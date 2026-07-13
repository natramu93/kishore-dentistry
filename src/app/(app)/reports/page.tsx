import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { canViewReports } from "@/lib/auth/guards";
import {
  getReportsData, getReportFilterOptions, defaultReportRange, type ReportRow,
} from "@/data/reports";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { clinicDayRange, clinicToday, formatINR } from "@/lib/tz";
import { formatInTimeZone } from "date-fns-tz";
import { CLINIC_TZ } from "@/lib/tz";
import { Stethoscope, Building2, CalendarRange, ClipboardList } from "lucide-react";

export const metadata = { title: "Reports — Dr. Kishor's Dentistry CRM" };

function toDateInputValue(iso: string): string {
  return formatInTimeZone(iso, CLINIC_TZ, "yyyy-MM-dd");
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const ctx = await getAuthContext();
  if (!canViewReports(ctx.role)) redirect("/dashboard");

  const fallback = defaultReportRange();
  // Date inputs are clinic-local calendar days — convert to UTC range boundaries.
  const from = params.from ? clinicDayRange(params.from).start : fallback.from;
  const to = params.to ? clinicDayRange(params.to).end : fallback.to;

  const [data, filterOptions] = await Promise.all([
    getReportsData(ctx, {
      from,
      to,
      branchId: params.branch || undefined,
      doctorId: params.doctor || undefined,
    }),
    getReportFilterOptions(ctx),
  ]);

  const fromValue = params.from ?? toDateInputValue(fallback.from);
  const toValue = params.to ?? clinicToday();
  const qs = (overrides: Record<string, string | undefined>) => {
    const merged = { from: fromValue, to: toValue, branch: params.branch, doctor: params.doctor, ...overrides };
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    return `?${sp.toString()}`;
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          {ctx.role === "admin" ? "All branches" : "Your branches"} · revenue is measured by
          treatment cost recorded at time of care
        </p>
      </div>

      {/* Filters */}
      <Card className="border-l-4 border-l-gold">
        <CardContent className="pt-5">
          <form className="flex flex-wrap items-end gap-3" action="/reports" method="get">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">From</label>
              <input
                type="date"
                name="from"
                defaultValue={fromValue}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm block"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">To</label>
              <input
                type="date"
                name="to"
                defaultValue={toValue}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm block"
              />
            </div>
            {(ctx.role === "admin" || filterOptions.branches.length > 1) && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Center</label>
                <select
                  name="branch"
                  defaultValue={params.branch ?? ""}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm min-w-40"
                >
                  <option value="">All centers</option>
                  {filterOptions.branches.map((b) => (
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
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm min-w-44"
              >
                <option value="">All doctors</option>
                {filterOptions.doctors.map((d) => (
                  <option key={d.id} value={d.id}>{d.full_name}</option>
                ))}
              </select>
            </div>
            <Button type="submit" variant="secondary" size="sm">Apply</Button>
            <Button asChild variant="ghost" size="sm">
              <a href="/reports">Reset</a>
            </Button>
          </form>

          <div className="flex flex-wrap gap-2 mt-3">
            {[
              { label: "Last 7 days", days: 7 },
              { label: "Last 30 days", days: 30 },
              { label: "Last 90 days", days: 90 },
            ].map((p) => {
              const range = defaultReportRange(p.days);
              return (
                <Button key={p.days} asChild size="sm" variant="outline">
                  <a href={qs({ from: toDateInputValue(range.from), to: clinicToday() })}>{p.label}</a>
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <TotalCard label="Total leads" value={data.totals.leads} accent="border-l-blue-400" />
        <TotalCard label="Appointments" value={data.totals.appointments} accent="border-l-violet-400" />
        <TotalCard label="Follow-ups" value={data.totals.followUps} accent="border-l-amber-400" />
        <TotalCard label="Revenue" value={formatINR(data.totals.revenue)} accent="border-l-emerald-400" />
      </div>

      <Card className="border-l-4 border-l-gold">
        <CardContent className="pt-5">
          <Tabs defaultValue="doctor">
            <TabsList className="mb-4 flex-wrap h-auto">
              <TabsTrigger value="doctor">
                <Stethoscope className="h-4 w-4 mr-1.5" />
                By Doctor
              </TabsTrigger>
              <TabsTrigger value="center">
                <Building2 className="h-4 w-4 mr-1.5" />
                By Center
              </TabsTrigger>
              <TabsTrigger value="day">
                <CalendarRange className="h-4 w-4 mr-1.5" />
                By Day
              </TabsTrigger>
              <TabsTrigger value="treatment">
                <ClipboardList className="h-4 w-4 mr-1.5" />
                By Treatment
              </TabsTrigger>
            </TabsList>

            <TabsContent value="doctor">
              <ReportTable rows={data.byDoctor} firstColumn="Doctor" emptyText="No doctor activity in this range" />
            </TabsContent>
            <TabsContent value="center">
              <ReportTable rows={data.byCenter} firstColumn="Center" emptyText="No branch activity in this range" />
            </TabsContent>
            <TabsContent value="day">
              <ReportTable rows={data.byDay} firstColumn="Day" emptyText="No activity in this range" />
            </TabsContent>
            <TabsContent value="treatment">
              <ReportTable rows={data.byTreatment} firstColumn="Treatment" emptyText="No treatments recorded in this range" />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function TotalCard({ label, value, accent }: { label: string; value: number | string; accent: string }) {
  return (
    <Card className={`border-l-4 ${accent}`}>
      <CardContent className="pt-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

function ReportTable({
  rows,
  firstColumn,
  emptyText,
}: {
  rows: ReportRow[];
  firstColumn: string;
  emptyText: string;
}) {
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{firstColumn}</TableHead>
          <TableHead className="text-right">Leads</TableHead>
          <TableHead className="text-right">Appointments</TableHead>
          <TableHead className="text-right">Follow-ups</TableHead>
          <TableHead className="text-right">Revenue</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
              {emptyText}
            </TableCell>
          </TableRow>
        )}
        {rows.map((r) => (
          <TableRow key={r.key}>
            <TableCell className="font-medium">{r.label}</TableCell>
            <TableCell className="text-right">{r.leads || "—"}</TableCell>
            <TableCell className="text-right">{r.appointments || "—"}</TableCell>
            <TableCell className="text-right">{r.followUps || "—"}</TableCell>
            <TableCell className="text-right font-semibold">
              {r.revenue ? formatINR(r.revenue) : "—"}
            </TableCell>
          </TableRow>
        ))}
        {rows.length > 0 && (
          <TableRow className="bg-muted/40">
            <TableCell className="font-semibold">Total</TableCell>
            <TableCell className="text-right font-semibold">
              {rows.reduce((s, r) => s + r.leads, 0)}
            </TableCell>
            <TableCell className="text-right font-semibold">
              {rows.reduce((s, r) => s + r.appointments, 0)}
            </TableCell>
            <TableCell className="text-right font-semibold">
              {rows.reduce((s, r) => s + r.followUps, 0)}
            </TableCell>
            <TableCell className="text-right font-semibold">{formatINR(totalRevenue)}</TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
