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
  normalizePagination,
} from "@/lib/validation";
import { throwMappedDatabaseError } from "./helpers";
import type {
  CaseSheet,
  Json,
  MedicalHistoryCondition,
  PatientMedicalHistoryVersion,
  ToothAssessment,
} from "@/lib/database.types";
import {
  createMedicalHistoryDraft,
  type MedicalHistoryDraft,
} from "@/lib/medical-history";
import type { PrescriptionItemDraft } from "@/lib/prescriptions";

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
  medicalHistory: MedicalHistoryDraft;
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
  medical_history: MedicalHistoryDraft;
  prescriptions: PrescriptionItemDraft[];
  tooth_assessments: Array<{
    tooth_number: string;
    tooth_state: string;
    conditions: string[];
    surfaces: string[];
    clinical_findings: string;
    diagnosis: string;
    prognosis: string | null;
    recommended_action: string | null;
    future_plan: string;
    notes: string;
  }>;
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

async function loadCurrentMedicalHistory(
  leadId: string
): Promise<PatientMedicalHistoryVersion | null> {
  const { data, error } = await db
    .from("patient_medical_history_versions")
    .select("*")
    .eq("lead_id", leadId)
    .order("recorded_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function toMedicalHistoryDraft(
  history: PatientMedicalHistoryVersion | null
): MedicalHistoryDraft {
  return createMedicalHistoryDraft(history ? {
    reviewStatus: history.review_status,
    conditions: history.conditions,
    description: history.description ?? "",
  } : undefined);
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
      medicalHistory: toMedicalHistoryDraft(await loadCurrentMedicalHistory(data.lead.id)),
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
  return {
    lead: data as CaseSheetFormContext["lead"],
    appointment: null,
    medicalHistory: toMedicalHistoryDraft(await loadCurrentMedicalHistory(data.id)),
  };
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

  const prescriptions = input.prescriptions.map((prescription) => ({
    medicine_name: prescription.medicine_name,
    strength: prescription.strength,
    dosage: prescription.dosage,
    morning: prescription.morning,
    noon: prescription.noon,
    night: prescription.night,
    food_timing: prescription.food_timing,
    duration_days: prescription.duration_days,
    instructions: prescription.instructions,
  }));
  const { data, error } = await db.rpc("finalize_clinical_visit", {
    p_lead_id: leadId,
    p_appointment_id: appointmentId,
    p_doctor_id: doctorId,
    p_visit_at: visitAt,
    p_chief_complaint: input.chief_complaint?.trim() || null,
    p_findings: input.findings?.trim() || null,
    p_diagnosis: input.diagnosis?.trim() || null,
    p_plan: input.plan?.trim() || null,
    p_medical_history_review_status: input.medical_history.reviewStatus,
    p_medical_history_confirmed: input.medical_history.reviewedToday,
    p_medical_history_conditions: input.medical_history.conditions as MedicalHistoryCondition[],
    p_medical_history_description: input.medical_history.description.trim() || null,
    p_tooth_assessments: input.tooth_assessments as unknown as Json,
    p_treatments: input.treatments as unknown as Json,
    p_prescriptions: prescriptions as unknown as Json,
    p_actor: ctx.userId,
  });
  if (error) throwMappedDatabaseError(error, "Case sheet");
  const row = data as unknown as { id: string; lead_id: string };
  return { id: row.id, lead_id: row.lead_id };
}

export async function listCaseSheetsForLead(
  ctx: AuthContext,
  leadIdValue: string,
  opts: { page?: number; pageSize?: number } = {}
) {
  const leadId = assertUuid(leadIdValue, "Patient");
  const pagination = normalizePagination(opts.page, opts.pageSize, 10);
  let page = pagination.page;
  const { pageSize } = pagination;
  if (ctx.role === "doctor") {
    if (!ctx.doctorId) throw new AuthorizationError("Linked doctor access required");
  } else {
    requireAnyRole(
      ctx,
      ["admin", "operations", "front_office", "clinical_head"],
      "Patient access required"
    );
    const { data: lead, error: leadError } = await db
      .from("leads")
      .select("branch_id, deleted_at")
      .eq("id", leadId)
      .maybeSingle();
    if (leadError) throw leadError;
    if (!lead || lead.deleted_at) throw new NotFoundError("Patient");
    assertBranchAccess(ctx, lead.branch_id);
  }

  const includesClinicalNarrative =
    ctx.role === "admin" || ctx.role === "clinical_head";
  const clinicalProjection =
    "*, doctor:doctors(full_name), tooth_assessments(*), treatments(*, treatment_code_ref:treatment_codes!treatments_treatment_code_fkey(name, category), invoice_items(id, invoice_id, active_billing)), medical_history:case_sheet_medical_history(*, history:patient_medical_history_versions(*)), prescription_items(*), case_sheet_attachments(id, case_sheet_id, lead_id, branch_id, category, bucket_id, original_name, mime_type, size_bytes, status, uploaded_at, created_at)";
  const businessProjection =
    "id, lead_id, branch_id, appointment_id, doctor_id, visit_at, finalized_at, created_at, doctor:doctors(full_name), treatments(id, treatment_code, treatment_name, treatment_category, clinical_status, site_scope, site_detail, tooth_number, surfaces, quantity, cost, invoice_items(id, invoice_id, active_billing))";
  let query = db
    .from("case_sheets")
    .select(includesClinicalNarrative ? clinicalProjection : businessProjection, { count: "exact" })
    .eq("lead_id", leadId)
    .order("visit_at", { ascending: false })
    .order("finalized_at", { ascending: false })
    .order("id", { ascending: false });
  if (ctx.role === "doctor") query = query.eq("doctor_id", ctx.doctorId ?? EMPTY_UUID);
  const from = (page - 1) * pageSize;
  const results = await Promise.all([
    query.range(from, from + pageSize - 1),
    includesClinicalNarrative
      ? db.rpc("current_tooth_assessments", { p_lead_id: leadId })
      : Promise.resolve({ data: [] as ToothAssessment[], error: null }),
    includesClinicalNarrative
      ? loadCurrentMedicalHistory(leadId)
      : Promise.resolve(null),
  ]);
  let sheetResult = results[0];
  const currentResult = results[1];
  const currentMedicalHistory = results[2];
  if (sheetResult.error) throw sheetResult.error;
  const pageCount = Math.max(1, Math.ceil((sheetResult.count ?? 0) / pageSize));
  if (page > pageCount) {
    page = pageCount;
    const clampedFrom = (page - 1) * pageSize;
    sheetResult = await query.range(clampedFrom, clampedFrom + pageSize - 1);
    if (sheetResult.error) throw sheetResult.error;
  }
  if (currentResult.error) throw currentResult.error;

  const { data, count } = sheetResult;
  const currentRows = (currentResult.data ?? []) as ToothAssessment[];
  const doctorIds = [...new Set(currentRows.map((row) => row.doctor_id))];
  let doctorNames = new Map<string, string>();
  if (doctorIds.length > 0) {
    const { data: doctors, error: doctorError } = await db
      .from("doctors")
      .select("id, full_name")
      .in("id", doctorIds);
    if (doctorError) throw doctorError;
    doctorNames = new Map((doctors ?? []).map((doctor) => [doctor.id, doctor.full_name]));
  }

  return {
    caseSheets: (data ?? []) as unknown as Array<Partial<CaseSheet> & Pick<CaseSheet, "id" | "lead_id" | "branch_id" | "appointment_id" | "doctor_id" | "visit_at" | "finalized_at" | "created_at"> & Record<string, unknown>>,
    currentMedicalHistory,
    currentToothAssessments: currentRows.map((row) => ({
      ...row,
      doctor_name: doctorNames.get(row.doctor_id) ?? null,
    })),
    total: count ?? 0,
    page,
    pageSize,
  };
}
