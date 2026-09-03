"use client";

import { useId, useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createPrescriptionItemDraft,
  MAX_PRESCRIPTION_ITEMS,
  PRESCRIPTION_FOOD_TIMINGS,
  type PrescriptionItemDraft,
} from "@/lib/prescriptions";

export type PrescriptionItemsEditorProps = {
  value: PrescriptionItemDraft[];
  onChange: (value: PrescriptionItemDraft[]) => void;
  disabled?: boolean;
  errors?: Record<string, string | undefined>;
  errorPrefix?: string;
  legend?: string;
};

type EditablePrescriptionField = Exclude<keyof PrescriptionItemDraft, "client_id">;

export function PrescriptionItemsEditor({
  value,
  onChange,
  disabled = false,
  errors = {},
  errorPrefix = "prescriptions",
  legend = "Prescription",
}: PrescriptionItemsEditorProps) {
  const idPrefix = useId();
  const nextClientId = useRef(1);
  const atLimit = value.length >= MAX_PRESCRIPTION_ITEMS;

  function addItem() {
    if (atLimit) return;

    let clientId: string;
    do {
      clientId = `medicine-${idPrefix}-${nextClientId.current}`;
      nextClientId.current += 1;
    } while (value.some((item) => item.client_id === clientId));

    onChange([...value, createPrescriptionItemDraft(clientId)]);
  }

  function updateItem(
    clientId: string,
    patch: Partial<Omit<PrescriptionItemDraft, "client_id">>,
  ) {
    onChange(value.map((item) => (
      item.client_id === clientId ? { ...item, ...patch } : item
    )));
  }

  function removeItem(clientId: string) {
    onChange(value.filter((item) => item.client_id !== clientId));
  }

  function fieldError(index: number, field: EditablePrescriptionField): string | undefined {
    return errors[`${errorPrefix}.${index}.${field}`] ?? errors[`${index}.${field}`];
  }

  return (
    <fieldset disabled={disabled} className="space-y-4">
      <legend className="sr-only">{legend}</legend>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold" aria-hidden="true">{legend}</h2>
          <p className="text-sm text-muted-foreground">
            Add medicines for this visit and clearly mark when each dose should be taken.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={addItem}
          disabled={disabled || atLimit}
          className="w-full sm:w-auto"
        >
          <Plus aria-hidden="true" /> Add medicine
        </Button>
      </div>

      {value.length === 0 && (
        <div className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
          No medicines prescribed for this visit.
        </div>
      )}

      <div className="space-y-4">
        {value.map((item, index) => (
          <PrescriptionItemRow
            key={item.client_id}
            idPrefix={`${idPrefix}-${item.client_id}`}
            index={index}
            item={item}
            error={(field) => fieldError(index, field)}
            onChange={(patch) => updateItem(item.client_id, patch)}
            onRemove={() => removeItem(item.client_id)}
          />
        ))}
      </div>

      <p aria-live="polite" className="text-sm text-muted-foreground">
        {value.length} of {MAX_PRESCRIPTION_ITEMS} medicines added
      </p>
      {atLimit && (
        <p role="status" className="text-sm text-muted-foreground">
          The maximum of {MAX_PRESCRIPTION_ITEMS} medicines has been reached.
        </p>
      )}
    </fieldset>
  );
}

