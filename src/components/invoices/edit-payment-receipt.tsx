"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateInvoicePaymentAction } from "@/actions/invoices";
import type { InvoicePayment } from "@/lib/database.types";
import { PAYMENT_METHODS } from "@/lib/invoice-receipts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function EditPaymentReceipt({ payment, maximumAmount }: { payment: InvoicePayment; maximumAmount: number }) {
  const id = useId();
  const router = useRouter();
  const [amount, setAmount] = useState(String(payment.amount));
  const [method, setMethod] = useState(payment.payment_method);
  const [reference, setReference] = useState(payment.reference ?? "");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  return <details className="rounded-md border p-3">
    <summary className="cursor-pointer text-sm font-medium">Edit receipt</summary>
    <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={(event) => {
      event.preventDefault();
      startTransition(async () => {
        try {
          const result = await updateInvoicePaymentAction(payment.invoice_id, payment.id, {
            amount, method, reference, reason, expected_version: payment.version,
          });
          if (!result.ok) toast.error(result.error);
          else { toast.success("Receipt updated"); router.refresh(); }
        } catch { toast.error("The receipt could not be updated. Your entries are kept; please try again."); }
      });
    }}>
      <div className="space-y-1.5"><Label htmlFor={`${id}-amount`}>Received amount (₹)</Label>
        <Input id={`${id}-amount`} type="number" inputMode="decimal" min="0.01" max={maximumAmount} step="0.01" required disabled={pending} value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
      <div className="space-y-1.5"><Label htmlFor={`${id}-method`}>Payment method</Label>
        <select id={`${id}-method`} value={method} disabled={pending} onChange={(event) => setMethod(event.target.value as InvoicePayment["payment_method"])} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm">
          {PAYMENT_METHODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></div>
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor={`${id}-reference`}>Transaction / receipt reference</Label>
        <Input id={`${id}-reference`} value={reference} disabled={pending} maxLength={120} onChange={(event) => setReference(event.target.value)} /></div>
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor={`${id}-reason`}>Reason for correction</Label>
        <Input id={`${id}-reason`} value={reason} disabled={pending} required maxLength={1000} onChange={(event) => setReason(event.target.value)} /></div>
      <p className="text-xs text-muted-foreground sm:col-span-2">The original receipt date is retained. The correction and reason are recorded in patient history.</p>
      <Button type="submit" disabled={pending}>{pending ? "Updating…" : "Update receipt"}</Button>
    </form>
  </details>;
}
