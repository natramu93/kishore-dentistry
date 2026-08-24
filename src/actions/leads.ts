"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { transitionPayloadSchemas } from "@/lib/leads/transitions";
import * as leads from "@/data/leads";
import * as comments from "@/data/comments";
import { clinicTimeToUtc } from "@/lib/tz";
import { assertActionRateLimit } from "@/lib/rate-limit";
import {
  commentEntitySchema,
  leadStatusSchema,
  optionalUuidSchema,
  assertDateOnly,
  uuidSchema,
} from "@/lib/validation";
import {
  runAction,
  runActionWithValue,
  type ActionResult,
} from "./util";

const optionalDate = z
  .string()
  .max(10)
  .refine(
    (value) => {
      if (!value) return true;
      try {
        assertDateOnly(value, "Date of birth");
        return true;
      } catch {
        return false;
      }
    },
    "Date of birth is invalid"
  )
  .optional()
  .or(z.literal(""));

const leadSchema = z.object({
  branch_id: uuidSchema,
  name: z.string().trim().min(1, "Name is required").max(200),
  mobile: z.string().trim().min(7, "Valid mobile is required").max(32),
  email: z.string().trim().email().max(254).optional().or(z.literal("")),
  source_id: optionalUuidSchema,
  interest_id: optionalUuidSchema,
  age: z.coerce.number().int().min(0).max(120).optional().or(z.literal("")),
  dob: optionalDate,
  notes: z.string().trim().max(4_000).optional(),
});

async function leadMutationLimit(userId: string): Promise<void> {
  await assertActionRateLimit(userId, "lead:mutation", {
    limit: 60,
    windowMs: 5 * 60_000,
  });
}

export async function createLeadAction(
  formData: FormData
): Promise<ActionResult & { id?: string }> {
  const ctx = await getAuthContext();
  const parsed = leadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const value = parsed.data;
  return runActionWithValue(async () => {
    await leadMutationLimit(ctx.userId);
    const lead = await leads.createLead(ctx, {
      branch_id: value.branch_id,
      name: value.name,
      mobile: value.mobile,
      email: value.email || null,
      source_id: value.source_id || null,
      interest_id: value.interest_id || null,
      age: value.age === "" || value.age === undefined ? null : Number(value.age),
      dob: value.dob || null,
      notes: value.notes || null,
    });
    revalidatePath("/leads");
    return { id: lead.id };
  });
}

export async function updateLeadAction(
  leadId: string,
  formData: FormData
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const id = uuidSchema.safeParse(leadId);
  const parsed = leadSchema
    .omit({ branch_id: true })
    .partial()
    .safeParse(Object.fromEntries(formData));
  if (!id.success) return { ok: false, error: "Lead is invalid" };
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const value = parsed.data;
  return runAction(async () => {
    await leadMutationLimit(ctx.userId);
    await leads.updateLeadDetails(ctx, id.data, {
      ...(value.name !== undefined && { name: value.name }),
      ...(value.mobile !== undefined && { mobile: value.mobile }),
      ...(value.email !== undefined && { email: value.email || null }),
      ...(value.source_id !== undefined && { source_id: value.source_id || null }),
      ...(value.interest_id !== undefined && { interest_id: value.interest_id || null }),
      ...(value.age !== undefined && {
        age: value.age === "" ? null : Number(value.age),
      }),
      ...(value.dob !== undefined && { dob: value.dob || null }),
      ...(value.notes !== undefined && { notes: value.notes || null }),
    });
    revalidatePath(`/leads/${id.data}`);
    revalidatePath("/leads");
  });
}

