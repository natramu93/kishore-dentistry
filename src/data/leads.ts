import "server-only";

import { cache } from "react";
import { db } from "./db";
import {
  requireActiveDoctorForBranch,
  requireActiveLeadSource,
  requireActiveTreatmentType,
  requireAppointmentForLead,
  requireAssignableUser,
  throwMappedDatabaseError,
} from "./helpers";
import type { AuthContext } from "@/lib/auth/context";
import {
  assertBranchAccess,
  assertLeadWriteAccess,
  canReadCallLogs,
  canReadLead,
  canDelete,
} from "@/lib/auth/guards";
import {
  canTransition,
  transitionPayloadSchemas,
} from "@/lib/leads/transitions";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import {
  EMPTY_UUID,
  assertIsoDateTime,
  assertLeadStatus,
  assertUuid,
  normalizeLimit,
  normalizePagination,
  normalizeSearch,
} from "@/lib/validation";
import type { Json, Lead, LeadStatus } from "@/lib/database.types";

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
  let query = db
    .from("leads")
    .select(
      "*, branch:branches(name, code), source:lead_sources(name), assignee:profiles!leads_assignee_id_fkey(full_name), interest:treatment_types!leads_interest_id_fkey(name, category)",
      { count: "exact" }
    )
    .is("deleted_at", null);
  if (ctx.role !== "admin") {
    query = query.in(
      "branch_id",
      ctx.branchIds.length ? [...ctx.branchIds] : [EMPTY_UUID]
    );
  }
  if (ctx.role === "front_office") {
    query = query.or(`assignee_id.eq.${ctx.userId},assignee_id.is.null`);
  }
  if (ctx.role === "doctor") query = query.eq("id", EMPTY_UUID);
  return query;
}

export async function listLeads(ctx: AuthContext, filters: LeadFilters = {}) {
  const { page, pageSize } = normalizePagination(filters.page, filters.pageSize);
  let query = scopedQuery(ctx);

  if (filters.status) query = query.eq("status", assertLeadStatus(filters.status));
  if (filters.branchId) {
    const branchId = assertUuid(filters.branchId, "Branch");
    assertBranchAccess(ctx, branchId);
    query = query.eq("branch_id", branchId);
  }
  if (filters.sourceId) {
    query = query.eq("source_id", assertUuid(filters.sourceId, "Lead source"));
  }
  if (filters.assigneeId) {
    query = query.eq("assignee_id", assertUuid(filters.assigneeId, "Assignee"));
  }
  const search = normalizeSearch(filters.search);
  if (search) {
    query = query.or(
      `name.ilike.%${search}%,mobile.ilike.%${search}%,email.ilike.%${search}%`
    );
  }

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) throw error;
  return { leads: data as LeadWithRefs[], total: count ?? 0, page, pageSize };
}

