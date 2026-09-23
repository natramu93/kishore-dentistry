import "server-only";

import { db, authAdmin } from "./db";
import type { AuthContext } from "@/lib/auth/context";
import { requireAdmin, assertBranchAccess } from "@/lib/auth/guards";
import type { Json, Profile, UserRole } from "@/lib/database.types";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import {
  EMPTY_UUID,
  MAX_LIST_ROWS,
  assertUserRole,
  assertUuid,
  normalizePagination,
  userRoleSchema,
} from "@/lib/validation";

/** Used by getAuthContext() itself; callers must supply a verified auth user ID. */
export async function getProfileWithBranches(userId: string) {
  const id = assertUuid(userId, "User");
  const [profileResult, allocationsResult, linkedDoctorResult] = await Promise.all([
    db.from("profiles").select("*").eq("id", id).maybeSingle(),
    db
      .from("user_branches")
      .select("branch_id, branch:branches!inner(is_active)")
      .eq("user_id", id)
      .eq("branch.is_active", true),
    db
      .from("doctors")
      .select("id, branch_id, branch:branches!inner(is_active)")
      .eq("profile_id", id)
      .eq("is_active", true)
      .eq("branch.is_active", true)
      .maybeSingle(),
  ]);
  if (profileResult.error) throw profileResult.error;
  if (allocationsResult.error) throw allocationsResult.error;
  if (linkedDoctorResult.error) throw linkedDoctorResult.error;
  if (!profileResult.data) return null;

  const role = userRoleSchema.safeParse(profileResult.data.role);
  if (!role.success) {
    throw new Error(`Unsupported CRM role for profile ${id}`);
  }

  const branchIds = new Set(allocationsResult.data.map((allocation) => allocation.branch_id));
  if (linkedDoctorResult.data) branchIds.add(linkedDoctorResult.data.branch_id);

  return {
    ...profileResult.data,
    role: role.data,
    branchIds: [...branchIds],
    doctorId: linkedDoctorResult.data?.id ?? null,
  };
}

export type UserWithBranches = Profile & {
  branches: { id: string; name: string; code: string }[];
  linkedDoctorId: string | null;
};

type ProfileAuditState = {
  role: UserRole;
  isActive: boolean;
  branchIds: readonly string[];
  doctorId: string | null;
};

type ProfileAuditChangedField =
  | "full_name"
  | "phone"
  | "role"
  | "is_active"
  | "branch_ids"
  | "doctor_id";

function profileAuditData(
  state: ProfileAuditState,
  changedFields?: readonly ProfileAuditChangedField[]
): Json {
  return {
    role: state.role,
    is_active: state.isActive,
    branch_ids: [...state.branchIds].sort(),
    doctor_id: state.doctorId,
    ...(changedFields !== undefined && {
      changed_fields: [...new Set(changedFields)],
    }),
  };
}

