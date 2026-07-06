import "server-only";

import { cache } from "react";
import { db } from "./db";
import type { AuthContext } from "@/lib/auth/context";
import { AuthorizationError } from "@/lib/auth/context";
import {
  assertBranchAccess,
  assertLeadWriteAccess,
  canReadLead,
} from "@/lib/auth/guards";
import { canTransition } from "@/lib/leads/transitions";
import type { Json, Lead, LeadStatus } from "@/lib/database.types";

const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

export type LeadWithRefs = Lead & {
  branch: { name: string; code: string } | null;
  source: { name: string } | null;
  assignee: { full_name: string } | null;
  interest: { name: string; category: string | null } | null;
};

export type LeadFilters = {
  status?: LeadStatus;
  branchId?: string;
  sourceId?: string;
  assigneeId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
};

function scopedQuery(ctx: AuthContext) {
  let q = db
    .from("leads")
    .select(
      "*, branch:branches(name, code), source:lead_sources(name), assignee:profiles!leads_assignee_id_fkey(full_name), interest:treatment_types!leads_interest_id_fkey(name, category)",
      { count: "exact" }
    );
  if (ctx.role !== "admin") {
    q = q.in("branch_id", ctx.branchIds.length ? ctx.branchIds : [EMPTY_UUID]);
  }
  if (ctx.role === "agent") {
    q = q.or(`assignee_id.eq.${ctx.userId},assignee_id.is.null`);
  }
  return q;
}

export async function listLeads(ctx: AuthContext, filters: LeadFilters = {}) {
  const pageSize = filters.pageSize ?? 25;
  const page = filters.page ?? 1;

  let q = scopedQuery(ctx);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.branchId) {
    assertBranchAccess(ctx, filters.branchId);
    q = q.eq("branch_id", filters.branchId);
  }
  if (filters.sourceId) q = q.eq("source_id", filters.sourceId);
  if (filters.assigneeId) q = q.eq("assignee_id", filters.assigneeId);
  if (filters.search) {
    const s = filters.search.replaceAll(",", " ").trim();
    q = q.or(`name.ilike.%${s}%,mobile.ilike.%${s}%,email.ilike.%${s}%`);
  }

  const from = (page - 1) * pageSize;
  const { data, error, count } = await q
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) throw error;
  return { leads: (data ?? []) as LeadWithRefs[], total: count ?? 0, page, pageSize };
}

// Cached per request: the lead detail page reads the same lead through several
// helpers — cache() collapses those into a single DB round-trip.
export const getLead = cache(
  async (ctx: AuthContext, id: string): Promise<LeadWithRefs | null> => {
    const { data, error } = await db
      .from("leads")
      .select(
        "*, branch:branches(name, code), source:lead_sources(name), assignee:profiles!leads_assignee_id_fkey(full_name), interest:treatment_types!leads_interest_id_fkey(name, category)"
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data || !canReadLead(ctx, data)) return null;
    return data as LeadWithRefs;
  }
);

/** Duplicate check for the new-lead form. */
export async function findLeadsByMobile(ctx: AuthContext, mobile: string) {
  const { data } = await scopedQuery(ctx).eq("mobile", mobile).limit(5);
  return (data ?? []) as LeadWithRefs[];
}

export async function createLead(
  ctx: AuthContext,
  input: {
    branch_id: string;
    name: string;
    mobile: string;
    email?: string | null;
    source_id?: string | null;
    interest_id?: string | null;
    age?: number | null;
    dob?: string | null;
    notes?: string | null;
  }
): Promise<Lead> {
  assertBranchAccess(ctx, input.branch_id);
  const { data, error } = await db
    .from("leads")
    .insert({ ...input, created_by: ctx.userId })
    .select()
    .single();
  if (error) throw error;

  await db.from("lead_activity").insert({
    lead_id: data.id,
    actor_id: ctx.userId,
    type: "note",
    detail: { event: "lead_created" },
  });
  return data;
}

