import Link from "next/link";
import { addDays } from "date-fns";
import { getAuthContext } from "@/lib/auth/context";
import { listAppointments } from "@/data/appointments";
import { listMyBranches } from "@/data/branches";
import { listTreatmentTypes, listDoctors } from "@/data/catalogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LeadStatusBadge } from "@/components/lead-status-badge";
import { DoctorAppointmentActions } from "@/components/appointments/doctor-actions";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { clinicDayRange, clinicToday, fmt, fmtTime } from "@/lib/tz";
import type { AppointmentStatus, LeadStatus } from "@/lib/database.types";

const APPOINTMENT_STATUSES: AppointmentStatus[] = ["scheduled", "completed", "cancelled", "no_show"];

export const metadata = { title: "Appointments — Dr. Kishor's Dentistry CRM" };

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const ctx = await getAuthContext();
  const isDoctor = ctx.role === "doctor";

  const view = params.view === "week" ? "week" : params.view === "all" ? "all" : "today";
  const today = clinicToday();
  const { start, end } = clinicDayRange(today);
  const range: { from?: string; to?: string } =
    view === "today"
      ? { from: start, to: end }
      : view === "week"
        ? { from: start, to: addDays(new Date(start), 7).toISOString() }
        : {};

  const status = APPOINTMENT_STATUSES.includes(params.status as AppointmentStatus)
    ? (params.status as AppointmentStatus)
    : undefined;

  const [appointments, branches, treatmentTypes, doctors] = await Promise.all([
    listAppointments(ctx, {
      ...range,
      branchId: params.branch || undefined,
      doctorId: params.doctor || undefined,
      status,
    }),
    listMyBranches(ctx),
    isDoctor ? listTreatmentTypes(ctx) : Promise.resolve([]),
    isDoctor ? Promise.resolve([]) : listDoctors(ctx, { branchId: params.branch || undefined }),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {isDoctor ? "My Schedule" : "Appointments"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {view === "today" ? "Today" : view === "week" ? "Next 7 days" : "All"} ·{" "}
            {appointments.length} appointment{appointments.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex gap-2">
          {(["today", "week", "all"] as const).map((v) => {
            const sp = new URLSearchParams();
            sp.set("view", v);
            if (params.branch) sp.set("branch", params.branch);
            if (params.doctor) sp.set("doctor", params.doctor);
            if (params.status) sp.set("status", params.status);
            return (
              <Button key={v} asChild size="sm" variant={view === v ? "default" : "outline"}>
                <Link href={`/appointments?${sp.toString()}`}>
                  {v === "today" ? "Today" : v === "week" ? "This week" : "All"}
                </Link>
              </Button>
            );
          })}
        </div>
      </div>

      {!isDoctor && (
        <form className="flex flex-wrap items-end gap-2" action="/appointments" method="get">
          <input type="hidden" name="view" value={view} />
          {branches.length > 1 && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Center</label>
              <select
                name="branch"
                defaultValue={params.branch ?? ""}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm block min-w-40"
              >
                <option value="">All centers</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Doctor</label>
            <select
              name="doctor"
              defaultValue={params.doctor ?? ""}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm block min-w-44"
            >
              <option value="">All doctors</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>{d.full_name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Status</label>
            <select
              name="status"
              defaultValue={params.status ?? ""}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm block"
            >
              <option value="">Any status</option>
              {APPOINTMENT_STATUSES.map((s) => (
                <option key={s} value={s} className="capitalize">{s.replaceAll("_", " ")}</option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="secondary" size="sm">Filter</Button>
          <Button asChild variant="ghost" size="sm">
            <Link href={`/appointments?view=${view}`}>Reset</Link>
          </Button>
        </form>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Patient / Lead</TableHead>
            {!isDoctor && <TableHead>Branch</TableHead>}
            {!isDoctor && <TableHead>Doctor</TableHead>}
            <TableHead>Appointment</TableHead>
            <TableHead>Lead status</TableHead>
            {isDoctor && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {appointments.length === 0 && (
            <TableRow>
              <TableCell colSpan={isDoctor ? 5 : 6} className="text-center text-muted-foreground py-8">
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
              {!isDoctor && <TableCell>{a.branch?.name ?? "—"}</TableCell>}
              {!isDoctor && (
                <TableCell className="text-muted-foreground">
                  {a.doctor?.full_name ?? "TBD"}
                </TableCell>
              )}
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
              {isDoctor && (
                <TableCell className="text-right">
                  {a.status === "scheduled" && (
                    <DoctorAppointmentActions appointmentId={a.id} treatmentTypes={treatmentTypes} />
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
