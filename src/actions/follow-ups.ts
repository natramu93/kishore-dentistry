"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth/context";
import * as followUps from "@/data/follow-ups";
import { runAction, type ActionResult } from "./util";

export async function completeFollowUpAction(
  id: string,
  status: "done" | "cancelled",
  outcomeNotes?: string
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  return runAction(async () => {
    await followUps.completeFollowUp(ctx, id, { status, outcome_notes: outcomeNotes });
    revalidatePath("/follow-ups");
    revalidatePath("/dashboard");
  });
}
