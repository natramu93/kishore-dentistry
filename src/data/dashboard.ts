import "server-only";

import { db } from "./db";
import type { AuthContext } from "@/lib/auth/context";
import type { LeadStatus } from "@/lib/database.types";
import { clinicDayRange, clinicToday } from "@/lib/tz";
import { requireAnyRole } from "@/lib/auth/guards";
import { AuthorizationError } from "@/lib/errors";
import { EMPTY_UUID, normalizeLimit } from "@/lib/validation";

function branchScope(ctx: AuthContext): string[] | null {
  if (ctx.role === "admin") return null;
  return ctx.branchIds.length ? [...ctx.branchIds] : [EMPTY_UUID];
}

export type DashboardData = {
  statusCounts: Record<string, number>;
  branchCounts: { branch: string; count: number }[];
  sourceCounts: { source: string; count: number }[];
  interestCounts: { interest: string; count: number }[];
  todaysAppointments: number;
  dueFollowUps: number;
  totalLeads: number;
};

export async function getDashboardData(
  ctx: AuthContext
): Promise<DashboardData> {
  requireAnyRole(
    ctx,
    ["admin", "operations", "front_office", "clinical_head"],
    "Business dashboard access required"
  );
  const { start, end } = clinicDayRange(clinicToday());

  const result = await db.rpc("get_business_dashboard", {
    p_actor: ctx.userId,
    p_day_start: start,
    p_day_end: end,
  });
  if (result.error) throw result.error;

  const rows = result.data ?? [];
  const statusCounts: Record<string, number> = Object.fromEntries(
    rows
      .filter((row) => row.metric === "status")
      .map((row) => [row.row_key, Number(row.value)])
  );
  const summary = new Map(
    rows
      .filter((row) => row.metric === "summary")
      .map((row) => [row.row_key, Number(row.value)])
  );
  const summaryValue = (key: string): number => {
    const value = summary.get(key);
    if (value === undefined) {
      throw new Error(`Business dashboard response omitted ${key}`);
    }
    return value;
  };

  return {
    statusCounts,
    branchCounts: rows
      .filter((row) => row.metric === "branch")
      .map((row) => ({
        branch: row.row_label,
        count: Number(row.value),
      })),
    sourceCounts: rows
      .filter((row) => row.metric === "source")
      .map((row) => ({
        source: row.row_label,
        count: Number(row.value),
      })),
    interestCounts: rows
      .filter((row) => row.metric === "interest")
      .map((row) => ({
        interest: row.row_label,
        count: Number(row.value),
      })),
    todaysAppointments: summaryValue("todays_appointments"),
    dueFollowUps: summaryValue("due_follow_ups"),
    totalLeads: summaryValue("total_leads"),
  };
}

export async function getRecentActivity(ctx: AuthContext, limit = 15) {
  if (ctx.role === "doctor") return [];
  const safeLimit = normalizeLimit(limit, 15, 50);
  const scope = branchScope(ctx);
  let query = db
    .from("lead_activity")
    .select(
      "*, lead:leads!inner(id, name, assignee_id), actor:profiles!lead_activity_actor_id_fkey(full_name)"
    )
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  if (scope) query = query.in("branch_id", scope);
  if (ctx.role === "front_office") {
    query = query.or(
      `assignee_id.eq.${ctx.userId},assignee_id.is.null`,
      { referencedTable: "lead" }
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return data.map((activity) => ({
    ...activity,
    lead: activity.lead
      ? { id: activity.lead.id, name: activity.lead.name }
      : null,
  }));
}

export type StatusCount = { status: LeadStatus; count: number };

export type DoctorDashboardData = {
  todaysAppointments: number;
  weekAppointments: number;
  patientsTreated: number;
  revenueGenerated: number;
};

/** Summary for the doctor role, derived from their linked doctor record. */
export async function getDoctorDashboardData(
  ctx: AuthContext
): Promise<DoctorDashboardData> {
  if (ctx.role !== "doctor") {
    throw new AuthorizationError("Doctor dashboard access required");
  }
  if (!ctx.doctorId) {
    return {
      todaysAppointments: 0,
      weekAppointments: 0,
      patientsTreated: 0,
      revenueGenerated: 0,
    };
  }

  const { start, end } = clinicDayRange(clinicToday());
  const result = await db.rpc("get_doctor_dashboard", {
    p_actor: ctx.userId,
    p_day_start: start,
    p_day_end: end,
  });
  if (result.error) throw result.error;

  const row = result.data?.[0];
  if (!row) {
    throw new Error("Doctor dashboard response was empty");
  }

  return {
    todaysAppointments: Number(row.todays_appointments),
    weekAppointments: Number(row.week_appointments),
    patientsTreated: Number(row.patients_treated),
    revenueGenerated: Number(row.revenue_generated),
  };
}
