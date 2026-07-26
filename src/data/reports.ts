import "server-only";

import { db } from "./db";
import type { AuthContext } from "@/lib/auth/context";
import { assertBranchAccess, requireReportAccess } from "@/lib/auth/guards";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  EMPTY_UUID,
  MAX_LIST_ROWS,
  MAX_REPORT_ROWS,
  assertUuid,
  validateIsoRange,
} from "@/lib/validation";
import { clinicDayRange, clinicToday } from "@/lib/tz";
import { z } from "zod";

export const DEFAULT_REPORT_DAYS = 30;

export type ReportRow = {
  key: string;
  label: string;
  leads: number;
  appointments: number;
  followUps: number;
  revenue: number;
};

export type ReportFilters = {
  from?: string;
  to?: string;
  branchId?: string;
  doctorId?: string;
};

export type ReportsData = {
  byDoctor: ReportRow[];
  byCenter: ReportRow[];
  byDay: ReportRow[];
  byTreatment: ReportRow[];
  totals: {
    leads: number;
    appointments: number;
    followUps: number;
    revenue: number;
  };
  range: { from: string; to: string };
};

const reportRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  leads: z.number().nonnegative(),
  appointments: z.number().nonnegative(),
  followUps: z.number().nonnegative(),
  revenue: z.number().nonnegative(),
});

const reportPayloadSchema = z.object({
  by_doctor: z.array(reportRowSchema).max(MAX_REPORT_ROWS),
  by_center: z.array(reportRowSchema).max(MAX_REPORT_ROWS),
  by_day: z.array(reportRowSchema).max(MAX_REPORT_ROWS),
  by_treatment: z.array(reportRowSchema).max(MAX_REPORT_ROWS),
  totals: z.object({
    leads: z.number().nonnegative(),
    appointments: z.number().nonnegative(),
    followUps: z.number().nonnegative(),
    revenue: z.number().nonnegative(),
  }),
});

function branchScope(ctx: AuthContext): string[] | null {
  if (ctx.role === "admin") return null;
  return ctx.branchIds.length ? [...ctx.branchIds] : [EMPTY_UUID];
}

export function defaultReportRange(
  days = DEFAULT_REPORT_DAYS
): { from: string; to: string } {
  const safeDays =
    Number.isSafeInteger(days) && days >= 1 && days <= 366
      ? days
      : DEFAULT_REPORT_DAYS;
  const today = clinicDayRange(clinicToday());
  return {
    from: new Date(
      Date.parse(today.start) - (safeDays - 1) * 24 * 60 * 60 * 1_000
    ).toISOString(),
    to: today.end,
  };
}

/**
 * Revenue is the sum of treatment cost recorded at the point of care. The
 * database RPC performs all aggregation and independently derives the actor's
 * branch scope, so the application receives only grouped, patient-safe DTOs.
 *
 * All breakdowns and totals use the same half-open UTC interval and optional
 * branch/doctor filters. Day grouping is pinned to the clinic's
 * Asia/Kolkata calendar in the RPC.
 */
export async function getReportsData(
  ctx: AuthContext,
  filters: ReportFilters = {}
): Promise<ReportsData> {
  requireReportAccess(ctx);
  const { from, to } = validateIsoRange(
    filters.from,
    filters.to,
    defaultReportRange()
  );

  const branchId = filters.branchId
    ? assertUuid(filters.branchId, "Branch")
    : undefined;
  if (branchId) assertBranchAccess(ctx, branchId);

  const doctorId = filters.doctorId
    ? assertUuid(filters.doctorId, "Doctor")
    : undefined;
  if (doctorId) {
    const doctorResult = await db
      .from("doctors")
      .select("branch_id")
      .eq("id", doctorId)
      .eq("is_active", true)
      .maybeSingle();
    if (doctorResult.error) throw doctorResult.error;
    if (!doctorResult.data) throw new NotFoundError("Doctor");
    assertBranchAccess(ctx, doctorResult.data.branch_id);
    if (branchId && doctorResult.data.branch_id !== branchId) {
      throw new ValidationError(
        "Doctor does not belong to the selected branch"
      );
    }
  }

  const result = await db.rpc("get_report_aggregates", {
    p_actor: ctx.userId,
    p_from: from,
    p_to: to,
    p_branch_id: branchId ?? null,
    p_doctor_id: doctorId ?? null,
  });
  if (result.error) throw result.error;

  const parsed = reportPayloadSchema.safeParse(result.data?.[0]);
  if (!parsed.success) {
    throw new Error("Report aggregate response was invalid");
  }
  const payload = parsed.data;

  return {
    byDoctor: payload.by_doctor,
    byCenter: payload.by_center,
    byDay: payload.by_day,
    byTreatment: payload.by_treatment,
    totals: payload.totals,
    range: { from, to },
  };
}

/** Doctors and centers for report filters, scoped to the user's access. */
export async function getReportFilterOptions(ctx: AuthContext) {
  requireReportAccess(ctx);
  const scope = branchScope(ctx);

  let doctorsQuery = db
    .from("doctors")
    .select("id, full_name, branch_id")
    .eq("is_active", true)
    .order("full_name")
    .limit(MAX_LIST_ROWS + 1);
  if (scope) doctorsQuery = doctorsQuery.in("branch_id", scope);

  let branchesQuery = db
    .from("branches")
    .select("id, name")
    .eq("is_active", true)
    .order("name")
    .limit(MAX_LIST_ROWS + 1);
  if (scope) branchesQuery = branchesQuery.in("id", scope);

  const [doctorsResult, branchesResult] = await Promise.all([
    doctorsQuery,
    branchesQuery,
  ]);
  if (doctorsResult.error) throw doctorsResult.error;
  if (branchesResult.error) throw branchesResult.error;
  if (doctorsResult.data.length > MAX_LIST_ROWS) {
    throw new ValidationError("Too many doctors to display in report filters");
  }
  if (branchesResult.data.length > MAX_LIST_ROWS) {
    throw new ValidationError("Too many branches to display in report filters");
  }

  return {
    doctors: doctorsResult.data,
    branches: branchesResult.data,
  };
}
