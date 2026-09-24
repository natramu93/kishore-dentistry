"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import * as branches from "@/data/branches";
import * as users from "@/data/users";
import * as catalogs from "@/data/catalogs";
import * as callTracking from "@/data/call-tracking";
import { assertActionRateLimit } from "@/lib/rate-limit";
import {
  booleanInputSchema,
  dentalCodePattern,
  optionalUuidSchema,
  userRoleSchema,
  uuidSchema,
} from "@/lib/validation";
import { runAction, runActionWithValue, type ActionResult, type ActionValueResult } from "./util";

const text = (max: number) => z.string().trim().max(max);
const idSchema = uuidSchema;
const activeSchema = booleanInputSchema;

const branchSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  code: z
    .string()
    .trim()
    .min(2, "Code is required")
    .max(6)
    .regex(/^[A-Za-z0-9]+$/, "Code can contain only letters and numbers"),
  address: text(500).optional(),
  phone: text(32).optional(),
  company_name: text(200).optional(),
  invoice_email: z.union([z.literal(""), z.string().trim().email().max(254)]).optional(),
  gst_number: text(32).optional(),
});

function invalid(error: z.ZodError): ActionResult {
  return { ok: false, error: error.issues[0]?.message ?? "Invalid input" };
}

async function adminMutationLimit(userId: string, scope: string): Promise<void> {
  await assertActionRateLimit(userId, scope, {
    limit: 30,
    windowMs: 5 * 60_000,
  });
}

export async function createBranchAction(formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsed = branchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    await adminMutationLimit(ctx.userId, "admin:branch");
    await branches.createBranch(ctx, { ...parsed.data, invoice_email: parsed.data.invoice_email || undefined });
    revalidatePath("/admin/branches");
  });
}

export async function updateBranchAction(id: string, formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsedId = idSchema.safeParse(id);
  const parsed = branchSchema
    .partial()
    .extend({ is_active: activeSchema.optional() })
    .safeParse(Object.fromEntries(formData));
  if (!parsedId.success) return { ok: false, error: "Branch is invalid" };
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    await adminMutationLimit(ctx.userId, "admin:branch");
    await branches.updateBranch(ctx, parsedId.data, { ...parsed.data, invoice_email: parsed.data.invoice_email || null });
    revalidatePath("/admin/branches");
  });
}

export async function toggleBranchActive(id: string, isActive: boolean): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsed = z.object({ id: idSchema, isActive: activeSchema }).safeParse({ id, isActive });
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    await adminMutationLimit(ctx.userId, "admin:branch");
    await branches.updateBranch(ctx, parsed.data.id, { is_active: parsed.data.isActive });
    revalidatePath("/admin/branches");
  });
}

const userDetailsSchema = z.object({
  email: z.string().trim().email("Valid email required").max(254),
  full_name: z.string().trim().min(1, "Name is required").max(200),
  phone: text(32).optional(),
  role: userRoleSchema,
});

const userCreateSchema = userDetailsSchema.extend({
  password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .max(128, "Password must be 128 characters or fewer"),
});

const branchIdsSchema = z.array(uuidSchema).max(50);

export async function createUserAction(formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const branchIds = branchIdsSchema.safeParse(
    [...new Set(formData.getAll("branch_ids").map(String).filter(Boolean))]
  );
  const doctorRecordId = optionalUuidSchema.safeParse(
    String(formData.get("doctor_record_id") ?? "")
  );
  const parsed = userCreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  if (!branchIds.success) return invalid(branchIds.error);
  if (!doctorRecordId.success) return invalid(doctorRecordId.error);
  return runAction(async () => {
    await assertActionRateLimit(ctx.userId, "admin:create-user", {
      limit: 5,
      windowMs: 10 * 60_000,
    });
    await users.createUser(ctx, {
      ...parsed.data,
      branchIds: branchIds.data,
      doctorRecordId: doctorRecordId.data || undefined,
    });
    revalidatePath("/admin/users");
  });
}

export async function updateUserAction(userId: string, formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsedId = idSchema.safeParse(userId);
  const branchIds = branchIdsSchema.safeParse(
    [...new Set(formData.getAll("branch_ids").map(String).filter(Boolean))]
  );
  const parsed = userDetailsSchema
    .omit({ email: true })
    .partial()
    .extend({ is_active: activeSchema.optional() })
    .safeParse(Object.fromEntries(formData));
  const doctorRecordId = formData.has("doctor_record_id")
    ? optionalUuidSchema.safeParse(String(formData.get("doctor_record_id") ?? ""))
    : null;
  if (!parsedId.success) return { ok: false, error: "User is invalid" };
  if (!parsed.success) return invalid(parsed.error);
  if (!branchIds.success) return invalid(branchIds.error);
  if (doctorRecordId && !doctorRecordId.success) return invalid(doctorRecordId.error);
  return runAction(async () => {
    await adminMutationLimit(ctx.userId, "admin:update-user");
    await users.updateUser(ctx, parsedId.data, {
      ...parsed.data,
      branchIds: formData.has("manage_branches") ? branchIds.data : undefined,
      doctorRecordId: doctorRecordId?.data,
    });
    revalidatePath("/admin/users");
  });
}