function PrescriptionItemRow({
  idPrefix,
  index,
  item,
  error,
  onChange,
  onRemove,
}: {
  idPrefix: string;
  index: number;
  item: PrescriptionItemDraft;
  error: (field: EditablePrescriptionField) => string | undefined;
  onChange: (patch: Partial<Omit<PrescriptionItemDraft, "client_id">>) => void;
  onRemove: () => void;
}) {
  const medicineError = error("medicine_name");
  const scheduleError = error("morning") ?? error("noon") ?? error("night");
  const durationError = error("duration_days");

  return (
    <fieldset className="rounded-xl border bg-muted/15 p-3 sm:p-4">
      <legend className="px-1 text-sm font-semibold">Medicine {index + 1}</legend>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Medicine name"
            htmlFor={`${idPrefix}-name`}
            error={medicineError}
          >
            <Input
              id={`${idPrefix}-name`}
              required
              maxLength={200}
              autoComplete="off"
              value={item.medicine_name}
              aria-invalid={Boolean(medicineError)}
              aria-describedby={medicineError ? `${idPrefix}-name-error` : undefined}
              onChange={(event) => onChange({ medicine_name: event.target.value })}
              placeholder="Generic or brand name"
            />
          </Field>
          <Field label="Strength" htmlFor={`${idPrefix}-strength`} error={error("strength")}>
            <Input
              id={`${idPrefix}-strength`}
              maxLength={100}
              autoComplete="off"
              value={item.strength}
              aria-invalid={Boolean(error("strength"))}
              aria-describedby={error("strength") ? `${idPrefix}-strength-error` : undefined}
              onChange={(event) => onChange({ strength: event.target.value })}
              placeholder="For example, 500 mg"
            />
          </Field>
          <Field label="Dose" htmlFor={`${idPrefix}-dosage`} error={error("dosage")}>
            <Input
              id={`${idPrefix}-dosage`}
              maxLength={100}
              autoComplete="off"
              value={item.dosage}
              aria-invalid={Boolean(error("dosage"))}
              aria-describedby={error("dosage") ? `${idPrefix}-dosage-error` : undefined}
              onChange={(event) => onChange({ dosage: event.target.value })}
              placeholder="For example, 1 tablet"
            />
          </Field>
          <Field
            label="Duration (days)"
            htmlFor={`${idPrefix}-duration`}
            error={durationError}
          >
            <Input
              id={`${idPrefix}-duration`}
              type="number"
              inputMode="numeric"
              min={1}
              max={3_650}
              step={1}
              value={item.duration_days ?? ""}
              aria-invalid={Boolean(durationError)}
              aria-describedby={durationError ? `${idPrefix}-duration-error` : undefined}
              onChange={(event) => onChange({
                duration_days: Number.isFinite(event.target.valueAsNumber)
                  ? event.target.valueAsNumber
                  : null,
              })}
              placeholder="Optional"
            />
          </Field>
        </div>

        <fieldset
          aria-describedby={scheduleError ? `${idPrefix}-schedule-error` : undefined}
          aria-invalid={Boolean(scheduleError)}
          className="space-y-2"
        >
          <legend className="text-sm font-medium">When to take</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <ScheduleCheckbox
              id={`${idPrefix}-morning`}
              label="Morning"
              checked={item.morning}
              onChange={(morning) => onChange({ morning })}
            />
            <ScheduleCheckbox
              id={`${idPrefix}-noon`}
              label="Noon / lunch"
              checked={item.noon}
              onChange={(noon) => onChange({ noon })}
            />
            <ScheduleCheckbox
              id={`${idPrefix}-night`}
              label="Night"
              checked={item.night}
              onChange={(night) => onChange({ night })}
            />
          </div>
          {scheduleError && (
            <p id={`${idPrefix}-schedule-error`} className="text-sm text-destructive">
              {scheduleError}
            </p>
          )}
        </fieldset>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Food timing" htmlFor={`${idPrefix}-food`} error={error("food_timing")}>
            <select
              id={`${idPrefix}-food`}
              value={item.food_timing}
              aria-invalid={Boolean(error("food_timing"))}
              aria-describedby={error("food_timing") ? `${idPrefix}-food-error` : undefined}
              onChange={(event) => onChange({
                food_timing: event.target.value as PrescriptionItemDraft["food_timing"],
              })}
              className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm"
            >
              {PRESCRIPTION_FOOD_TIMINGS.map((timing) => (
                <option key={timing.value} value={timing.value}>{timing.label}</option>
              ))}
            </select>
          </Field>
          <Field
            label="Additional instructions"
            htmlFor={`${idPrefix}-instructions`}
            error={error("instructions")}
          >
            <Textarea
              id={`${idPrefix}-instructions`}
              rows={2}
              maxLength={1_000}
              value={item.instructions}
              aria-invalid={Boolean(error("instructions"))}
              aria-describedby={error("instructions") ? `${idPrefix}-instructions-error` : undefined}
              onChange={(event) => onChange({ instructions: event.target.value })}
              placeholder="Optional advice for this medicine"
            />
          </Field>
        </div>

        <div className="flex justify-end border-t pt-3">
          <Button
            type="button"
            variant="destructive"
            size="lg"
            onClick={onRemove}
            aria-label={`Remove medicine ${index + 1}${item.medicine_name ? `, ${item.medicine_name}` : ""}`}
            className="w-full sm:w-auto"
          >
            <Trash2 aria-hidden="true" /> Remove medicine
          </Button>
        </div>
      </div>
    </fieldset>
  );
}

function ScheduleCheckbox({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border bg-background px-3 py-2 text-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-disabled:cursor-not-allowed has-disabled:opacity-50"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-5 shrink-0 accent-primary"
      />
      <span>{label}</span>
    </label>
  );
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={htmlFor} className="text-sm font-medium">{label}</label>
      {children}
      {error && (
        <p id={`${htmlFor}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
