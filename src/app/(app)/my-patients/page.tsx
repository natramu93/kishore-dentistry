import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { listMyTreatments, countMyPatients } from "@/data/doctor-portal";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PaginationNav } from "@/components/pagination-nav";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { clinicDayRange, fmt, formatINR } from "@/lib/tz";

export const metadata = { title: "My Patients — Dr. Kishor's Dentistry CRM" };

function isValidDateParam(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export default async function MyPatientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const ctx = await getAuthContext();
  // Doctor-portal page: any other role has richer views (Leads, Reports).
  if (ctx.role !== "doctor") redirect("/dashboard");

  // Date inputs are clinic-local calendar days — widen to UTC boundaries.
  const from = isValidDateParam(params.from) ? clinicDayRange(params.from).start : undefined;
  const to = isValidDateParam(params.to) ? clinicDayRange(params.to).end : undefined;

  const [result, patientCount] = await Promise.all([
    listMyTreatments(ctx, {
      from,
      to,
      treatmentCode: params.treatment_code || undefined,
      search: params.q || undefined,
      page: Number(params.page),
    }),
    countMyPatients(ctx),
  ]);
  const { records, total, page, pageSize } = result;
  const totalRevenue = records.reduce(
    (sum, r) => sum + (r.cost ?? 0) * (r.quantity ?? 1),
    0,
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Patients</h1>
        <p className="text-sm text-muted-foreground">
          {patientCount} patient{patientCount === 1 ? "" : "s"} treated overall ·{" "}
          {total} treatment record{total === 1 ? "" : "s"} matching filters
        </p>
      </div>

      {/* Record filters */}
      <Card className="border-l-4 border-l-gold">
        <CardContent className="pt-5">
          <form className="flex flex-wrap items-end gap-3" action="/my-patients" method="get">
            <div className="space-y-1">
              <label htmlFor="mp-q" className="text-xs text-muted-foreground">Patient</label>
              <input
                id="mp-q"
                type="search"
                name="q"
                defaultValue={params.q ?? ""}
                placeholder="Name or mobile"
                className="block h-11 min-w-48 rounded-md border border-input bg-transparent px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="mp-from" className="text-xs text-muted-foreground">From</label>
              <input
                id="mp-from"
                type="date"
                name="from"
                defaultValue={isValidDateParam(params.from) ? params.from : ""}
                className="block h-11 rounded-md border border-input bg-transparent px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="mp-to" className="text-xs text-muted-foreground">To</label>
              <input
                id="mp-to"
                type="date"
                name="to"
                defaultValue={isValidDateParam(params.to) ? params.to : ""}
                className="block h-11 rounded-md border border-input bg-transparent px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="mp-treatment-code" className="text-xs text-muted-foreground">Treatment code</label>
              <input
                id="mp-treatment-code"
                name="treatment_code"
                defaultValue={params.treatment_code ?? ""}
                placeholder="e.g. TMT_108"
                autoCapitalize="characters"
                className="block h-11 min-w-44 rounded-md border border-input bg-transparent px-3 text-sm"
              />
            </div>
            <Button type="submit" variant="secondary" size="sm">Filter</Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/my-patients">Reset</Link>
            </Button>
          </form>
        </CardContent>
      </Card>

      <Table aria-label="My treatment records">
        <TableHeader>
          <TableRow>
            <TableHead>Treated</TableHead>
            <TableHead>Patient</TableHead>
            <TableHead>Treatment</TableHead>
            <TableHead className="hidden md:table-cell">Center</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                No treatment records match these filters
              </TableCell>
            </TableRow>
          )}
          {records.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="whitespace-nowrap font-medium">{fmt(r.treated_at)}</TableCell>
              <TableCell className="whitespace-normal">
                {r.lead ? (
                  <Link href={`/my-patients/${r.lead.id}`} className="font-medium underline-offset-2 hover:underline">
                    {r.lead.name}
                  </Link>
                ) : (
                  <span className="font-medium">—</span>
                )}
                {r.lead?.mobile && (
                  <a
                    href={`tel:${r.lead.mobile}`}
                    className="block text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    {r.lead.mobile}
                  </a>
                )}
              </TableCell>
              <TableCell className="whitespace-normal">
                {r.treatment_code ? (
                  <>
                    <Badge variant="outline" className="mr-2 font-mono">
                      {r.treatment_code}
                    </Badge>
                    {r.treatment_name ?? "Coded treatment"}
                    {r.treatment_category && (
                      <Badge variant="secondary" className="ml-2 hidden lg:inline-flex">
                        {r.treatment_category}
                      </Badge>
                    )}
                  </>
                ) : r.treatment_type ? (
                  <>{r.treatment_type.name} <Badge variant="secondary">Legacy</Badge></>
                ) : (
                  "—"
                )}
                {r.tooth_number && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    FDI tooth {r.tooth_number}
                    {r.surfaces?.length ? ` · ${r.surfaces.join(", ")}` : ""}
                  </p>
                )}
                {r.notes && (
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{r.notes}</p>
                )}
              </TableCell>
              <TableCell className="hidden md:table-cell text-muted-foreground">
                {r.branch?.name ?? "—"}
              </TableCell>
              <TableCell className="text-right font-semibold whitespace-nowrap">
                {r.cost != null ? formatINR(r.cost * (r.quantity ?? 1)) : "—"}
                {r.cost != null && (r.quantity ?? 1) !== 1 && (
                  <span className="block text-xs font-normal text-muted-foreground">
                    {r.quantity} × {formatINR(r.cost)}
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
          {records.length > 0 && (
            <TableRow className="bg-muted/40">
              <TableCell colSpan={4} className="font-semibold">
                Page total
              </TableCell>
              <TableCell className="text-right font-semibold whitespace-nowrap">
                {formatINR(totalRevenue)}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <PaginationNav
        pathname="/my-patients"
        searchParams={params}
        page={page}
        pageSize={pageSize}
        total={total}
      />
    </div>
  );
}
