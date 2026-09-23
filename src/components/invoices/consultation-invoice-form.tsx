"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { createConsultationInvoiceAndRedirect } from "@/actions/invoices";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ConsultationInvoiceForm({ leadId }: { leadId: string }) {
  const id = useId();
  const [amount, setAmount] = useState("200");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await createConsultationInvoiceAndRedirect({
        lead_id: leadId,
        amount,
        notes,
      });
      if (result && !result.ok) toast.error(result.error);
    });
  }

  return (
    <Card className="border-blue-200 bg-blue-50/40 dark:border-blue-900 dark:bg-blue-950/20">
      <CardHeader>
        <CardTitle className="text-base">Ad-hoc consultation invoice</CardTitle>
        <p className="text-sm text-muted-foreground">
          Collect the consultation fee at reception without linking it to a treatment or case sheet.
        </p>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-amount`}>Amount (₹)</Label>
            <Input
              id={`${id}-amount`}
              type="number"
              inputMode="decimal"
              min={0.01}
              max={99999999.99}
              step={0.01}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-notes`}>Notes (optional)</Label>
            <Textarea
              id={`${id}-notes`}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={4000}
              rows={2}
              placeholder="e.g. Walk-in consultation"
            />
          </div>
          <Button type="submit" disabled={pending} className="sm:mb-0.5">
            {pending ? "Creating…" : "Create consultation invoice"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
