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
import type { Treatment } from "@/lib/database.types";

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

/** Distinct patients this doctor has treated (for the summary header). */
export async function countMyPatients(ctx: AuthContext): Promise<number> {
  const doctorId = requireLinkedDoctor(ctx);
  const { data, error } = await db
    .from("treatments")
    .select("lead_id")
    .eq("doctor_id", doctorId ?? EMPTY_UUID)
    .or("case_sheet_id.is.null,clinical_status.eq.completed");
  if (error) throw error;
  return new Set((data ?? []).map((t) => t.lead_id)).size;
}

export async function getMyPatientHistory(ctx: AuthContext, leadIdValue: string) {
  const doctorId = requireLinkedDoctor(ctx);
  const leadId = assertUuid(leadIdValue, "Patient");
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

  const [leadResult, sheetsResult, legacyResult] = await Promise.all([
    db
      .from("leads")
      .select("id, name, mobile, email, dob, age, branch_id, branch:branches(name)")
      .eq("id", leadId)
      .eq("branch_id", relationship.branch_id)
      .is("deleted_at", null)
      .maybeSingle(),
    db
      .from("case_sheets")
      .select("*, doctor:doctors(full_name), treatments(*)")
      .eq("lead_id", leadId)
      .eq("branch_id", relationship.branch_id)
      .order("visit_at", { ascending: false })
      .limit(200),
    db
      .from("treatments")
      .select("*, doctor:doctors(full_name), treatment_type:treatment_types(name, category)")
      .eq("lead_id", leadId)
      .eq("branch_id", relationship.branch_id)
      .is("case_sheet_id", null)
      .order("treated_at", { ascending: false })
      .limit(200),
  ]);
  if (leadResult.error) throw leadResult.error;
  if (!leadResult.data) throw new NotFoundError("Patient");
  if (sheetsResult.error) throw sheetsResult.error;
  if (legacyResult.error) throw legacyResult.error;
  return {
    lead: leadResult.data,
    caseSheets: sheetsResult.data ?? [],
    legacyTreatments: legacyResult.data ?? [],
  };
}
