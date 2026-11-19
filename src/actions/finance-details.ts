"use server";

import { z } from "zod";
import { getFinanceDetails } from "@/data/finance";
import { getAuthContext } from "@/lib/auth/context";
import { requireAnyRole, requireReportAccess } from "@/lib/auth/guards";
import { financeFilterSchema, financeMetrics } from "@/lib/finance-activity";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { ValidationError } from "@/lib/errors";
import { runActionWithValue } from "@/actions/util";

export async function financeDetailsAction(input: unknown) {
  const ctx = await getAuthContext();
  return runActionWithValue(async () => {
    requireAnyRole(ctx, ["admin", "operations", "clinical_head", "front_office"]);
    const parsed = z.object({
      filters: financeFilterSchema, source: z.enum(["invoices", "reports"]),
      metric: z.enum(financeMetrics), page: z.number().int().min(1).max(100000),
    }).safeParse(input);
    if (!parsed.success) throw new ValidationError("Choose valid finance detail filters");
    const { filters, source, metric, page } = parsed.data;
    if (source === "reports") requireReportAccess(ctx);
    await assertActionRateLimit(ctx.userId, "finance-details", { limit: 90, windowMs: 60000 });
    return { details: await getFinanceDetails(ctx, { filters, source, metric, page }) };
  });
}
