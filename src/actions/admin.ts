"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import * as branches from "@/data/branches";
import * as users from "@/data/users";
import * as catalogs from "@/data/catalogs";
import { runAction, type ActionResult } from "./util";

// ---------- Branches ----------

const branchSchema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string().min(2, "Code is required").max(6),
  address: z.string().optional(),
  phone: z.string().optional(),
});

export async function createBranchAction(formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsed = branchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  return runAction(async () => {
    await branches.createBranch(ctx, parsed.data);
    revalidatePath("/admin/branches");
  });
}

export async function updateBranchAction(id: string, formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsed = branchSchema.partial().extend({ is_active: z.coerce.boolean().optional() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  return runAction(async () => {
    await branches.updateBranch(ctx, id, parsed.data);
    revalidatePath("/admin/branches");
  });
}

export async function toggleBranchActive(id: string, isActive: boolean): Promise<ActionResult> {
  const ctx = await getAuthContext();
  return runAction(async () => {
    await branches.updateBranch(ctx, id, { is_active: isActive });
    revalidatePath("/admin/branches");
  });
}

// ---------- Users ----------

const userSchema = z.object({
  email: z.string().email("Valid email required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  full_name: z.string().min(1, "Name is required"),
  phone: z.string().optional(),
  role: z.enum(["admin", "manager", "agent"]),
});

export async function createUserAction(formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const branchIds = formData.getAll("branch_ids").map(String).filter(Boolean);
  const parsed = userSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  return runAction(async () => {
    await users.createUser(ctx, { ...parsed.data, branchIds });
    revalidatePath("/admin/users");
  });
}

export async function updateUserAction(userId: string, formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const branchIds = formData.getAll("branch_ids").map(String).filter(Boolean);
  const parsed = userSchema
    .omit({ email: true, password: true })
    .partial()
    .extend({ is_active: z.coerce.boolean().optional() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  return runAction(async () => {
    await users.updateUser(ctx, userId, {
      ...parsed.data,
      // The edit form always includes the branch fieldset (marker present),
      // so an empty selection clears allocations rather than being ignored.
      branchIds: formData.has("manage_branches") ? branchIds : undefined,
    });
    revalidatePath("/admin/users");
  });
}

export async function toggleUserActive(userId: string, isActive: boolean): Promise<ActionResult> {
  const ctx = await getAuthContext();
  return runAction(async () => {
    await users.updateUser(ctx, userId, { is_active: isActive });
    revalidatePath("/admin/users");
  });
}

// ---------- Doctors ----------

const doctorSchema = z.object({
  branch_id: z.string().uuid("Branch is required"),
  full_name: z.string().min(1, "Name is required"),
  specialization: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
});

export async function createDoctorAction(formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsed = doctorSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  return runAction(async () => {
    await catalogs.createDoctor(ctx, { ...parsed.data, email: parsed.data.email || undefined });
    revalidatePath("/admin/doctors");
  });
}

export async function updateDoctorAction(id: string, formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsed = doctorSchema.omit({ branch_id: true }).partial().safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  return runAction(async () => {
    await catalogs.updateDoctor(ctx, id, {
      ...parsed.data,
      email: parsed.data.email === "" ? null : parsed.data.email,
    });
    revalidatePath("/admin/doctors");
  });
}

export async function toggleDoctorActive(id: string, isActive: boolean): Promise<ActionResult> {
  const ctx = await getAuthContext();
  return runAction(async () => {
    await catalogs.updateDoctor(ctx, id, { is_active: isActive });
    revalidatePath("/admin/doctors");
  });
}

// ---------- Lead sources & treatment types ----------

export async function createLeadSourceAction(formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Name is required" };
  return runAction(async () => {
    await catalogs.createLeadSource(ctx, name);
    revalidatePath("/admin/sources");
  });
}

export async function updateLeadSourceAction(id: string, formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Name is required" };
  return runAction(async () => {
    await catalogs.updateLeadSource(ctx, id, { name });
    revalidatePath("/admin/sources");
  });
}

export async function toggleLeadSourceActive(id: string, isActive: boolean): Promise<ActionResult> {
  const ctx = await getAuthContext();
  return runAction(async () => {
    await catalogs.updateLeadSource(ctx, id, { is_active: isActive });
    revalidatePath("/admin/sources");
  });
}

export async function createTreatmentTypeAction(formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const name = String(formData.get("name") ?? "").trim();
  const cost = formData.get("default_cost");
  if (!name) return { ok: false, error: "Name is required" };
  return runAction(async () => {
    await catalogs.createTreatmentType(ctx, {
      name,
      default_cost: cost ? Number(cost) : undefined,
    });
    revalidatePath("/admin/treatments");
  });
}

export async function updateTreatmentTypeAction(id: string, formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const name = String(formData.get("name") ?? "").trim();
  const cost = formData.get("default_cost");
  if (!name) return { ok: false, error: "Name is required" };
  return runAction(async () => {
    await catalogs.updateTreatmentType(ctx, id, {
      name,
      default_cost: cost ? Number(cost) : null,
    });
    revalidatePath("/admin/treatments");
  });
}

export async function toggleTreatmentTypeActive(id: string, isActive: boolean): Promise<ActionResult> {
  const ctx = await getAuthContext();
  return runAction(async () => {
    await catalogs.updateTreatmentType(ctx, id, { is_active: isActive });
    revalidatePath("/admin/treatments");
  });
}
