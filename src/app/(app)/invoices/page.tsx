import Link from "next/link";
import { getAuthContext } from "@/lib/auth/context";
import { listInvoices } from "@/data/invoices";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { fmtDate, formatINR } from "@/lib/tz";

export const metadata = { title: "Invoices — Kishore Dentistry CRM" };

const STATUS_VARIANT = {
  draft: "secondary",
  sent: "outline",
  paid: "default",
} as const;

export default async function InvoicesPage() {
  const ctx = await getAuthContext();
  const invoices = await listInvoices(ctx);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
        <p className="text-sm text-muted-foreground">
          Raised from treatment records on a lead. {invoices.length} total.
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Invoice #</TableHead>
            <TableHead>Patient</TableHead>
            <TableHead>Branch</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Total</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                No invoices yet — raise one from a treated lead
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
              <TableCell className="text-muted-foreground">{fmtDate(inv.created_at)}</TableCell>
              <TableCell className="font-semibold">{formatINR(inv.total)}</TableCell>
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
