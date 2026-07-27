import "server-only";

import { db } from "./db";
import type { AuthContext } from "@/lib/auth/context";
import { AuthorizationError } from "@/lib/errors";
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
  treatmentTypeId?: string;
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
    .order("treated_at", { ascending: false });

  if (filters.from) {
    query = query.gte("treated_at", assertIsoDateTime(filters.from, "Start date"));
  }
  if (filters.to) {
    query = query.lt("treated_at", assertIsoDateTime(filters.to, "End date"));
  }
  if (filters.treatmentTypeId) {
    query = query.eq(
      "treatment_type_id",
      assertUuid(filters.treatmentTypeId, "Treatment type")
    );
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
    .eq("doctor_id", doctorId ?? EMPTY_UUID);
  if (error) throw error;
  return new Set((data ?? []).map((t) => t.lead_id)).size;
}