export const getLead = cache(
  async (ctx: AuthContext, id: string): Promise<LeadWithRefs | null> => {
    const leadId = assertUuid(id, "Lead");
    const { data, error } = await db
      .from("leads")
      .select(
        "*, branch:branches(name, code), source:lead_sources(name), assignee:profiles!leads_assignee_id_fkey(full_name), interest:treatment_types!leads_interest_id_fkey(name, category)"
      )
      .eq("id", leadId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    if (!data || !canReadLead(ctx, data)) return null;
    return data as LeadWithRefs;
  }
);

/** Duplicate check for the new-lead form. */
export async function findLeadsByMobile(ctx: AuthContext, mobile: string) {
  const normalized = mobile.trim().slice(0, 32);
  if (normalized.length < 7) return [];
  const { data, error } = await scopedQuery(ctx).eq("mobile", normalized).limit(5);
  if (error) throw error;
  return data as LeadWithRefs[];
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
  if (ctx.role === "doctor") {
    throw new AuthorizationError("Doctors cannot create leads");
  }
  const branchId = assertUuid(input.branch_id, "Branch");
  assertBranchAccess(ctx, branchId);
  await Promise.all([
    input.source_id ? requireActiveLeadSource(input.source_id) : Promise.resolve(),
    input.interest_id
      ? requireActiveTreatmentType(input.interest_id)
      : Promise.resolve(),
  ]);

  const { data, error } = await db.rpc("create_lead", {
    p_branch_id: branchId,
    p_name: input.name,
    p_mobile: input.mobile,
    p_email: input.email ?? null,
    p_source_id: input.source_id ?? null,
    p_interest_id: input.interest_id ?? null,
    p_age: input.age ?? null,
    p_dob: input.dob ?? null,
    p_notes: input.notes ?? null,
    p_actor: ctx.userId,
  });
  if (error) throwMappedDatabaseError(error, "Lead");
  return data as unknown as Lead;
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
  const leadId = assertUuid(id, "Lead");
  const lookup = await db
    .from("leads")
    .select("branch_id, assignee_id")
    .eq("id", leadId)
    .is("deleted_at", null)
    .maybeSingle();
  if (lookup.error) throw lookup.error;
  if (!lookup.data) throw new NotFoundError("Lead");
  assertLeadWriteAccess(ctx, lookup.data);

  await Promise.all([
    input.source_id ? requireActiveLeadSource(input.source_id) : Promise.resolve(),
    input.interest_id
      ? requireActiveTreatmentType(input.interest_id)
      : Promise.resolve(),
  ]);
  const { error } = await db.from("leads").update(input).eq("id", leadId);
  if (error) throw error;
}

/**
 * The single application entry point for pipeline changes. Conditional payload
 * checks happen here after loading the current state; the SQL RPC then locks and
 * applies the compound transition atomically.
 */
export async function transitionLead(
  ctx: AuthContext,
  leadIdValue: string,
  toValue: LeadStatus,
  payload: Record<string, unknown> = {}
): Promise<Lead> {
  const leadId = assertUuid(leadIdValue, "Lead");
  const to = assertLeadStatus(toValue);
  if (to === "visited_treated") {
    throw new ValidationError(
      "Finalize a coded digital case sheet to complete this visit"
    );
  }
  const lookup = await db
    .from("leads")
    .select("id, branch_id, assignee_id, status")
    .eq("id", leadId)
    .is("deleted_at", null)
    .maybeSingle();
  if (lookup.error) throw lookup.error;
  const lead = lookup.data;
  if (!lead) throw new NotFoundError("Lead");

  if (to === "assigned" && lead.status === "open") {
    assertBranchAccess(ctx, lead.branch_id);
    if (ctx.role === "doctor") throw new AuthorizationError("Doctors cannot manage leads");
  } else {
    assertLeadWriteAccess(ctx, lead);
  }
  if (lead.status === to) {
    const replay = await db.rpc("transition_lead", {
      p_lead_id: leadId,
      p_to: to,
      p_actor: ctx.userId,
      p_payload: {} as Json,
    });
    if (replay.error) throwMappedDatabaseError(replay.error, "Lead");
    return replay.data as unknown as Lead;
  }
  if (!canTransition(lead.status, to)) {
    throw new ConflictError(`Lead cannot move from ${lead.status} to ${to}`);
  }

  const schema = transitionPayloadSchemas[to as keyof typeof transitionPayloadSchemas];
  if (!schema) throw new ValidationError("Transition target is invalid");
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Transition details are invalid");
  }
  const trustedPayload: Record<string, unknown> = { ...parsed.data };

  if (to === "assigned") {
    if (lead.status === "appointment_booked") {
      const appointmentId = trustedPayload.cancelled_appointment_id;
      if (typeof appointmentId !== "string") {
        throw new ValidationError("Appointment to cancel is required");
      }
      await requireAppointmentForLead(appointmentId, leadId);
      if (!lead.assignee_id) {
        throw new ConflictError("Lead must have an assignee before cancelling its appointment");
      }
      // The current SQL RPC always applies assignee_id for an assigned target.
      // Preserve the trusted current assignee rather than accepting it from the client.
      trustedPayload.assignee_id = lead.assignee_id;
    } else {
      const assigneeId = trustedPayload.assignee_id;
      if (typeof assigneeId !== "string") {
        throw new ValidationError("Assignee is required");
      }
      if (ctx.role === "front_office" && assigneeId !== ctx.userId) {
        throw new AuthorizationError("Front Office can only assign leads to themselves");
      }
      await requireAssignableUser(assigneeId, lead.branch_id);
    }
  }

  if (to === "appointment_booked") {
    trustedPayload.scheduled_at = assertIsoDateTime(
      trustedPayload.scheduled_at,
      "Appointment date"
    );
    if (typeof trustedPayload.doctor_id === "string") {
      await requireActiveDoctorForBranch(trustedPayload.doctor_id, lead.branch_id);
    }
  }

  if (to === "missed") {
    if (typeof trustedPayload.appointment_id !== "string") {
      throw new ValidationError("Scheduled appointment is required");
    }
    await requireAppointmentForLead(trustedPayload.appointment_id, leadId);
  }

  if (to === "dropped" && typeof trustedPayload.appointment_id === "string") {
    await requireAppointmentForLead(trustedPayload.appointment_id, leadId);
  }

  if (to === "follow_up") {
    trustedPayload.due_at = assertIsoDateTime(trustedPayload.due_at, "Follow-up date");
  }

  const { data, error } = await db.rpc("transition_lead", {
    p_lead_id: leadId,
    p_to: to,
    p_actor: ctx.userId,
    p_payload: trustedPayload as Json,
  });
  if (error) throwMappedDatabaseError(error, "Lead");
  return data as unknown as Lead;
}

