import "server-only";

import { db } from "./db";
import type { AuthContext } from "@/lib/auth/context";
import { requireAdmin, requireManagerOf } from "@/lib/auth/guards";
import type { Doctor, LeadSource, TreatmentType } from "@/lib/database.types";

// ---------- Lead sources ----------

export async function listLeadSources(
  _ctx: AuthContext,
  opts: { includeInactive?: boolean } = {}
): Promise<LeadSource[]> {
  let q = db.from("lead_sources").select("*").order("name");
  if (!opts.includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
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
  const { error } = await db.from("lead_sources").update(input).eq("id", id);
  if (error) throw error;
}

// ---------- Treatment types ----------

export async function listTreatmentTypes(
  _ctx: AuthContext,
  opts: { includeInactive?: boolean } = {}
): Promise<TreatmentType[]> {
  let q = db.from("treatment_types").select("*").order("name");
  if (!opts.includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function createTreatmentType(
  ctx: AuthContext,
  input: { name: string; default_cost?: number }
) {
  requireAdmin(ctx);
  const { error } = await db.from("treatment_types").insert(input);
  if (error) throw error;
}

export async function updateTreatmentType(
  ctx: AuthContext,
  id: string,
  input: { name?: string; default_cost?: number | null; is_active?: boolean }
) {
  requireAdmin(ctx);
  const { error } = await db.from("treatment_types").update(input).eq("id", id);
  if (error) throw error;
}

// ---------- Doctors ----------

export async function listDoctors(
  ctx: AuthContext,
  opts: { branchId?: string; includeInactive?: boolean } = {}
): Promise<(Doctor & { branch: { name: string; code: string } | null })[]> {
  let q = db.from("doctors").select("*, branch:branches(name, code)").order("full_name");
  if (opts.branchId) {
    q = q.eq("branch_id", opts.branchId);
  } else if (ctx.role !== "admin") {
    q = q.in("branch_id", ctx.branchIds.length ? ctx.branchIds : ["00000000-0000-0000-0000-000000000000"]);
  }
  if (!opts.includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as (Doctor & { branch: { name: string; code: string } | null })[];
}

export async function createDoctor(
  ctx: AuthContext,
  input: { branch_id: string; full_name: string; specialization?: string; phone?: string; email?: string }
) {
  requireManagerOf(ctx, input.branch_id);
  const { error } = await db.from("doctors").insert(input);
  if (error) throw error;
}

export async function updateDoctor(
  ctx: AuthContext,
  id: string,
  input: { full_name?: string; specialization?: string | null; phone?: string | null; email?: string | null; is_active?: boolean }
) {
  const { data: doctor } = await db.from("doctors").select("branch_id").eq("id", id).maybeSingle();
  if (!doctor) throw new Error("Doctor not found");
  requireManagerOf(ctx, doctor.branch_id);
  const { error } = await db.from("doctors").update(input).eq("id", id);
  if (error) throw error;
}
