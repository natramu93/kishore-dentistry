import Link from "next/link";
import { getAuthContext } from "@/lib/auth/context";
import { getDashboardData, getRecentActivity, getDoctorDashboardData } from "@/data/dashboard";
import { canViewReports } from "@/lib/auth/guards";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LeadStatusBadge } from "@/components/lead-status-badge";
import { STATUS_LABELS, PIPELINE_ORDER } from "@/lib/leads/transitions";
import type { LeadStatus } from "@/lib/database.types";
import { fmt, formatINR } from "@/lib/tz";
import {
  CalendarDays, BellRing, Users, TrendingUp, Stethoscope, IndianRupee, BarChart3,
} from "lucide-react";

export const metadata = { title: "Dashboard — Dr. Kishor's Dentistry CRM" };

export default async function DashboardPage() {
  const ctx = await getAuthContext();

  if (ctx.role === "doctor") {
    const doc = await getDoctorDashboardData(ctx);
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Dashboard</h1>
          <p className="text-sm text-muted-foreground">Your schedule and clinical activity</p>
        </div>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <KpiCard icon={CalendarDays} label="Today's appointments" value={doc.todaysAppointments} href="/appointments" accent="violet" />
          <KpiCard icon={CalendarDays} label="This week" value={doc.weekAppointments} href="/appointments?view=week" accent="blue" />
          <KpiCard icon={Stethoscope} label="Patients treated" value={doc.patientsTreated} accent="emerald" />
          <KpiCard icon={IndianRupee} label="Revenue generated" value={formatINR(doc.revenueGenerated)} accent="gold" />
        </div>
        <Card className="border-l-4 border-l-violet-400">
          <CardContent className="pt-5">
            <Link href="/appointments" className="text-sm font-medium text-primary hover:underline">
              Go to My Schedule →
            </Link>
            <p className="text-sm text-muted-foreground mt-1">
              Mark appointments treated or no-show, and log your treatment notes there.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const [data, activity] = await Promise.all([
    getDashboardData(ctx),
    getRecentActivity(ctx),
  ]);

  const terminalStatuses: LeadStatus[] = ["missed", "dropped"];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {ctx.role === "admin"
              ? "All branches"
              : `Your ${ctx.branchIds.length} branch${ctx.branchIds.length === 1 ? "" : "es"}`}
          </p>
        </div>
        {canViewReports(ctx.role) && (
          <Link
            href="/reports"
            className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <BarChart3 className="h-4 w-4" />
            View detailed reports
          </Link>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Users} label="Total leads" value={data.totalLeads} href="/leads" accent="blue" />
        <KpiCard
          icon={CalendarDays}
          label="Today's appointments"
          value={data.todaysAppointments}
          href="/appointments"
          accent="violet"
        />
        <KpiCard
          icon={BellRing}
          label="Follow-ups due"
          value={data.dueFollowUps}
          href="/follow-ups"
          accent="amber"
        />
        <KpiCard
          icon={TrendingUp}
          label="Treated / Closed"
          value={(data.statusCounts["visited_treated"] ?? 0) + (data.statusCounts["closed"] ?? 0)}
          href="/leads?status=visited_treated"
          accent="emerald"
        />
      </div>

      {/* Pipeline funnel */}
      <Card className="border-l-4 border-l-blue-400">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Lead pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2.5 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            {PIPELINE_ORDER.map((status) => (
              <Link
                key={status}
                href={`/leads?status=${status}`}
                className="rounded-lg border p-2.5 hover:bg-accent transition-colors"
              >
                <div className="text-2xl font-bold">{data.statusCounts[status] ?? 0}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{STATUS_LABELS[status]}</div>
              </Link>
            ))}
          </div>
          <div className="flex gap-2.5 mt-2.5">
            {terminalStatuses.map((status) => (
              <Link
                key={status}
                href={`/leads?status=${status}`}
                className="flex items-center gap-2 rounded-lg border border-dashed px-2.5 py-1.5 text-sm hover:bg-accent"
              >
                <LeadStatusBadge status={status} />
                <span className="font-semibold">{data.statusCounts[status] ?? 0}</span>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Leads by branch */}
        <Card className="border-l-4 border-l-violet-400">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Leads by branch</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.branchCounts.length === 0 && (
              <p className="text-sm text-muted-foreground">No leads yet</p>
            )}
            {data.branchCounts.map((b) => (
              <BarRow key={b.branch} label={b.branch} count={b.count} max={data.branchCounts[0]?.count ?? 1} />
            ))}
          </CardContent>
        </Card>

        {/* Leads by source */}
        <Card className="border-l-4 border-l-amber-400">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Leads by source</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.sourceCounts.length === 0 && (
              <p className="text-sm text-muted-foreground">No leads yet</p>
            )}
            {data.sourceCounts.map((s) => (
              <BarRow key={s.source} label={s.source} count={s.count} max={data.sourceCounts[0]?.count ?? 1} />
            ))}
          </CardContent>
        </Card>

        {/* Top treatment interests */}
        <Card className="border-l-4 border-l-emerald-400">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top treatment interests</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.interestCounts.length === 0 && (
              <p className="text-sm text-muted-foreground">No treatment interest captured yet</p>
            )}
            {data.interestCounts.map((t) => (
              <BarRow
                key={t.interest}
                label={t.interest}
                count={t.count}
                max={data.interestCounts[0]?.count ?? 1}
              />
            ))}
          </CardContent>
        </Card>

        {/* Recent activity */}
        <Card className="border-l-4 border-l-gold lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            {activity.length === 0 && (
              <p className="text-sm text-muted-foreground">Nothing yet</p>
            )}
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {activity.slice(0, 9).map((a) => {
                const lead = a.lead as { id: string; name: string } | null;
                const actor = a.actor as { full_name: string } | null;
                return (
                  <li key={a.id} className="text-sm">
                    <Link href={`/leads/${a.lead_id}`} className="font-medium hover:underline">
                      {lead?.name ?? "Lead"}
                    </Link>{" "}
                    <span className="text-muted-foreground">
                      {a.type === "status_change" && a.to_status
                        ? `→ ${STATUS_LABELS[a.to_status]}`
                        : a.type.replaceAll("_", " ")}
                      {actor?.full_name ? ` · ${actor.full_name}` : ""}
                    </span>
                    <div className="text-xs text-muted-foreground">{fmt(a.created_at)}</div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const ACCENTS = {
  blue: "border-l-blue-400",
  violet: "border-l-violet-400",
  amber: "border-l-amber-400",
  emerald: "border-l-emerald-400",
  gold: "border-l-gold",
} as const;

function KpiCard({
  icon: Icon,
  label,
  value,
  href,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  href?: string;
  accent: keyof typeof ACCENTS;
}) {
  const content = (
    <Card className={`border-l-4 ${ACCENTS[accent]} ${href ? "hover:bg-accent/50 transition-colors" : ""}`}>
      <CardContent className="pt-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-3xl font-bold">{value}</p>
          </div>
          <Icon className="h-8 w-8 text-muted-foreground/40" />
        </div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

function BarRow({ label, count, max }: { label: string; count: number; max: number }) {
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="font-medium">{count}</span>
      </div>
      <div className="h-2 rounded-full bg-muted mt-1">
        <div
          className="h-2 rounded-full bg-primary"
          style={{ width: `${Math.max(4, (count / Math.max(max, 1)) * 100)}%` }}
        />
      </div>
    </div>
  );
}
