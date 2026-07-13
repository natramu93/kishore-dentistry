import "server-only";

import { db, authAdmin } from "./db";
import type { AuthContext } from "@/lib/auth/context";
import { AuthorizationError } from "@/lib/auth/context";
import { requireAdmin, assertBranchAccess } from "@/lib/auth/guards";
import type { Profile, UserRole } from "@/lib/database.types";

/** Used by getAuthContext() itself — no ctx, do not export to pages. */
export async function getProfileWithBranches(userId: string) {
  const [{ data: profile }, { data: allocations }, { data: linkedDoctor }] = await Promise.all([
    db.from("profiles").select("*").eq("id", userId).maybeSingle(),
    db.from("user_branches").select("branch_id").eq("user_id", userId),
    db.from("doctors").select("id, branch_id").eq("profile_id", userId).maybeSingle(),
  ]);
  if (!profile) return null;

  // A "doctor" login self-scopes to their own doctors row's branch even if no
  // explicit user_branches allocation was made — that's the natural default.
  const branchIds = new Set((allocations ?? []).map((a) => a.branch_id));
  if (linkedDoctor) branchIds.add(linkedDoctor.branch_id);

  return {
    ...profile,
    branchIds: [...branchIds],
    doctorId: linkedDoctor?.id ?? null,
  };
}

export type UserWithBranches = Profile & {
  branches: { id: string; name: string; code: string }[];
  /** Set for role "doctor" — the crm.doctors row this login is linked to. */
  linkedDoctorId: string | null;
};

export async function listUsers(ctx: AuthContext): Promise<UserWithBranches[]> {
  let userIds: string[] | null = null;

  if (ctx.role === "front_office" || ctx.role === "doctor") {
    userIds = [ctx.userId];
  } else if (ctx.role === "operations" || ctx.role === "clinical_head") {
    // Users sharing any of this manager's branches (plus themselves)
    const { data } = await db
      .from("user_branches")
      .select("user_id")
      .in("branch_id", ctx.branchIds.length ? ctx.branchIds : ["00000000-0000-0000-0000-000000000000"]);
    userIds = [...new Set([...(data ?? []).map((r) => r.user_id), ctx.userId])];
  }

  let q = db.from("profiles").select("*").order("full_name");
  if (userIds) q = q.in("id", userIds);
  const { data: profiles, error } = await q;
  if (error) throw error;

  const ids = (profiles ?? []).map((p) => p.id);
  const [{ data: allocations }, { data: branches }, { data: linkedDoctors }] = await Promise.all([
    db
      .from("user_branches")
      .select("user_id, branch_id")
      .in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
    db.from("branches").select("id, name, code"),
    db.from("doctors").select("id, profile_id").not("profile_id", "is", null),
  ]);

  const branchMap = new Map((branches ?? []).map((b) => [b.id, b]));
  const doctorByProfile = new Map((linkedDoctors ?? []).map((d) => [d.profile_id as string, d.id]));
  return (profiles ?? []).map((p) => ({
    ...p,
    branches: (allocations ?? [])
      .filter((a) => a.user_id === p.id)
      .map((a) => branchMap.get(a.branch_id))
      .filter((b): b is NonNullable<typeof b> => Boolean(b)),
    linkedDoctorId: doctorByProfile.get(p.id) ?? null,
  }));
}

/** Users allocated to a branch — for the assignee picker. */
export async function listAssignableUsers(ctx: AuthContext, branchId: string) {
  assertBranchAccess(ctx, branchId);
  const { data: allocations } = await db
    .from("user_branches")
    .select("user_id")
    .eq("branch_id", branchId);
  const ids = (allocations ?? []).map((a) => a.user_id);
  if (!ids.length) return [];
  const { data } = await db
    .from("profiles")
    .select("id, full_name, email, role")
    .in("id", ids)
    .eq("is_active", true)
    .order("full_name");
  return data ?? [];
}

export async function createUser(
  ctx: AuthContext,
  input: {
    email: string;
    password: string;
    full_name: string;
    phone?: string;
    role: UserRole;
    branchIds: string[];
    /** When role is "doctor": link this login to an existing crm.doctors row. */
    doctorRecordId?: string;
  }
) {
  requireAdmin(ctx);

  const { data: created, error } = await authAdmin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.full_name },
  });
  if (error) throw error;
  const userId = created.user.id;

  // handle_new_user trigger created the profile; set role + details
  const { error: profileError } = await db
    .from("profiles")
    .update({
      full_name: input.full_name,
      phone: input.phone ?? null,
      role: input.role,
    })
    .eq("id", userId);
  if (profileError) throw profileError;

  if (input.branchIds.length) {
    const { error: allocError } = await db
      .from("user_branches")
      .insert(input.branchIds.map((branch_id) => ({ user_id: userId, branch_id })));
    if (allocError) throw allocError;
  }

  if (input.role === "doctor" && input.doctorRecordId) {
    await db.from("doctors").update({ profile_id: userId }).eq("id", input.doctorRecordId);
  }
  return userId;
}

export async function updateUser(
  ctx: AuthContext,
  userId: string,
  input: {
    full_name?: string;
    phone?: string | null;
    role?: UserRole;
    is_active?: boolean;
    branchIds?: string[];
    doctorRecordId?: string;
  }
) {
  requireAdmin(ctx);
  if (userId === ctx.userId && (input.role !== undefined || input.is_active === false)) {
    throw new AuthorizationError("You cannot change your own role or deactivate yourself");
  }

  const { branchIds, doctorRecordId, ...profileFields } = input;
  if (Object.keys(profileFields).length) {
    const { error } = await db.from("profiles").update(profileFields).eq("id", userId);
    if (error) throw error;
  }

  if (branchIds) {
    await db.from("user_branches").delete().eq("user_id", userId);
    if (branchIds.length) {
      const { error } = await db
        .from("user_branches")
        .insert(branchIds.map((branch_id) => ({ user_id: userId, branch_id })));
      if (error) throw error;
    }
  }

  if (doctorRecordId !== undefined) {
    // Unlink any doctor row previously pointing at this login, then relink.
    await db.from("doctors").update({ profile_id: null }).eq("profile_id", userId);
    if (doctorRecordId) {
      await db.from("doctors").update({ profile_id: userId }).eq("id", doctorRecordId);
    }
  }
}

/** All doctor rows for the "link a login" picker — flags ones already linked. */
export async function listDoctorsForLinking() {
  const { data } = await db
    .from("doctors")
    .select("id, full_name, profile_id, branch:branches(name)")
    .eq("is_active", true)
    .order("full_name");
  return (data ?? []).map((d) => ({
    id: d.id,
    full_name: d.full_name,
    branch: d.branch,
    alreadyLinked: d.profile_id !== null,
  }));
}
