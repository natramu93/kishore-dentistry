import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { getInvoice } from "@/data/invoices";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { fmtDate, formatINR } from "@/lib/tz";
import { InvoiceActions } from "./status-buttons";
import { Printer } from "lucide-react";

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getAuthContext();
  const invoice = await getInvoice(ctx, id);
  if (!invoice) notFound();

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{invoice.invoice_number}</h1>
            <Badge variant={invoice.status === "paid" ? "default" : "secondary"} className="capitalize">
              {invoice.status}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {invoice.lead ? (
              <Link href={`/leads/${invoice.lead.id}`} className="hover:underline">
                {invoice.lead.name}
              </Link>
            ) : "—"}{" "}
            · {invoice.branch?.name} · {fmtDate(invoice.created_at)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/invoices/${invoice.id}/print`} target="_blank">
              <Printer className="h-4 w-4 mr-1" />
              Print / PDF
            </Link>
          </Button>
          <InvoiceActions invoiceId={invoice.id} status={invoice.status} role={ctx.role} />
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.description}</TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">{formatINR(item.unit_price)}</TableCell>
                  <TableCell className="text-right">{formatINR(item.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-4 ml-auto w-56 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatINR(invoice.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tax ({invoice.tax_rate}%)</span>
              <span>{formatINR(invoice.tax_amount)}</span>
            </div>
            <div className="flex justify-between font-bold text-base border-t pt-1">
              <span>Total</span>
              <span>{formatINR(invoice.total)}</span>
            </div>
          </div>
          {invoice.notes && (
            <p className="mt-4 text-sm text-muted-foreground border-t pt-3">{invoice.notes}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
