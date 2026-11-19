import "server-only";

import { db } from "./db";
import { throwMappedDatabaseError } from "./helpers";
import type { AuthContext } from "@/lib/auth/context";
import { requireAnyRole, requireReportAccess } from "@/lib/auth/guards";
import { financeFilterSchema, financialDetailSchema, type FinanceFilters, type FinanceMetric } from "@/lib/finance-activity";
import type { Json } from "@/lib/database.types";

export async function getFinanceDetails(ctx: AuthContext, input: {
  filters: FinanceFilters; source: "invoices" | "reports"; metric: FinanceMetric; page: number;
}) {
  requireAnyRole(ctx, ["admin", "operations", "clinical_head", "front_office"]);
  if (input.source === "reports") requireReportAccess(ctx);
  const filters = financeFilterSchema.parse(input.filters);
  const result = await db.rpc("get_finance_details", {
    p_actor: ctx.userId, p_filters: filters as Json, p_source: input.source,
    p_metric: input.metric, p_page: input.page, p_page_size: 100,
  });
  if (result.error) throwMappedDatabaseError(result.error, "Finance details");
  return financialDetailSchema.parse(result.data);
}
