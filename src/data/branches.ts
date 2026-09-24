import "server-only";

import { db } from "./db";
import type { AuthContext } from "@/lib/auth/context";
import { requireAdmin } from "@/lib/auth/guards";
import type { Branch } from "@/lib/database.types";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { MAX_LIST_ROWS, assertUuid } from "@/lib/validation";

/** All active branches — names are needed app-wide for labels/dropdowns. */
export async function listBranches(
  _ctx: AuthContext,
  opts: { includeInactive?: boolean } = {}
): Promise<Branch[]> {
  let q = db
    .from("branches")
    .select("*")
    .order("name")
    .limit(MAX_LIST_ROWS + 1);
  if (!opts.includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  if ((data?.length ?? 0) > MAX_LIST_ROWS) {
    throw new ValidationError("Too many branches to display");
  }
  return data ?? [];
}

/** Branches the user can work in (admin: all active). */
export async function listMyBranches(ctx: AuthContext): Promise<Branch[]> {
  const all = await listBranches(ctx);
  if (ctx.role === "admin") return all;
  return all.filter((b) => ctx.branchIds.includes(b.id));
}

export async function createBranch(
  ctx: AuthContext,
  input: { name: string; code: string; address?: string; phone?: string; company_name?: string; invoice_email?: string; gst_number?: string }
) {
  requireAdmin(ctx);
  const { data, error } = await db
    .from("branches")
    .insert({ ...input, code: input.code.toUpperCase() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateBranch(
  ctx: AuthContext,
  id: string,
  input: { name?: string; code?: string; address?: string | null; phone?: string | null; company_name?: string | null; invoice_email?: string | null; gst_number?: string | null; is_active?: boolean }
) {
  requireAdmin(ctx);
  const branchId = assertUuid(id, "Branch");
  const { data, error } = await db
    .from("branches")
    .update({ ...input, ...(input.code ? { code: input.code.toUpperCase() } : {}) })
    .eq("id", branchId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("Branch");
}
