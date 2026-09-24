import "server-only";

import { db } from "./db";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { assertUuid } from "@/lib/validation";
import type { CommentEntity, Json } from "@/lib/database.types";

export function throwIfError(error: unknown): void {
  if (error) throw error;
}

export function throwMappedDatabaseError(
  error: unknown,
  resource = "Record"
): never {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  const databaseMessage =
    typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : "";
  if (code === "40001") {
    throw new ConflictError(`${resource} changed in another request. Refresh and try again.`);
  }
  if (code === "23P01") {
    throw new ConflictError("The doctor already has an overlapping appointment");
  }
  if (code === "P0002") throw new NotFoundError(resource);
  if (code === "42501") {
    if (/only the treating doctor may amend prescriptions/i.test(databaseMessage)) {
      throw new AuthorizationError(databaseMessage);
    }
    if (/this patient is not assigned to you/i.test(databaseMessage)) {
      throw new AuthorizationError(databaseMessage);
    }
    throw new AuthorizationError();
  }
  if (code === "23514" || code === "22023" || code === "55000") {
    if (resource === "Case sheet") {
      if (/case-sheet amendment window has expired/i.test(databaseMessage)) {
        throw new ConflictError("Case sheets can only be amended within 24 hours of finalization.");
      }
      if (/a treatment linked to an invoice or file cannot be (changed|removed)/i.test(databaseMessage)) {
        throw new ConflictError(databaseMessage);
      }
      if (/only the treating doctor may amend prescriptions/i.test(databaseMessage)) {
        throw new AuthorizationError(databaseMessage);
      }
      if (/this patient is not assigned to you/i.test(databaseMessage)) {
        throw new AuthorizationError(databaseMessage);
      }
      if (/lead must have a booked appointment/i.test(databaseMessage)) {
        throw new ConflictError(
          "This patient no longer has an active booked appointment. Refresh the lead and open the current appointment before saving the case sheet."
        );
      }
      if (/case sheet requires this patient.?s scheduled appointment/i.test(databaseMessage)) {
        throw new ConflictError(
          "The selected appointment is no longer scheduled. Refresh the lead and open a current scheduled appointment before saving."
        );
      }
      if (/treatment status, scope, quantity, or cost is invalid|multi-tooth treatments require/i.test(databaseMessage)) {
        throw new ConflictError(
          "Review the treatment code, status, and tooth selection. A completed case sheet can only contain valid coded treatment details."
        );
      }
      if (/medical history details are invalid|medical history must be reviewed/i.test(databaseMessage)) {
        throw new ConflictError(
          "Review the Medical History section and confirm the patient’s conditions before saving the case sheet."
        );
      }
      if (/prescription line/i.test(databaseMessage)) {
        throw new ConflictError(
          "Review the prescription details. Each medicine needs a dose timing and valid duration before the case sheet can be saved."
        );
      }
      if (/visit time|completed treatment time/i.test(databaseMessage)) {
        throw new ConflictError(
          "The case-sheet entry time is captured by the server and does not need to match the appointment schedule. Refresh the lead and try again."
        );
      }
      throw new ConflictError(
        "This case sheet could not be saved because the appointment or clinical record changed. Refresh the lead and try again."
      );
    }
    throw new ConflictError(`${resource} cannot be changed in its current state`);
  }
  throw error;
}

export async function recordLeadActivity(
  input: {
    lead_id: string;
    actor_id: string;
    type: string;
    detail?: Json;
  },
  options: { required?: boolean } = {}
): Promise<void> {
  const { error } = await db.from("lead_activity").insert({
    ...input,
    detail: input.detail ?? {},
  });
  if (!error) return;
  if (options.required) throw error;
  console.error("Unable to record lead activity", {
    leadId: input.lead_id,
    type: input.type,
    error,
  });
}

export async function requireActiveDoctorForBranch(
  doctorId: string,
  branchId: string
): Promise<{ id: string; branch_id: string; profile_id: string | null }> {
  assertUuid(doctorId, "Doctor");
  const { data, error } = await db
    .from("doctors")
    .select("id, branch_id, profile_id")
    .eq("id", doctorId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("Doctor");
  if (data.branch_id !== branchId) {
    throw new ValidationError("Doctor does not belong to the selected branch");
  }
  return data;
}

export async function requireActiveTreatmentType(treatmentTypeId: string): Promise<void> {
  assertUuid(treatmentTypeId, "Treatment type");
  const { data, error } = await db
    .from("treatment_types")
    .select("id")
    .eq("id", treatmentTypeId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("Treatment type");
}

export async function requireActiveLeadSource(sourceId: string): Promise<void> {
  assertUuid(sourceId, "Lead source");
  const { data, error } = await db
    .from("lead_sources")
    .select("id")
    .eq("id", sourceId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("Lead source");
}

export async function requireAssignableUser(userId: string, branchId: string): Promise<void> {
  assertUuid(userId, "Assignee");
  const [{ data: profile, error: profileError }, { data: allocation, error: allocationError }] =
    await Promise.all([
      db
        .from("profiles")
        .select("id, role")
        .eq("id", userId)
        .eq("is_active", true)
        .maybeSingle(),
      db
        .from("user_branches")
        .select("user_id")
        .eq("user_id", userId)
        .eq("branch_id", branchId)
        .maybeSingle(),
    ]);
  if (profileError) throw profileError;
  if (allocationError) throw allocationError;
  if (!profile || !allocation) throw new ValidationError("Assignee is not active at this branch");
  if (!["front_office", "operations", "clinical_head"].includes(profile.role)) {
    throw new ValidationError("This role cannot be assigned lead work");
  }
}

export async function requireAppointmentForLead(
  appointmentId: string,
  leadId: string,
  expectedStatus: "scheduled" | "completed" | "cancelled" | "no_show" = "scheduled"
): Promise<{ id: string; doctor_id: string | null; branch_id: string }> {
  assertUuid(appointmentId, "Appointment");
  const { data, error } = await db
    .from("appointments")
    .select("id, doctor_id, branch_id, status")
    .eq("id", appointmentId)
    .eq("lead_id", leadId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("Appointment");
  if (data.status !== expectedStatus) {
    throw new ConflictError(`Appointment is already ${data.status.replaceAll("_", " ")}`);
  }
  return data;
}

export async function requireTreatmentForLead(
  treatmentId: string,
  leadId: string,
  branchId: string
): Promise<void> {
  assertUuid(treatmentId, "Treatment");
  const { data, error } = await db
    .from("treatments")
    .select("id")
    .eq("id", treatmentId)
    .eq("lead_id", leadId)
    .eq("branch_id", branchId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ValidationError("Treatment does not belong to this lead");
}

export async function requireCommentEntityForLead(
  entityType: CommentEntity,
  entityId: string | null | undefined,
  leadId: string
): Promise<void> {
  if (entityType === "lead") {
    if (entityId && entityId !== leadId) {
      throw new ValidationError("Comment target does not belong to this lead");
    }
    return;
  }
  if (!entityId) throw new ValidationError("A comment target is required");
  assertUuid(entityId, "Comment target");

  const table = {
    appointment: "appointments",
    treatment: "treatments",
    follow_up: "follow_ups",
    invoice: "invoices",
  }[entityType];
  const { data, error } = await db
    .from(table)
    .select("id")
    .eq("id", entityId)
    .eq("lead_id", leadId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ValidationError("Comment target does not belong to this lead");
}