async function recordProfileAdminAudit(input: {
  profileId: string;
  actorId: string;
  action: "created" | "updated";
  oldData: Json | null;
  newData: Json;
}): Promise<void> {
  const result = await db.rpc("record_profile_admin_audit", {
    p_profile_id: input.profileId,
    p_actor: input.actorId,
    p_action: input.action,
    p_old_data: input.oldData,
    p_new_data: input.newData,
  });
  if (result.error) throw result.error;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

export async function listUsers(
  ctx: AuthContext,
  opts: { page?: number; pageSize?: number } = {}
): Promise<{
  users: UserWithBranches[];
  total: number;
  page: number;
  pageSize: number;
}> {
  requireAdmin(ctx);
  const { page, pageSize } = normalizePagination(opts.page, opts.pageSize);
  const from = (page - 1) * pageSize;
  const profilesResult = await db
    .from("profiles")
    .select("*", { count: "exact" })
    .order("full_name")
    .range(from, from + pageSize - 1);
  if (profilesResult.error) throw profilesResult.error;

  const ids = profilesResult.data.map((profile) => profile.id);
  const idChunks = Array.from(
    { length: Math.ceil(ids.length / 20) },
    (_, index) => ids.slice(index * 20, index * 20 + 20)
  );
  const [allocationResults, branchesResult, doctorsResult] = await Promise.all([
    Promise.all(
      idChunks.map((chunk) =>
        db
          .from("user_branches")
          .select("user_id, branch_id")
          .in("user_id", chunk)
      )
    ),
    db
      .from("branches")
      .select("id, name, code")
      .limit(MAX_LIST_ROWS + 1),
    db
      .from("doctors")
      .select("id, profile_id")
      .in("profile_id", ids.length ? ids : [EMPTY_UUID]),
  ]);
  for (const result of allocationResults) {
    if (result.error) throw result.error;
  }
  if (branchesResult.error) throw branchesResult.error;
  if (doctorsResult.error) throw doctorsResult.error;
  if (branchesResult.data.length > MAX_LIST_ROWS) {
    throw new ValidationError("Too many branches to display");
  }
  const allocations = allocationResults.flatMap((result) => result.data ?? []);

  const branchMap = new Map(branchesResult.data.map((branch) => [branch.id, branch]));
  const allocationsByUser = new Map<string, string[]>();
  for (const allocation of allocations) {
    const branchIds = allocationsByUser.get(allocation.user_id) ?? [];
    branchIds.push(allocation.branch_id);
    allocationsByUser.set(allocation.user_id, branchIds);
  }
  const doctorByProfile = new Map(
    doctorsResult.data.map((doctor) => [doctor.profile_id as string, doctor.id])
  );

  const users = profilesResult.data.map((profile) => ({
    ...profile,
    branches: (allocationsByUser.get(profile.id) ?? [])
      .map((branchId) => branchMap.get(branchId))
      .filter((branch): branch is NonNullable<typeof branch> => Boolean(branch)),
    linkedDoctorId: doctorByProfile.get(profile.id) ?? null,
  }));
  return {
    users,
    total: profilesResult.count ?? 0,
    page,
    pageSize,
  };
}

/** Active workflow users allocated to a branch, for the assignee picker. */
export async function listAssignableUsers(ctx: AuthContext, branchId: string) {
  const scopedBranchId = assertUuid(branchId, "Branch");
  assertBranchAccess(ctx, scopedBranchId);
  const allocationsResult = await db
    .from("user_branches")
    .select("user_id")
    .eq("branch_id", scopedBranchId)
    .limit(MAX_LIST_ROWS + 1);
  if (allocationsResult.error) throw allocationsResult.error;
  if (allocationsResult.data.length > MAX_LIST_ROWS) {
    throw new ValidationError("Too many assignees to display");
  }
  const ids = allocationsResult.data.map((allocation) => allocation.user_id);
  if (!ids.length) return [];

  const profilesResult = await db
    .from("profiles")
    .select("id, full_name, email, role")
    .in("id", ids)
    .in("role", ["front_office", "operations", "clinical_head"])
    .eq("is_active", true)
    .order("full_name")
    .limit(MAX_LIST_ROWS + 1);
  if (profilesResult.error) throw profilesResult.error;
  if (profilesResult.data.length > MAX_LIST_ROWS) {
    throw new ValidationError("Too many assignees to display");
  }
  return profilesResult.data;
}

async function validateBranchIds(branchIds: readonly string[]): Promise<string[]> {
  if (branchIds.length > 50) {
    throw new ValidationError("A user can be allocated to at most 50 branches");
  }
  const ids = [...new Set(branchIds.map((id) => assertUuid(id, "Branch")))];
  if (!ids.length) return [];
  const result = await db
    .from("branches")
    .select("id")
    .in("id", ids)
    .eq("is_active", true);
  if (result.error) throw result.error;
  if (result.data.length !== ids.length) {
    throw new ValidationError("One or more selected branches are unavailable");
  }
  return ids;
}

async function validateDoctorLink(
  doctorRecordId: string,
  currentUserId?: string
): Promise<{ id: string; branch_id: string }> {
  const doctorId = assertUuid(doctorRecordId, "Doctor");
  const result = await db
    .from("doctors")
    .select("id, branch_id, profile_id, branch:branches!inner(is_active)")
    .eq("id", doctorId)
    .eq("is_active", true)
    .eq("branch.is_active", true)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new NotFoundError("Doctor");
  if (result.data.profile_id && result.data.profile_id !== currentUserId) {
    throw new ConflictError("That doctor record is already linked to another account");
  }
  return result.data;
}

export async function createUser(
  ctx: AuthContext,
  input: {
    email: string;
    full_name: string;
    phone?: string;
    role: UserRole;
    password: string;
    branchIds: string[];
    doctorRecordId?: string;
  }
) {
  requireAdmin(ctx);
  const role = assertUserRole(input.role);
  const branchIds = await validateBranchIds(input.branchIds);
  let doctor: { id: string; branch_id: string } | null = null;
  if (role === "doctor") {
    if (!input.doctorRecordId) {
      throw new ValidationError("A doctor account must be linked to a doctor record");
    }
    doctor = await validateDoctorLink(input.doctorRecordId);
    if (!branchIds.includes(doctor.branch_id)) branchIds.push(doctor.branch_id);
  } else if (input.doctorRecordId) {
    throw new ValidationError("Only a doctor account can link to a doctor record");
  }

  const { data: created, error: createError } =
    await authAdmin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.full_name },
    });
  if (createError) {
    if (
      createError.code === "email_exists" ||
      createError.code === "user_already_exists"
    ) {
      throw new ConflictError("An account already exists for this email");
    }
    throw createError;
  }
  if (!created.user) throw new Error("User creation did not create an auth user");
  const userId = created.user.id;

  try {
    const profileResult = await db
      .from("profiles")
      .update({
        full_name: input.full_name,
        phone: input.phone ?? null,
        role,
        is_active: true,
      })
      .eq("id", userId)
      .select("id")
      .maybeSingle();
    if (profileResult.error) throw profileResult.error;
    if (!profileResult.data) throw new Error("Auth user was created without a CRM profile");

    if (branchIds.length) {
      const allocationResult = await db
        .from("user_branches")
        .insert(branchIds.map((branch_id) => ({ user_id: userId, branch_id })));
      if (allocationResult.error) throw allocationResult.error;
    }

    if (doctor) {
      const linkResult = await db
        .from("doctors")
        .update({ profile_id: userId })
        .eq("id", doctor.id)
        .is("profile_id", null)
        .select("id")
        .maybeSingle();
      if (linkResult.error) throw linkResult.error;
      if (!linkResult.data) {
        throw new ConflictError("That doctor record was linked by another request");
      }
    }

    const changedFields: ProfileAuditChangedField[] = [
      "full_name",
      "role",
      "is_active",
      "branch_ids",
    ];
    if (input.phone !== undefined) changedFields.push("phone");
    if (doctor) changedFields.push("doctor_id");

    await recordProfileAdminAudit({
      profileId: userId,
      actorId: ctx.userId,
      action: "created",
      oldData: null,
      newData: profileAuditData(
        {
          role,
          isActive: true,
          branchIds,
          doctorId: doctor?.id ?? null,
        },
        changedFields
      ),
    });

    return userId;
  } catch (error) {
    const cleanup = await authAdmin.deleteUser(userId);
    if (cleanup.error) {
      console.error("Unable to compensate failed user provisioning", {
        userId,
        cleanupError: cleanup.error,
        originalError: error,
      });
    }
    throw error;
  }
}

