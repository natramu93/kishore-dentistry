import "server-only";

import { db } from "./db";
import type { AuthContext } from "@/lib/auth/context";
import {
  assertBranchAccess,
  assertLeadWriteAccess,
} from "@/lib/auth/guards";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import {
  EMPTY_UUID,
  assertFollowUpStatus,
  assertIsoDateTime,
  assertUuid,
  normalizePagination,
} from "@/lib/validation";
import type { FollowUp } from "@/lib/database.types";

export type FollowUpWithLead = FollowUp & {
  lead: {
    id: string;
    name: string;
    mobile: string;
    status: string;
    assignee_id: string | null;
  } | null;
  branch: { name: string; code: string } | null;
};

export async function listFollowUps(
  ctx: AuthContext,
  opts: {
    status?: FollowUp["status"];
    dueFrom?: string;
    dueBefore?: string;
    branchId?: string;
    page?: number;
    pageSize?: number;
  } = {}
): Promise<{
  followUps: FollowUpWithLead[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const { page, pageSize } = normalizePagination(opts.page, opts.pageSize);
  if (ctx.role === "doctor") {
    return { followUps: [], total: 0, page, pageSize };
  }

  let query = db
    .from("follow_ups")
    .select(
      "*, lead:leads!inner(id, name, mobile, status, assignee_id), branch:branches(name, code)",
      { count: "exact" }
    )
    .order("due_at");
  if (ctx.role !== "admin") {
    query = query.in(
      "branch_id",
      ctx.branchIds.length ? [...ctx.branchIds] : [EMPTY_UUID]
    );
  }
  if (opts.branchId) {
    const branchId = assertUuid(opts.branchId, "Branch");
    assertBranchAccess(ctx, branchId);
    query = query.eq("branch_id", branchId);
  }
  if (opts.status) query = query.eq("status", assertFollowUpStatus(opts.status));
  if (opts.dueFrom) {
    query = query.gte("due_at", assertIsoDateTime(opts.dueFrom, "Due date"));
  }
  if (opts.dueBefore) {
    query = query.lt("due_at", assertIsoDateTime(opts.dueBefore, "Due date"));
  }
  if (ctx.role === "front_office") {
    query = query.or(`assignee_id.eq.${ctx.userId},assignee_id.is.null`, {
      referencedTable: "lead",
    });
  }

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query.range(
    from,
    from + pageSize - 1
  );
  if (error) throw error;
  return {
    followUps: data as FollowUpWithLead[],
    total: count ?? 0,
    page,
    pageSize,
  };
}

export async function completeFollowUp(
  ctx: AuthContext,
  id: string,
  outcome: { status: "done" | "cancelled"; outcome_notes?: string }
): Promise<{ lead_id: string }> {
  const followUpId = assertUuid(id, "Follow-up");
  const status = assertFollowUpStatus(outcome.status);
  if (status !== "done" && status !== "cancelled") {
    throw new ValidationError("Follow-up outcome is invalid");
  }
  if (outcome.outcome_notes && outcome.outcome_notes.length > 4_000) {
    throw new ValidationError("Outcome notes are too long");
  }

  const lookup = await db
    .from("follow_ups")
    .select("branch_id, lead_id, status, lead:leads(assignee_id)")
    .eq("id", followUpId)
    .maybeSingle();
  if (lookup.error) throw lookup.error;
  const followUp = lookup.data;
  if (!followUp) throw new NotFoundError("Follow-up");
  if (ctx.role === "doctor") {
    throw new AuthorizationError("Follow-ups are managed by Front Office or Operations");
  }
  const assignee = (followUp.lead as { assignee_id: string | null } | null)?.assignee_id;
  assertLeadWriteAccess(ctx, {
    branch_id: followUp.branch_id,
    assignee_id: assignee ?? null,
  });
  if (followUp.status !== "pending") {
    throw new ConflictError("This follow-up has already been completed");
  }

  const updateResult = await db
    .from("follow_ups")
    .update({
      status,
      outcome_notes: outcome.outcome_notes?.trim() || null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", followUpId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (updateResult.error) throw updateResult.error;
  if (!updateResult.data) {
    throw new ConflictError("Follow-up changed while you were updating it");
  }
  return { lead_id: followUp.lead_id };
}
