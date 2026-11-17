import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { listInvoices } from "@/data/invoices";
import { getLead } from "@/data/leads";
import { listMyBranches } from "@/data/branches";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PaginationNav } from "@/components/pagination-nav";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { invoiceListFilters, invoiceStatusLabel, INVOICE_STATUSES } from "@/lib/invoice-policy";
import { InvoiceDateFilters } from "@/components/invoices/invoice-date-filters";
import { clinicToday, fmtDate, formatINR } from "@/lib/tz";

export const metadata = { title: "Invoices — Dr. Kishor's Dentistry CRM" };

const STATUS_VARIANT = {
  draft: "secondary",
  sent: "outline",
  paid: "default",
  cancelled: "destructive",
} as const;

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const ctx = await getAuthContext();
  const patient = params.lead ? await getLead(ctx, params.lead) : null;
  if (params.lead && !patient) notFound();

  const branches = await listMyBranches(ctx);
  const { dates: dateFilter, options } = invoiceListFilters(params);
  const invoiceResult = dateFilter.error ? { invoices: [], total: 0, page: 1, pageSize: 25 } : await listInvoices(ctx, {
    ...options,
    leadId: patient?.id,
    page: Number(params.page),
  });
  const exportParams = new URLSearchParams({
    dates: dateFilter.mode === "all" ? "all" : "range",
    from: options.fromDate ?? "",
    to: options.toDate ?? "",
    branch: options.branchId ?? "",
    lead: patient?.id ?? "",
    q: options.search ?? "",
    status: options.status ?? "",
    balance: options.dueOnly ? "due" : "",
    method: options.paymentMethod ?? "",
  });
  const { invoices, total, page, pageSize } = invoiceResult;

  const paidTotalOnPage = invoices.reduce((s, i) => s + i.amount_paid, 0);
  const dueTotalOnPage = invoices.reduce((s, i) => s + i.balance_due, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
          {patient && <p className="text-sm">For <Link className="underline underline-offset-4" href={`/patients/${patient.id}#patient-invoices`} target="_blank" rel="noopener noreferrer" title="Opens in a new tab">{patient.name}</Link></p>}
          <p className="text-sm text-muted-foreground">
            {total} invoice{total === 1 ? "" : "s"} · {formatINR(paidTotalOnPage)} collected · {formatINR(dueTotalOnPage)} due on this page
          </p>
        </div>
        {ctx.role !== "doctor" && (
          <Button asChild>
            <Link href={patient ? `/invoices/new?lead=${patient.id}` : "/invoices/new"}>Create invoice</Link>
          </Button>
        )}
      </div>

      {/* Patient search and invoice filters */}
      <form className="flex flex-wrap gap-2 items-end" action="/invoices" method="get">
        {patient && <input type="hidden" name="lead" value={patient.id} />}
        <div className="w-full space-y-1 sm:w-64">
          <label htmlFor="invoice-patient-search" className="text-xs text-muted-foreground">Patient name or mobile number</label>
          <Input id="invoice-patient-search" name="q" type="search" defaultValue={options.search ?? ""}
            placeholder="Search patients" maxLength={120} autoComplete="off" />
        </div>
        <InvoiceDateFilters key={`${dateFilter.mode}:${params.from}:${params.to}`} mode={dateFilter.mode} from={params.from ?? clinicToday()} to={params.to ?? clinicToday()} />
        {(ctx.role === "admin" || branches.length > 1) && (
          <div className="space-y-1">
            <label htmlFor="invoice-branch" className="text-xs text-muted-foreground">Center</label>
            <select
              id="invoice-branch"
              name="branch"
              defaultValue={params.branch ?? ""}
              className="h-11 min-w-40 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">All centers</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-1">
          <label htmlFor="invoice-status" className="text-xs text-muted-foreground">Status</label>
          <select
            id="invoice-status"
            name="status"
            defaultValue={params.status ?? ""}
            className="h-11 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">Active invoices</option>
              {INVOICE_STATUSES.map((s) => (
              <option key={s} value={s} className="capitalize">{invoiceStatusLabel(s)}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="invoice-balance" className="text-xs text-muted-foreground">Balance</label>
          <select id="invoice-balance" name="balance" defaultValue={params.balance ?? ""} className="h-11 rounded-md border border-input bg-transparent px-3 text-sm">
            <option value="">All invoices</option><option value="due">Amount due</option>
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="invoice-method" className="text-xs text-muted-foreground">Payment mode</label>
          <select id="invoice-method" name="method" defaultValue={params.method ?? ""} className="h-11 rounded-md border border-input bg-transparent px-3 text-sm">
            <option value="">Any method</option><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="neft">NEFT</option>
          </select>
        </div>
        <Button type="submit" variant="secondary" size="sm">Filter</Button>
        {!dateFilter.error && total > 0 && ctx.role !== "doctor" && (
          <Button asChild variant="outline" size="sm">
            <a href={`/invoices/export?${exportParams}`} download>Download filtered invoices (CSV)</a>
          </Button>
        )}
        <Button asChild variant="ghost" size="sm">
          <Link href={patient ? `/invoices?lead=${patient.id}` : "/invoices"}>Reset filters</Link>
        </Button>
      </form>

      {dateFilter.error && <p role="alert" className="text-sm text-destructive">{dateFilter.error}</p>}
      <p className="text-sm text-muted-foreground">Showing {dateFilter.mode === "all" ? "all invoice dates" : dateFilter.mode === "today" ? `today’s invoices (${fmtDate(clinicToday())})` : "the selected invoice date range"}.</p>
      <Table aria-label="Invoices">
        <TableHeader>
          <TableRow>
            <TableHead>Invoice #</TableHead>
            <TableHead>Patient</TableHead>
            <TableHead className="hidden md:table-cell">Center</TableHead>
            <TableHead className="hidden md:table-cell">Date</TableHead>
            <TableHead>Total</TableHead>
            <TableHead className="hidden sm:table-cell">Paid / Due</TableHead>
            <TableHead className="hidden sm:table-cell">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                No invoices match these filters
              </TableCell>
            </TableRow>
          )}
          {invoices.map((inv) => (
            <TableRow key={inv.id}>
              <TableCell className="whitespace-normal">
                <Link href={`/invoices/${inv.id}`} target="_blank" rel="noopener noreferrer" title="Opens in a new tab" className="font-medium hover:underline">
                  {inv.invoice_number}
                </Link>
                {inv.invoice_kind === "opening_balance" && <div className="text-xs text-muted-foreground">Opening balance</div>}
                <div className="mt-1 sm:hidden">
                  <Badge variant={STATUS_VARIANT[inv.status]} className="capitalize">
                    {invoiceStatusLabel(inv.status)}
                  </Badge>
                </div>
              </TableCell>
              <TableCell className="whitespace-normal">
                {inv.lead ? (
                  <Link href={`/patients/${inv.lead.id}`} target="_blank" rel="noopener noreferrer" title="Opens in a new tab" className="hover:underline">
                    {inv.lead.name}
                  </Link>
                ) : "—"}
              </TableCell>
              <TableCell className="hidden md:table-cell">{inv.branch?.name ?? "—"}</TableCell>
              <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">{fmtDate(inv.billing_date)}</TableCell>
              <TableCell className="whitespace-nowrap">
                <span className="font-semibold">{formatINR(inv.status === "cancelled" ? 0 : inv.total)}</span>
                <span className="mt-1 block text-xs text-muted-foreground sm:hidden">Due {formatINR(inv.balance_due)}</span>
              </TableCell>
              <TableCell className="hidden whitespace-nowrap text-xs sm:table-cell">
                <span className="block">Paid {formatINR(inv.amount_paid)}</span>
                <span className="text-muted-foreground">Due {formatINR(inv.balance_due)}</span>
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <Badge variant={STATUS_VARIANT[inv.status]} className="capitalize">
                  {invoiceStatusLabel(inv.status)}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <PaginationNav
        pathname="/invoices"
        searchParams={params}
        page={page}
        pageSize={pageSize}
        total={total}
      />
    </div>
  );
}
