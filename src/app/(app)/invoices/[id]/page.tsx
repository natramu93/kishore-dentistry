import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
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
import { WhatsAppInvoiceShare } from "@/components/invoices/whatsapp-invoice-share";
import { Printer } from "lucide-react";

const getInvoicePageData = cache(async (id: string) => {
  const ctx = await getAuthContext();
  const invoice = await getInvoice(ctx, id);
  return { ctx, invoice };
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { invoice } = await getInvoicePageData(id);
  return {
    title: invoice
      ? `${invoice.invoice_number} — Invoice — Dr. Kishor's Dentistry CRM`
      : "Invoice not found — Dr. Kishor's Dentistry CRM",
  };
}

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx, invoice } = await getInvoicePageData(id);
  if (!invoice) notFound();

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{invoice.invoice_number}</h1>
            <Badge variant={invoice.status === "paid" ? "default" : "secondary"} className="capitalize">
              {invoice.status}
            </Badge>
            <Badge variant={invoice.code_enforced || invoice.invoice_kind === "consultation" ? "outline" : "destructive"}>
              {invoice.code_enforced
                ? "Case-sheet coded"
                : invoice.invoice_kind === "consultation"
                  ? "Consultation"
                  : "Legacy uncoded"}
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
        <div className="flex flex-wrap gap-2">
          {(invoice.code_enforced || invoice.invoice_kind === "consultation") && (
            <>
              <WhatsAppInvoiceShare
                invoiceId={invoice.id}
                invoiceNumber={invoice.invoice_number}
                patientName={invoice.lead?.name ?? null}
                patientMobile={invoice.lead?.mobile ?? null}
              />
              <Button asChild variant="outline" size="sm">
                <Link href={`/invoices/${invoice.id}/print`} target="_blank" rel="noreferrer">
                  <Printer className="h-4 w-4 mr-1" />
                  Print / PDF
                  <span className="sr-only"> (opens in a new tab)</span>
                </Link>
              </Button>
            </>
          )}
          <InvoiceActions
            invoiceId={invoice.id}
            status={invoice.status}
            role={ctx.role}
            version={invoice.version}
            codeEnforced={invoice.code_enforced}
            consultation={invoice.invoice_kind === "consultation"}
          />
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          {!invoice.code_enforced && invoice.invoice_kind !== "consultation" && (
            <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">
              This historical invoice predates coded digital case sheets. It remains readable,
              but editing, sending, payment changes, and print generation are locked.
            </div>
          )}
          <Table aria-label={`Line items for invoice ${invoice.invoice_number}`}>
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
                  <TableCell>
                    {item.description}
                    {item.surfaces?.length ? (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        Surfaces: {item.surfaces.join(", ")}
                      </span>
                    ) : null}
                  </TableCell>
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
