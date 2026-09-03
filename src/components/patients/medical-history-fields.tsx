"use client";

import { useId } from "react";
import { Textarea } from "@/components/ui/textarea";
import {
  MEDICAL_HISTORY_CONDITIONS,
  type MedicalHistoryCondition,
  type MedicalHistoryDraft,
} from "@/lib/medical-history";

export type MedicalHistoryFieldErrors = Partial<Record<
  "reviewStatus" | "reviewedToday" | "conditions" | "description",
  string
>>;

export type MedicalHistoryFieldsProps = {
  value: MedicalHistoryDraft;
  onChange: (value: MedicalHistoryDraft) => void;
  disabled?: boolean;
  errors?: MedicalHistoryFieldErrors;
  legend?: string;
};

export function MedicalHistoryFields({
  value,
  onChange,
  disabled = false,
  errors = {},
  legend = "Medical history",
}: MedicalHistoryFieldsProps) {
  const idPrefix = useId();
  const helperId = `${idPrefix}-helper`;
  const conditionsErrorId = `${idPrefix}-conditions-error`;
  const descriptionId = `${idPrefix}-description`;
  const descriptionHelperId = `${idPrefix}-description-helper`;
  const descriptionErrorId = `${idPrefix}-description-error`;
  const reviewedTodayErrorId = `${idPrefix}-reviewed-today-error`;
  const hasOtherCondition = value.conditions.includes("other");
  const noKnownConditions = value.reviewStatus === "reviewed_none";

  function setNoKnownConditions(checked: boolean) {
    onChange({
      ...value,
      reviewStatus: checked ? "reviewed_none" : "not_reviewed",
      reviewedToday: false,
      conditions: [],
      description: checked ? "" : value.description,
    });
  }

  function setCondition(condition: MedicalHistoryCondition, checked: boolean) {
    const conditions = checked
      ? [...new Set([...value.conditions, condition])]
      : value.conditions.filter((candidate) => candidate !== condition);

    onChange({
      ...value,
      reviewStatus: conditions.length > 0 ? "reviewed_conditions" : "not_reviewed",
      reviewedToday: false,
      conditions,
    });
  }

  return (
    <fieldset
      disabled={disabled}
      aria-describedby={helperId}
      className="space-y-4 rounded-xl border bg-muted/15 p-3 sm:p-4"
    >
      <legend className="px-1 text-base font-semibold">{legend}</legend>
      <p id={helperId} className="text-sm text-muted-foreground">
        Review this section with the patient at every visit. Select all known
        conditions, or confirm that none are known.
      </p>

      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border bg-background px-3 py-2 text-sm font-medium focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-disabled:cursor-not-allowed has-disabled:opacity-50">
        <input
          type="checkbox"
          checked={noKnownConditions}
          onChange={(event) => setNoKnownConditions(event.target.checked)}
          className="size-5 shrink-0 accent-primary"
        />
        <span>No known medical conditions</span>
      </label>

      <fieldset
        aria-describedby={errors.conditions ? conditionsErrorId : undefined}
        aria-invalid={Boolean(errors.conditions)}
        className="space-y-2"
      >
        <legend className="text-sm font-medium">Known conditions</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {MEDICAL_HISTORY_CONDITIONS.map((condition) => {
            const inputId = `${idPrefix}-${condition.value}`;
            return (
              <label
                key={condition.value}
                htmlFor={inputId}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border bg-background px-3 py-2 text-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-disabled:cursor-not-allowed has-disabled:opacity-50"
              >
                <input
                  id={inputId}
                  type="checkbox"
                  checked={value.conditions.includes(condition.value)}
                  onChange={(event) => setCondition(condition.value, event.target.checked)}
                  className="size-5 shrink-0 accent-primary"
                />
                <span>{condition.label}</span>
              </label>
            );
          })}
        </div>
        {errors.conditions && (
          <p id={conditionsErrorId} className="text-sm text-destructive">
            {errors.conditions}
          </p>
        )}
      </fieldset>

      <div className="space-y-2">
        <label htmlFor={descriptionId} className="text-sm font-medium">
          Medical history description
          {hasOtherCondition && <span aria-hidden="true"> *</span>}
        </label>
        <Textarea
          id={descriptionId}
          rows={3}
          required={hasOtherCondition}
          value={value.description}
          aria-invalid={Boolean(errors.description)}
          aria-describedby={[
            descriptionHelperId,
            errors.description ? descriptionErrorId : undefined,
          ].filter(Boolean).join(" ")}
          onChange={(event) => onChange({
            ...value,
            reviewedToday: false,
            description: event.target.value,
          })}
          placeholder="Relevant medicines, allergies, control status, previous procedures or other details"
        />
        <p id={descriptionHelperId} className="text-sm text-muted-foreground">
          {hasOtherCondition
            ? "Describe the other condition before the case sheet is finalized."
            : "Add details that may affect dental treatment, including regular medicines and allergies."}
        </p>
        {errors.description && (
          <p id={descriptionErrorId} className="text-sm text-destructive">
            {errors.description}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-medium focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-disabled:cursor-not-allowed has-disabled:opacity-50">
          <input
            type="checkbox"
            checked={value.reviewedToday}
            aria-invalid={Boolean(errors.reviewedToday)}
            aria-describedby={errors.reviewedToday ? reviewedTodayErrorId : undefined}
            onChange={(event) => onChange({
              ...value,
              reviewedToday: event.target.checked,
            })}
            className="size-5 shrink-0 accent-primary"
          />
          <span>Reviewed with the patient today</span>
        </label>
        {errors.reviewedToday && (
          <p id={reviewedTodayErrorId} className="text-sm text-destructive">
            {errors.reviewedToday}
          </p>
        )}
      </div>
    </fieldset>
  );
}
