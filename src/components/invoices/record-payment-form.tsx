"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { recordInvoicePaymentAction } from "@/actions/invoices";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatINR } from "@/lib/tz";

export function RecordPaymentForm({ invoiceId, balanceDue }: { invoiceId: string; balanceDue: number }) {
  const router = useRouter();
  const id = useId();
  const [amount, setAmount] = useState(String(balanceDue.toFixed(2)));
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await recordInvoicePaymentAction(invoiceId, { amount, method, reference });
      if (!result.ok) toast.error(result.error);
      else {
        toast.success("Payment recorded");
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-amount`}>Payment amount (₹)</Label>
        <Input id={`${id}-amount`} type="number" inputMode="decimal" min="0.01" max={balanceDue} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required />
        <p className="text-xs text-muted-foreground">Outstanding: {formatINR(balanceDue)}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-method`}>Payment method</Label>
        <select id={`${id}-method`} value={method} onChange={(event) => setMethod(event.target.value)} required className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm">
          <option value="" disabled>Select a method</option>
          <option value="upi">UPI</option>
          <option value="cash">Cash</option>
          <option value="card">Card</option>
          <option value="neft">NEFT</option>
        </select>
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${id}-reference`}>Transaction / receipt reference (optional)</Label>
        <Input id={`${id}-reference`} value={reference} onChange={(event) => setReference(event.target.value)} maxLength={120} placeholder="UPI transaction ID, card slip, NEFT UTR, etc." />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending || !method || !Number.isFinite(Number(amount)) || Number(amount) <= 0 || Number(amount) > balanceDue}>
          {pending ? "Recording…" : "Record payment"}
        </Button>
      </div>
    </form>
  );
}
