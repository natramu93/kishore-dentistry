import "server-only";

import { db } from "./db";
import type { AuthContext } from "@/lib/auth/context";
import { AuthorizationError } from "@/lib/auth/context";
import { assertBranchAccess } from "@/lib/auth/guards";
import type { FollowUp } from "@/lib/database.types";

const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

export type FollowUpWithLead = FollowUp & {
  lead: { id: string; name: string; mobile: string; status: string; assignee_id: string | null } | null;
  branch: { name: string; code: string } | null;
};

export async function listFollowUps(
  ctx: AuthContext,
  opts: { status?: FollowUp["status"]; dueBefore?: string; branchId?: string } = {}
): Promise<FollowUpWithLead[]> {
  // Follow-ups are a Front Office / Operations workflow — doctors work through
  // appointments and treatment records instead.
  if (ctx.role === "doctor") return [];

  let q = db
    .from("follow_ups")
    .select("*, lead:leads(id, name, mobile, status, assignee_id), branch:branches(name, code)")
    .order("due_at");

  if (ctx.role !== "admin") {
    q = q.in("branch_id", ctx.branchIds.length ? ctx.branchIds : [EMPTY_UUID]);
  }
  if (opts.branchId) {
    assertBranchAccess(ctx, opts.branchId);
    q = q.eq("branch_id", opts.branchId);
  }
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.dueBefore) q = q.lt("due_at", opts.dueBefore);

  const { data, error } = await q;
  if (error) throw error;

  let rows = (data ?? []) as FollowUpWithLead[];
  if (ctx.role === "front_office") {
    rows = rows.filter(
      (f) => !f.lead || f.lead.assignee_id === ctx.userId || f.lead.assignee_id === null
    );
  }
  return rows;
}

export async function completeFollowUp(
  ctx: AuthContext,
  id: string,
  outcome: { status: "done" | "cancelled"; outcome_notes?: string }
) {
  const { data: followUp } = await db
    .from("follow_ups")
    .select("branch_id, lead_id, leads:leads(assignee_id)")
    .eq("id", id)
    .maybeSingle();
  if (!followUp) throw new Error("Follow-up not found");
  if (ctx.role === "doctor") {
    throw new AuthorizationError("Follow-ups are managed by Front Office / Operations");
  }
  assertBranchAccess(ctx, followUp.branch_id);
  const assignee = (followUp.leads as { assignee_id: string | null } | null)?.assignee_id;
  if (ctx.role === "front_office" && assignee && assignee !== ctx.userId) {
    throw new AuthorizationError("This lead is not assigned to you");
  }

  const { error } = await db
    .from("follow_ups")
    .update({ ...outcome, completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
