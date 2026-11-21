import "server-only";

import { db } from "./db";
import type { AuthContext } from "@/lib/auth/context";
import { assertBranchAccess, canReadLead, requireAnyRole } from "@/lib/auth/guards";
import { AuthorizationError, NotFoundError } from "@/lib/errors";
import { assertUuid } from "@/lib/validation";
import type { PatientTreatmentProgress, TreatmentDetails, TreatmentProgressRecord } from "@/lib/treatment-progress";
import { listComments } from "./comments";
import { listClinicalAttachmentsForTreatment } from "./clinical-attachments";

export const TREATMENT_PROGRESS_LIMIT = 100;

async function requirePatientTreatmentAccess(
  ctx: AuthContext,
  leadIdValue: string,
) {
  requireAnyRole(ctx, ["admin", "operations", "front_office", "clinical_head", "doctor"]);
  const leadId = assertUuid(leadIdValue, "Patient");
  const { data: lead, error: leadError } = await db.from("leads")
    .select("branch_id, assignee_id")
    .eq("id", leadId)
    .is("deleted_at", null)
    .maybeSingle();
  if (leadError) throw leadError;
  if (!lead) throw new NotFoundError("Patient");

  if (ctx.role === "doctor") {
    if (!ctx.doctorId) throw new AuthorizationError("Linked doctor access required");
    assertBranchAccess(ctx, lead.branch_id);
    const [appointment, treatment] = await Promise.all([
      db.from("appointments").select("id")
        .eq("lead_id", leadId).eq("branch_id", lead.branch_id).eq("doctor_id", ctx.doctorId)
        .in("status", ["scheduled", "completed"]).limit(1).maybeSingle(),
      db.from("treatments").select("id")
        .eq("lead_id", leadId).eq("branch_id", lead.branch_id).eq("doctor_id", ctx.doctorId)
        .limit(1).maybeSingle(),
    ]);
    if (appointment.error) throw appointment.error;
    if (treatment.error) throw treatment.error;
    if (!appointment.data && !treatment.data) throw new NotFoundError("Patient history");
  } else if (!canReadLead(ctx, lead)) {
    throw new NotFoundError("Patient");
  }
  return { leadId, lead };
}

/** Independent of case-sheet pagination, so an older plan cannot vanish from the summary. */
export async function getPatientTreatmentProgress(
  ctx: AuthContext,
  leadIdValue: string,
): Promise<PatientTreatmentProgress> {
  const { leadId, lead } = await requirePatientTreatmentAccess(ctx, leadIdValue);

  const load = (status: "planned" | "completed") => db.from("clinical_treatment_progress")
    .select("id, case_sheet_id, planned_treatment_id, treatment_code, treatment_name, clinical_status, site_scope, site_detail, tooth_number, tooth_numbers, remaining_tooth_numbers, surfaces, notes, treated_at, performed_at, doctor_name", { count: "exact" })
    .eq("lead_id", leadId)
    .eq("branch_id", lead.branch_id)
    .eq(status === "planned" ? "is_pending" : "clinical_status", status === "planned" ? true : status)
    .order("treated_at", { ascending: status === "planned" })
    .order("id", { ascending: status === "planned" })
    .range(0, TREATMENT_PROGRESS_LIMIT - 1);
  const [planned, completed] = await Promise.all([load("planned"), load("completed")]);
  if (planned.error) throw planned.error;
  if (completed.error) throw completed.error;
  const sheetIds = [...new Set((completed.data ?? []).map((row) => row.case_sheet_id).filter((id): id is string => Boolean(id)))];
  const remarks = new Map<string, string | null>();
  if (sheetIds.length) {
    const sheets = await db.from("case_sheets").select("id, findings")
      .eq("lead_id", leadId).eq("branch_id", lead.branch_id).in("id", sheetIds);
    if (sheets.error) throw sheets.error;
    for (const sheet of sheets.data ?? []) remarks.set(sheet.id, sheet.findings);
  }
  return {
    planned: { records: (planned.data ?? []).map((row) => ({ ...row, doctor: row.doctor_name ? { full_name: row.doctor_name } : null })), total: planned.count },
    completed: { records: (completed.data ?? []).map((row) => ({ ...row, visit_remarks: row.case_sheet_id ? remarks.get(row.case_sheet_id) ?? null : null, doctor: row.doctor_name ? { full_name: row.doctor_name } : null })), total: completed.count },
  };
}

/** Load only the clicked record, including visits outside the current history page. */
export async function getTreatmentDetails(
  ctx: AuthContext,
  leadIdValue: string,
  treatmentIdValue: string,
): Promise<TreatmentDetails> {
  const treatmentId = assertUuid(treatmentIdValue, "Treatment");
  const { leadId, lead } = await requirePatientTreatmentAccess(ctx, leadIdValue);
  const { data, error } = await db.from("treatments")
    .select("id, case_sheet_id, planned_treatment_id, treatment_code, treatment_name, clinical_status, site_scope, site_detail, tooth_number, tooth_numbers, surfaces, notes, treated_at, performed_at, doctor:doctors(full_name), case_sheet:case_sheets!inner(doctor_id, finalized_at)" + (ctx.role !== "doctor" ? ", invoice_items(active_billing)" : ""))
    .eq("id", treatmentId).eq("lead_id", leadId).eq("branch_id", lead.branch_id).maybeSingle();
  if (error) throw error;
  const row = data as unknown as (TreatmentProgressRecord & {
    case_sheet: { doctor_id: string; finalized_at: string | null } | null;
    invoice_items?: { active_billing: boolean }[];
  }) | null;
  if (!row?.case_sheet?.finalized_at) throw new NotFoundError("Finalized treatment");
  const { case_sheet: sheet, invoice_items: invoiceItems, ...treatment } = row;
  const filesAvailable = ctx.role !== "doctor" || sheet.doctor_id === ctx.doctorId;
  const canWriteComments = ctx.role !== "doctor" && (ctx.role !== "front_office" || lead.assignee_id === ctx.userId);
  const [attachments, comments] = await Promise.all([
    filesAvailable ? listClinicalAttachmentsForTreatment(ctx, treatmentId) : Promise.resolve([]),
    ctx.role !== "doctor" ? listComments(ctx, leadId, { type: "treatment", id: treatmentId }) : Promise.resolve([]),
  ]);
  return {
    treatment, attachments, comments, filesAvailable,
    canUpload: filesAvailable && (ctx.role !== "front_office" || lead.assignee_id === ctx.userId),
    currentUserId: ctx.userId, canWriteComments,
    canModerate: ctx.role !== "front_office" && ctx.role !== "doctor",
    showComments: ctx.role !== "doctor",
    ...(ctx.role !== "doctor" && { invoiced: invoiceItems?.some((item) => item.active_billing) ?? false }),
  };
}
