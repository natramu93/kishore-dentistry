"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createInvoiceAndRedirect } from "@/actions/invoices";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatINR } from "@/lib/tz";
import { Plus, Trash2 } from "lucide-react";

type Item = { description: string; quantity: number; unit_price: number };

export function InvoiceEditor({
  leadId,
  treatmentId,
  initialItems,
}: {
  leadId: string;
  treatmentId: string | null;
  initialItems: Item[];
}) {
  const [items, setItems] = useState<Item[]>(initialItems);
  const [taxRate, setTaxRate] = useState(0);
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();

  const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const tax = Math.round(subtotal * taxRate) / 100;
  const total = subtotal + tax;

  function updateItem(idx: number, patch: Partial<Item>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function submit() {
    startTransition(async () => {
      const result = await createInvoiceAndRedirect({
        lead_id: leadId,
        treatment_id: treatmentId ?? "",
        tax_rate: taxRate,
        notes,
        items: items.filter((i) => i.description.trim()),
      });
      if (result && !result.ok) toast.error(result.error);
    });
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_80px_110px_32px] gap-2 text-xs font-medium text-muted-foreground">
            <span>Description</span>
            <span>Qty</span>
            <span>Unit price (₹)</span>
            <span />
          </div>
          {items.map((item, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_80px_110px_32px] gap-2 items-center">
              <Input
                value={item.description}
                onChange={(e) => updateItem(idx, { description: e.target.value })}
                placeholder="e.g. Root canal — molar"
              />
              <Input
                type="number"
                min={0.5}
                step={0.5}
                value={item.quantity}
                onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })}
              />
              <Input
                type="number"
                min={0}
                step={0.01}
                value={item.unit_price}
                onChange={(e) => updateItem(idx, { unit_price: Number(e.target.value) })}
              />
              <button
                type="button"
                onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                className="text-muted-foreground hover:text-destructive disabled:opacity-30"
                disabled={items.length === 1}
                aria-label="Remove line"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setItems((p) => [...p, { description: "", quantity: 1, unit_price: 0 }])}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add line
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="tax_rate">Tax rate (%)</Label>
            <Input
              id="tax_rate"
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={taxRate}
              onChange={(e) => setTaxRate(Number(e.target.value))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <div className="border-t pt-4 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatINR(subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tax ({taxRate}%)</span>
            <span>{formatINR(tax)}</span>
          </div>
          <div className="flex justify-between font-bold text-base">
            <span>Total</span>
            <span>{formatINR(total)}</span>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={submit} disabled={pending || subtotal <= 0}>
            {pending ? "Creating…" : "Create invoice"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
