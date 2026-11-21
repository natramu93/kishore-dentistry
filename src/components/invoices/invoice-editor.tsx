"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createInvoiceAction, updateInvoiceAction } from "@/actions/invoices";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToothSelector } from "@/components/clinical/tooth-selector";
import { SuggestionInput } from "@/components/ui/suggestion-input";
import { invoiceDisplayTotals, invoiceLineAmount } from "@/lib/invoice-lines";
import { invoicePaymentEditIssue } from "@/lib/invoice-policy";
import { TreatmentSearch } from "@/components/invoices/treatment-search";
import { preventImplicitInvoiceSubmit } from "./invoice-form-keyboard";
import { clinicToday, formatINR } from "@/lib/tz";
import { LockKeyhole, Pencil, Plus, Trash2 } from "lucide-react";

export type CodedInvoiceItem = {
  invoice_item_id?: string;
  treatment_id?: string | null;
  treatment_type_id?: string | null;
  treatment_code?: string | null;
  description: string;
  site_label: string;
  quantity: number;
  unit_price: number;
  tooth_numbers?: string[];
  line_note?: string;
};

export type EligibleInvoiceTreatment = {
  id: string;
  code: string;
  name: string;
  site_label: string;
  quantity: number;
  unit_price: number;
};

export type InvoiceCatalogTreatment = {
  id: string;
  name: string;
  category: string | null;
  default_cost: number | null;
  is_general_consultation: boolean;
};

type EditableItem = CodedInvoiceItem & { rowKey: string };
type LineDraft = Omit<CodedInvoiceItem, "quantity" | "unit_price"> & { quantity: string; unit_price: string };
const emptyDraft = (): LineDraft => ({ description: "", site_label: "", quantity: "1", unit_price: "0" });
const MAX_LINES = 100;

function lineSite(item: CodedInvoiceItem | LineDraft) {
  return item.tooth_numbers?.length && !item.treatment_id
    ? `Teeth ${item.tooth_numbers.join(", ")}`
    : item.site_label || "General / not tooth-specific";
}