export async function updateLeadDetails(
  ctx: AuthContext,
  id: string,
  input: {
    name?: string;
    mobile?: string;
    email?: string | null;
    source_id?: string | null;
    interest_id?: string | null;
    age?: number | null;
    dob?: string | null;
    notes?: string | null;
  }
) {
  const { data: lead } = await db.from("leads").select("branch_id, assignee_id").eq("id", id).maybeSingle();
  if (!lead) throw new Error("Lead not found");
  // Editing contact details is allowed for anyone who can read the lead at
  // their branch; agents may also fix details of unassigned pool leads.
  assertBranchAccess(ctx, lead.branch_id);
  if (ctx.role === "agent" && lead.assignee_id && lead.assignee_id !== ctx.userId) {
    throw new AuthorizationError("This lead is not assigned to you");
  }
  const { error } = await db.from("leads").update(input).eq("id", id);
  if (error) throw error;
}

/**
 * The single entry point for status changes. Authorizes, checks the
 * transition map, then delegates to the atomic crm.transition_lead RPC
 * (which also validates via trigger — defense in depth).
 */
export async function transitionLead(
  ctx: AuthContext,
  leadId: string,
  to: LeadStatus,
  payload: Record<string, unknown> = {}
): Promise<Lead> {
  const { data: lead } = await db
    .from("leads")
    .select("id, branch_id, assignee_id, status")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) throw new Error("Lead not found");

  // Assigning from the open pool: agents may claim/receive unassigned leads
  if (to === "assigned" && lead.status === "open") {
    assertBranchAccess(ctx, lead.branch_id);
    if (ctx.role === "agent" && payload.assignee_id !== ctx.userId) {
      throw new AuthorizationError("Agents can only assign open leads to themselves");
    }
  } else {
    assertLeadWriteAccess(ctx, lead);
  }

  if (!canTransition(lead.status, to)) {
    throw new Error(`Illegal transition: ${lead.status} -> ${to}`);
  }

  const { data, error } = await db.rpc("transition_lead", {
    p_lead_id: leadId,
    p_to: to,
    p_actor: ctx.userId,
    p_payload: payload as Json,
  });
  if (error) throw error;
  return data as unknown as Lead;
}

/** Delete a lead and all its child records (cascade). Managers/admins only. */
export async function deleteLead(ctx: AuthContext, id: string) {
  const { data: lead } = await db.from("leads").select("branch_id").eq("id", id).maybeSingle();
  if (!lead) return;
  if (ctx.role === "agent") throw new AuthorizationError("Only managers or admins can delete leads");
  assertBranchAccess(ctx, lead.branch_id);
  const { error } = await db.from("leads").delete().eq("id", id);
  if (error) throw error;
}

export async function getLeadActivity(ctx: AuthContext, leadId: string) {
  const lead = await getLead(ctx, leadId);
  if (!lead) return [];
  const { data, error } = await db
    .from("lead_activity")
    .select("*, actor:profiles!lead_activity_actor_id_fkey(full_name)")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Child records for the lead detail tabs. */
export async function getLeadRelated(ctx: AuthContext, leadId: string) {
  const lead = await getLead(ctx, leadId);
  if (!lead) return null;

  const [appointments, treatments, followUps, invoices] = await Promise.all([
    db
      .from("appointments")
      .select("*, doctor:doctors(full_name)")
      .eq("lead_id", leadId)
      .order("scheduled_at", { ascending: false }),
    db
      .from("treatments")
      .select("*, treatment_type:treatment_types(name), doctor:doctors(full_name)")
      .eq("lead_id", leadId)
      .order("treated_at", { ascending: false }),
    db.from("follow_ups").select("*").eq("lead_id", leadId).order("due_at", { ascending: false }),
    db.from("invoices").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }),
  ]);

  return {
    lead,
    appointments: appointments.data ?? [],
    treatments: treatments.data ?? [],
    followUps: followUps.data ?? [],
    invoices: invoices.data ?? [],
  };
}
