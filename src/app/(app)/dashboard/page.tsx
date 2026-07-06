import Link from "next/link";
import { getAuthContext } from "@/lib/auth/context";
import { getDashboardData, getRecentActivity } from "@/data/dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LeadStatusBadge } from "@/components/lead-status-badge";
import { STATUS_LABELS, PIPELINE_ORDER } from "@/lib/leads/transitions";
import type { LeadStatus } from "@/lib/database.types";
import { fmt } from "@/lib/tz";
import { CalendarDays, BellRing, Users, TrendingUp } from "lucide-react";

export const metadata = { title: "Dashboard — Kishore Dentistry CRM" };

export default async function DashboardPage() {
  const ctx = await getAuthContext();
  const [data, activity] = await Promise.all([
    getDashboardData(ctx),
    getRecentActivity(ctx),
  ]);

  const terminalStatuses: LeadStatus[] = ["missed", "dropped"];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {ctx.role === "admin"
            ? "All branches"
            : `Your ${ctx.branchIds.length} branch${ctx.branchIds.length === 1 ? "" : "es"}`}
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Users} label="Total leads" value={data.totalLeads} href="/leads" />
        <KpiCard
          icon={CalendarDays}
          label="Today's appointments"
          value={data.todaysAppointments}
          href="/appointments"
        />
        <KpiCard
          icon={BellRing}
          label="Follow-ups due"
          value={data.dueFollowUps}
          href="/follow-ups"
        />
        <KpiCard
          icon={TrendingUp}
          label="Treated / Closed"
          value={(data.statusCounts["visited_treated"] ?? 0) + (data.statusCounts["closed"] ?? 0)}
          href="/leads?status=visited_treated"
        />
      </div>

      {/* Pipeline funnel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lead pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            {PIPELINE_ORDER.map((status) => (
              <Link
                key={status}
                href={`/leads?status=${status}`}
                className="rounded-lg border p-3 hover:bg-accent transition-colors"
              >
                <div className="text-2xl font-bold">{data.statusCounts[status] ?? 0}</div>
                <div className="text-xs text-muted-foreground mt-1">{STATUS_LABELS[status]}</div>
              </Link>
            ))}
          </div>
          <div className="flex gap-3 mt-3">
            {terminalStatuses.map((status) => (
              <Link
                key={status}
                href={`/leads?status=${status}`}
                className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm hover:bg-accent"
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
        <Card>
          <CardHeader>
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
        <Card>
          <CardHeader>
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
        <Card>
          <CardHeader>
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
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            {activity.length === 0 && (
              <p className="text-sm text-muted-foreground">Nothing yet</p>
            )}
            <ul className="space-y-3">
              {activity.slice(0, 8).map((a) => {
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

function KpiCard({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  href: string;
}) {
  return (
    <Link href={href}>
      <Card className="hover:bg-accent/50 transition-colors">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="text-3xl font-bold">{value}</p>
            </div>
            <Icon className="h-8 w-8 text-muted-foreground/40" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
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
