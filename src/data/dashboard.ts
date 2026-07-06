import "server-only";

import { db } from "./db";
import type { AuthContext } from "@/lib/auth/context";
import type { LeadStatus } from "@/lib/database.types";
import { clinicDayRange, clinicToday } from "@/lib/tz";

const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

function branchScope(ctx: AuthContext): string[] | null {
  if (ctx.role === "admin") return null;
  return ctx.branchIds.length ? ctx.branchIds : [EMPTY_UUID];
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

export async function getDashboardData(ctx: AuthContext): Promise<DashboardData> {
  const scope = branchScope(ctx);
  const today = clinicToday();
  const { start, end } = clinicDayRange(today);

  let leadsQ = db.from("leads").select("status, branch_id, source_id, interest_id");
  if (scope) leadsQ = leadsQ.in("branch_id", scope);
  if (ctx.role === "agent") {
    leadsQ = leadsQ.or(`assignee_id.eq.${ctx.userId},assignee_id.is.null`);
  }

  let apptQ = db
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .gte("scheduled_at", start)
    .lt("scheduled_at", end)
    .eq("status", "scheduled");
  if (scope) apptQ = apptQ.in("branch_id", scope);

  let fuQ = db
    .from("follow_ups")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .lt("due_at", end);
  if (scope) fuQ = fuQ.in("branch_id", scope);

  const [leadsRes, apptRes, fuRes, branchesRes, sourcesRes, treatmentsRes] = await Promise.all([
    leadsQ,
    apptQ,
    fuQ,
    db.from("branches").select("id, name"),
    db.from("lead_sources").select("id, name"),
    db.from("treatment_types").select("id, name"),
  ]);

  const leads = leadsRes.data ?? [];
  const branchNames = new Map((branchesRes.data ?? []).map((b) => [b.id, b.name]));
  const sourceNames = new Map((sourcesRes.data ?? []).map((s) => [s.id, s.name]));
  const treatmentNames = new Map((treatmentsRes.data ?? []).map((t) => [t.id, t.name]));

  const statusCounts: Record<string, number> = {};
  const byBranch = new Map<string, number>();
  const bySource = new Map<string, number>();
  const byInterest = new Map<string, number>();
  for (const l of leads) {
    statusCounts[l.status] = (statusCounts[l.status] ?? 0) + 1;
    byBranch.set(l.branch_id, (byBranch.get(l.branch_id) ?? 0) + 1);
    const src = l.source_id ?? "unknown";
    bySource.set(src, (bySource.get(src) ?? 0) + 1);
    if (l.interest_id) byInterest.set(l.interest_id, (byInterest.get(l.interest_id) ?? 0) + 1);
  }

  return {
    statusCounts,
    branchCounts: [...byBranch.entries()]
      .map(([id, count]) => ({ branch: branchNames.get(id) ?? "—", count }))
      .sort((a, b) => b.count - a.count),
    sourceCounts: [...bySource.entries()]
      .map(([id, count]) => ({ source: sourceNames.get(id) ?? "Unknown", count }))
      .sort((a, b) => b.count - a.count),
    interestCounts: [...byInterest.entries()]
      .map(([id, count]) => ({ interest: treatmentNames.get(id) ?? "Unknown", count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
    todaysAppointments: apptRes.count ?? 0,
    dueFollowUps: fuRes.count ?? 0,
    totalLeads: leads.length,
  };
}

export async function getRecentActivity(ctx: AuthContext, limit = 15) {
  const scope = branchScope(ctx);
  let q = db
    .from("lead_activity")
    .select("*, lead:leads(id, name), actor:profiles!lead_activity_actor_id_fkey(full_name)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (scope) q = q.in("branch_id", scope);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export type StatusCount = { status: LeadStatus; count: number };