export async function toggleUserActive(userId: string, isActive: boolean): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsed = z.object({ userId: idSchema, isActive: activeSchema }).safeParse({
    userId,
    isActive,
  });
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    await adminMutationLimit(ctx.userId, "admin:update-user");
    await users.updateUser(ctx, parsed.data.userId, { is_active: parsed.data.isActive });
    revalidatePath("/admin/users");
  });
}

const passwordUpdateSchema = z
  .object({
    password: z
      .string()
      .min(12, "Password must be at least 12 characters")
      .max(128, "Password must be 128 characters or fewer"),
    password_confirmation: z.string(),
  })
  .refine((value) => value.password === value.password_confirmation, {
    path: ["password_confirmation"],
    message: "Passwords do not match",
  });

export async function updateUserPasswordAction(
  userId: string,
  formData: FormData
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsedId = idSchema.safeParse(userId);
  const parsedPassword = passwordUpdateSchema.safeParse(Object.fromEntries(formData));
  if (!parsedId.success) return { ok: false, error: "User is invalid" };
  if (!parsedPassword.success) return invalid(parsedPassword.error);
  return runAction(async () => {
    await adminMutationLimit(ctx.userId, "admin:password-reset");
    await users.updatePassword(ctx, parsedId.data, parsedPassword.data.password);
    revalidatePath("/admin/users");
  });
}

const doctorSchema = z.object({
  branch_id: uuidSchema,
  full_name: z.string().trim().min(1, "Name is required").max(200),
  specialization: text(200).optional(),
  phone: text(32).optional(),
  email: z.string().trim().email().max(254).optional().or(z.literal("")),
});

export async function createDoctorAction(formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsed = doctorSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    await adminMutationLimit(ctx.userId, "admin:doctor");
    await catalogs.createDoctor(ctx, {
      ...parsed.data,
      email: parsed.data.email || undefined,
    });
    revalidatePath("/admin/doctors");
  });
}

export async function updateDoctorAction(id: string, formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsedId = idSchema.safeParse(id);
  const parsed = doctorSchema
    .omit({ branch_id: true })
    .partial()
    .safeParse(Object.fromEntries(formData));
  if (!parsedId.success) return { ok: false, error: "Doctor is invalid" };
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    await adminMutationLimit(ctx.userId, "admin:doctor");
    await catalogs.updateDoctor(ctx, parsedId.data, {
      ...parsed.data,
      email: parsed.data.email === "" ? null : parsed.data.email,
    });
    revalidatePath("/admin/doctors");
  });
}

export async function toggleDoctorActive(id: string, isActive: boolean): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsed = z.object({ id: idSchema, isActive: activeSchema }).safeParse({ id, isActive });
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    await adminMutationLimit(ctx.userId, "admin:doctor");
    await catalogs.updateDoctor(ctx, parsed.data.id, { is_active: parsed.data.isActive });
    revalidatePath("/admin/doctors");
  });
}

const catalogNameSchema = z.string().trim().min(1, "Name is required").max(200);

export async function createLeadSourceAction(formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsed = catalogNameSchema.safeParse(formData.get("name"));
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    await adminMutationLimit(ctx.userId, "admin:catalog");
    await catalogs.createLeadSource(ctx, parsed.data);
    revalidatePath("/admin/sources");
  });
}

export async function updateLeadSourceAction(id: string, formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsed = z.object({ id: idSchema, name: catalogNameSchema }).safeParse({
    id,
    name: formData.get("name"),
  });
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    await adminMutationLimit(ctx.userId, "admin:catalog");
    await catalogs.updateLeadSource(ctx, parsed.data.id, { name: parsed.data.name });
    revalidatePath("/admin/sources");
  });
}

export async function toggleLeadSourceActive(id: string, isActive: boolean): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsed = z.object({ id: idSchema, isActive: activeSchema }).safeParse({ id, isActive });
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    await adminMutationLimit(ctx.userId, "admin:catalog");
    await catalogs.updateLeadSource(ctx, parsed.data.id, { is_active: parsed.data.isActive });
    revalidatePath("/admin/sources");
  });
}

const treatmentTypeSchema = z.object({
  name: catalogNameSchema,
  category: text(200),
  default_cost: z.coerce.number().finite().min(0).max(100_000_000).optional(),
});

const dentalCodeCreateSchema = z.object({
  code: z.string().trim().toUpperCase().regex(dentalCodePattern, "Use a valid ICD-10 dental code"),
  name: z.string().trim().min(1, "Description is required").max(300),
  category: text(120),
  code_level: z.enum(["category", "detail"]),
  billable: booleanInputSchema,
}).superRefine((value, issueContext) => {
  const expectedLevel = value.code.includes(".") ? "detail" : "category";
  if (value.code_level !== expectedLevel) {
    issueContext.addIssue({ code: "custom", path: ["code_level"], message: `Use ${expectedLevel} for this code` });
  }
});

