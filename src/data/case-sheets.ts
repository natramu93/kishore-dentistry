import "server-only";

import { db } from "./db";
import type { AuthContext } from "@/lib/auth/context";
import {
  assertBranchAccess,
  requireAnyRole,
} from "@/lib/auth/guards";
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import {
  EMPTY_UUID,
  assertIsoDateTime,
  assertUuid,
} from "@/lib/validation";
import { throwMappedDatabaseError } from "./helpers";
import type { Json } from "@/lib/database.types";

const CLINICAL_AUTHOR_ROLES = ["admin", "clinical_head", "doctor"] as const;

export type TreatmentCodeOption = {
  code: string;
  name: string;
  category: string | null;
  default_price: null;
};

export type CaseSheetFormContext = {
  lead: {
    id: string;
    name: string;
    mobile: string;
    branch_id: string;
    branch: { name: string } | null;
  };
  appointment: {
    id: string;
    doctor_id: string | null;
    scheduled_at: string;
    status: string;
  } | null;
};

export type FinalizeCaseSheetInput = {
  lead_id: string;
  appointment_id: string | null;
  doctor_id: string;
  visit_at: string;
  chief_complaint?: string | null;
  findings?: string | null;
  diagnosis?: string | null;
  plan?: string | null;
  medical_alerts?: string | null;
  treatments: Array<{
    treatment_code: string;
    status: "planned" | "completed";
    site_scope: "not_applicable" | "full_mouth" | "arch" | "quadrant" | "tooth";
    site_detail: string | null;
    tooth_number: string | null;
    surfaces: string[];
    quantity: number;
    unit_price: number;
    notes: string;
  }>;
};

function assertClinicalAuthor(ctx: AuthContext): void {
  requireAnyRole(ctx, CLINICAL_AUTHOR_ROLES, "Clinical case-sheet access required");
}

export async function listTreatmentCodes(
  ctx: AuthContext
): Promise<TreatmentCodeOption[]> {
  assertClinicalAuthor(ctx);
  const { data, error } = await db
    .from("treatment_codes")
    .select("code, name, category")
    .eq("status", "active")
    .order("code")
    .limit(1_000);
  if (error) throw error;
  return (data ?? []).map((row) => ({ ...row, default_price: null }));
}

export async function getCaseSheetFormContext(
  ctx: AuthContext,
  input: { leadId?: string; appointmentId?: string }
): Promise<CaseSheetFormContext> {
  assertClinicalAuthor(ctx);

  if (input.appointmentId) {
    const appointmentId = assertUuid(input.appointmentId, "Appointment");
    const { data, error } = await db
      .from("appointments")
      .select(
        "id, doctor_id, scheduled_at, status, branch_id, lead:leads!inner(id, name, mobile, branch_id, deleted_at, branch:branches(name))"
      )
      .eq("id", appointmentId)
      .maybeSingle();
    if (error) throw error;
    if (!data || !data.lead || data.lead.deleted_at) throw new NotFoundError("Appointment");
    if (data.status !== "scheduled") {
      throw new ValidationError("Only a scheduled appointment can receive a new case sheet");
    }
    if (ctx.role === "doctor") {
      if (!ctx.doctorId || data.doctor_id !== ctx.doctorId) {
        throw new AuthorizationError("This appointment is not on your schedule");
      }
    } else {
      assertBranchAccess(ctx, data.branch_id);
    }
    return {
      lead: data.lead as CaseSheetFormContext["lead"],
      appointment: {
        id: data.id,
        doctor_id: data.doctor_id,
        scheduled_at: data.scheduled_at,
        status: data.status,
      },
    };
  }

  if (!input.leadId) throw new ValidationError("A patient or appointment is required");
  if (ctx.role === "doctor") {
    throw new AuthorizationError("Doctors must open a case sheet from their scheduled appointment");
  }
  const leadId = assertUuid(input.leadId, "Patient");
  const { data, error } = await db
    .from("leads")
    .select("id, name, mobile, branch_id, deleted_at, branch:branches(name)")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.deleted_at) throw new NotFoundError("Patient");
  assertBranchAccess(ctx, data.branch_id);
  return { lead: data as CaseSheetFormContext["lead"], appointment: null };
}

export async function finalizeCaseSheet(
  ctx: AuthContext,
  input: FinalizeCaseSheetInput
): Promise<{ id: string; lead_id: string }> {
  assertClinicalAuthor(ctx);
  const leadId = assertUuid(input.lead_id, "Patient");
  const appointmentId = input.appointment_id
    ? assertUuid(input.appointment_id, "Appointment")
    : null;
  if (!appointmentId) {
    throw new ValidationError("A scheduled appointment is required for a finalized case sheet");
  }
  const doctorId = assertUuid(input.doctor_id, "Doctor");
  const visitAt = assertIsoDateTime(input.visit_at, "Visit date");

  if (ctx.role === "doctor" && doctorId !== (ctx.doctorId ?? EMPTY_UUID)) {
    throw new AuthorizationError("Doctors can only sign their own case sheets");
  }

  const scope = await getCaseSheetFormContext(ctx, {
    leadId,
    appointmentId,
  });
  if (scope.lead.id !== leadId) {
    throw new ValidationError("Appointment does not belong to this patient");
  }
  if (scope.appointment?.doctor_id && scope.appointment.doctor_id !== doctorId) {
    throw new ValidationError("Case-sheet doctor must match the booked doctor");
  }

  const { data, error } = await db.rpc("finalize_case_sheet", {
    p_lead_id: leadId,
    p_appointment_id: appointmentId,
    p_doctor_id: doctorId,
    p_visit_at: visitAt,
    p_chief_complaint: input.chief_complaint?.trim() || null,
    p_findings: input.findings?.trim() || null,
    p_diagnosis: input.diagnosis?.trim() || null,
    p_plan: input.plan?.trim() || null,
    p_medical_alerts: input.medical_alerts?.trim() || null,
    p_treatments: input.treatments as unknown as Json,
    p_actor: ctx.userId,
  });
  if (error) throwMappedDatabaseError(error, "Case sheet");
  const row = data as unknown as { id: string; lead_id: string };
  return { id: row.id, lead_id: row.lead_id };
}

export async function listCaseSheetsForLead(ctx: AuthContext, leadIdValue: string) {
  const leadId = assertUuid(leadIdValue, "Patient");
  if (ctx.role === "doctor") {
    if (!ctx.doctorId) throw new AuthorizationError("Linked doctor access required");
  } else {
    requireAnyRole(
      ctx,
      ["admin", "operations", "front_office", "clinical_head"],
      "Patient access required"
    );
  }

  let query = db
    .from("case_sheets")
    .select(
      "*, doctor:doctors(full_name), treatments(*, treatment_code_ref:treatment_codes!treatments_treatment_code_fkey(name, category), invoice_items(id, invoice_id, active_billing))"
    )
    .eq("lead_id", leadId)
    .order("visit_at", { ascending: false })
    .limit(200);
  if (ctx.role === "doctor") query = query.eq("doctor_id", ctx.doctorId ?? EMPTY_UUID);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}
