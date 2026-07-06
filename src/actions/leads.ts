"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { transitionPayloadSchemas } from "@/lib/leads/transitions";
import * as leads from "@/data/leads";
import * as comments from "@/data/comments";
import { clinicTimeToUtc } from "@/lib/tz";
import type { CommentEntity, LeadStatus } from "@/lib/database.types";
import { runAction, type ActionResult } from "./util";

const leadSchema = z.object({
  branch_id: z.string().uuid(),
  name: z.string().min(1, "Name is required"),
  mobile: z.string().min(7, "Valid mobile is required"),
  email: z.string().email().optional().or(z.literal("")),
  source_id: z.string().uuid().optional().or(z.literal("")),
  age: z.coerce.number().int().min(0).max(120).optional().or(z.literal("")),
  dob: z.string().optional().or(z.literal("")),
  notes: z.string().optional(),
});

export async function createLeadAction(formData: FormData): Promise<ActionResult & { id?: string }> {
  const ctx = await getAuthContext();
  const parsed = leadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const v = parsed.data;
  try {
    const lead = await leads.createLead(ctx, {
      branch_id: v.branch_id,
      name: v.name,
      mobile: v.mobile,
      email: v.email || null,
      source_id: v.source_id || null,
      age: v.age === "" || v.age === undefined ? null : Number(v.age),
      dob: v.dob || null,
      notes: v.notes || null,
    });
    revalidatePath("/leads");
    return { ok: true, id: lead.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to create lead" };
  }
}

export async function updateLeadAction(leadId: string, formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsed = leadSchema.omit({ branch_id: true }).partial().safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const v = parsed.data;
  return runAction(async () => {
    await leads.updateLeadDetails(ctx, leadId, {
      ...(v.name !== undefined && { name: v.name }),
      ...(v.mobile !== undefined && { mobile: v.mobile }),
      ...(v.email !== undefined && { email: v.email || null }),
      ...(v.source_id !== undefined && { source_id: v.source_id || null }),
      ...(v.age !== undefined && { age: v.age === "" ? null : Number(v.age) }),
      ...(v.dob !== undefined && { dob: v.dob || null }),
      ...(v.notes !== undefined && { notes: v.notes || null }),
    });
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/leads");
  });
}

/** Single entry point for every pipeline move. */
export async function transitionLeadAction(
  leadId: string,
  to: LeadStatus,
  formData: FormData
): Promise<ActionResult> {
  const ctx = await getAuthContext();

  const schema = transitionPayloadSchemas[to as keyof typeof transitionPayloadSchemas];
  if (!schema) return { ok: false, error: `Unknown transition target: ${to}` };

  const raw = Object.fromEntries(formData);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const payload: Record<string, unknown> = { ...parsed.data };
  // datetime-local inputs are clinic wall time — convert to UTC ISO
  if (typeof payload.scheduled_at === "string" && payload.scheduled_at) {
    payload.scheduled_at = clinicTimeToUtc(payload.scheduled_at);
  }
  if (typeof payload.due_at === "string" && payload.due_at) {
    payload.due_at = clinicTimeToUtc(payload.due_at);
  }
  // strip empty-string optionals
  for (const k of Object.keys(payload)) {
    if (payload[k] === "" || payload[k] === undefined) delete payload[k];
  }
  // pass cancelled appointment through for appointment_booked -> assigned
  if (to === "assigned" && raw.cancelled_appointment_id) {
    payload.cancelled_appointment_id = raw.cancelled_appointment_id;
  }

  return runAction(async () => {
    await leads.transitionLead(ctx, leadId, to, payload);
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/leads");
    revalidatePath("/dashboard");
    revalidatePath("/appointments");
    revalidatePath("/follow-ups");
  });
}

export async function checkDuplicateMobile(mobile: string) {
  const ctx = await getAuthContext();
  if (mobile.length < 7) return [];
  const matches = await leads.findLeadsByMobile(ctx, mobile);
  return matches.map((m) => ({ id: m.id, name: m.name, status: m.status }));
}

// ---------- Comments ----------

const commentSchema = z.object({
  lead_id: z.string().uuid(),
  body: z.string().min(1, "Comment cannot be empty").max(4000),
  entity_type: z.enum(["lead", "appointment", "treatment", "follow_up", "invoice"]).default("lead"),
  entity_id: z.string().uuid().optional().or(z.literal("")),
});

export async function addCommentAction(formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsed = commentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid comment" };
  }
  const v = parsed.data;
  return runAction(async () => {
    await comments.addComment(ctx, {
      lead_id: v.lead_id,
      body: v.body,
      entity_type: v.entity_type as CommentEntity,
      entity_id: v.entity_id || null,
    });
    revalidatePath(`/leads/${v.lead_id}`);
  });
}

export async function deleteCommentAction(commentId: string, leadId: string): Promise<ActionResult> {
  const ctx = await getAuthContext();
  return runAction(async () => {
    await comments.deleteComment(ctx, commentId);
    revalidatePath(`/leads/${leadId}`);
  });
}

export async function createLeadAndRedirect(formData: FormData) {
  const result = await createLeadAction(formData);
  if (result.ok && result.id) {
    redirect(`/leads/${result.id}`);
  }
  return result;
}
