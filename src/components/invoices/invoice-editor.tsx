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
import { Plus, Trash2 } from "lucide-react";

type Item = { description: string; quantity: number; unit_price: number };
type EditableItem = Item & { rowKey: string };
type CatalogItem = { id: string; name: string; default_cost: number | null };

export function InvoiceEditor({
  mode,
  invoiceId,
  initialVersion,
  leadId,
  treatmentId,
  treatmentCatalog,
  initialItems,
  initialTaxRate = 0,
  initialNotes = "",
}: {
  mode: "create" | "edit";
  invoiceId?: string;
  initialVersion?: number;
  leadId: string;
  treatmentId?: string | null;
  treatmentCatalog: CatalogItem[];
  initialItems: Item[];
  initialTaxRate?: number;
  initialNotes?: string;
}) {
  const router = useRouter();
  const idPrefix = useId();
  const nextRowKey = useRef(initialItems.length);
  const [items, setItems] = useState<EditableItem[]>(() =>
    initialItems.map((item, index) => ({ ...item, rowKey: `initial-${index}` })),
  );
  const [taxRate, setTaxRate] = useState(initialTaxRate);
  const [notes, setNotes] = useState(initialNotes);
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!dirty || pending) return;

    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };

    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty, pending]);

  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const tax = Math.round(subtotal * taxRate) / 100;
  const total = subtotal + tax;

  function makeBlankItem(item: Item): EditableItem {
    const rowKey = `new-${nextRowKey.current}`;
    nextRowKey.current += 1;
    return { ...item, rowKey };
  }

  function updateItem(rowKey: string, patch: Partial<Item>) {
    setDirty(true);
    setItems((previous) =>
      previous.map((item) => (item.rowKey === rowKey ? { ...item, ...patch } : item)),
    );
  }

  function addFromCatalog(catalogId: string) {
    const treatment = treatmentCatalog.find((item) => item.id === catalogId);
    if (!treatment) return;
    setDirty(true);
    setItems((previous) => [
      ...previous,
      makeBlankItem({
        description: treatment.name,
        quantity: 1,
        unit_price: treatment.default_cost ?? 0,
      }),
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
    const cleanItems = items
      .filter((item) => item.description.trim())
      .map(({ description, quantity, unit_price }) => ({ description, quantity, unit_price }));

    if (!cleanItems.length) {
      toast.error("Add at least one line item");
      return;
    }

    startTransition(async () => {
      if (mode === "create") {
        const result = await createInvoiceAndRedirect({
          lead_id: leadId,
          treatment_id: treatmentId ?? "",
          tax_rate: taxRate,
          notes,
          items: cleanItems,
        });
        if (result && !result.ok) toast.error(result.error);
      } else {
        const result = await updateInvoiceAction(invoiceId!, {
          tax_rate: taxRate,
          notes,
          items: cleanItems,
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
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <CardContent className="space-y-5 pt-6">
          {treatmentCatalog.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-catalog`}>Add from treatment catalog</Label>
              <select
                id={`${idPrefix}-catalog`}
                value=""
                onChange={(event) => {
                  if (event.target.value) addFromCatalog(event.target.value);
                }}
                className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">Select a treatment to add a priced line…</option>
                {treatmentCatalog.map((treatment) => (
                  <option key={treatment.id} value={treatment.id}>
                    {treatment.name}
                    {treatment.default_cost != null
                      ? ` — ${formatINR(treatment.default_cost)}`
                      : ""}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Prices auto-fill from the catalog and remain editable per line.
              </p>
            </div>
          )}

          <section aria-labelledby={`${idPrefix}-items-heading`} className="space-y-3">
            <h2 id={`${idPrefix}-items-heading`} className="text-base font-semibold">
              Line items
            </h2>
            <div
              aria-hidden="true"
              className="hidden grid-cols-[minmax(0,1fr)_90px_130px_40px] gap-2 text-xs font-medium text-muted-foreground sm:grid"
            >
              <span>Description</span>
              <span>Quantity</span>
              <span>Unit price (₹)</span>
              <span />
            </div>
            {items.map((item, index) => {
              const descriptionId = `${idPrefix}-${item.rowKey}-description`;
              const quantityId = `${idPrefix}-${item.rowKey}-quantity`;
              const priceId = `${idPrefix}-${item.rowKey}-price`;

              return (
                <fieldset
                  key={item.rowKey}
                  className="grid grid-cols-1 items-end gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_90px_130px_40px] sm:border-0 sm:p-0"
                >
                  <legend className="sr-only">Line item {index + 1}</legend>
                  <div className="space-y-1.5">
                    <Label className="sm:sr-only" htmlFor={descriptionId}>
                      Description
                    </Label>
                    <Input
                      id={descriptionId}
                      value={item.description}
                      onChange={(event) =>
                        updateItem(item.rowKey, { description: event.target.value })
                      }
                      placeholder="e.g. Root canal — molar"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="sm:sr-only" htmlFor={quantityId}>
                      Quantity
                    </Label>
                    <Input
                      id={quantityId}
                      type="number"
                      inputMode="decimal"
                      min={0.5}
                      step={0.5}
                      value={item.quantity}
                      onChange={(event) =>
                        updateItem(item.rowKey, { quantity: Number(event.target.value) })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="sm:sr-only" htmlFor={priceId}>
                      Unit price in rupees
                    </Label>
                    <Input
                      id={priceId}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.01}
                      value={item.unit_price}
                      onChange={(event) =>
                        updateItem(item.rowKey, { unit_price: Number(event.target.value) })
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeItem(item.rowKey)}
                    disabled={items.length === 1}
                    aria-label={`Remove line item ${index + 1}${
                      item.description ? `: ${item.description}` : ""
                    }`}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </fieldset>
              );
            })}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setDirty(true);
                setItems((previous) => [
                  ...previous,
                  makeBlankItem({ description: "", quantity: 1, unit_price: 0 }),
                ]);
              }}
            >
              <Plus aria-hidden="true" />
              Add blank line
            </Button>
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
                onChange={(event) => {
                  setDirty(true);
                  setTaxRate(Number(event.target.value));
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-notes`}>Notes</Label>
              <Textarea
                id={`${idPrefix}-notes`}
                rows={2}
                value={notes}
                onChange={(event) => {
                  setDirty(true);
                  setNotes(event.target.value);
                }}
              />
            </div>
          </div>

          <div
            aria-live="polite"
            aria-atomic="true"
            className="space-y-1 border-t pt-4 text-sm"
          >
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
            <Button variant="ghost" type="button" onClick={cancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || subtotal <= 0}>
              {pending ? "Saving…" : mode === "create" ? "Create invoice" : "Save changes"}
            </Button>
          </div>
        </CardContent>
      </form>
    </Card>
  );
}
