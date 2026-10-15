"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateConsultationInvoiceAction } from "@/actions/invoices";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ConsultationInvoiceEditor({ invoiceId, version, initialAmount, initialNotes }: {
  invoiceId: string; version: number; initialAmount: number; initialNotes: string;
}) {
  const id = useId();
  const router = useRouter();
  const [amount, setAmount] = useState(String(initialAmount));
  const [notes, setNotes] = useState(initialNotes);
  const [pending, startTransition] = useTransition();
  return <form className="space-y-4" onSubmit={(event) => {
    event.preventDefault();
    startTransition(async () => {
      try {
        const result = await updateConsultationInvoiceAction(invoiceId, { amount, notes, expected_version: version });
        if (result.ok) { toast.success("Invoice updated"); router.push(`/invoices/${invoiceId}`); }
        else toast.error(result.error);
      } catch { toast.error("Unable to save. Your entries are still here; please try again."); }
    });
  }}>
    <div className="space-y-1"><Label htmlFor={`${id}-amount`}>Consultation amount (₹)</Label>
      <Input id={`${id}-amount`} type="number" min="0" max="99999999.99" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
    <div className="space-y-1"><Label htmlFor={`${id}-notes`}>Invoice remarks (optional)</Label>
      <Textarea id={`${id}-notes`} maxLength={4000} value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
    <div className="flex gap-2"><Button disabled={pending} type="submit">{pending ? "Saving…" : "Save changes"}</Button>
      <Button type="button" variant="outline" disabled={pending} onClick={() => router.back()}>Cancel</Button></div>
  </form>;
}
