import Link from "next/link";
import { getAuthContext } from "@/lib/auth/context";
import { listInvoices } from "@/data/invoices";
import { listMyBranches } from "@/data/branches";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

  const invoices = await listInvoices(ctx, {
    branchId: params.branch || undefined,
    status,
  });

  const paidTotal = invoices
    .filter((i) => i.status === "paid")
    .reduce((s, i) => s + i.total, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
          <p className="text-sm text-muted-foreground">
            {invoices.length} invoice{invoices.length === 1 ? "" : "s"} · {formatINR(paidTotal)} collected
          </p>
        </div>
      </div>

      {/* Per-center + status filters */}
      <form className="flex flex-wrap gap-2 items-end" action="/invoices" method="get">
        {(ctx.role === "admin" || branches.length > 1) && (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Center</label>
            <select
              name="branch"
              defaultValue={params.branch ?? ""}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm min-w-40"
            >
              <option value="">All centers</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Status</label>
          <select
            name="status"
            defaultValue={params.status ?? ""}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
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

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Invoice #</TableHead>
            <TableHead>Patient</TableHead>
            <TableHead>Center</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Total</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                No invoices match these filters
              </TableCell>
            </TableRow>
          )}
          {invoices.map((inv) => (
            <TableRow key={inv.id}>
              <TableCell>
                <Link href={`/invoices/${inv.id}`} className="font-medium hover:underline">
                  {inv.invoice_number}
                </Link>
              </TableCell>
              <TableCell>
                {inv.lead ? (
                  <Link href={`/leads/${inv.lead.id}`} className="hover:underline">
                    {inv.lead.name}
                  </Link>
                ) : "—"}
              </TableCell>
              <TableCell>{inv.branch?.name ?? "—"}</TableCell>
              <TableCell className="text-muted-foreground whitespace-nowrap">{fmtDate(inv.created_at)}</TableCell>
              <TableCell className="font-semibold whitespace-nowrap">{formatINR(inv.total)}</TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[inv.status]} className="capitalize">
                  {inv.status}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