type UserUpdate = {
  full_name?: string;
  phone?: string | null;
  role?: UserRole;
  is_active?: boolean;
  branchIds?: string[];
  doctorRecordId?: string;
};

async function restoreUserSnapshot(
  userId: string,
  snapshot: {
    profile: Pick<Profile, "full_name" | "phone" | "role" | "is_active">;
    branchIds: string[];
    doctorId: string | null;
  }
): Promise<void> {
  const results = await Promise.all([
    db.from("profiles").update(snapshot.profile).eq("id", userId),
    db.from("user_branches").delete().eq("user_id", userId),
    db.from("doctors").update({ profile_id: null }).eq("profile_id", userId),
  ]);
  for (const result of results) {
    if (result.error) console.error("User update rollback failed", { userId, error: result.error });
  }
  if (snapshot.branchIds.length) {
    const result = await db
      .from("user_branches")
      .insert(snapshot.branchIds.map((branch_id) => ({ user_id: userId, branch_id })));
    if (result.error) console.error("User branch rollback failed", { userId, error: result.error });
  }
  if (snapshot.doctorId) {
    const result = await db
      .from("doctors")
      .update({ profile_id: userId })
      .eq("id", snapshot.doctorId);
    if (result.error) console.error("Doctor-link rollback failed", { userId, error: result.error });
  }
}

