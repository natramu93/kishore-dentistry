import "server-only";

import { db } from "./db";
import type { AuthContext } from "@/lib/auth/context";
import { AuthorizationError } from "@/lib/auth/context";
import { assertBranchAccess } from "@/lib/auth/guards";
import type { Appointment, Json } from "@/lib/database.types";

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
    doctorId?: string;
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
  if (opts.doctorId) q = q.eq("doctor_id", opts.doctorId);
  // Doctors only ever see their own schedule.
  if (ctx.role === "doctor") q = q.eq("doctor_id", ctx.doctorId ?? EMPTY_UUID);

  const { data, error } = await q;
  if (error) throw error;

  let rows = (data ?? []) as AppointmentWithRefs[];
  // Front Office sees appointments for their leads (or the unassigned pool)
  if (ctx.role === "front_office") {
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
  if (ctx.role === "doctor") {
    throw new AuthorizationError("Ask Front Office or Operations to reschedule an appointment");
  }
  assertBranchAccess(ctx, appt.branch_id);
  const assignee = (appt.lead as { assignee_id: string | null } | null)?.assignee_id;
  if (ctx.role === "front_office" && assignee && assignee !== ctx.userId) {
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

async function loadOwnScheduledAppointment(ctx: AuthContext, appointmentId: string) {
  if (ctx.role !== "doctor" || !ctx.doctorId) {
    throw new AuthorizationError("Only a doctor login can act on its own appointment this way");
  }
  const { data: appt } = await db
    .from("appointments")
    .select("id, lead_id, doctor_id, status")
    .eq("id", appointmentId)
    .maybeSingle();
  if (!appt) throw new Error("Appointment not found");
  if (appt.doctor_id !== ctx.doctorId) {
    throw new AuthorizationError("This appointment isn't on your schedule");
  }
  if (appt.status !== "scheduled") {
    throw new Error("Only a scheduled appointment can be updated");
  }
  return appt;
}

/**
 * Doctor-only: complete their own appointment and log the treatment performed.
 * Reuses the same crm.transition_lead RPC the lead pipeline uses (visited_treated),
 * so the lead's status/activity trail stays consistent either way it's triggered.
 */
export async function doctorCompleteAppointment(
  ctx: AuthContext,
  appointmentId: string,
  treatment: { treatment_type_id?: string; cost?: number; notes?: string }
): Promise<{ lead_id: string }> {
  const appt = await loadOwnScheduledAppointment(ctx, appointmentId);
  const { error } = await db.rpc("transition_lead", {
    p_lead_id: appt.lead_id,
    p_to: "visited_treated",
    p_actor: ctx.userId,
    p_payload: {
      appointment_id: appointmentId,
      treatment_type_id: treatment.treatment_type_id,
      cost: treatment.cost,
      notes: treatment.notes,
    } as Json,
  });
  if (error) throw error;
  return { lead_id: appt.lead_id };
}

/** Doctor-only: mark their own appointment a no-show. */
export async function doctorMarkNoShow(ctx: AuthContext, appointmentId: string): Promise<{ lead_id: string }> {
  const appt = await loadOwnScheduledAppointment(ctx, appointmentId);
  const { error } = await db.rpc("transition_lead", {
    p_lead_id: appt.lead_id,
    p_to: "missed",
    p_actor: ctx.userId,
    p_payload: { appointment_id: appointmentId } as Json,
  });
  if (error) throw error;
  return { lead_id: appt.lead_id };
}
