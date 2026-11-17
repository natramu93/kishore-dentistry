"use client";

import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { confirmInvoiceCarryForwardAction, recordInvoicePaymentsAction } from "@/actions/invoices";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clinicToday, formatINR } from "@/lib/tz";
import { PAYMENT_METHODS, receivedAmountInWords } from "@/lib/invoice-receipts";
import type { PatientInvoiceBalance } from "@/lib/patient-invoice-balance";
import { preventImplicitInvoiceSubmit } from "./invoice-form-keyboard";

type ReceiptEntry = { key: number; amount: string; method: string; reference: string };

export function RecordPaymentForm({ invoiceId, balanceDue }: { invoiceId: string; balanceDue: number }) {
  const router = useRouter();
  const id = useId();
  const [entries, setEntries] = useState<ReceiptEntry[]>([{ key: 0, amount: balanceDue.toFixed(2), method: "", reference: "" }]);
  const [receiptDate, setReceiptDate] = useState(clinicToday);
  const nextKey = useRef(1);
  const requestKey = useRef<string | null>(null);
  const [saved, setSaved] = useState<"payment" | "carry-forward" | null>(null);
  const [confirmedBalance, setConfirmedBalance] = useState<PatientInvoiceBalance | null>(null);
  const [pending, startTransition] = useTransition();
  const total = Math.round(entries.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0) * 100) / 100;
  const noPayment = entries.length === 1 && entries[0].amount.trim() !== "" && Number(entries[0].amount) === 0;

  function update(key: number, patch: Partial<ReceiptEntry>) {
    requestKey.current = null;
    setEntries((previous) => previous.map((entry) => entry.key === key ? { ...entry, ...patch } : entry));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saved || pending) return;
    if (entries.some((entry) => entry.amount.trim() === "" || !Number.isFinite(Number(entry.amount)) || Number(entry.amount) < 0)) {
      toast.error("Enter a payment amount of zero or greater");
      return;
    }
    if (noPayment) {
      if (entries[0].reference.trim()) {
        toast.error("Clear the transaction reference when no payment was received");
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
    if (entries.some((entry) => Number(entry.amount) === 0)) {
      toast.error("Remove zero-value payment rows, or choose No payment — carry forward");
      return;
    }
    if (entries.some((entry) => !entry.method)) {
      toast.error("Choose a payment method to record this payment");
      return;
    }
    if (total > balanceDue) {
      toast.error("Payment cannot exceed the outstanding balance");
      return;
    }
    startTransition(async () => {
      try {
        requestKey.current ??= crypto.randomUUID();
        const result = await recordInvoicePaymentsAction(invoiceId, {
          request_key: requestKey.current,
          receipt_date: receiptDate,
          receipts: entries.map(({ amount, method, reference }) => ({ amount, method, reference })),
        });
        if (!result.ok) toast.error(result.error);
        else {
          setSaved("payment");
          toast.success("Payment recorded");
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
      <Button type="button" variant="outline" className="w-full whitespace-normal" disabled={pending || saved !== null} onClick={() => {
        requestKey.current = null;
        setEntries([{ key: nextKey.current++, amount: "0", method: "", reference: "" }]);
      }}>No payment — carry forward</Button>
      {!noPayment && <div className="space-y-1.5">
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
        <Input id={`${id}-${entry.key}-amount`} type="number" inputMode="decimal" min="0" max={balanceDue} step="0.01" value={entry.amount} onChange={(event) => update(entry.key, { amount: event.target.value })} required />
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
      {entries.length > 1 && <Button type="button" variant="ghost" className="sm:col-span-2" onClick={() => {
        requestKey.current = null;
        setEntries((previous) => previous.filter((row) => row.key !== entry.key));
      }}>Remove payment {index + 1}</Button>}
      </fieldset>)}
      <Button type="button" variant="outline" disabled={pending || saved !== null || noPayment || entries.length >= 10} onClick={() => {
        requestKey.current = null;
        setEntries((previous) => [...previous, { key: nextKey.current++, amount: Math.max(0, balanceDue - total).toFixed(2), method: "", reference: "" }]);
      }}>Add payment method</Button>
      <p className="text-sm">Receiving now: {formatINR(total)}</p>
      {Number.isFinite(total) && total >= 0 && total <= 9_999_999_999.99 && <p className="text-xs text-muted-foreground">{receivedAmountInWords(total)}</p>}
      {noPayment && saved !== "carry-forward" && <p className="text-sm text-muted-foreground">No receipt will be created. This invoice’s unpaid balance and all earlier dues remain outstanding.</p>}
      {saved === "carry-forward" && confirmedBalance && <div role="status" className="space-y-1 rounded-md border p-3 text-sm">
        <p>No payment received now. No charges or previous payments were changed.</p>
        <p>This invoice due: {formatINR(confirmedBalance.invoice_due)}</p>
        <p className="font-semibold">Overall patient due: {formatINR(confirmedBalance.overall_due)}</p>
        <Button type="button" variant="outline" className="mt-2" disabled={pending} onClick={() => {
          setSaved(null);
          setConfirmedBalance(null);
          requestKey.current = null;
          setEntries([{ key: nextKey.current++, amount: confirmedBalance.invoice_due.toFixed(2), method: "", reference: "" }]);
        }}>Record a payment</Button>
      </div>}
      <div>
        <Button type="submit" className="h-auto min-h-11 max-w-full whitespace-normal py-2" disabled={pending || saved !== null}>
          {pending ? noPayment ? "Confirming…" : "Recording…" : saved === "carry-forward" ? "Balance carried forward" : saved === "payment" ? "Payment recorded" : noPayment ? "Confirm ₹0 received / carry forward" : "Record payment"}
        </Button>
      </div>
    </form>
  );
}
