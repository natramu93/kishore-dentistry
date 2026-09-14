import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { listMyCaseSheets, listMyTreatments, countMyPatients } from "@/data/doctor-portal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  const [result, patientCount, clinicalFiles] = await Promise.all([
    listMyTreatments(ctx, {
      from,
      to,
      treatmentCode: params.treatment_code || undefined,
      search: params.q || undefined,
      page: Number(params.page),
    }),
    countMyPatients(ctx),
    listMyCaseSheets(ctx, {
      from,
      to,
      search: params.q || undefined,
      page: Number(params.case_page),
    }),
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
                placeholder="e.g. K02.9"
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clinical case sheets</CardTitle>
          <p className="text-sm text-muted-foreground">
            {clinicalFiles.total} examination record{clinicalFiles.total === 1 ? "" : "s"}; includes visits without treatment.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {clinicalFiles.records.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No clinical case sheets match these patient and date filters.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {clinicalFiles.records.map((sheet) => (
                <li key={sheet.id}>
                  <Link
                    href={`/my-patients/${sheet.lead_id}`}
                    className="block h-full rounded-lg border p-3 outline-none transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span className="block font-medium">{sheet.lead?.name ?? "Patient"}</span>
                    <span className="block text-xs text-muted-foreground">
                      {fmt(sheet.visit_at)} · {sheet.branch?.name ?? "Clinic"}
                    </span>
                    <span className="mt-2 block text-xs">
                      {sheet.tooth_assessments.length} tooth record{sheet.tooth_assessments.length === 1 ? "" : "s"}
                      {` · ${sheet.treatments.length} treatment${sheet.treatments.length === 1 ? "" : "s"}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <PaginationNav
            pathname="/my-patients"
            searchParams={params}
            page={clinicalFiles.page}
            pageSize={clinicalFiles.pageSize}
            total={clinicalFiles.total}
            pageParam="case_page"
          />
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
                    Tooth {r.tooth_number} · Indian Standard IS 8815
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
