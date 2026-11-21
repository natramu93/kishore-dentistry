"use client";

import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { confirmInvoiceCarryForwardAction, recordInvoicePaymentsAction } from "@/actions/invoices";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { clinicToday, formatINR } from "@/lib/tz";
import { PAYMENT_METHODS, receivedAmountInWords } from "@/lib/invoice-receipts";
import type { PatientInvoiceBalance } from "@/lib/patient-invoice-balance";
import { preventImplicitInvoiceSubmit } from "./invoice-form-keyboard";

type ReceiptEntry = { key: number; amount: string; method: string; reference: string; notes: string };

export function RecordPaymentForm({ invoiceId, balanceDue, invoiceVersion, taxRate = 0, availableDiscount = 0 }: {
  invoiceId: string; balanceDue: number; invoiceVersion?: number; taxRate?: number; availableDiscount?: number;
}) {
  const router = useRouter();
  const id = useId();
  const [entries, setEntries] = useState<ReceiptEntry[]>([{ key: 0, amount: balanceDue.toFixed(2), method: "", reference: "", notes: "" }]);
  const [receiptDate, setReceiptDate] = useState(clinicToday);
  const [discount, setDiscount] = useState("");
  const [givenBy, setGivenBy] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const nextKey = useRef(1);
  const requestKey = useRef<string | null>(null);
  const [saved, setSaved] = useState<"payment" | "carry-forward" | null>(null);
  const [confirmedBalance, setConfirmedBalance] = useState<PatientInvoiceBalance | null>(null);
  const [pending, startTransition] = useTransition();
  const total = Math.round(entries.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0) * 100) / 100;
  const noPayment = entries.length === 1 && entries[0].amount.trim() !== "" && Number(entries[0].amount) === 0;
  const discountAmount = Number(discount) || 0;
  const hasDiscount = discountAmount > 0;
  const dueAfterDiscount = (amount: number) => Math.round((balanceDue - amount
    - (Math.round(availableDiscount * taxRate) - Math.round((availableDiscount - amount) * taxRate)) / 100) * 100) / 100;
  const adjustedDue = dueAfterDiscount(discountAmount);

  function updateDiscount(value: string) {
    requestKey.current = null;
    const next = Number(value) || 0;
    const nextDue = Math.max(0, dueAfterDiscount(next));
    setEntries((rows) => rows.length === 1 && Number(rows[0].amount) === adjustedDue ? [{ ...rows[0], amount: nextDue.toFixed(2) }] : rows);
    setDiscount(value);
  }

  function update(key: number, patch: Partial<ReceiptEntry>) {
    requestKey.current = null;
    setEntries((previous) => previous.map((entry) => entry.key === key ? { ...entry, ...patch } : entry));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saved || pending) return;
    if (discount.trim() && (!Number.isFinite(Number(discount)) || Number(discount) < 0
      || Math.abs(Number(discount) * 100 - Math.round(Number(discount) * 100)) > 1e-6)) {
      toast.error("Enter a valid discount with at most two decimals");
      return;
    }
    if (hasDiscount && (!invoiceVersion || discountAmount > availableDiscount || adjustedDue < 0 || !givenBy.trim() || !discountReason.trim())) {
      toast.error("Check the discount amount, approver and reason. The total cannot fall below payments already received.");
      return;
    }
    if (entries.some((entry) => entry.amount.trim() === "" || !Number.isFinite(Number(entry.amount)) || Number(entry.amount) < 0)) {
      toast.error("Enter a payment amount of zero or greater");
      return;
    }
    if (noPayment && hasDiscount && (entries[0].reference.trim() || entries[0].notes.trim())) {
      toast.error("Clear the receipt reference and remarks when no payment was received. The discount has its own reason.");
      return;
    }
    if (noPayment && !hasDiscount) {
      if (entries[0].reference.trim()) {
        toast.error("Clear the transaction reference when no payment was received");
        return;
      }
      if (entries[0].notes.trim()) {
        toast.error("Clear the receipt remarks when no payment was received. No receipt will be created.");
        return;
      }
      startTransition(async () => {
        try {
          const result = await confirmInvoiceCarryForwardAction(invoiceId);
          if (!result.ok) toast.error(result.error);
          else {
            setConfirmedBalance(result.balance);
            setSaved("carry-forward");
            toast.success("No payment received. Unpaid balance carried forward.");
            router.refresh();
          }
        } catch {
          toast.error("Could not confirm the outstanding balance. No payment was recorded; please try again.");
        }
      });
      return;
    }
    if (!noPayment && entries.some((entry) => Number(entry.amount) === 0)) {
      toast.error("Remove zero-value payment rows, or choose No payment — carry forward");
      return;
    }
    if (!noPayment && entries.some((entry) => !entry.method)) {
      toast.error("Choose a payment method to record this payment");
      return;
    }
    if (total > adjustedDue) {
      toast.error("Payment cannot exceed the outstanding balance");
      return;
    }
    startTransition(async () => {
      try {
        requestKey.current ??= crypto.randomUUID();
        const result = await recordInvoicePaymentsAction(invoiceId, {
          request_key: requestKey.current,
          receipt_date: receiptDate,
          receipts: noPayment ? [] : entries.map(({ amount, method, reference, notes }) => ({ amount, method, reference, ...(notes.trim() ? { notes: notes.trim() } : {}) })),
          ...(hasDiscount ? { discount: { amount: discountAmount, given_by: givenBy.trim(), reason: discountReason.trim(), expected_version: invoiceVersion } } : {}),
        });
        if (!result.ok) toast.error(result.error);
        else {
          setSaved("payment");
          toast.success(hasDiscount ? "Discount and payment details saved" : "Payment recorded");
          router.refresh();
        }
      } catch {
        toast.error("Could not confirm the payment. Your entries are kept; retry to check and save this receipt.");
      }
    });
  }

  return (
    <form onKeyDown={preventImplicitInvoiceSubmit} onSubmit={submit} className="space-y-3 rounded-md border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">Outstanding: {formatINR(balanceDue)}. Split a receipt across methods, or enter ₹0 to carry the full unpaid balance forward.</p>
      {invoiceVersion && availableDiscount > 0 && <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">Discount at payment (optional)</summary>
        <fieldset disabled={pending || saved !== null} className="mt-3 space-y-3">
          <div className="space-y-1.5"><Label htmlFor={`${id}-discount`}>Additional discount before tax (₹)</Label>
            <Input id={`${id}-discount`} type="number" inputMode="decimal" min="0" max={availableDiscount} step="0.01" value={discount} onChange={(event) => updateDiscount(event.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor={`${id}-discount-by`}>Discount approved by</Label>
            <Input id={`${id}-discount-by`} required={hasDiscount} maxLength={200} value={givenBy} onChange={(event) => { requestKey.current = null; setGivenBy(event.target.value); }} /></div>
          <div className="space-y-1.5"><Label htmlFor={`${id}-discount-reason`}>Discount reason</Label>
            <Textarea id={`${id}-discount-reason`} required={hasDiscount} maxLength={1000} value={discountReason} onChange={(event) => { requestKey.current = null; setDiscountReason(event.target.value); }} /></div>
          <p className="text-sm" role="status">Outstanding after discount: {formatINR(Math.max(0, adjustedDue))}</p>
        </fieldset>
      </details>}
      <Button type="button" variant="outline" className="w-full whitespace-normal" disabled={pending || saved !== null} onClick={() => {
        requestKey.current = null;
        setEntries([{ key: nextKey.current++, amount: "0", method: "", reference: "", notes: "" }]);
      }}>No payment — carry forward</Button>
      {(!noPayment || hasDiscount) && <div className="space-y-1.5">
        <Label htmlFor={`${id}-receipt-date`}>Receipt date</Label>
        <Input id={`${id}-receipt-date`} type="date" required min="0001-01-01" max={clinicToday()}
          disabled={pending || saved !== null} value={receiptDate} onChange={(event) => {
            requestKey.current = null;
            setReceiptDate(event.target.value);
          }} />
        {entries.length > 1 && <p className="text-xs text-muted-foreground">This date applies to all payment methods below.</p>}
      </div>}
      {entries.map((entry, index) => <fieldset key={entry.key} disabled={pending || saved !== null} className="grid min-w-0 gap-3 rounded-md border p-3 sm:grid-cols-2">
        <legend className="px-1 text-sm font-medium">Payment {index + 1}</legend>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-${entry.key}-amount`}>Payment amount (₹)</Label>
        <Input id={`${id}-${entry.key}-amount`} type="number" inputMode="decimal" min="0" max={Math.max(0, adjustedDue)} step="0.01" value={entry.amount} onChange={(event) => update(entry.key, { amount: event.target.value })} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-${entry.key}-method`}>Payment method</Label>
        <select id={`${id}-${entry.key}-method`} value={entry.method} onChange={(event) => update(entry.key, { method: event.target.value })} required={!noPayment} disabled={noPayment} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50">
          <option value="" disabled>{noPayment ? "No payment method needed" : "Select a method"}</option>
          {PAYMENT_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
        </select>
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${id}-${entry.key}-reference`}>Transaction / receipt reference (optional)</Label>
        <Input id={`${id}-${entry.key}-reference`} value={entry.reference} onChange={(event) => update(entry.key, { reference: event.target.value })} maxLength={120} placeholder="UPI transaction ID, card slip, NEFT UTR, etc." />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${id}-${entry.key}-remarks`}>Remarks (optional)</Label>
        <Textarea id={`${id}-${entry.key}-remarks`} value={entry.notes} rows={2} maxLength={1000}
          onChange={(event) => update(entry.key, { notes: event.target.value })}
          placeholder="Remarks for this payment receipt" />
      </div>
      {entries.length > 1 && <Button type="button" variant="ghost" className="sm:col-span-2" onClick={() => {
        requestKey.current = null;
        setEntries((previous) => previous.filter((row) => row.key !== entry.key));
      }}>Remove payment {index + 1}</Button>}
      </fieldset>)}
      <Button type="button" variant="outline" disabled={pending || saved !== null || noPayment || entries.length >= 10} onClick={() => {
        requestKey.current = null;
        setEntries((previous) => [...previous, { key: nextKey.current++, amount: Math.max(0, adjustedDue - total).toFixed(2), method: "", reference: "", notes: "" }]);
      }}>Add payment method</Button>
      <p className="text-sm">Receiving now: {formatINR(total)}</p>
      {Number.isFinite(total) && total >= 0 && total <= 9_999_999_999.99 && <p className="text-xs text-muted-foreground">{receivedAmountInWords(total)}</p>}
      {noPayment && saved !== "carry-forward" && <p className="text-sm text-muted-foreground">No receipt will be created. {hasDiscount ? "Only the discount is saved; the remaining balance stays outstanding." : "This invoice’s unpaid balance and all earlier dues remain outstanding."}</p>}
      {saved === "carry-forward" && confirmedBalance && <div role="status" className="space-y-1 rounded-md border p-3 text-sm">
        <p>No payment received now. No charges or previous payments were changed.</p>
        <p>This invoice due: {formatINR(confirmedBalance.invoice_due)}</p>
        <p className="font-semibold">Overall patient due: {formatINR(confirmedBalance.overall_due)}</p>
        <Button type="button" variant="outline" className="mt-2" disabled={pending} onClick={() => {
          setSaved(null);
          setConfirmedBalance(null);
          requestKey.current = null;
          setEntries([{ key: nextKey.current++, amount: confirmedBalance.invoice_due.toFixed(2), method: "", reference: "", notes: "" }]);
        }}>Record a payment</Button>
      </div>}
      <div>
        <Button type="submit" className="h-auto min-h-11 max-w-full whitespace-normal py-2" disabled={pending || saved !== null}>
          {pending ? noPayment ? "Confirming…" : "Recording…" : saved === "carry-forward" ? "Balance carried forward" : saved === "payment" ? "Payment details saved" : hasDiscount ? "Save discount and payment" : noPayment ? "Confirm ₹0 received / carry forward" : "Record payment"}
        </Button>
      </div>
    </form>
  );
}
