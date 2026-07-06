import "server-only";

import { db } from "./db";
import type { AuthContext } from "@/lib/auth/context";
import { AuthorizationError } from "@/lib/auth/context";
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

/**
 * Reschedule a scheduled appointment and/or reassign it to another doctor.
 * Only scheduled appointments can be changed; completed/cancelled/no-show are locked.
 */
export async function updateAppointment(
  ctx: AuthContext,
  id: string,
  input: {
    scheduled_at?: string;
    doctor_id?: string | null;
    duration_minutes?: number;
    notes?: string | null;
  }
): Promise<{ lead_id: string }> {
  const { data: appt } = await db
    .from("appointments")
    .select("branch_id, status, lead_id, scheduled_at, doctor_id, lead:leads(assignee_id)")
    .eq("id", id)
    .maybeSingle();
  if (!appt) throw new Error("Appointment not found");
  assertBranchAccess(ctx, appt.branch_id);
  const assignee = (appt.lead as { assignee_id: string | null } | null)?.assignee_id;
  if (ctx.role === "agent" && assignee && assignee !== ctx.userId) {
    throw new AuthorizationError("This lead is not assigned to you");
  }
  if (appt.status !== "scheduled") {
    throw new Error("Only scheduled appointments can be rescheduled");
  }

  const patch: Partial<
    Pick<Appointment, "scheduled_at" | "doctor_id" | "duration_minutes" | "notes">
  > = {};
  if (input.scheduled_at !== undefined) patch.scheduled_at = input.scheduled_at;
  if (input.doctor_id !== undefined) patch.doctor_id = input.doctor_id;
  if (input.duration_minutes !== undefined) patch.duration_minutes = input.duration_minutes;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (Object.keys(patch).length === 0) return { lead_id: appt.lead_id };

  const { error } = await db.from("appointments").update(patch).eq("id", id);
  if (error) throw error;

  await db.from("lead_activity").insert({
    lead_id: appt.lead_id,
    actor_id: ctx.userId,
    type: "appointment",
    detail: {
      event: "rescheduled",
      appointment_id: id,
      ...(input.scheduled_at ? { scheduled_at: input.scheduled_at } : {}),
      ...(input.doctor_id !== undefined ? { doctor_id: input.doctor_id } : {}),
    },
  });

  return { lead_id: appt.lead_id };
}
