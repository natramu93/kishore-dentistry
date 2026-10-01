"use client";

import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { recordInvoicePaymentsAction } from "@/actions/invoices";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatINR } from "@/lib/tz";
import { PAYMENT_METHODS, receivedAmountInWords } from "@/lib/invoice-receipts";

type ReceiptEntry = { key: number; amount: string; method: string; reference: string };

export function RecordPaymentForm({ invoiceId, balanceDue }: { invoiceId: string; balanceDue: number }) {
  const router = useRouter();
  const id = useId();
  const [entries, setEntries] = useState<ReceiptEntry[]>([{ key: 0, amount: balanceDue.toFixed(2), method: "", reference: "" }]);
  const nextKey = useRef(1);
  const requestKey = useRef<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const total = Math.round(entries.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0) * 100) / 100;

  function update(key: number, patch: Partial<ReceiptEntry>) {
    requestKey.current = null;
    setEntries((previous) => previous.map((entry) => entry.key === key ? { ...entry, ...patch } : entry));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saved || pending) return;
    if (entries.some((entry) => !entry.method)) {
      toast.error("Choose a payment method to record this payment");
      return;
    }
    if (entries.some((entry) => !Number.isFinite(Number(entry.amount)) || Number(entry.amount) <= 0)) {
      toast.error("Enter a payment amount greater than zero");
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
          receipts: entries.map(({ amount, method, reference }) => ({ amount, method, reference })),
        });
        if (!result.ok) toast.error(result.error);
        else {
          setSaved(true);
          toast.success("Payment recorded");
          router.refresh();
        }
      } catch {
        toast.error("Could not confirm the payment. Your entries are kept; retry to check and save this receipt.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">Outstanding: {formatINR(balanceDue)}. Add another method to split this receipt.</p>
      {entries.map((entry, index) => <fieldset key={entry.key} disabled={pending || saved} className="grid min-w-0 gap-3 rounded-md border p-3 sm:grid-cols-2">
        <legend className="px-1 text-sm font-medium">Payment {index + 1}</legend>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-${entry.key}-amount`}>Payment amount (₹)</Label>
        <Input id={`${id}-${entry.key}-amount`} type="number" inputMode="decimal" min="0.01" max={balanceDue} step="0.01" value={entry.amount} onChange={(event) => update(entry.key, { amount: event.target.value })} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-${entry.key}-method`}>Payment method</Label>
        <select id={`${id}-${entry.key}-method`} value={entry.method} onChange={(event) => update(entry.key, { method: event.target.value })} required className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm">
          <option value="" disabled>Select a method</option>
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
      <Button type="button" variant="outline" disabled={pending || saved || entries.length >= 10} onClick={() => {
        requestKey.current = null;
        setEntries((previous) => [...previous, { key: nextKey.current++, amount: Math.max(0, balanceDue - total).toFixed(2), method: "", reference: "" }]);
      }}>Add payment method</Button>
      <p className="text-sm">Receiving now: {formatINR(total)}</p>
      {Number.isFinite(total) && total >= 0 && total <= 9_999_999_999.99 && <p className="text-xs text-muted-foreground">{receivedAmountInWords(total)}</p>}
      <div>
        <Button type="submit" disabled={pending || saved}>
          {pending ? "Recording…" : saved ? "Payment recorded" : "Record payment"}
        </Button>
      </div>
    </form>
  );
}
