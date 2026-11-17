"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateConsultationInvoiceAction } from "@/actions/invoices";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { preventImplicitInvoiceSubmit } from "./invoice-form-keyboard";
import { invoiceDisplayTotals } from "@/lib/invoice-lines";
import { invoicePaymentEditIssue } from "@/lib/invoice-policy";
import { formatINR } from "@/lib/tz";

export function ConsultationInvoiceEditor({
  invoiceId, version, initialAmount, initialNotes, initialInvoiceDate, amountReceived = 0, legacyPaidTotal, taxRate = 0, discount = 0,
}: {
  invoiceId: string; version: number; initialAmount: number; initialNotes: string; initialInvoiceDate: string;
  amountReceived?: number; legacyPaidTotal?: number; taxRate?: number; discount?: number;
}) {
  const id = useId();
  const router = useRouter();
  const [amount, setAmount] = useState(String(initialAmount));
  const [notes, setNotes] = useState(initialNotes);
  const [invoiceDate, setInvoiceDate] = useState(initialInvoiceDate);
  const [pending, startTransition] = useTransition();
  const { total } = invoiceDisplayTotals([{ quantity: 1, unit_price: Number(amount) }], taxRate, discount);
  const paymentEditIssue = invoicePaymentEditIssue(total, amountReceived, legacyPaidTotal);
  return <form className="space-y-4" onKeyDown={preventImplicitInvoiceSubmit} onSubmit={(event) => {
    event.preventDefault();
    if (pending || paymentEditIssue) return;
    startTransition(async () => {
      try {
        const result = await updateConsultationInvoiceAction(invoiceId, { amount, notes, invoice_date: invoiceDate, expected_version: version });
        if (result.ok) { toast.success("Invoice updated"); router.push(`/invoices/${invoiceId}`); }
        else toast.error(result.error);
      } catch { toast.error("Unable to save. Your entries are still here; please try again."); }
    });
  }}>
    <div className="space-y-1"><Label htmlFor={`${id}-invoice-date`}>Invoice date</Label>
      <Input id={`${id}-invoice-date`} type="date" required value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} /></div>
    <div className="space-y-1"><Label htmlFor={`${id}-amount`}>Consultation amount (₹)</Label>
      <Input id={`${id}-amount`} type="number" min={discount} max="99999999.99" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
    <div className="space-y-1"><Label htmlFor={`${id}-notes`}>Invoice remarks (optional)</Label>
      <Textarea id={`${id}-notes`} maxLength={4000} value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
    {amountReceived > 0 && <div aria-live="polite" className="space-y-1 text-sm">
      <p>Amount already received: {formatINR(amountReceived)}</p>
      <p>Balance after edit: {formatINR(Math.max(0, total - amountReceived))}</p>
      {paymentEditIssue && <p className="text-destructive">{paymentEditIssue}</p>}
    </div>}
    <div className="flex gap-2"><Button disabled={pending || !!paymentEditIssue} type="submit">{pending ? "Saving…" : "Save changes"}</Button>
      <Button type="button" variant="outline" disabled={pending} onClick={() => router.back()}>Cancel</Button></div>
  </form>;
}