export async function updateUser(ctx: AuthContext, userId: string, input: UserUpdate) {
  requireAdmin(ctx);
  const id = assertUuid(userId, "User");
  if (id === ctx.userId && (input.role !== undefined || input.is_active === false)) {
    throw new AuthorizationError("You cannot change your own role or deactivate yourself");
  }

  const [profileResult, allocationsResult, doctorResult] = await Promise.all([
    db
      .from("profiles")
      .select("full_name, phone, role, is_active")
      .eq("id", id)
      .maybeSingle(),
    db.from("user_branches").select("branch_id").eq("user_id", id),
    db.from("doctors").select("id").eq("profile_id", id).maybeSingle(),
  ]);
  if (profileResult.error) throw profileResult.error;
  if (allocationsResult.error) throw allocationsResult.error;
  if (doctorResult.error) throw doctorResult.error;
  if (!profileResult.data) throw new NotFoundError("User");

  const role = input.role === undefined ? profileResult.data.role : assertUserRole(input.role);
  let branchIds =
    input.branchIds === undefined
      ? allocationsResult.data.map((row) => row.branch_id)
      : await validateBranchIds(input.branchIds);
  const requestedDoctorId =
    input.doctorRecordId === undefined
      ? doctorResult.data?.id ?? null
      : input.doctorRecordId || null;
  const targetDoctorId = role === "doctor" ? requestedDoctorId : null;

  if (role === "doctor") {
    if (!targetDoctorId) {
      throw new ValidationError("A doctor account must be linked to a doctor record");
    }
    const doctor = await validateDoctorLink(targetDoctorId, id);
    if (!branchIds.includes(doctor.branch_id)) branchIds = [...branchIds, doctor.branch_id];
  }

  const snapshot = {
    profile: profileResult.data,
    branchIds: allocationsResult.data.map((row) => row.branch_id),
    doctorId: doctorResult.data?.id ?? null,
  };
  const isActive = input.is_active ?? snapshot.profile.is_active;
  const changedFields: ProfileAuditChangedField[] = [];
  if (
    input.full_name !== undefined &&
    input.full_name !== snapshot.profile.full_name
  ) {
    changedFields.push("full_name");
  }
  if (input.phone !== undefined && input.phone !== snapshot.profile.phone) {
    changedFields.push("phone");
  }
  if (role !== snapshot.profile.role) changedFields.push("role");
  if (isActive !== snapshot.profile.is_active) {
    changedFields.push("is_active");
  }
  if (!sameIds(branchIds, snapshot.branchIds)) {
    changedFields.push("branch_ids");
  }
  if (targetDoctorId !== snapshot.doctorId) {
    changedFields.push("doctor_id");
  }

  const profileFields: Partial<
    Pick<Profile, "full_name" | "phone" | "role" | "is_active">
  > = {
    ...(changedFields.includes("full_name") && {
      full_name: input.full_name,
    }),
    ...(changedFields.includes("phone") && { phone: input.phone }),
    ...(changedFields.includes("role") && { role }),
    ...(changedFields.includes("is_active") && { is_active: isActive }),
  };

  try {
    if (input.branchIds !== undefined || role === "doctor") {
      const current = new Set(snapshot.branchIds);
      const target = new Set(branchIds);
      const additions = branchIds.filter((branchId) => !current.has(branchId));
      const removals = snapshot.branchIds.filter((branchId) => !target.has(branchId));
      if (additions.length) {
        const result = await db
          .from("user_branches")
          .insert(additions.map((branch_id) => ({ user_id: id, branch_id })));
        if (result.error) throw result.error;
      }
      if (removals.length) {
        const result = await db
          .from("user_branches")
          .delete()
          .eq("user_id", id)
          .in("branch_id", removals);
        if (result.error) throw result.error;
      }
    }

    if (targetDoctorId !== snapshot.doctorId) {
      const unlinkResult = await db.from("doctors").update({ profile_id: null }).eq("profile_id", id);
      if (unlinkResult.error) throw unlinkResult.error;
      if (targetDoctorId) {
        const linkResult = await db
          .from("doctors")
          .update({ profile_id: id })
          .eq("id", targetDoctorId)
          .or(`profile_id.is.null,profile_id.eq.${id}`)
          .select("id")
          .maybeSingle();
        if (linkResult.error) throw linkResult.error;
        if (!linkResult.data) throw new ConflictError("That doctor record is already linked");
      }
    }

    if (Object.keys(profileFields).length) {
      const result = await db.from("profiles").update(profileFields).eq("id", id);
      if (result.error) throw result.error;
    }

    if (changedFields.length) {
      await recordProfileAdminAudit({
        profileId: id,
        actorId: ctx.userId,
        action: "updated",
        oldData: profileAuditData({
          role: snapshot.profile.role,
          isActive: snapshot.profile.is_active,
          branchIds: snapshot.branchIds,
          doctorId: snapshot.doctorId,
        }),
        newData: profileAuditData(
          {
            role,
            isActive,
            branchIds,
            doctorId: targetDoctorId,
          },
          changedFields
        ),
      });
    }
  } catch (error) {
    await restoreUserSnapshot(id, snapshot);
    throw error;
  }
}