export async function transitionLeadAction(
  leadId: string,
  toValue: unknown,
  formData: FormData
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const id = uuidSchema.safeParse(leadId);
  const target = leadStatusSchema.safeParse(toValue);
  if (!id.success || !target.success) {
    return { ok: false, error: "Transition target is invalid" };
  }
  if (target.data === "visited_treated") {
    return {
      ok: false,
      error: "Finalize a coded digital case sheet to complete this visit",
    };
  }
  const schema =
    transitionPayloadSchemas[target.data as keyof typeof transitionPayloadSchemas];
  if (!schema) return { ok: false, error: "Transition target is invalid" };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  return runAction(async () => {
    await leadMutationLimit(ctx.userId);
    const payload: Record<string, unknown> = { ...parsed.data };
    if (typeof payload.scheduled_at === "string" && payload.scheduled_at) {
      payload.scheduled_at = clinicTimeToUtc(payload.scheduled_at);
    }
    if (typeof payload.due_at === "string" && payload.due_at) {
      payload.due_at = clinicTimeToUtc(payload.due_at);
    }
    for (const key of Object.keys(payload)) {
      if (payload[key] === "" || payload[key] === undefined) delete payload[key];
    }
    await leads.transitionLead(ctx, id.data, target.data, payload);
    revalidatePath(`/leads/${id.data}`);
    revalidatePath("/leads");
    revalidatePath("/dashboard");
    revalidatePath("/appointments");
    revalidatePath("/follow-ups");
  });
}

export async function deleteLeadAction(leadId: string): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const id = uuidSchema.safeParse(leadId);
  if (!id.success) return { ok: false, error: "Lead is invalid" };
  return runAction(async () => {
    await assertActionRateLimit(ctx.userId, "lead:delete", {
      limit: 10,
      windowMs: 10 * 60_000,
    });
    await leads.deleteLead(ctx, id.data);
    revalidatePath("/leads");
    revalidatePath("/dashboard");
  });
}

export async function checkDuplicateMobile(mobile: string) {
  const ctx = await getAuthContext();
  const parsed = z.string().trim().min(7).max(32).safeParse(mobile);
  if (!parsed.success) return [];
  try {
    await assertActionRateLimit(ctx.userId, "lead:duplicate-check", {
      limit: 60,
      windowMs: 60_000,
    });
  } catch {
    return [];
  }
  const matches = await leads.findLeadsByMobile(ctx, parsed.data);
  return matches.map((match) => ({
    id: match.id,
    name: match.name,
    status: match.status,
  }));
}

const commentSchema = z.object({
  lead_id: uuidSchema,
  body: z.string().trim().min(1, "Comment cannot be empty").max(4_000),
  entity_type: commentEntitySchema.default("lead"),
  entity_id: optionalUuidSchema,
});

export async function addCommentAction(formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsed = commentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid comment" };
  }
  return runAction(async () => {
    await assertActionRateLimit(ctx.userId, "comment:mutation", {
      limit: 60,
      windowMs: 60_000,
    });
    await comments.addComment(ctx, {
      lead_id: parsed.data.lead_id,
      body: parsed.data.body,
      entity_type: parsed.data.entity_type,
      entity_id: parsed.data.entity_id || null,
    });
    revalidatePath(`/leads/${parsed.data.lead_id}`);
  });
}

export async function updateCommentAction(
  commentId: string,
  expectedVersion: unknown,
  body: string
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsed = z
    .object({
      commentId: uuidSchema,
      expectedVersion: z.coerce.number().int().positive(),
      body: z.string().trim().min(1, "Comment cannot be empty").max(4_000),
    })
    .safeParse({ commentId, expectedVersion, body });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid comment" };
  }
  return runAction(async () => {
    await assertActionRateLimit(ctx.userId, "comment:mutation", {
      limit: 60,
      windowMs: 60_000,
    });
    const updated = await comments.updateComment(
      ctx,
      parsed.data.commentId,
      parsed.data.body,
      parsed.data.expectedVersion
    );
    revalidatePath(`/leads/${updated.lead_id}`);
  });
}

export async function archiveCommentAction(
  commentId: string,
  expectedVersion: unknown,
  reason: string
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsed = z
    .object({
      commentId: uuidSchema,
      expectedVersion: z.coerce.number().int().positive(),
      reason: z.string().trim().min(1, "Archive reason is required").max(500),
    })
    .safeParse({ commentId, expectedVersion, reason });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Comment reference is invalid",
    };
  }
  return runAction(async () => {
    await assertActionRateLimit(ctx.userId, "comment:mutation", {
      limit: 60,
      windowMs: 60_000,
    });
    const archived = await comments.archiveComment(
      ctx,
      parsed.data.commentId,
      parsed.data.reason,
      parsed.data.expectedVersion
    );
    revalidatePath(`/leads/${archived.lead_id}`);
  });
}

export async function createLeadAndRedirect(formData: FormData) {
  const result = await createLeadAction(formData);
  if (result.ok && result.id) redirect(`/leads/${result.id}`);
  return result;
}