export async function deleteLead(ctx: AuthContext, id: string) {
  const leadId = assertUuid(id, "Lead");
  const lookup = await db
    .from("leads")
    .select("branch_id")
    .eq("id", leadId)
    .is("deleted_at", null)
    .maybeSingle();
  if (lookup.error) throw lookup.error;
  if (!lookup.data) return;
  if (!canDelete(ctx.role)) {
    throw new AuthorizationError("Only Operations or Admin can delete leads");
  }
  assertBranchAccess(ctx, lookup.data.branch_id);
  const { error } = await db.rpc("soft_delete_lead", {
    p_lead_id: leadId,
    p_actor: ctx.userId,
    p_reason: "Deleted by user",
  });
  if (error) throwMappedDatabaseError(error, "Lead");
}

export async function getLeadActivity(ctx: AuthContext, leadIdValue: string, limit = 200) {
  const leadId = assertUuid(leadIdValue, "Lead");
  const lead = await getLead(ctx, leadId);
  if (!lead) return [];
  const { data, error } = await db
    .from("lead_activity")
    .select("*, actor:profiles!lead_activity_actor_id_fkey(full_name)")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(normalizeLimit(limit, 200, 200));
  if (error) throw error;
  return data;
}

export async function getLeadRelated(ctx: AuthContext, leadIdValue: string) {
  const leadId = assertUuid(leadIdValue, "Lead");
  const lead = await getLead(ctx, leadId);
  if (!lead) return null;
  const limit = 200;

  const results = await Promise.all([
    db
      .from("appointments")
      .select("*, doctor:doctors(full_name)")
      .eq("lead_id", leadId)
      .order("scheduled_at", { ascending: false })
      .limit(limit),
    db
      .from("treatments")
      .select("*, treatment_type:treatment_types(name), doctor:doctors(full_name)")
      .eq("lead_id", leadId)
      .order("treated_at", { ascending: false })
      .limit(limit),
    db
      .from("follow_ups")
      .select("*")
      .eq("lead_id", leadId)
      .order("due_at", { ascending: false })
      .limit(limit),
    db
      .from("invoices")
      .select("*, payments:invoice_payments(amount, payment_method)")
      .eq("lead_id", leadId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limit),
    canReadCallLogs(ctx)
      ? db
          .from("call_logs")
          .select("id, source_system, external_call_id, phone, caller_name, status, started_at, duration_seconds, summary")
          .eq("lead_id", leadId)
          .order("started_at", { ascending: false, nullsFirst: false })
          .limit(limit)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of results) {
    if (result.error) throw result.error;
  }

  return {
    lead,
    appointments: results[0].data,
    treatments: results[1].data,
    followUps: results[2].data,
    invoices: (results[3].data ?? []).map((invoice) => {
      const payments = invoice.payments ?? [];
      const amount_paid = invoice.status === "paid" && payments.length === 0
        ? Number(invoice.total)
        : payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
      return { ...invoice, payments, amount_paid, balance_due: Math.max(0, Number(invoice.total) - amount_paid) };
    }),
    callLogs: results[4].data,
  };
}
