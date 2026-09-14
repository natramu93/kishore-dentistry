"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth/context";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { caseSheetPayloadSchema } from "@/lib/clinical";
import * as caseSheets from "@/data/case-sheets";
import { runActionWithValue, type ActionResult } from "./util";

export async function finalizeCaseSheetAction(
  input: unknown
): Promise<ActionResult & { id?: string }> {
  const ctx = await getAuthContext();
  const parsed = caseSheetPayloadSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Case-sheet details are invalid",
    };
  }

  return runActionWithValue(async () => {
    await assertActionRateLimit(ctx.userId, "case-sheet:finalize", {
      limit: 20,
      windowMs: 5 * 60_000,
    });
    const result = await caseSheets.finalizeCaseSheet(ctx, {
      ...parsed.data,
      // The browser value is display-only. The database trigger also replaces
      // this with its own clock value so direct RPC calls cannot backdate it.
      visit_at: new Date().toISOString(),
    });
    revalidatePath(`/leads/${result.lead_id}`);
    revalidatePath("/appointments");
    revalidatePath("/my-patients");
    revalidatePath("/dashboard");
    revalidatePath("/invoices");
    return { id: result.id };
  });
}
