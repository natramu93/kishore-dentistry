import Link from "next/link";
import { getAuthContext } from "@/lib/auth/context";
import { listInvoices } from "@/data/invoices";
import { listMyBranches } from "@/data/branches";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PaginationNav } from "@/components/pagination-nav";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { fmtDate, formatINR } from "@/lib/tz";
import type { InvoiceStatus } from "@/lib/database.types";

export const metadata = { title: "Invoices — Dr. Kishor's Dentistry CRM" };

const STATUS_VARIANT = {
  draft: "secondary",
  sent: "outline",
  paid: "default",
} as const;

const STATUSES: InvoiceStatus[] = ["draft", "sent", "paid"];

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const ctx = await getAuthContext();

  const [branches] = await Promise.all([listMyBranches(ctx)]);
  const status = STATUSES.includes(params.status as InvoiceStatus)
    ? (params.status as InvoiceStatus)
    : undefined;

  const invoiceResult = await listInvoices(ctx, {
    branchId: params.branch || undefined,
    status,
    page: Number(params.page),
  });
  const { invoices, total, page, pageSize } = invoiceResult;

  const paidTotalOnPage = invoices.reduce((s, i) => s + i.amount_paid, 0);
  const dueTotalOnPage = invoices.reduce((s, i) => s + i.balance_due, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
          <p className="text-sm text-muted-foreground">
            {total} invoice{total === 1 ? "" : "s"} · {formatINR(paidTotalOnPage)} collected · {formatINR(dueTotalOnPage)} due on this page
          </p>
        </div>
      </div>

      {/* Per-center + status filters */}
      <form className="flex flex-wrap gap-2 items-end" action="/invoices" method="get">
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
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s} className="capitalize">{s}</option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary" size="sm">Filter</Button>
        <Button asChild variant="ghost" size="sm">
          <Link href="/invoices">Reset</Link>
        </Button>
      </form>

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
                <Link href={`/invoices/${inv.id}`} className="font-medium hover:underline">
                  {inv.invoice_number}
                </Link>
                <div className="mt-1 sm:hidden">
                  <Badge variant={STATUS_VARIANT[inv.status]} className="capitalize">
                    {inv.status}
                  </Badge>
                </div>
              </TableCell>
              <TableCell className="whitespace-normal">
                {inv.lead ? (
                  <Link href={`/leads/${inv.lead.id}`} className="hover:underline">
                    {inv.lead.name}
                  </Link>
                ) : "—"}
              </TableCell>
              <TableCell className="hidden md:table-cell">{inv.branch?.name ?? "—"}</TableCell>
              <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">{fmtDate(inv.created_at)}</TableCell>
              <TableCell className="whitespace-nowrap">
                <span className="font-semibold">{formatINR(inv.total)}</span>
                <span className="mt-1 block text-xs text-muted-foreground sm:hidden">Due {formatINR(inv.balance_due)}</span>
              </TableCell>
              <TableCell className="hidden whitespace-nowrap text-xs sm:table-cell">
                <span className="block">Paid {formatINR(inv.amount_paid)}</span>
                <span className="text-muted-foreground">Due {formatINR(inv.balance_due)}</span>
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <Badge variant={STATUS_VARIANT[inv.status]} className="capitalize">
                  {inv.status}
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
