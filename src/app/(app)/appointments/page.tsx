import Link from "next/link";
import { addDays } from "date-fns";
import { getAuthContext } from "@/lib/auth/context";
import { listAppointments } from "@/data/appointments";
import { listMyBranches } from "@/data/branches";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LeadStatusBadge } from "@/components/lead-status-badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { clinicDayRange, clinicToday, fmt, fmtTime } from "@/lib/tz";
import type { LeadStatus } from "@/lib/database.types";

export const metadata = { title: "Appointments — Kishore Dentistry CRM" };

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const ctx = await getAuthContext();

  const view = params.view === "week" ? "week" : params.view === "all" ? "all" : "today";
  const today = clinicToday();
  const { start, end } = clinicDayRange(today);
  const range: { from?: string; to?: string } =
    view === "today"
      ? { from: start, to: end }
      : view === "week"
        ? { from: start, to: addDays(new Date(start), 7).toISOString() }
        : {};

  const [appointments, branches] = await Promise.all([
    listAppointments(ctx, {
      ...range,
      branchId: params.branch || undefined,
    }),
    listMyBranches(ctx),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Appointments</h1>
          <p className="text-sm text-muted-foreground">
            {view === "today" ? "Today" : view === "week" ? "Next 7 days" : "All"} ·{" "}
            {appointments.length} appointment{appointments.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex gap-2">
          {(["today", "week", "all"] as const).map((v) => (
            <Button key={v} asChild size="sm" variant={view === v ? "default" : "outline"}>
              <Link href={`/appointments?view=${v}${params.branch ? `&branch=${params.branch}` : ""}`}>
                {v === "today" ? "Today" : v === "week" ? "This week" : "All"}
              </Link>
            </Button>
          ))}
        </div>
      </div>

      {branches.length > 1 && (
        <form className="flex gap-2" action="/appointments" method="get">
          <input type="hidden" name="view" value={view} />
          <select
            name="branch"
            defaultValue={params.branch ?? ""}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <Button type="submit" variant="secondary" size="sm">Filter</Button>
        </form>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Patient / Lead</TableHead>
            <TableHead>Branch</TableHead>
            <TableHead>Doctor</TableHead>
            <TableHead>Appointment</TableHead>
            <TableHead>Lead status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {appointments.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                No appointments in this view
              </TableCell>
            </TableRow>
          )}
          {appointments.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="font-medium whitespace-nowrap">
                {view === "today" ? fmtTime(a.scheduled_at) : fmt(a.scheduled_at)}
              </TableCell>
              <TableCell>
                {a.lead ? (
                  <Link href={`/leads/${a.lead.id}`} className="font-medium hover:underline">
                    {a.lead.name}
                  </Link>
                ) : "—"}
                <div className="text-xs text-muted-foreground">{a.lead?.mobile}</div>
              </TableCell>
              <TableCell>{a.branch?.name ?? "—"}</TableCell>
              <TableCell className="text-muted-foreground">
                {a.doctor?.full_name ?? "TBD"}
              </TableCell>
              <TableCell>
                <Badge
                  variant={a.status === "scheduled" ? "default" : "secondary"}
                  className="capitalize"
                >
                  {a.status.replaceAll("_", " ")}
                </Badge>
              </TableCell>
              <TableCell>
                {a.lead && <LeadStatusBadge status={a.lead.status as LeadStatus} />}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
