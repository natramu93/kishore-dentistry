import "server-only";

import { db } from "./db";
import type { AuthContext } from "@/lib/auth/context";
import { assertBranchAccess, canReadLead, requireAnyRole } from "@/lib/auth/guards";
import { AuthorizationError, NotFoundError } from "@/lib/errors";
import { assertUuid } from "@/lib/validation";
import type { PatientTreatmentProgress } from "@/lib/treatment-progress";

export const TREATMENT_PROGRESS_LIMIT = 100;

/** Independent of case-sheet pagination, so an older plan cannot vanish from the summary. */
export async function getPatientTreatmentProgress(
  ctx: AuthContext,
  leadIdValue: string,
): Promise<PatientTreatmentProgress> {
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
  return {
    planned: { records: (planned.data ?? []).map((row) => ({ ...row, doctor: row.doctor_name ? { full_name: row.doctor_name } : null })), total: planned.count },
    completed: { records: (completed.data ?? []).map((row) => ({ ...row, doctor: row.doctor_name ? { full_name: row.doctor_name } : null })), total: completed.count },
  };
}
