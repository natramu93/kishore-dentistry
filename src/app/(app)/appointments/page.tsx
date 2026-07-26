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
import { AppointmentDatePicker } from "@/components/appointments/date-picker";
import { PaginationNav } from "@/components/pagination-nav";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { clinicDayRange, clinicToday, fmt, fmtDate, fmtTime } from "@/lib/tz";
import type { AppointmentStatus, LeadStatus } from "@/lib/database.types";

const APPOINTMENT_STATUSES: AppointmentStatus[] = ["scheduled", "completed", "cancelled", "no_show"];

export const metadata = { title: "Appointments — Dr. Kishor's Dentistry CRM" };

function isValidDateParam(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const ctx = await getAuthContext();
  const isDoctor = ctx.role === "doctor";

  const hasValidDate = isValidDateParam(params.date);
  const view =
    params.view === "week"
      ? "week"
      : params.view === "all"
        ? "all"
        : params.view === "date" && hasValidDate
          ? "date"
          : "today";
  const today = clinicToday();
  const selectedDate = view === "date" ? params.date! : today;
  const { start, end } = clinicDayRange(selectedDate);
  const range: { from?: string; to?: string } =
    view === "today"
      ? { from: start, to: end }
      : view === "week"
        ? { from: start, to: addDays(new Date(start), 7).toISOString() }
        : view === "date"
          ? { from: start, to: end }
        : {};

  const status = APPOINTMENT_STATUSES.includes(params.status as AppointmentStatus)
    ? (params.status as AppointmentStatus)
    : undefined;

  const [appointmentResult, branches, treatmentTypes, doctors] = await Promise.all([
    listAppointments(ctx, {
      ...range,
      branchId: params.branch || undefined,
      doctorId: params.doctor || undefined,
      status,
      page: Number(params.page),
    }),
    listMyBranches(ctx),
    isDoctor ? listTreatmentTypes(ctx) : Promise.resolve([]),
    isDoctor ? Promise.resolve([]) : listDoctors(ctx, { branchId: params.branch || undefined }),
  ]);
  const { appointments, total, page, pageSize } = appointmentResult;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {isDoctor ? "My Schedule" : "Appointments"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {view === "today"
              ? "Today"
              : view === "week"
                ? "Next 7 days"
                : view === "date"
                  ? fmtDate(selectedDate)
                  : "All"}{" "}
            ·{" "}
            {total} appointment{total === 1 ? "" : "s"}
          </p>
        </div>
        <div role="group" aria-label="Appointment date range" className="flex flex-wrap gap-2">
          {(["today", "week", "all"] as const).map((v) => {
            const sp = new URLSearchParams();
            sp.set("view", v);
            if (params.branch) sp.set("branch", params.branch);
            if (params.doctor) sp.set("doctor", params.doctor);
            if (params.status) sp.set("status", params.status);
            return (
              <Button key={v} asChild size="sm" variant={view === v ? "default" : "outline"}>
                <Link
                  href={`/appointments?${sp.toString()}`}
                  aria-current={view === v ? "page" : undefined}
                >
                  {v === "today" ? "Today" : v === "week" ? "Next 7 days" : "All"}
                </Link>
              </Button>
            );
          })}
          <AppointmentDatePicker
            selectedDate={view === "date" ? selectedDate : undefined}
            filters={{
              branch: params.branch,
              doctor: params.doctor,
              status: params.status,
            }}
          />
        </div>
      </div>

      {!isDoctor && (
        <form className="flex flex-wrap items-end gap-2" action="/appointments" method="get">
          <input type="hidden" name="view" value={view} />
          {view === "date" && <input type="hidden" name="date" value={selectedDate} />}
          {branches.length > 1 && (
            <div className="space-y-1">
              <label htmlFor="appointment-branch" className="text-xs text-muted-foreground">Center</label>
              <select
                id="appointment-branch"
                name="branch"
                defaultValue={params.branch ?? ""}
                className="block h-11 min-w-40 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">All centers</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1">
            <label htmlFor="appointment-doctor" className="text-xs text-muted-foreground">Doctor</label>
            <select
              id="appointment-doctor"
              name="doctor"
              defaultValue={params.doctor ?? ""}
              className="block h-11 min-w-44 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">All doctors</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>{d.full_name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="appointment-status" className="text-xs text-muted-foreground">Status</label>
            <select
              id="appointment-status"
              name="status"
              defaultValue={params.status ?? ""}
              className="block h-11 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">Any status</option>
              {APPOINTMENT_STATUSES.map((s) => (
                <option key={s} value={s} className="capitalize">{s.replaceAll("_", " ")}</option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="secondary" size="sm">Filter</Button>
          <Button asChild variant="ghost" size="sm">
            <Link
              href={`/appointments?view=${view}${
                view === "date" ? `&date=${encodeURIComponent(selectedDate)}` : ""
              }`}
            >
              Reset
            </Link>
          </Button>
        </form>
      )}

      <Table aria-label={isDoctor ? "My appointments" : "Appointments"}>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Patient / Lead</TableHead>
            {!isDoctor && <TableHead className="hidden md:table-cell">Center</TableHead>}
            {!isDoctor && <TableHead className="hidden md:table-cell">Doctor</TableHead>}
            <TableHead className="hidden lg:table-cell">Appointment</TableHead>
            <TableHead className="hidden lg:table-cell">Lead status</TableHead>
            {isDoctor && <TableHead><span className="sr-only">Actions</span></TableHead>}
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
                {view === "today" || view === "date"
                  ? fmtTime(a.scheduled_at)
                  : fmt(a.scheduled_at)}
              </TableCell>
              <TableCell className="whitespace-normal">
                {a.lead ? (
                  isDoctor ? (
                    <span className="font-medium">{a.lead.name}</span>
                  ) : (
                    <Link href={`/leads/${a.lead.id}`} className="font-medium hover:underline">
                      {a.lead.name}
                    </Link>
                  )
                ) : "—"}
                {a.lead?.mobile && (
                  <a
                    href={`tel:${a.lead.mobile}`}
                    className="block text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    {a.lead.mobile}
                  </a>
                )}
                {!isDoctor && (
                  <div className="mt-1 text-xs text-muted-foreground md:hidden">
                    {a.branch?.name ?? "No center"} · {a.doctor?.full_name ?? "Doctor TBD"}
                  </div>
                )}
                <Badge
                  variant={a.status === "scheduled" ? "default" : "secondary"}
                  className="mt-1 capitalize lg:hidden"
                >
                  Appointment: {a.status.replaceAll("_", " ")}
                </Badge>
              </TableCell>
              {!isDoctor && <TableCell className="hidden md:table-cell">{a.branch?.name ?? "—"}</TableCell>}
              {!isDoctor && (
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {a.doctor?.full_name ?? "TBD"}
                </TableCell>
              )}
              <TableCell className="hidden lg:table-cell">
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
      <PaginationNav
        pathname="/appointments"
        searchParams={params}
        page={page}
        pageSize={pageSize}
        total={total}
      />
    </div>
  );
}
