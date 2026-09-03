import "server-only";

import { db } from "./db";
import type { AuthContext } from "@/lib/auth/context";
import { AuthorizationError, NotFoundError } from "@/lib/errors";
import { assertBranchAccess } from "@/lib/auth/guards";
import {
  EMPTY_UUID,
  assertIsoDateTime,
  assertUuid,
  normalizePagination,
  normalizeSearch,
} from "@/lib/validation";
import type { ToothAssessment, Treatment } from "@/lib/database.types";

export type DoctorTreatmentRecord = Treatment & {
  lead: { id: string; name: string; mobile: string } | null;
  treatment_type: { name: string; category: string | null } | null;
  branch: { name: string } | null;
};

export type DoctorPatientFilters = {
  from?: string;
  to?: string;
  treatmentCode?: string;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type DoctorCaseSheetRecord = {
  id: string;
  lead_id: string;
  visit_at: string;
  finalized_at: string;
  lead: { id: string; name: string; mobile: string } | null;
  branch: { name: string } | null;
  tooth_assessments: Array<{ id: string }>;
  treatments: Array<{ id: string }>;
};

function requireLinkedDoctor(ctx: AuthContext): string {
  if (ctx.role !== "doctor" || !ctx.doctorId) {
    throw new AuthorizationError("Only a linked doctor login can view this");
  }
  return ctx.doctorId;
}

/**
 * The doctor portal's patient-record list: treatments THIS doctor performed,
 * with the patient's name/mobile and the treatment type. Never exposes other
 * doctors' work — the doctor_id equality is applied unconditionally.
 */
export async function listMyTreatments(
  ctx: AuthContext,
  filters: DoctorPatientFilters = {}
): Promise<{
  records: DoctorTreatmentRecord[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const doctorId = requireLinkedDoctor(ctx);
  const { page, pageSize } = normalizePagination(filters.page, filters.pageSize);

  let query = db
    .from("treatments")
    .select(
      "*, lead:leads!inner(id, name, mobile), treatment_type:treatment_types(name, category), branch:branches(name)",
      { count: "exact" }
    )
    .eq("doctor_id", doctorId)
    .or("case_sheet_id.is.null,clinical_status.eq.completed")
    .order("treated_at", { ascending: false });

  if (filters.from) {
    query = query.gte("treated_at", assertIsoDateTime(filters.from, "Start date"));
  }
  if (filters.to) {
    query = query.lt("treated_at", assertIsoDateTime(filters.to, "End date"));
  }
  if (filters.treatmentCode) {
    const code = filters.treatmentCode.trim().toUpperCase();
    if (!/^TMT_\d+$/.test(code)) {
      throw new AuthorizationError("Treatment code filter is invalid");
    }
    query = query.eq("treatment_code", code);
  }
  const search = normalizeSearch(filters.search);
  if (search) {
    query = query.or(`name.ilike.%${search}%,mobile.ilike.%${search}%`, {
      referencedTable: "lead",
    });
  }

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query.range(from, from + pageSize - 1);
  if (error) throw error;
  return {
    records: (data ?? []) as DoctorTreatmentRecord[],
    total: count ?? 0,
    page,
    pageSize,
  };
}

export async function listMyCaseSheets(
  ctx: AuthContext,
  filters: Pick<DoctorPatientFilters, "from" | "to" | "search" | "page" | "pageSize"> = {}
): Promise<{
  records: DoctorCaseSheetRecord[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const doctorId = requireLinkedDoctor(ctx);
  const pagination = normalizePagination(filters.page, filters.pageSize, 12);
  let page = pagination.page;
  const { pageSize } = pagination;
  let query = db
    .from("case_sheets")
    .select(
      "id, lead_id, visit_at, finalized_at, lead:leads!inner(id, name, mobile), branch:branches(name), tooth_assessments(id), treatments(id)",
      { count: "exact" }
    )
    .eq("doctor_id", doctorId)
    .order("visit_at", { ascending: false })
    .order("finalized_at", { ascending: false })
    .order("id", { ascending: false });

  if (filters.from) query = query.gte("visit_at", assertIsoDateTime(filters.from, "Start date"));
  if (filters.to) query = query.lt("visit_at", assertIsoDateTime(filters.to, "End date"));
  const search = normalizeSearch(filters.search);
  if (search) {
    query = query.or(`name.ilike.%${search}%,mobile.ilike.%${search}%`, {
      referencedTable: "lead",
    });
  }

  const from = (page - 1) * pageSize;
  let result = await query.range(from, from + pageSize - 1);
  if (result.error) throw result.error;
  const pageCount = Math.max(1, Math.ceil((result.count ?? 0) / pageSize));
  if (page > pageCount) {
    page = pageCount;
    const clampedFrom = (page - 1) * pageSize;
    result = await query.range(clampedFrom, clampedFrom + pageSize - 1);
    if (result.error) throw result.error;
  }
  return {
    records: (result.data ?? []) as DoctorCaseSheetRecord[],
    total: result.count ?? 0,
    page,
    pageSize,
  };
}

/** Distinct patients this doctor has treated (for the summary header). */
export async function countMyPatients(ctx: AuthContext): Promise<number> {
  const doctorId = requireLinkedDoctor(ctx);
  const [treatments, sheets] = await Promise.all([
    db
      .from("treatments")
      .select("lead_id")
      .eq("doctor_id", doctorId ?? EMPTY_UUID)
      .or("case_sheet_id.is.null,clinical_status.eq.completed"),
    db
      .from("case_sheets")
      .select("lead_id")
      .eq("doctor_id", doctorId ?? EMPTY_UUID),
  ]);
  if (treatments.error) throw treatments.error;
  if (sheets.error) throw sheets.error;
  return new Set([
    ...(treatments.data ?? []).map((row) => row.lead_id),
    ...(sheets.data ?? []).map((row) => row.lead_id),
  ]).size;
}

export async function getMyPatientHistory(
  ctx: AuthContext,
  leadIdValue: string,
  opts: { page?: number; pageSize?: number } = {}
) {
  const doctorId = requireLinkedDoctor(ctx);
  const leadId = assertUuid(leadIdValue, "Patient");
  const pagination = normalizePagination(opts.page, opts.pageSize, 10);
  let page = pagination.page;
  const { pageSize } = pagination;
  const [appointmentLink, treatmentLink] = await Promise.all([
    db
      .from("appointments")
      .select("id, branch_id")
      .eq("lead_id", leadId)
      .eq("doctor_id", doctorId)
      .in("status", ["scheduled", "completed"])
      .limit(1)
      .maybeSingle(),
    db
      .from("treatments")
      .select("id, branch_id")
      .eq("lead_id", leadId)
      .eq("doctor_id", doctorId)
      .limit(1)
      .maybeSingle(),
  ]);
  if (appointmentLink.error) throw appointmentLink.error;
  if (treatmentLink.error) throw treatmentLink.error;
  const relationship = appointmentLink.data ?? treatmentLink.data;
  if (!relationship) throw new NotFoundError("Patient history");
  assertBranchAccess(ctx, relationship.branch_id);

  const from = (page - 1) * pageSize;
  const sheetsQuery = db
    .from("case_sheets")
    .select("*, doctor:doctors(full_name), tooth_assessments(*), treatments(*), medical_history:case_sheet_medical_history(*, history:patient_medical_history_versions(*)), prescription_items(*)", { count: "exact" })
    .eq("lead_id", leadId)
    .eq("branch_id", relationship.branch_id)
    .order("visit_at", { ascending: false })
    .order("finalized_at", { ascending: false })
    .order("id", { ascending: false });
  const results = await Promise.all([
    db
      .from("leads")
      .select("id, name, mobile, email, dob, age, branch_id, branch:branches(name)")
      .eq("id", leadId)
      .eq("branch_id", relationship.branch_id)
      .is("deleted_at", null)
      .maybeSingle(),
    sheetsQuery.range(from, from + pageSize - 1),
    db
      .from("treatments")
      .select("*, doctor:doctors(full_name), treatment_type:treatment_types(name, category)")
      .eq("lead_id", leadId)
      .eq("branch_id", relationship.branch_id)
      .is("case_sheet_id", null)
      .order("treated_at", { ascending: false })
      .limit(200),
    db.rpc("current_tooth_assessments", { p_lead_id: leadId }),
    db
      .from("patient_medical_history_versions")
      .select("*")
      .eq("lead_id", leadId)
      .eq("branch_id", relationship.branch_id)
      .order("recorded_at", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const leadResult = results[0];
  let sheetsResult = results[1];
  const legacyResult = results[2];
  const currentResult = results[3];
  const medicalHistoryResult = results[4];
  if (leadResult.error) throw leadResult.error;
  if (!leadResult.data) throw new NotFoundError("Patient");
  if (sheetsResult.error) throw sheetsResult.error;
  const pageCount = Math.max(1, Math.ceil((sheetsResult.count ?? 0) / pageSize));
  if (page > pageCount) {
    page = pageCount;
    const clampedFrom = (page - 1) * pageSize;
    sheetsResult = await sheetsQuery.range(clampedFrom, clampedFrom + pageSize - 1);
    if (sheetsResult.error) throw sheetsResult.error;
  }
  if (legacyResult.error) throw legacyResult.error;
  if (currentResult.error) throw currentResult.error;
  if (medicalHistoryResult.error) throw medicalHistoryResult.error;

  const sheetRows = sheetsResult.data ?? [];
  const ownedSheetIds = sheetRows
    .filter((sheet) => sheet.doctor_id === doctorId)
    .map((sheet) => sheet.id);
  const attachmentResult = ownedSheetIds.length > 0
    ? await db
        .from("case_sheet_attachments")
        .select("id, case_sheet_id, lead_id, branch_id, category, bucket_id, original_name, mime_type, size_bytes, status, uploaded_at, created_at")
        .in("case_sheet_id", ownedSheetIds)
        .eq("status", "ready")
        .order("created_at", { ascending: true })
    : { data: [], error: null };
  if (attachmentResult.error) throw attachmentResult.error;
  const attachmentsBySheet = new Map<string, typeof attachmentResult.data>();
  for (const attachment of attachmentResult.data ?? []) {
    const existing = attachmentsBySheet.get(attachment.case_sheet_id) ?? [];
    existing.push(attachment);
    attachmentsBySheet.set(attachment.case_sheet_id, existing);
  }

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
    lead: leadResult.data,
    caseSheets: sheetRows.map((sheet) => ({
      ...sheet,
      case_sheet_attachments: attachmentsBySheet.get(sheet.id) ?? [],
    })),
    caseSheetTotal: sheetsResult.count ?? 0,
    caseSheetPage: page,
    caseSheetPageSize: pageSize,
    currentToothAssessments: currentRows.map((row) => ({
      ...row,
      doctor_name: doctorNames.get(row.doctor_id) ?? null,
    })),
    currentMedicalHistory: medicalHistoryResult.data,
    legacyTreatments: legacyResult.data ?? [],
  };
}
