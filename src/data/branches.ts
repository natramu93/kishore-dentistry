import "server-only";

import { db } from "./db";
import type { AuthContext } from "@/lib/auth/context";
import { requireAdmin } from "@/lib/auth/guards";
import type { Branch } from "@/lib/database.types";

/** All active branches — names are needed app-wide for labels/dropdowns. */
export async function listBranches(
  _ctx: AuthContext,
  opts: { includeInactive?: boolean } = {}
): Promise<Branch[]> {
  let q = db.from("branches").select("*").order("name");
  if (!opts.includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
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
  input: { name: string; code: string; address?: string; phone?: string }
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
  input: { name?: string; code?: string; address?: string | null; phone?: string | null; is_active?: boolean }
) {
  requireAdmin(ctx);
  const { error } = await db
    .from("branches")
    .update({ ...input, ...(input.code ? { code: input.code.toUpperCase() } : {}) })
    .eq("id", id);
  if (error) throw error;
}