/** Update an existing user's password through the server-only Auth admin API. */
export async function updatePassword(
  ctx: AuthContext,
  userId: string,
  password: string
): Promise<void> {
  requireAdmin(ctx);
  const id = assertUuid(userId, "User");
  const profile = await db.from("profiles").select("id").eq("id", id).maybeSingle();
  if (profile.error) throw profile.error;
  if (!profile.data) throw new NotFoundError("User");

  const result = await authAdmin.updateUserById(id, {
    password,
  });
  if (result.error) throw result.error;
}

/** Doctor rows for the admin-only account-linking picker. */
export async function listDoctorsForLinking(ctx: AuthContext) {
  requireAdmin(ctx);
  const result = await db
    .from("doctors")
    .select(
      "id, full_name, profile_id, branch:branches!inner(name, is_active)"
    )
    .eq("is_active", true)
    .eq("branch.is_active", true)
    .order("full_name")
    .limit(MAX_LIST_ROWS + 1);
  if (result.error) throw result.error;
  if (result.data.length > MAX_LIST_ROWS) {
    throw new ValidationError("Too many doctors to display in one picker");
  }
  return result.data.map((doctor) => ({
    id: doctor.id,
    full_name: doctor.full_name,
    branch: doctor.branch,
    alreadyLinked: doctor.profile_id !== null,
  }));
}
