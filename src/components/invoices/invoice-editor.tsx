"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createInvoiceAndRedirect, updateInvoiceAction } from "@/actions/invoices";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatINR } from "@/lib/tz";
import { LockKeyhole, Trash2 } from "lucide-react";

export type CodedInvoiceItem = {
  treatment_id: string;
  treatment_code: string;
  description: string;
  site_label: string;
  quantity: number;
  unit_price: number;
};

export type EligibleInvoiceTreatment = {
  id: string;
  code: string;
  name: string;
  site_label: string;
  quantity: number;
  unit_price: number;
};

type EditableItem = CodedInvoiceItem & { rowKey: string };

export function InvoiceEditor({
  mode,
  invoiceId,
  initialVersion,
  primaryTreatmentId,
  leadId,
  treatmentCatalog,
  initialItems,
  initialTaxRate = 0,
  initialNotes = "",
}: {
  mode: "create" | "edit";
  invoiceId?: string;
  initialVersion?: number;
  primaryTreatmentId?: string | null;
  leadId: string;
  treatmentCatalog: EligibleInvoiceTreatment[];
  initialItems: CodedInvoiceItem[];
  initialTaxRate?: number;
  initialNotes?: string;
}) {
  const router = useRouter();
  const idPrefix = useId();
  const nextRowKey = useRef(initialItems.length);
  const [items, setItems] = useState<EditableItem[]>(() =>
    initialItems.map((item, index) => ({ ...item, rowKey: `initial-${index}` }))
  );
  const [taxRate, setTaxRate] = useState(initialTaxRate);
  const [notes, setNotes] = useState(initialNotes);
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!dirty || pending) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty, pending]);

  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const tax = Math.round(subtotal * taxRate) / 100;
  const total = subtotal + tax;
  const selectedIds = new Set(items.map((item) => item.treatment_id));
  const available = treatmentCatalog.filter((item) => !selectedIds.has(item.id));

  function updateItem(
    rowKey: string,
    patch: Partial<Pick<CodedInvoiceItem, "quantity" | "unit_price">>
  ) {
    setDirty(true);
    setItems((previous) =>
      previous.map((item) => (item.rowKey === rowKey ? { ...item, ...patch } : item))
    );
  }

  function addTreatment(id: string) {
    const treatment = treatmentCatalog.find((item) => item.id === id);
    if (!treatment || selectedIds.has(treatment.id)) return;
    const rowKey = `new-${nextRowKey.current++}`;
    setDirty(true);
    setItems((previous) => [
      ...previous,
      {
        rowKey,
        treatment_id: treatment.id,
        treatment_code: treatment.code,
        description: treatment.name,
        site_label: treatment.site_label,
        quantity: treatment.quantity,
        unit_price: treatment.unit_price,
      },
    ]);
  }

  function removeItem(rowKey: string) {
    setDirty(true);
    setItems((previous) => previous.filter((item) => item.rowKey !== rowKey));
  }

  function cancel() {
    if (dirty && !window.confirm("Discard your unsaved invoice changes?")) return;
    router.back();
  }

  function submit() {
    if (!items.length) {
      toast.error("Select at least one completed coded treatment");
      return;
    }
    const payloadItems = items.map(({ treatment_id, quantity, unit_price }) => ({
      treatment_id,
      quantity,
      unit_price,
    }));
    startTransition(async () => {
      if (mode === "create") {
        const result = await createInvoiceAndRedirect({
          lead_id: leadId,
          tax_rate: taxRate,
          notes,
          items: payloadItems,
        });
        if (result && !result.ok) toast.error(result.error);
      } else {
        const result = await updateInvoiceAction(invoiceId!, {
          tax_rate: taxRate,
          notes,
          items: payloadItems,
          expected_version: initialVersion,
        });
        if (result.ok) {
          setDirty(false);
          toast.success("Invoice updated");
          router.push(`/invoices/${invoiceId}`);
        } else {
          toast.error(result.error);
        }
      }
    });
  }

  return (
    <Card>
      <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <CardContent className="space-y-5 pt-6">
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
            <p className="flex items-center gap-2 font-medium">
              <LockKeyhole aria-hidden="true" className="size-4" />
              Coded clinical treatments only
            </p>
            <p className="mt-1 text-xs">
              Descriptions and codes come from the finalized digital case sheet and cannot be replaced with free text.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-treatment`}>Add completed treatment</Label>
            <select
              id={`${idPrefix}-treatment`}
              value=""
              onChange={(event) => event.target.value && addTreatment(event.target.value)}
              className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              disabled={available.length === 0}
            >
              <option value="">
                {available.length ? "Select a coded treatment…" : "No other eligible treatments"}
              </option>
              {available.map((treatment) => (
                <option key={treatment.id} value={treatment.id}>
                  {treatment.code} — {treatment.name} — {treatment.site_label}
                </option>
              ))}
            </select>
          </div>

          <section aria-labelledby={`${idPrefix}-items-heading`} className="space-y-3">
            <h2 id={`${idPrefix}-items-heading`} className="text-base font-semibold">
              Treatment lines
            </h2>
            {items.length === 0 && (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                There is no invoice line yet. Select a finalized completed treatment above.
              </p>
            )}
            {items.map((item, index) => {
              const quantityId = `${idPrefix}-${item.rowKey}-quantity`;
              const priceId = `${idPrefix}-${item.rowKey}-price`;
              const isPrimary = mode === "edit" && item.treatment_id === primaryTreatmentId;
              return (
                <fieldset
                  key={item.rowKey}
                  className="grid grid-cols-1 items-end gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_90px_130px_40px]"
                >
                  <legend className="sr-only">Treatment line {index + 1}</legend>
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span className="rounded border px-1.5 py-0.5 font-mono text-xs">
                        {item.treatment_code}
                      </span>
                      <span>{item.description}</span>
                      {isPrimary && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal">
                          Primary line
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{item.site_label}</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={quantityId}>Quantity</Label>
                    <Input
                      id={quantityId}
                      type="number"
                      inputMode="decimal"
                      min={0.01}
                      step={0.01}
                      value={item.quantity}
                      readOnly
                      aria-readonly="true"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={priceId}>Unit price (₹)</Label>
                    <Input
                      id={priceId}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.01}
                      value={item.unit_price}
                      onChange={(event) => updateItem(item.rowKey, { unit_price: Number(event.target.value) })}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={isPrimary}
                    onClick={() => removeItem(item.rowKey)}
                    aria-label={isPrimary
                      ? `Primary treatment ${item.treatment_code} cannot be removed`
                      : `Remove ${item.treatment_code} ${item.description}`}
                    title={isPrimary ? "The primary treatment must remain on this invoice" : undefined}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </fieldset>
              );
            })}
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-tax-rate`}>Tax rate (%)</Label>
              <Input
                id={`${idPrefix}-tax-rate`}
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step={0.01}
                value={taxRate}
                onChange={(event) => { setDirty(true); setTaxRate(Number(event.target.value)); }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-notes`}>Invoice notes</Label>
              <Textarea
                id={`${idPrefix}-notes`}
                rows={2}
                value={notes}
                onChange={(event) => { setDirty(true); setNotes(event.target.value); }}
              />
            </div>
          </div>

          <div aria-live="polite" aria-atomic="true" className="space-y-1 border-t pt-4 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatINR(subtotal)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Tax ({taxRate}%)</span>
              <span>{formatINR(tax)}</span>
            </div>
            <div className="flex justify-between gap-4 text-base font-bold">
              <span>Total</span>
              <span>{formatINR(total)}</span>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" type="button" onClick={cancel}>Cancel</Button>
            <Button type="submit" disabled={pending || items.length === 0 || subtotal <= 0}>
              {pending ? "Saving…" : mode === "create" ? "Create coded invoice" : "Save changes"}
            </Button>
          </div>
        </CardContent>
      </form>
    </Card>
  );
}
