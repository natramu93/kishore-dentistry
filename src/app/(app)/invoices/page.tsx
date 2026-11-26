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
import { invoiceFinanceFilters } from "@/lib/finance-activity";
import { FinanceDetailCard } from "@/components/invoices/finance-detail-card";
import { PAYMENT_METHODS, PAYMENT_LABELS } from "@/lib/reports/collections";
import { patientDisplayName } from "@/lib/patient-demographics";

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
  const invoiceResult = dateFilter.error ? { invoices: [], total: 0, page: 1, pageSize: 25,
    collections: { upi: 0, cash: 0, card: 0, neft: 0, amount: 0 } } : await listInvoices(ctx, {
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
    sort: options.sort, order: options.descending ? "desc" : "asc",
  });
  const { invoices, total, page, pageSize } = invoiceResult;

  const dueTotalOnPage = invoices.reduce((s, i) => s + i.balance_due, 0);
  const financeFilters = dateFilter.error ? undefined : invoiceFinanceFilters({ ...options, leadId: patient?.id });
  const sortState = (key: string) => options.sort === key ? options.descending ? "descending" as const : "ascending" as const : "none" as const;
  const sortHeading = (label: string, key: string) => {
    const search = new URLSearchParams(exportParams);
    search.set("sort", key);
    search.set("order", options.sort === key && !options.descending ? "desc" : "asc");
    return <Link href={`/invoices?${search}`} className="inline-flex min-h-10 items-center gap-1"
      aria-label={`Sort all matching invoices by ${label}`}>{label} {options.sort === key ? options.descending ? "↓" : "↑" : "↕"}</Link>;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
          {patient && <p className="text-sm">For <Link className="underline underline-offset-4" href={`/patients/${patient.id}#patient-invoices`} target="_blank" rel="noopener noreferrer" title="Opens in a new tab">{patientDisplayName(patient)}</Link></p>}
          <p className="text-sm text-muted-foreground">
            {total} invoice{total === 1 ? "" : "s"} · {formatINR(invoiceResult.collections.amount)} received in range · {formatINR(dueTotalOnPage)} outstanding on this page
          </p>
        </div>
        {ctx.role !== "doctor" && (
          <Button asChild>
            <Link href={patient ? `/invoices/new?lead=${patient.id}` : "/invoices/new"}>Create invoice</Link>
          </Button>
        )}
      </div>

      {financeFilters && <section aria-label="Collections in the selected receipt date range" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <FinanceDetailCard label="Total received in range" amount={invoiceResult.collections.amount} source="invoices" filters={financeFilters} />
        {PAYMENT_METHODS.filter((method) => !options.paymentMethod || options.paymentMethod === method).map((method) => <FinanceDetailCard key={method} label={PAYMENT_LABELS[method]}
          amount={invoiceResult.collections[method]} source="invoices" filters={{ ...financeFilters, method }} />)}
      </section>}
      <form className="flex flex-wrap gap-2 items-end" action="/invoices" method="get">
        <input type="hidden" name="sort" value={options.sort} /><input type="hidden" name="order" value={options.descending ? "desc" : "asc"} />
        {patient && <input type="hidden" name="lead" value={patient.id} />}
        <div className="w-full space-y-1 sm:w-72">
          <label htmlFor="invoice-search" className="text-xs text-muted-foreground">Invoice number, patient name, or mobile</label>
          <Input id="invoice-search" name="q" type="search" defaultValue={options.search ?? ""}
            placeholder="Search invoices" maxLength={120} autoComplete="off" />
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
      <p className="text-sm text-muted-foreground">Showing invoices dated in the range or with payments received in it{dateFilter.mode === "today" ? ` (today, ${fmtDate(clinicToday())})` : dateFilter.mode === "all" ? " (all dates)" : ""}. Collections use receipt dates only; unpaid charges do not count as revenue.</p>
      <Table aria-label="Invoices" sortable={false}>
        <TableHeader>
          <TableRow>
            <TableHead aria-sort={sortState("number")}>{sortHeading("Invoice #", "number")}</TableHead>
            <TableHead aria-sort={sortState("patient")}>{sortHeading("Patient", "patient")}</TableHead>
            <TableHead aria-sort={sortState("center")} className="hidden md:table-cell">{sortHeading("Center", "center")}</TableHead>
            <TableHead aria-sort={sortState("date")} className="hidden md:table-cell">{sortHeading("Invoice date", "date")}</TableHead>
            <TableHead aria-sort={sortState("total")}>{sortHeading("Total", "total")}</TableHead>
            <TableHead aria-sort={sortState("received")} className="hidden sm:table-cell">{sortHeading("Received in range", "received")}</TableHead>
            <TableHead aria-sort={sortState("paid")} className="hidden sm:table-cell">{sortHeading("All payments", "paid")}</TableHead>
            <TableHead aria-sort={sortState("due")} className="hidden sm:table-cell">{sortHeading("Due", "due")}</TableHead>
            <TableHead aria-sort={sortState("status")} className="hidden sm:table-cell">{sortHeading("Status", "status")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.length === 0 && (
            <TableRow>
              <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
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
                {formatINR(inv.received_in_range)}
              </TableCell>
              <TableCell className="hidden whitespace-nowrap text-xs sm:table-cell">{formatINR(inv.amount_paid)}</TableCell>
              <TableCell className="hidden whitespace-nowrap text-xs sm:table-cell">{formatINR(inv.balance_due)}</TableCell>
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
