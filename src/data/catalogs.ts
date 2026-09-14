import "server-only";

import { db } from "./db";
import type { AuthContext } from "@/lib/auth/context";
import {
  assertBranchAccess,
  requireAdmin,
  requireManagerOf,
  requireClinicalCatalogAccess,
} from "@/lib/auth/guards";
import type { Doctor, LeadSource, TreatmentCode, TreatmentType } from "@/lib/database.types";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { MAX_LIST_ROWS, assertUuid } from "@/lib/validation";

function rejectOversizedLookup(rows: readonly unknown[], label: string): void {
  if (rows.length > MAX_LIST_ROWS) {
    throw new ValidationError(`Too many ${label} to display`);
  }
}

// ---------- Lead sources ----------

export async function listLeadSources(
  _ctx: AuthContext,
  opts: { includeInactive?: boolean } = {}
): Promise<LeadSource[]> {
  let q = db
    .from("lead_sources")
    .select("*")
    .order("name")
    .limit(MAX_LIST_ROWS + 1);
  if (!opts.includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  rejectOversizedLookup(data ?? [], "lead sources");
  return data ?? [];
}

export async function createLeadSource(ctx: AuthContext, name: string) {
  requireAdmin(ctx);
  const { error } = await db.from("lead_sources").insert({ name });
  if (error) throw error;
}

export async function updateLeadSource(
  ctx: AuthContext,
  id: string,
  input: { name?: string; is_active?: boolean }
) {
  requireAdmin(ctx);
  const sourceId = assertUuid(id, "Lead source");
  const { data, error } = await db
    .from("lead_sources")
    .update(input)
    .eq("id", sourceId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("Lead source");
}

// ---------- Treatment types ----------

export async function listTreatmentTypes(
  _ctx: AuthContext,
  opts: { includeInactive?: boolean } = {}
): Promise<TreatmentType[]> {
  let q = db
    .from("treatment_types")
    .select("*")
    .order("name")
    .limit(MAX_LIST_ROWS + 1);
  if (!opts.includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  rejectOversizedLookup(data ?? [], "treatment types");
  return data ?? [];
}

export async function createTreatmentType(
  ctx: AuthContext,
  input: { name: string; category?: string | null; default_cost?: number }
) {
  requireClinicalCatalogAccess(ctx);
  const { error } = await db.from("treatment_types").insert(input);
  if (error) throw error;
}

export async function updateTreatmentType(
  ctx: AuthContext,
  id: string,
  input: { name?: string; category?: string | null; default_cost?: number | null; is_active?: boolean }
) {
  requireClinicalCatalogAccess(ctx);
  const treatmentTypeId = assertUuid(id, "Treatment type");
  const { data, error } = await db
    .from("treatment_types")
    .update(input)
    .eq("id", treatmentTypeId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("Treatment type");
}

// ---------- Managed dental codes ----------

export async function listTreatmentCodeCatalog(
  ctx: AuthContext,
  opts: { includeInactive?: boolean } = {}
): Promise<TreatmentCode[]> {
  requireAdmin(ctx);
  let q = db
    .from("treatment_codes")
    .select("*")
    .order("code")
    .limit(2_000);
  q = q.eq("code_system", "ICD10_IN");
  if (!opts.includeInactive) q = q.eq("status", "active");
  const { data, error } = await q;
  if (error) throw error;
  if ((data ?? []).length > 2_000) throw new ValidationError("Too many dental codes to display");
  return (data ?? []) as TreatmentCode[];
}

export async function createTreatmentCode(
  ctx: AuthContext,
  input: Pick<TreatmentCode, "code" | "name" | "category" | "code_level" | "billable">
) {
  requireAdmin(ctx);
  const { error } = await db.from("treatment_codes").insert({
    ...input,
    code_system: "ICD10_IN",
    status: "active",
    raw_metadata: null,
    source: "Admin managed / India-aligned ICD-10",
    source_version: "admin",
  });
  if (error) throw error;
}

export async function updateTreatmentCode(
  ctx: AuthContext,
  code: string,
  input: Partial<Pick<TreatmentCode, "name" | "category" | "code_level" | "billable">> & { status?: string }
) {
  requireAdmin(ctx);
  const { data, error } = await db
    .from("treatment_codes")
    .update(input)
    .eq("code", code)
    .select("code")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("Dental code");
}

// ---------- Doctors ----------

export async function listDoctors(
  ctx: AuthContext,
  opts: { branchId?: string; includeInactive?: boolean } = {}
): Promise<(Doctor & { branch: { name: string; code: string } | null })[]> {
  let q = db
    .from("doctors")
    .select("*, branch:branches(name, code)")
    .order("full_name")
    .limit(MAX_LIST_ROWS + 1);
  if (opts.branchId) {
    const branchId = assertUuid(opts.branchId, "Branch");
    assertBranchAccess(ctx, branchId);
    q = q.eq("branch_id", branchId);
  } else if (ctx.role !== "admin") {
    q = q.in("branch_id", ctx.branchIds.length ? ctx.branchIds : ["00000000-0000-0000-0000-000000000000"]);
  }
  if (!opts.includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  rejectOversizedLookup(data ?? [], "doctors");
  return (data ?? []) as (Doctor & { branch: { name: string; code: string } | null })[];
}

export async function createDoctor(
  ctx: AuthContext,
  input: { branch_id: string; full_name: string; specialization?: string; phone?: string; email?: string }
) {
  const branchId = assertUuid(input.branch_id, "Branch");
  requireManagerOf(ctx, branchId);
  const { error } = await db.from("doctors").insert(input);
  if (error) throw error;
}

export async function updateDoctor(
  ctx: AuthContext,
  id: string,
  input: { full_name?: string; specialization?: string | null; phone?: string | null; email?: string | null; is_active?: boolean }
) {
  const doctorId = assertUuid(id, "Doctor");
  const { data: doctor, error: lookupError } = await db
    .from("doctors")
    .select("branch_id")
    .eq("id", doctorId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!doctor) throw new NotFoundError("Doctor");
  requireManagerOf(ctx, doctor.branch_id);
  const { error } = await db.from("doctors").update(input).eq("id", doctorId);
  if (error) throw error;
}
