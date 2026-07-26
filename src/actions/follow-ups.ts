"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import * as followUps from "@/data/follow-ups";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { uuidSchema } from "@/lib/validation";
import { runAction, type ActionResult } from "./util";

export async function completeFollowUpAction(
  id: string,
  status: "done" | "cancelled",
  outcomeNotes?: string
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsed = z
    .object({
      id: uuidSchema,
      status: z.enum(["done", "cancelled"]),
      outcomeNotes: z.string().trim().max(4_000).optional(),
    })
    .safeParse({ id, status, outcomeNotes });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid follow-up" };
  }
  return runAction(async () => {
    await assertActionRateLimit(ctx.userId, "follow-up:complete", {
      limit: 40,
      windowMs: 5 * 60_000,
    });
    const completed = await followUps.completeFollowUp(ctx, parsed.data.id, {
      status: parsed.data.status,
      outcome_notes: parsed.data.outcomeNotes,
    });
    revalidatePath(`/leads/${completed.lead_id}`);
    revalidatePath("/follow-ups");
    revalidatePath("/dashboard");
  });
}
