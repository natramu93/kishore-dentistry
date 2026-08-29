import "server-only";

import { db } from "./db";
import type { AuthContext } from "@/lib/auth/context";
import { assertBranchAccess } from "@/lib/auth/guards";
import type { BranchBusinessHour } from "@/lib/database.types";
import { assertUuid } from "@/lib/validation";

export async function getBranchBusinessHours(
  ctx: AuthContext,
  branchIdValue: string
): Promise<BranchBusinessHour[]> {
  const branchId = assertUuid(branchIdValue, "Branch");
  assertBranchAccess(ctx, branchId);

  const { data, error } = await db
    .from("branch_business_hours")
    .select("branch_id, iso_weekday, opens_at, closes_at")
    .eq("branch_id", branchId)
    .order("iso_weekday");
  if (error) throw error;
  return data;
}