function validLineNumber(value: number, min: number, max: number) {
  const scaled = value * 100;
  return Number.isFinite(value) && value >= min && value <= max && Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

export function InvoiceEditor({
  mode,
  invoiceId,
  initialVersion,
  primaryTreatmentId,
  leadId,
  treatmentCatalog,
  treatmentOptions,
  initialItems,
  initialTaxRate = 0,
  initialNotes = "",
  initialDiscount = 0,
  initialDiscountGivenBy = "",
  initialMention = "",
  doctorNames = [],
  initialInvoiceDate,
  existingBalanceDue,
  amountReceived = 0,
  legacyPaidTotal,
}: {
  mode: "create" | "edit";
  invoiceId?: string;
  initialVersion?: number;
  primaryTreatmentId?: string | null;
  leadId: string;
  treatmentCatalog: EligibleInvoiceTreatment[];
  treatmentOptions: InvoiceCatalogTreatment[];
  initialItems: CodedInvoiceItem[];
  initialTaxRate?: number;
  initialNotes?: string;
  initialDiscount?: number;
  initialDiscountGivenBy?: string;
  initialMention?: string;
  doctorNames?: string[];
  initialInvoiceDate?: string;
  existingBalanceDue?: number;
  amountReceived?: number;
  legacyPaidTotal?: number;
}) {
  const router = useRouter();
  const idPrefix = useId();
  const nextRowKey = useRef(initialItems.length);
  const focusEntry = useRef(false);
  const entryRef = useRef<HTMLFieldSetElement>(null);
  const [items, setItems] = useState<EditableItem[]>(() =>
    initialItems.map((item, index) => ({ ...item, rowKey: `initial-${index}` }))
  );
  const [draft, setDraft] = useState<LineDraft>(emptyDraft);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [entryVersion, setEntryVersion] = useState(0);
  const [searchEdited, setSearchEdited] = useState(false);
  const [lineError, setLineError] = useState("");
  const [lineFeedback, setLineFeedback] = useState("");
  const [taxRate, setTaxRate] = useState(initialTaxRate);
  const [notes, setNotes] = useState(initialNotes);
  const [discount, setDiscount] = useState(initialDiscount);
  const [discountGivenBy, setDiscountGivenBy] = useState(initialDiscountGivenBy);
  const [mention, setMention] = useState(initialMention);
  const [invoiceDate, setInvoiceDate] = useState(() => initialInvoiceDate ?? clinicToday());
  const [consultingDoctor, setConsultingDoctor] = useState("");
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!focusEntry.current) return;
    focusEntry.current = false;
    entryRef.current?.querySelector<HTMLInputElement>('input[role="combobox"], input[type="number"]:not([readonly])')?.focus();
  }, [entryVersion]);

  useEffect(() => {
    if (!dirty || pending) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty, pending]);

  const { subtotal, safeDiscount, tax: discountedTax, total } = invoiceDisplayTotals(items, taxRate, discount);
  const paymentEditIssue = mode === "edit" ? invoicePaymentEditIssue(total, amountReceived, legacyPaidTotal) : undefined;
  const available = useMemo(() => {
    const selectedIds = new Set(items.map((item) => item.treatment_id));
    return mode === "edit" ? treatmentCatalog.filter((item) => !selectedIds.has(item.id)) : [];
  }, [items, mode, treatmentCatalog]);
  const catalogOptions = useMemo(() => treatmentOptions.map((option) => ({
    value: `catalog:${option.id}`,
    label: `${option.is_general_consultation ? "General consultation" : option.name}${option.category ? ` — ${option.category}` : ""}`,
    searchText: `${option.name} ${option.category ?? ""} ${option.is_general_consultation ? "general consultation" : ""}`,
  })), [treatmentOptions]);
  const searchOptions = useMemo(() => [
    ...catalogOptions,
    ...available.map((item) => ({ value: `case:${item.id}`, label: `${item.code} — ${item.name} — ${item.site_label}` })),
  ], [catalogOptions, available]);
  const existingEdit = items.find((item) => item.rowKey === editingKey);
  const linkedEdit = Boolean(existingEdit?.treatment_id);
  const draftSelection = draft.treatment_id ? `case:${draft.treatment_id}` : draft.treatment_type_id ? `catalog:${draft.treatment_type_id}` : "";
  const hasDraft = Boolean(editingKey || draftSelection || searchEdited || draft.line_note?.trim() || draft.tooth_numbers?.length || draft.quantity !== "1" || draft.unit_price !== "0");

  function patchDraft(patch: Partial<LineDraft>) {
    setDirty(true);
    setLineError("");
    setDraft((current) => ({ ...current, ...patch }));
  }

  function resetEntry() {
    setDraft(emptyDraft());
    setEditingKey(null);
    setSearchEdited(false);
    setLineError("");
    focusEntry.current = true;
    setEntryVersion((version) => version + 1);
  }

  function selectTreatment(value: string) {
    setSearchEdited(false);
    if (value.startsWith("case:")) {
      const item = available.find((item) => item.id === value.slice(5));
      if (!item) return;
      patchDraft({
        treatment_id: item.id, treatment_type_id: null, treatment_code: item.code,
        description: item.name, site_label: item.site_label, tooth_numbers: [],
        quantity: String(item.quantity), unit_price: String(item.unit_price),
      });
      return;
    }
    const item = treatmentOptions.find((item) => `catalog:${item.id}` === value);
    patchDraft({
      treatment_id: null, treatment_code: null, treatment_type_id: item?.id ?? null,
      description: item?.name ?? "", site_label: "",
      quantity: draft.treatment_id ? "1" : draft.quantity,
      unit_price: String(item?.default_cost ?? 0),
    });
  }

  function commitLine() {
    if (pending) return;
    if (!draftSelection || searchEdited) {
      setLineError("Choose a treatment from the search results before adding the line.");
      return;
    }
    if (!editingKey && items.length >= MAX_LINES) {
      setLineError(`An invoice can contain at most ${MAX_LINES} lines.`);
      return;
    }
    const quantity = Number(draft.quantity);
    const price = Number(draft.unit_price);
    if (!validLineNumber(quantity, 0.01, 100_000)) {
      setLineError("Enter a quantity from 0.01 to 100,000, with at most two decimals.");
      return;
    }
    if (draft.unit_price === "" || !validLineNumber(price, 0, 99_999_999.99)) {
      setLineError("Enter a valid unit price with at most two decimals. Use 0 for a no-charge treatment.");
      return;
    }
    const line: EditableItem = {
      ...draft, quantity, unit_price: price, line_note: draft.line_note?.trim(),
      rowKey: editingKey ?? `new-${nextRowKey.current++}`,
    };
    setDirty(true);
    setItems((previous) => editingKey
      ? previous.map((item) => item.rowKey === editingKey ? line : item)
      : [...previous, line]);
    setLineFeedback(`${line.description} ${editingKey ? "updated" : "added"}.`);
    resetEntry();
  }

  function editLine(item: EditableItem) {
    if (editingKey === item.rowKey) {
      entryRef.current?.querySelector<HTMLInputElement>('input[role="combobox"], input[type="number"]:not([readonly])')?.focus();
      return;
    }
    if (hasDraft) {
      setLineError("Add, update, or clear the current entry before editing another line.");
      entryRef.current?.scrollIntoView?.({ block: "nearest" });
      return;
    }
    setEditingKey(item.rowKey);
    setDraft({ ...item, quantity: String(item.quantity), unit_price: String(item.unit_price) });
    setLineError("");
    focusEntry.current = true;
    setEntryVersion((version) => version + 1);
  }

  function removeItem(rowKey: string) {
    setDirty(true);
    setItems((previous) => previous.filter((item) => item.rowKey !== rowKey));
    if (editingKey === rowKey) resetEntry();
  }

  function cancel() {
    if (dirty && !window.confirm("Discard your unsaved invoice changes?")) return;
    router.back();
  }

  function submit() {
    if (pending) return;
    if (hasDraft) {
      setLineError(editingKey ? "Click Update line or cancel the line edit before saving the invoice." : "Click Add treatment or clear the entry before saving the invoice.");
      entryRef.current?.scrollIntoView?.({ block: "nearest" });
      return;
    }
    if (mode === "create" && !consultingDoctor.trim()) {
      toast.error("Enter the consulting doctor.");
      return;
    }
    if (!items.length) {
      toast.error("Add at least one treatment line");
      return;
    }
    if (items.some((item) => !item.treatment_id && !item.treatment_type_id)) {
      toast.error("Choose a treatment from the dropdown for every added invoice line");
      return;
    }
    if (items.some((item) => !Number.isFinite(item.quantity) || item.quantity <= 0)) {
      toast.error("Enter a quantity greater than zero for every invoice line");
      return;
    }
    if (items.some((item) => !Number.isFinite(item.unit_price) || item.unit_price < 0)) {
      toast.error("Enter a valid unit price for every invoice line");
      return;
    }
    if (!Number.isFinite(discount) || discount < 0 || discount > subtotal) {
      toast.error("Discount must be between zero and the invoice subtotal");
      return;
    }
    if (paymentEditIssue) {
      toast.error(paymentEditIssue);
      return;
    }
    const payloadItems = items.map(({ invoice_item_id, treatment_id, treatment_type_id, quantity, unit_price, tooth_numbers, line_note }) => ({
      ...(invoice_item_id ? { invoice_item_id } : {}),
      ...(treatment_id ? { treatment_id } : { treatment_type_id }),
      quantity,
      unit_price,
      ...(!treatment_id && tooth_numbers?.length ? { tooth_numbers } : {}),
      ...(line_note?.trim() ? { line_note: line_note.trim() } : {}),
    }));
    startTransition(async () => {
      try {
      if (mode === "create") {
        const result = await createInvoiceAction({
          lead_id: leadId,
          invoice_date: invoiceDate,
          consulting_doctor_name: consultingDoctor,
          tax_rate: taxRate,
          discount_amount: safeDiscount,
          discount_given_by: discountGivenBy,
          mention,
          notes,
          items: payloadItems,
        });
        if (result.ok && result.id) {
          setDirty(false);
          router.push(`/invoices/${result.id}`);
        } else if (!result.ok) toast.error(result.error);
      } else {
        const result = await updateInvoiceAction(invoiceId!, {
          invoice_date: invoiceDate,
          tax_rate: taxRate,
          discount_amount: safeDiscount,
          discount_given_by: discountGivenBy,
          mention,
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
      } catch {
        toast.error("The invoice could not be saved. Your entries are still here; please try again.");
      }
    });
  }

  return (
    <Card>
      <form onKeyDown={preventImplicitInvoiceSubmit} onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <CardContent className="space-y-5 pt-6">
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
            <p className="flex items-center gap-2 font-medium">
              <LockKeyhole aria-hidden="true" className="size-4" />
              Patient invoice
            </p>
            <p className="mt-1 text-xs">
              Create this invoice independently of the case sheet. Choose one or more treatments from this center’s treatment list; a completed treatment record is not required.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-invoice-date`}>Invoice date</Label>
              <Input id={`${idPrefix}-invoice-date`} type="date" value={invoiceDate} required
                onChange={(event) => { setDirty(true); setInvoiceDate(event.target.value); }} />
            </div>
            {mode === "create" && <>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={`${idPrefix}-consulting-doctor`}>Consulting doctor</Label>
              <SuggestionInput id={`${idPrefix}-consulting-doctor`} value={consultingDoctor} options={doctorNames.map((name) => ({ value: name, label: name }))}
                required maxLength={200} placeholder="Choose or enter doctor name"
                onValueChange={(name) => { setDirty(true); setConsultingDoctor(name); }} />
            </div>
            </>}
          </div>

          <section aria-labelledby={`${idPrefix}-items-heading`} className="space-y-3">
            <h2 id={`${idPrefix}-items-heading`} className="text-base font-semibold">Invoice line items</h2>
            {items.length ? (
              <ul aria-label="Added treatment lines" className="divide-y rounded-lg border">
                {items.map((item, index) => {
                  const isPrimary = mode === "edit" && Boolean(primaryTreatmentId) && item.treatment_id === primaryTreatmentId;
                  return (
                    <li key={item.rowKey} aria-label={`Treatment line ${index + 1}: ${item.description}`}
                      className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 p-3">
                      <div className="min-w-0 space-y-1 text-sm">
                        <p className="break-words font-medium">{item.description}{isPrimary && <span className="ml-2 text-xs font-normal text-muted-foreground">Primary treatment</span>}</p>
                        <p className="break-words text-xs text-muted-foreground">{lineSite(item)}</p>
                        {item.line_note && <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{item.line_note}</p>}
                        <p className="tabular-nums text-xs text-muted-foreground">{item.quantity} × {formatINR(item.unit_price)} <span className="font-semibold text-foreground">= {formatINR(invoiceLineAmount(item))}</span></p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button type="button" variant="ghost" size="icon-lg" disabled={pending}
                          aria-label={`Edit treatment line ${index + 1}: ${item.description}`} title="Edit line" onClick={() => editLine(item)}>
                          <Pencil aria-hidden="true" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon-lg" disabled={pending || isPrimary}
                          aria-label={isPrimary ? "The primary treatment cannot be removed" : `Remove treatment line ${index + 1}: ${item.description}`}
                          title={isPrimary ? "The primary treatment must remain on this invoice" : "Remove line"} onClick={() => removeItem(item.rowKey)}>
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="text-sm text-muted-foreground">No treatment lines added yet.</p>}

            {searchOptions.length === 0 && !existingEdit ? (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
                No active treatments are configured for this center. Ask a center admin to update the treatment list.
              </p>
            ) : (
              <fieldset ref={entryRef} disabled={pending} className="min-w-0 space-y-3 rounded-lg border p-3"
                aria-describedby={lineError ? `${idPrefix}-line-error` : undefined}>
                <legend className="px-1 text-sm font-semibold">{existingEdit ? "Edit treatment line" : "Add a treatment line"}</legend>
                <div className="grid min-w-0 grid-cols-2 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(5rem,0.3fr)_minmax(7rem,0.4fr)]">
                  <div className="col-span-full min-w-0 space-y-1.5 lg:col-span-1">
                    <Label htmlFor={linkedEdit ? undefined : `${idPrefix}-treatment`}>Treatment</Label>
                    {linkedEdit ? (
                      <p className="break-words text-sm font-medium">{draft.treatment_code} · {draft.description}</p>
                    ) : (
                      <TreatmentSearch key={entryVersion} id={`${idPrefix}-treatment`} value={draftSelection}
                        options={searchOptions} onChange={selectTreatment} disabled={pending}
                        onSearchChange={(value) => {
                          setDirty(true);
                          setSearchEdited(Boolean(value.trim() || draftSelection));
                          setLineError("");
                        }} />
                    )}
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor={`${idPrefix}-quantity`}>Quantity</Label>
                    <Input id={`${idPrefix}-quantity`} type="number" inputMode="decimal" step="any" value={draft.quantity}
                      readOnly={Boolean(draft.treatment_id)} onChange={(event) => patchDraft({ quantity: event.target.value })} />
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor={`${idPrefix}-price`}>Unit price (₹)</Label>
                    <Input id={`${idPrefix}-price`} type="number" inputMode="decimal" step="any" value={draft.unit_price}
                      onChange={(event) => patchDraft({ unit_price: event.target.value })} />
                  </div>
                </div>
                {draft.treatment_id && <p className="break-words text-xs text-muted-foreground">{lineSite(draft)} · Quantity and teeth come from the case sheet.</p>}
                <details key={entryVersion} open={existingEdit && (draft.tooth_numbers?.length || draft.line_note) ? true : undefined}
                  className="rounded-md bg-muted/30 p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    {draft.treatment_id ? "Line note (optional)" : "Teeth & line note (optional)"}
                    {draft.tooth_numbers?.length && !draft.treatment_id ? ` · ${draft.tooth_numbers.length} selected` : ""}
                  </summary>
                  <div className="mt-3 space-y-3">
                    {!draft.treatment_id && <ToothSelector label="Teeth for this line" value={draft.tooth_numbers ?? []}
                      onChange={(teeth) => patchDraft({ tooth_numbers: teeth, quantity: String(Math.max(1, teeth.length)) })} disabled={pending} />}
                    <div className="space-y-1.5">
                      <Label htmlFor={`${idPrefix}-line-note`}>Line note</Label>
                      <Textarea id={`${idPrefix}-line-note`} value={draft.line_note ?? ""} maxLength={1000}
                        rows={2} placeholder="Optional note shown on the invoice" onChange={(event) => patchDraft({ line_note: event.target.value })} />
                    </div>
                  </div>
                </details>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {hasDraft && <Button type="button" variant="ghost" onClick={resetEntry}>{existingEdit ? "Cancel line edit" : "Clear entry"}</Button>}
                  <Button type="button" variant="outline" className="ml-auto" onClick={commitLine}>
                    {existingEdit ? <Pencil aria-hidden="true" /> : <Plus aria-hidden="true" />}
                    {existingEdit ? "Update line" : "Add treatment"}
                  </Button>
                </div>
                {lineError && <p id={`${idPrefix}-line-error`} role="alert" className="text-sm text-destructive">{lineError}</p>}
              </fieldset>
            )}
            <p role="status" className="sr-only">{lineFeedback}</p>
          </section>

          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-notes`}>Invoice remarks (optional)</Label>
            <Textarea id={`${idPrefix}-notes`} rows={2} maxLength={4000} value={notes}
              onChange={(event) => { setDirty(true); setNotes(event.target.value); }} />
          </div>
          <details className="rounded-md border p-3" open={initialDiscount > 0 || initialTaxRate > 0 || Boolean(initialMention) ? true : undefined}>
            <summary className="cursor-pointer text-sm font-medium">Discount, tax & additional details (optional)</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
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
              <Label htmlFor={`${idPrefix}-discount`}>Discount amount (₹)</Label>
              <Input id={`${idPrefix}-discount`} type="number" inputMode="decimal" min={0} max={subtotal} step={0.01} value={discount} onChange={(event) => { setDirty(true); setDiscount(Number(event.target.value)); }} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-discount-by`}>Discount given by</Label>
              <Input id={`${idPrefix}-discount-by`} maxLength={200} value={discountGivenBy} onChange={(event) => { setDirty(true); setDiscountGivenBy(event.target.value); }} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor={`${idPrefix}-mention`}>Mention / remarks</Label>
              <Textarea id={`${idPrefix}-mention`} rows={2} maxLength={1000} value={mention} onChange={(event) => { setDirty(true); setMention(event.target.value); }} />
            </div>
            </div>
          </details>

          <div aria-live="polite" aria-atomic="true" className="space-y-1 border-t pt-4 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatINR(subtotal)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Discount</span>
              <span>−{formatINR(safeDiscount)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Tax ({taxRate}%)</span>
              <span>{formatINR(discountedTax)}</span>
            </div>
            <div className="flex justify-between gap-4 text-base font-bold">
              <span>Total</span>
              <span>{formatINR(total)}</span>
            </div>
            {mode === "create" && <>
              <div className="flex justify-between gap-4"><span>Amount received on creation</span><span>{formatINR(0)}</span></div>
              {total > 0 && <p className="pt-2 text-muted-foreground">No payment is required to create this invoice. The full unpaid amount carries forward; record a payment separately when received.</p>}
            </>}
            {mode === "edit" && amountReceived > 0 && <>
              <div className="flex justify-between gap-4"><span>Amount already received</span><span>{formatINR(amountReceived)}</span></div>
              <div className="flex justify-between gap-4"><span>Balance after edit</span><span>{formatINR(Math.max(0, total - amountReceived))}</span></div>
            </>}
            {paymentEditIssue && <p className="text-destructive">{paymentEditIssue}</p>}
            {total === 0 && !paymentEditIssue && items.length > 0 && items.every((item) => item.treatment_id || item.treatment_type_id) && (
              <p className="pt-2 text-muted-foreground">This is a ₹0 invoice. No payment is required for this bill; earlier patient dues remain unchanged.</p>
            )}
          </div>

          {mode === "create" && existingBalanceDue !== undefined && <section aria-label="Patient due after this invoice" className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
            <div className="flex justify-between gap-4"><span>Earlier unpaid bills</span><span>{formatINR(existingBalanceDue)}</span></div>
            <div className="flex justify-between gap-4"><span>New invoice total</span><span>{formatINR(total)}</span></div>
            <div className="flex justify-between gap-4 border-t pt-2 text-base font-bold"><span>Overall patient due after this bill</span><span>{formatINR(Math.round((existingBalanceDue + total) * 100) / 100)}</span></div>
            <p className="text-xs text-muted-foreground">Earlier dues are not added to this invoice’s charges. The saved bill will show the latest unpaid balance.</p>
          </section>}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" type="button" onClick={cancel}>Cancel</Button>
            <Button type="submit" disabled={pending || !!paymentEditIssue}>
              {pending ? "Saving…" : mode === "create" ? "Create invoice" : "Save changes"}
            </Button>
          </div>
        </CardContent>
      </form>
    </Card>
  );
}
