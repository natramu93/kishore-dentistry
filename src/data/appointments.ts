import "server-only";

import { db } from "./db";
import type { AuthContext } from "@/lib/auth/context";
import { assertBranchAccess } from "@/lib/auth/guards";
import type { Appointment } from "@/lib/database.types";

const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

export type AppointmentWithRefs = Appointment & {
  lead: { id: string; name: string; mobile: string; status: string; assignee_id: string | null } | null;
  doctor: { full_name: string } | null;
  branch: { name: string; code: string } | null;
};

export async function listAppointments(
  ctx: AuthContext,
  opts: {
    from?: string; // ISO
    to?: string;
    branchId?: string;
    status?: Appointment["status"];
  } = {}
): Promise<AppointmentWithRefs[]> {
  let q = db
    .from("appointments")
    .select(
      "*, lead:leads(id, name, mobile, status, assignee_id), doctor:doctors(full_name), branch:branches(name, code)"
    )
    .order("scheduled_at");

  if (ctx.role !== "admin") {
    q = q.in("branch_id", ctx.branchIds.length ? ctx.branchIds : [EMPTY_UUID]);
  }
  if (opts.branchId) {
    assertBranchAccess(ctx, opts.branchId);
    q = q.eq("branch_id", opts.branchId);
  }
  if (opts.from) q = q.gte("scheduled_at", opts.from);
  if (opts.to) q = q.lt("scheduled_at", opts.to);
  if (opts.status) q = q.eq("status", opts.status);

  const { data, error } = await q;
  if (error) throw error;

  let rows = (data ?? []) as AppointmentWithRefs[];
  // Agents see appointments for their leads (or unassigned pool leads)
  if (ctx.role === "agent") {
    rows = rows.filter(
      (a) => !a.lead || a.lead.assignee_id === ctx.userId || a.lead.assignee_id === null
    );
  }
  return rows;
}
