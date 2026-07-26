import "server-only";

import { db } from "./db";
import {
  recordLeadActivity,
  requireActiveDoctorForBranch,
  requireActiveTreatmentType,
  throwMappedDatabaseError,
} from "./helpers";
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
  assertAppointmentStatus,
  assertIsoDateTime,
  assertUuid,
  normalizePagination,
} from "@/lib/validation";
import type { Appointment, Json } from "@/lib/database.types";

export type AppointmentWithRefs = Appointment & {
  lead: {
    id: string;
    name: string;
    mobile: string;
    status: string;
    assignee_id: string | null;
  } | null;
  doctor: { full_name: string } | null;
  branch: { name: string; code: string } | null;
};

export async function listAppointments(
  ctx: AuthContext,
  opts: {
    from?: string;
    to?: string;
    branchId?: string;
    doctorId?: string;
    status?: Appointment["status"];
    page?: number;
    pageSize?: number;
  } = {}
): Promise<{
  appointments: AppointmentWithRefs[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const { page, pageSize } = normalizePagination(opts.page, opts.pageSize);
  let query = db
    .from("appointments")
    .select(
      "*, lead:leads!inner(id, name, mobile, status, assignee_id), doctor:doctors(full_name), branch:branches(name, code)",
      { count: "exact" }
    )
    .order("scheduled_at");

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
  if (opts.from) query = query.gte("scheduled_at", assertIsoDateTime(opts.from, "Start date"));
  if (opts.to) query = query.lt("scheduled_at", assertIsoDateTime(opts.to, "End date"));
  if (opts.status) query = query.eq("status", assertAppointmentStatus(opts.status));
  if (opts.doctorId) query = query.eq("doctor_id", assertUuid(opts.doctorId, "Doctor"));
  if (ctx.role === "doctor") {
    query = query.eq("doctor_id", ctx.doctorId ?? EMPTY_UUID);
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
    appointments: data as AppointmentWithRefs[],
    total: count ?? 0,
    page,
    pageSize,
  };
}

export async function updateAppointment(
  ctx: AuthContext,
  id: string,
  input: {
    scheduled_at?: string;
    doctor_id?: string | null;
    duration_minutes?: number;
    notes?: string | null;
  },
  expectedLeadId?: string
): Promise<{ lead_id: string }> {
  const appointmentId = assertUuid(id, "Appointment");
  const lookup = await db
    .from("appointments")
    .select("branch_id, status, lead_id, lead:leads(assignee_id)")
    .eq("id", appointmentId)
    .maybeSingle();
  if (lookup.error) throw lookup.error;
  const appointment = lookup.data;
  if (!appointment) throw new NotFoundError("Appointment");
  if (
    expectedLeadId &&
    appointment.lead_id !== assertUuid(expectedLeadId, "Lead")
  ) {
    throw new ValidationError("Appointment does not belong to this lead");
  }
  if (ctx.role === "doctor") {
    throw new AuthorizationError("Ask Front Office or Operations to reschedule an appointment");
  }
  const assignee = (appointment.lead as { assignee_id: string | null } | null)?.assignee_id;
  assertLeadWriteAccess(ctx, {
    branch_id: appointment.branch_id,
    assignee_id: assignee ?? null,
  });
  if (appointment.status !== "scheduled") {
    throw new ConflictError("Only scheduled appointments can be rescheduled");
  }

  const patch: Partial<
    Pick<Appointment, "scheduled_at" | "doctor_id" | "duration_minutes" | "notes">
  > = {};
  if (input.scheduled_at !== undefined) {
    patch.scheduled_at = assertIsoDateTime(input.scheduled_at, "Appointment date");
  }
  if (input.doctor_id !== undefined) {
    if (input.doctor_id) {
      await requireActiveDoctorForBranch(input.doctor_id, appointment.branch_id);
      patch.doctor_id = input.doctor_id;
    } else {
      patch.doctor_id = null;
    }
  }
  if (input.duration_minutes !== undefined) {
    if (
      !Number.isInteger(input.duration_minutes) ||
      input.duration_minutes < 5 ||
      input.duration_minutes > 480
    ) {
      throw new ValidationError("Duration must be between 5 and 480 minutes");
    }
    patch.duration_minutes = input.duration_minutes;
  }
  if (input.notes !== undefined) {
    if (input.notes && input.notes.length > 4_000) {
      throw new ValidationError("Appointment notes are too long");
    }
    patch.notes = input.notes;
  }
  if (!Object.keys(patch).length) return { lead_id: appointment.lead_id };

  const updateResult = await db
    .from("appointments")
    .update(patch)
    .eq("id", appointmentId)
    .eq("status", "scheduled")
    .select("id")
    .maybeSingle();
  if (updateResult.error) throwMappedDatabaseError(updateResult.error, "Appointment");
  if (!updateResult.data) {
    throw new ConflictError("Appointment changed while you were editing it");
  }

  await recordLeadActivity({
    lead_id: appointment.lead_id,
    actor_id: ctx.userId,
    type: "appointment",
    detail: {
      event: "rescheduled",
      appointment_id: appointmentId,
      ...(patch.scheduled_at ? { scheduled_at: patch.scheduled_at } : {}),
      ...(input.doctor_id !== undefined ? { doctor_id: input.doctor_id } : {}),
    },
  });
  return { lead_id: appointment.lead_id };
}

async function loadOwnScheduledAppointment(ctx: AuthContext, appointmentIdValue: string) {
  const appointmentId = assertUuid(appointmentIdValue, "Appointment");
  if (ctx.role !== "doctor" || !ctx.doctorId) {
    throw new AuthorizationError("Only a linked doctor can update this appointment");
  }
  const result = await db
    .from("appointments")
    .select("id, lead_id, branch_id, doctor_id, status")
    .eq("id", appointmentId)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new NotFoundError("Appointment");
  if (result.data.doctor_id !== ctx.doctorId) {
    throw new AuthorizationError("This appointment is not on your schedule");
  }
  if (result.data.status !== "scheduled") {
    throw new ConflictError("Only a scheduled appointment can be updated");
  }
  return result.data;
}

export async function doctorCompleteAppointment(
  ctx: AuthContext,
  appointmentId: string,
  treatment: { treatment_type_id?: string; cost?: number; notes?: string }
): Promise<{ lead_id: string }> {
  const appointment = await loadOwnScheduledAppointment(ctx, appointmentId);
  if (treatment.treatment_type_id) {
    await requireActiveTreatmentType(treatment.treatment_type_id);
  }
  if (
    treatment.cost !== undefined &&
    (!Number.isFinite(treatment.cost) || treatment.cost < 0 || treatment.cost > 100_000_000)
  ) {
    throw new ValidationError("Treatment cost is invalid");
  }
  if (treatment.notes && treatment.notes.length > 4_000) {
    throw new ValidationError("Treatment notes are too long");
  }

  const { error } = await db.rpc("transition_lead", {
    p_lead_id: appointment.lead_id,
    p_to: "visited_treated",
    p_actor: ctx.userId,
    p_payload: {
      appointment_id: appointment.id,
      treatment_type_id: treatment.treatment_type_id,
      doctor_id: ctx.doctorId,
      cost: treatment.cost,
      notes: treatment.notes,
    } as Json,
  });
  if (error) throwMappedDatabaseError(error, "Appointment");
  return { lead_id: appointment.lead_id };
}

export async function doctorMarkNoShow(
  ctx: AuthContext,
  appointmentId: string
): Promise<{ lead_id: string }> {
  const appointment = await loadOwnScheduledAppointment(ctx, appointmentId);
  const { error } = await db.rpc("transition_lead", {
    p_lead_id: appointment.lead_id,
    p_to: "missed",
    p_actor: ctx.userId,
    p_payload: { appointment_id: appointment.id } as Json,
  });
  if (error) throwMappedDatabaseError(error, "Appointment");
  return { lead_id: appointment.lead_id };
}
