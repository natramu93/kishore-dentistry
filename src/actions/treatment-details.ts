"use server";

import { getAuthContext } from "@/lib/auth/context";
import { getTreatmentDetails } from "@/data/treatment-progress";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { runActionWithValue } from "./util";

export async function loadTreatmentDetailsAction(leadId: string, treatmentId: string) {
  const ctx = await getAuthContext();
  return runActionWithValue(async () => {
    await assertActionRateLimit(ctx.userId, "treatment:details", { limit: 120, windowMs: 60_000 });
    return { details: await getTreatmentDetails(ctx, leadId, treatmentId) };
  });
}
