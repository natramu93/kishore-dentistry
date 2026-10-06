import Link from "next/link";
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
import { PAYMENT_METHODS, PAYMENT_LABELS, type CollectionRow } from "@/lib/reports/collections";
import type { InvoiceValues } from "@/lib/reports/invoice-values";
import {
  Stethoscope,
  Building2,
  CalendarRange,
  Download,
} from "lucide-react";

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
  const exportParams = new URLSearchParams();
  for (const [key, value] of Object.entries({
    from: params.from,
    to: params.to,
    branch: params.branch,
    doctor: params.doctor,
  })) {
    if (value) exportParams.set(key, value);
  }
  const exportHref = `/reports/export${
    exportParams.size ? `?${exportParams.toString()}` : ""
  }`;
  const monthlyRows = Object.values(data.byDay.reduce<Record<string, ReportRow>>((groups, row) => {
    const key = row.key.slice(0, 7);
    const group = groups[key] ?? {
      key,
      label: formatInTimeZone(`${key}-01T12:00:00Z`, CLINIC_TZ, "MMM yyyy"),
      leads: 0, appointments: 0, followUps: 0, revenue: 0,
    };
    group.leads += row.leads;
    group.appointments += row.appointments;
    group.followUps += row.followUps;
    group.revenue += row.revenue;
    groups[key] = group;
    return groups;
  }, {}));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          {ctx.role === "admin" ? "All branches" : "Your branches"} · Revenue received is actual invoice payments.
          Treatment value is invoice line value before discounts and tax, including direct invoices.
        </p>
      </div>

      <div className="flex justify-end">
        <Button asChild variant="outline" size="sm">
          <Link
            href={exportHref}
            prefetch={false}
            aria-label="Download the filtered aggregate report as CSV"
          >
            <Download aria-hidden="true" className="h-4 w-4" />
            Download CSV
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <Card className="border-l-4 border-l-gold">
        <CardContent className="pt-5">
          <form className="flex flex-wrap items-end gap-3" action="/reports" method="get">
            <div className="space-y-1">
              <label htmlFor="report-from" className="text-xs text-muted-foreground">From</label>
              <input
                id="report-from"
                type="date"
                name="from"
                defaultValue={fromValue}
                className="block h-11 rounded-md border border-input bg-transparent px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="report-to" className="text-xs text-muted-foreground">To</label>
              <input
                id="report-to"
                type="date"
                name="to"
                defaultValue={toValue}
                className="block h-11 rounded-md border border-input bg-transparent px-3 text-sm"
              />
            </div>
            {(ctx.role === "admin" || filterOptions.branches.length > 1) && (
              <div className="space-y-1">
                <label htmlFor="report-branch" className="text-xs text-muted-foreground">Center</label>
                <select
                  id="report-branch"
                  name="branch"
                  defaultValue={params.branch ?? ""}
                  className="h-11 min-w-40 rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  <option value="">All centers</option>
                  {filterOptions.branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1">
              <label htmlFor="report-doctor" className="text-xs text-muted-foreground">Doctor</label>
              <select
                id="report-doctor"
                name="doctor"
                defaultValue={params.doctor ?? ""}
                className="h-11 min-w-44 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">All doctors</option>
                {filterOptions.doctors.map((d) => (
                  <option key={d.id} value={d.id}>{d.full_name}</option>
                ))}
              </select>
            </div>
            <Button type="submit" variant="secondary" size="sm">Apply</Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/reports">Reset</Link>
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
                  <Link href={qs({ from: toDateInputValue(range.from), to: clinicToday() })}>{p.label}</Link>
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
        <TotalCard label="Revenue received" value={formatINR(data.collections.total.amount)} accent="border-l-emerald-400" />
        <TotalCard label="Treatment value" value={formatINR(data.totals.revenue)} accent="border-l-blue-400" />
        <TotalCard label="Invoice discounts" value={formatINR(data.invoiceValues.discounts)} accent="border-l-amber-400" />
        <TotalCard label="Invoice tax" value={formatINR(data.invoiceValues.tax)} accent="border-l-amber-400" />
        <TotalCard label="Net billed" value={formatINR(data.invoiceValues.net)} accent="border-l-blue-400" />
      </div>

      <Card className="border-l-4 border-l-blue-400">
        <CardContent className="pt-5">
          <h2 className="mb-1 text-base font-semibold">Invoice-based treatment value</h2>
          <p className="mb-4 text-sm text-muted-foreground">Includes direct and case-sheet invoices, including drafts; excludes cancelled and archived invoices. Grouped by the invoice’s consulting doctor and line-item treatment/category. Uses invoice date, or issue/creation date for older invoices. Doctor and center filters apply. Missing details remain visible in unspecified groups.</p>
          <Tabs defaultValue="invoice-doctor">
            <TabsList className="mb-4 h-auto flex-wrap">
              {(["doctor", "category", "treatment", "center", "day", "month"] as const).map((dimension) => <TabsTrigger key={dimension} value={`invoice-${dimension}`}>By {dimension === "day" ? "date" : dimension}</TabsTrigger>)}
            </TabsList>
            {(["doctor", "category", "treatment", "center", "day", "month"] as const).map((dimension) => <TabsContent key={dimension} value={`invoice-${dimension}`}><InvoiceValueTable rows={data.invoiceValues.rows.filter((row) => row.dimension === dimension)} dimension={dimension} /></TabsContent>)}
          </Tabs>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-gold">
        <CardContent className="pt-5">
          <h2 className="mb-4 text-base font-semibold">Clinical and lead activity</h2>
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
              <TabsTrigger value="month">
                <CalendarRange className="h-4 w-4 mr-1.5" />
                By Month
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
            <TabsContent value="month">
              <ReportTable rows={monthlyRows} firstColumn="Month" emptyText="No activity in this range" />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-emerald-400">
        <CardContent className="pt-5">
          <h2 className="mb-1 text-base font-semibold">Revenue received by payment method</h2>
          <p className="mb-4 text-sm text-muted-foreground">Actual invoice receipts by payment date, including split payments. Center and date filters apply; doctor filter does not apply to receipts. These are collections, not expense costs or profit.</p>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {PAYMENT_METHODS.map((method) => <TotalCard key={method} label={PAYMENT_LABELS[method]} value={formatINR(data.collections.total[method])} accent="border-l-emerald-400" />)}
          </div>
          <Tabs defaultValue="collection-day">
            <TabsList className="mb-4"><TabsTrigger value="collection-day">By Date</TabsTrigger><TabsTrigger value="collection-month">By Month</TabsTrigger></TabsList>
            <TabsContent value="collection-day"><CollectionTable rows={data.collections.byDay} total={data.collections.total} monthly={false} /></TabsContent>
            <TabsContent value="collection-month"><CollectionTable rows={data.collections.byMonth} total={data.collections.total} monthly /></TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function CollectionTable({ rows, total, monthly }: { rows: CollectionRow[]; total: CollectionRow; monthly: boolean }) {
  const cells = (row: CollectionRow) => <>{PAYMENT_METHODS.map((method) => <TableCell key={method} className="text-right whitespace-nowrap">{formatINR(row[method])}</TableCell>)}<TableCell className="text-right whitespace-nowrap font-semibold">{formatINR(row.amount)}</TableCell></>;
  return (
    <Table aria-label={`Revenue received by ${monthly ? "month" : "date"} and payment method`}>
      <TableHeader><TableRow><TableHead>{monthly ? "Month" : "Date"}</TableHead>{PAYMENT_METHODS.map((method) => <TableHead key={method} className="text-right">{PAYMENT_LABELS[method]}</TableHead>)}<TableHead className="text-right">Total received</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No payments received in this date range</TableCell></TableRow>}
        {rows.map((row) => <TableRow key={row.key}><TableCell className="whitespace-nowrap">{formatInTimeZone(`${row.key}${monthly ? "-01" : ""}T12:00:00Z`, CLINIC_TZ, monthly ? "MMM yyyy" : "d MMM yyyy")}</TableCell>{cells(row)}</TableRow>)}
        <TableRow className="bg-muted/40 font-semibold"><TableCell>Total</TableCell>{cells(total)}</TableRow>
      </TableBody>
    </Table>
  );
}

function InvoiceValueTable({ rows, dimension }: { rows: InvoiceValues["rows"]; dimension: string }) {
  return <Table aria-label={`Invoice treatment value by ${dimension}`}>
    <TableHeader><TableRow><TableHead className="capitalize">{dimension === "day" ? "Date" : dimension}</TableHead><TableHead className="text-right">Invoices</TableHead><TableHead className="text-right">Treatment value</TableHead></TableRow></TableHeader>
    <TableBody>
      {rows.length === 0 && <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">No invoices in this range</TableCell></TableRow>}
      {rows.map((row) => <TableRow key={row.key}><TableCell>{row.label}</TableCell><TableCell className="text-right">{row.invoices}</TableCell><TableCell className="text-right">{formatINR(row.value)}</TableCell></TableRow>)}
      <TableRow className="bg-muted/40 font-semibold"><TableCell>Total value</TableCell><TableCell /><TableCell className="text-right">{formatINR(rows.reduce((sum, row) => sum + row.value, 0))}</TableCell></TableRow>
    </TableBody>
  </Table>;
}

function TotalCard({ label, value, accent }: { label: string; value: number | string; accent: string }) {
  return (
    <Card className={`border-l-4 ${accent}`}>
      <CardContent className="pt-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="break-words text-xl font-bold sm:text-2xl">{value}</p>
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
  return (
    <Table aria-label={`${firstColumn} report`}>
      <TableHeader>
        <TableRow>
          <TableHead>{firstColumn}</TableHead>
          <TableHead className="text-right">Leads</TableHead>
          <TableHead className="text-right">Appointments</TableHead>
          <TableHead className="text-right">Follow-ups</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
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
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