const dentalCodeUpdateSchema = z.object({
  name: z.string().trim().min(1, "Description is required").max(300),
  category: text(120),
  code_level: z.enum(["procedure", "category", "detail"]),
  billable: booleanInputSchema,
});

function dentalCodeFormValues(formData: FormData) {
  return {
    code: formData.get("code"),
    name: formData.get("name"),
    category: String(formData.get("category") ?? "").trim(),
    code_level: formData.get("code_level"),
    billable: formData.get("billable") ?? "false",
  };
}

function dentalCodeUpdateFormValues(formData: FormData) {
  return {
    name: formData.get("name"),
    category: String(formData.get("category") ?? "").trim(),
    code_level: formData.get("code_level"),
    billable: formData.get("billable") ?? "false",
  };
}

export async function createTreatmentCodeAction(formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsed = dentalCodeCreateSchema.safeParse(dentalCodeFormValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    await adminMutationLimit(ctx.userId, "admin:dental-codes");
    await catalogs.createTreatmentCode(ctx, {
      ...parsed.data,
      category: parsed.data.category || null,
    });
    revalidatePath("/admin/dental-codes");
  });
}

export async function updateTreatmentCodeAction(code: string, formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsedCode = z.string().trim().toUpperCase().regex(dentalCodePattern).safeParse(code);
  const parsed = dentalCodeUpdateSchema.safeParse(dentalCodeUpdateFormValues(formData));
  if (!parsedCode.success) return { ok: false, error: "Dental code is invalid" };
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    await adminMutationLimit(ctx.userId, "admin:dental-codes");
    await catalogs.updateTreatmentCode(ctx, parsedCode.data, {
      ...parsed.data,
      category: parsed.data.category || null,
    });
    revalidatePath("/admin/dental-codes");
  });
}

export async function toggleTreatmentCodeActive(code: string, isActive: boolean): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsed = z.object({
    code: z.string().trim().toUpperCase().regex(dentalCodePattern),
    isActive: activeSchema,
  }).safeParse({ code, isActive });
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    await adminMutationLimit(ctx.userId, "admin:dental-codes");
    await catalogs.updateTreatmentCode(ctx, parsed.data.code, {
      status: parsed.data.isActive ? "active" : "inactive",
    });
    revalidatePath("/admin/dental-codes");
  });
}

export async function createTreatmentTypeAction(formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsed = treatmentTypeSchema.safeParse({
    name: formData.get("name"),
    category: String(formData.get("category") ?? "").trim(),
    default_cost: formData.get("default_cost") || undefined,
  });
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    await adminMutationLimit(ctx.userId, "admin:catalog");
    await catalogs.createTreatmentType(ctx, {
      name: parsed.data.name,
      category: parsed.data.category || null,
      default_cost: parsed.data.default_cost,
    });
    revalidatePath("/admin/treatments");
  });
}

export async function updateTreatmentTypeAction(id: string, formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsed = treatmentTypeSchema.safeParse({
    name: formData.get("name"),
    category: String(formData.get("category") ?? "").trim(),
    default_cost: formData.get("default_cost") || undefined,
  });
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: "Treatment type is invalid" };
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    await adminMutationLimit(ctx.userId, "admin:catalog");
    await catalogs.updateTreatmentType(ctx, parsedId.data, {
      name: parsed.data.name,
      category: parsed.data.category || null,
      default_cost: parsed.data.default_cost ?? null,
    });
    revalidatePath("/admin/treatments");
  });
}

export async function toggleTreatmentTypeActive(id: string, isActive: boolean): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsed = z.object({ id: idSchema, isActive: activeSchema }).safeParse({ id, isActive });
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    await adminMutationLimit(ctx.userId, "admin:catalog");
    await catalogs.updateTreatmentType(ctx, parsed.data.id, { is_active: parsed.data.isActive });
    revalidatePath("/admin/treatments");
  });
}

const webhookSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  source_system: z.string().trim().min(1, "Source system is required").max(80),
  branch_id: optionalUuidSchema,
});

export async function createWebhookEndpointAction(
  formData: FormData
): Promise<ActionValueResult<{ endpointPath: string; secret: string }>> {
  const ctx = await getAuthContext();
  const parsed = webhookSchema.safeParse({
    name: formData.get("name"),
    source_system: formData.get("source_system"),
    branch_id: String(formData.get("branch_id") ?? ""),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  return runActionWithValue(async () => {
    await adminMutationLimit(ctx.userId, "admin:webhook");
    const created = await callTracking.createWebhookEndpoint(ctx, {
      name: parsed.data.name,
      sourceSystem: parsed.data.source_system,
      branchId: parsed.data.branch_id || null,
    });
    revalidatePath("/admin/webhooks");
    return {
      endpointPath: created.endpointPath,
      secret: created.secret,
    };
  });
}

export async function revokeWebhookEndpointAction(id: string): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: "Webhook endpoint is invalid" };
  return runAction(async () => {
    await adminMutationLimit(ctx.userId, "admin:webhook");
    await callTracking.revokeWebhookEndpoint(ctx, parsedId.data);
    revalidatePath("/admin/webhooks");
  });
}
