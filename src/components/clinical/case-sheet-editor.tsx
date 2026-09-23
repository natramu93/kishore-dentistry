"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { finalizeCaseSheetAction } from "@/actions/case-sheets";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToothChart } from "@/components/clinical/tooth-chart";
import { OdontogramEditor } from "@/components/clinical/odontogram-editor";
import { PrescriptionItemsEditor } from "@/components/clinical/prescription-items-editor";
import { MedicalHistoryFields } from "@/components/patients/medical-history-fields";
import {
  createMedicalHistoryDraft,
  type MedicalHistoryDraft,
} from "@/lib/medical-history";
import type { PrescriptionItemDraft } from "@/lib/prescriptions";
import {
  ARCH_SITES,
  caseSheetPayloadSchema,
  DENTAL_SURFACES,
  INDIAN_PERMANENT_TEETH,
  INDIAN_PRIMARY_TEETH,
  isIndianToothNumber,
  isPrimaryIndianTooth,
  QUADRANT_SITES,
  type CaseSheetPayload,
  type CaseSheetTreatmentInput,
  type DentalSurface,
  type ToothAssessmentInput,
  type TreatmentSiteScope,
} from "@/lib/clinical";

export type ClinicalDoctorOption = { id: string; label: string };

export type TreatmentCodeOption = {
  code: string;
  name: string;
  category?: string | null;
  code_system: "KISHORE_TREATMENT" | "ICD10_IN";
  code_level: "procedure" | "category" | "detail";
  billable: boolean;
  default_price?: number | null;
  default_cost?: number | null;
};

export type CaseSheetEditorProps = {
  leadId: string;
  appointmentId?: string | null;
  doctors: ClinicalDoctorOption[];
  doctorLocked?: boolean;
  treatmentCodes: TreatmentCodeOption[];
  canPrescribe?: boolean;
  initialMedicalHistory?: MedicalHistoryDraft;
  successHref?: string;
};

type EditableTreatment = CaseSheetTreatmentInput & {
  rowKey: string;
  codeSearch: string;
  codePickerOpen: boolean;
  dentition: "permanent" | "primary";
};

type FieldErrors = Record<string, string>;

const SITE_SCOPE_OPTIONS: { value: TreatmentSiteScope; label: string }[] = [
  { value: "not_applicable", label: "Not tooth-specific" },
  { value: "full_mouth", label: "Full mouth" },
  { value: "arch", label: "Arch" },
  { value: "quadrant", label: "Quadrant" },
  { value: "tooth", label: "Individual tooth" },
  { value: "multi_tooth", label: "Multiple teeth" },
];

const SITE_LABELS: Record<(typeof ARCH_SITES)[number] | (typeof QUADRANT_SITES)[number], string> = {
  upper: "Upper arch",
  lower: "Lower arch",
  upper_right: "Upper right quadrant",
  upper_left: "Upper left quadrant",
  lower_left: "Lower left quadrant",
  lower_right: "Lower right quadrant",
};

const SURFACE_LABELS: Record<DentalSurface, string> = {
  mesial: "Mesial",
  distal: "Distal",
  occlusal: "Occlusal",
  incisal: "Incisal",
  buccal: "Buccal",
  lingual: "Lingual",
  palatal: "Palatal",
  facial: "Facial",
};

function blankTreatment(rowKey: string): EditableTreatment {
  return {
    rowKey,
    codeSearch: "",
    codePickerOpen: false,
    dentition: "permanent",
    treatment_code: "",
    status: "planned",
    site_scope: "not_applicable",
    site_detail: null,
    tooth_number: null,
    tooth_numbers: [],
    surfaces: [],
    notes: "",
  };
}

function localDateTimeNow(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function CaseSheetEditor({
  leadId,
  appointmentId = null,
  doctors,
  doctorLocked = false,
  treatmentCodes,
  canPrescribe = false,
  initialMedicalHistory,
  successHref,
}: CaseSheetEditorProps) {
  const router = useRouter();
  const idPrefix = useId();
  const nextRowKey = useRef(1);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const [pending, startTransition] = useTransition();
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [doctorId, setDoctorId] = useState(() => doctors.length === 1 ? doctors[0]!.id : "");
  const [visitAt] = useState(localDateTimeNow);
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [findings, setFindings] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [plan, setPlan] = useState("");
  const [medicalHistory, setMedicalHistory] = useState<MedicalHistoryDraft>(() => (
    createMedicalHistoryDraft(initialMedicalHistory)
  ));
  const [prescriptions, setPrescriptions] = useState<PrescriptionItemDraft[]>([]);
  const [toothAssessments, setToothAssessments] = useState<ToothAssessmentInput[]>([]);
  const [treatments, setTreatments] = useState<EditableTreatment[]>([]);

  const searchableTreatmentCodes = useMemo(
    () => treatmentCodes.map((treatment) => ({
      ...treatment,
      searchText: `${treatment.code} ${treatment.name} ${treatment.category ?? ""} ${treatment.code_system}`.toLocaleLowerCase(),
    })),
    [treatmentCodes],
  );
  const treatmentCodeSet = useMemo(
    () => new Set(treatmentCodes.map((treatment) => treatment.code)),
    [treatmentCodes],
  );

  useEffect(() => {
    if (!dirty || pending) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty, pending]);

  function changeTreatment(rowKey: string, patch: Partial<EditableTreatment>) {
    setDirty(true);
    setTreatments((current) => current.map((treatment) => (
      treatment.rowKey === rowKey ? { ...treatment, ...patch } : treatment
    )));
  }

  function addTreatment() {
    const rowKey = `treatment-${nextRowKey.current}`;
    nextRowKey.current += 1;
    setDirty(true);
    setTreatments((current) => [...current, blankTreatment(rowKey)]);
  }

  function addTreatmentForTooth(toothNumber: string) {
    if (!isIndianToothNumber(toothNumber)) return;
    const rowKey = `treatment-${nextRowKey.current}`;
    nextRowKey.current += 1;
    setDirty(true);
    setTreatments((current) => [
      ...current,
      {
        ...blankTreatment(rowKey),
        site_scope: "tooth",
        tooth_number: toothNumber,
        tooth_numbers: [toothNumber],
        dentition: isPrimaryIndianTooth(toothNumber) ? "primary" : "permanent",
      },
    ]);
  }

  function removeTreatment(rowKey: string) {
    setDirty(true);
    setTreatments((current) => current.filter((treatment) => treatment.rowKey !== rowKey));
  }

  function buildPayload(): CaseSheetPayload {
    return {
      lead_id: leadId,
      appointment_id: appointmentId,
      doctor_id: doctorId,
      visit_at: visitAt,
      chief_complaint: chiefComplaint,
      findings,
      diagnosis,
      plan,
      medical_history: medicalHistory,
      prescriptions,
      tooth_assessments: toothAssessments,
      treatments: treatments.map(({
        treatment_code,
        status,
        site_scope,
        site_detail,
        tooth_number,
        tooth_numbers,
        surfaces,
        notes,
      }) => ({
        treatment_code,
        status,
        site_scope,
        site_detail,
        tooth_number,
        tooth_numbers,
        surfaces,
        notes,
      })),
    };
  }

  function submit() {
    const payload = buildPayload();
    const parsed = caseSheetPayloadSchema.safeParse(payload);
    const nextErrors: FieldErrors = {};

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".");
        if (!nextErrors[key]) nextErrors[key] = issue.message;
      }
    }
    payload.treatments.forEach((treatment, index) => {
      if (treatment.treatment_code && !treatmentCodeSet.has(treatment.treatment_code)) {
        nextErrors[`treatments.${index}.treatment_code`] = "Select a treatment from the approved code list";
      }
    });

    if (!parsed.success || Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      requestAnimationFrame(() => errorSummaryRef.current?.focus());
      return;
    }

    setErrors({});
    startTransition(async () => {
      const result = await finalizeCaseSheetAction(parsed.data);
      if (result.ok) {
        setDirty(false);
        toast.success("Case sheet finalized");
        if (successHref) router.push(successHref);
        else router.refresh();
      } else {
        setErrors({ form: result.error });
        requestAnimationFrame(() => errorSummaryRef.current?.focus());
        toast.error(result.error);
      }
    });
  }

  const errorMessages = [...new Set(Object.values(errors))];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Digital dental case sheet</CardTitle>
        <CardDescription>
          Record the whole-mouth examination first. Treatments are optional, but every planned or completed procedure must use an approved code.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="space-y-7"
        >
          {errorMessages.length > 0 && (
            <div
              ref={errorSummaryRef}
              role="alert"
              tabIndex={-1}
              className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <p className="font-medium text-destructive">
                {errors.form ? "Unable to save this case sheet." : "Review the highlighted case-sheet details."}
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                {errorMessages.map((message) => <li key={message}>{message}</li>)}
              </ul>
            </div>
          )}

          <section aria-labelledby={`${idPrefix}-visit-heading`} className="space-y-4">
            <h2 id={`${idPrefix}-visit-heading`} className="text-base font-semibold">Visit details</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Treating doctor" htmlFor={`${idPrefix}-doctor`} error={errors.doctor_id}>
                <select
                  id={`${idPrefix}-doctor`}
                  value={doctorId}
                  required
                  disabled={doctorLocked}
                  aria-invalid={Boolean(errors.doctor_id)}
                  onChange={(event) => { setDirty(true); setDoctorId(event.target.value); }}
                  className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm"
                >
                  <option value="">Select doctor…</option>
                  {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.label}</option>)}
                </select>
                {doctorLocked && (
                  <p className="text-xs text-muted-foreground">
                    The treating doctor is fixed by this appointment.
                  </p>
                )}
              </Field>
              <Field label="Visit date and time (captured on save)" htmlFor={`${idPrefix}-visit-at`} error={errors.visit_at}>
                <Input
                  id={`${idPrefix}-visit-at`}
                  type="datetime-local"
                  required
                  value={visitAt}
                  readOnly
                  aria-readonly="true"
                  aria-invalid={Boolean(errors.visit_at)}
                />
                <p className="text-xs text-muted-foreground">
                  The exact server time is recorded when this case sheet is finalized.
                </p>
              </Field>
            </div>
            <Field label="Chief complaint" htmlFor={`${idPrefix}-complaint`} error={errors.chief_complaint}>
              <Textarea
                id={`${idPrefix}-complaint`}
                rows={2}
                required
                value={chiefComplaint}
                aria-invalid={Boolean(errors.chief_complaint)}
                onChange={(event) => { setDirty(true); setChiefComplaint(event.target.value); }}
                placeholder="Patient’s concern, symptoms and duration"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Clinical findings" htmlFor={`${idPrefix}-findings`} error={errors.findings}>
                <Textarea
                  id={`${idPrefix}-findings`}
                  rows={3}
                  value={findings}
                  aria-invalid={Boolean(errors.findings)}
                  onChange={(event) => { setDirty(true); setFindings(event.target.value); }}
                />
              </Field>
              <Field label="Diagnosis" htmlFor={`${idPrefix}-diagnosis`} error={errors.diagnosis}>
                <Textarea
                  id={`${idPrefix}-diagnosis`}
                  rows={3}
                  required
                  value={diagnosis}
                  aria-invalid={Boolean(errors.diagnosis)}
                  onChange={(event) => { setDirty(true); setDiagnosis(event.target.value); }}
                />
              </Field>
              <Field label="Treatment plan" htmlFor={`${idPrefix}-plan`} error={errors.plan}>
                <Textarea
                  id={`${idPrefix}-plan`}
                  rows={3}
                  value={plan}
                  aria-invalid={Boolean(errors.plan)}
                  onChange={(event) => { setDirty(true); setPlan(event.target.value); }}
                />
              </Field>
            </div>
          </section>

          <MedicalHistoryFields
            value={medicalHistory}
            errors={{
              conditions: errors["medical_history.conditions"]
                ?? errors["medical_history.reviewStatus"],
              reviewedToday: errors["medical_history.reviewedToday"],
              description: errors["medical_history.description"],
            }}
            onChange={(next) => {
              setDirty(true);
              setMedicalHistory(next);
            }}
          />

          <OdontogramEditor
            value={toothAssessments}
            errors={errors}
            onChange={(next) => {
              setDirty(true);
              setToothAssessments(next);
            }}
            onAddTreatment={addTreatmentForTooth}
          />

          <section aria-labelledby={`${idPrefix}-treatments-heading`} className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 id={`${idPrefix}-treatments-heading`} className="text-base font-semibold">Coded treatments <span className="font-normal text-muted-foreground">(optional)</span></h2>
                <p className="text-sm text-muted-foreground">Add only planned or completed procedures. Select one or multiple teeth when applicable; billing terms are chosen on the invoice.</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addTreatment}>
                <Plus aria-hidden="true" /> Add treatment
              </Button>
            </div>

            <div className="space-y-4">
              {treatments.length === 0 && (
                <div className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
                  No treatment is required to finalize this examination. Add a coded treatment only when applicable.
                </div>
              )}
              {treatments.map((treatment, index) => (
                <TreatmentRow
                  key={treatment.rowKey}
                  idPrefix={`${idPrefix}-${treatment.rowKey}`}
                  index={index}
                  treatment={treatment}
                  treatmentCodes={searchableTreatmentCodes}
                  errors={errors}
                  canRemove
                  onChange={(patch) => changeTreatment(treatment.rowKey, patch)}
                  onRemove={() => removeTreatment(treatment.rowKey)}
                />
              ))}
            </div>
          </section>

          {canPrescribe ? (
            <section aria-labelledby={`${idPrefix}-prescription-heading`} className="space-y-4">
              <h2 id={`${idPrefix}-prescription-heading`} className="sr-only">Prescription for this visit</h2>
              <PrescriptionItemsEditor
                value={prescriptions}
                errors={errors}
                legend="Prescription for this visit"
                onChange={(next) => {
                  setDirty(true);
                  setPrescriptions(next);
                }}
              />
            </section>
          ) : (
            <section className="rounded-xl border border-dashed p-4" aria-label="Prescription for this visit">
              <h2 className="text-base font-semibold">Prescription for this visit</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Prescription lines can be signed only by the treating doctor from their own account.
              </p>
            </section>
          )}

          <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-end">
            <Button type="submit" disabled={pending || (treatments.length > 0 && treatmentCodes.length === 0)} className="sm:min-w-44">
              {pending ? "Finalizing…" : "Finalize case sheet"}
            </Button>
          </div>
          {treatmentCodes.length === 0 && treatments.length > 0 && (
            <p role="alert" className="text-sm text-destructive">
              The approved treatment-code list is unavailable. This case sheet cannot be finalized.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function TreatmentRow({
  idPrefix,
  index,
  treatment,
  treatmentCodes,
  errors,
  canRemove,
  onChange,
  onRemove,
}: {
  idPrefix: string;
  index: number;
  treatment: EditableTreatment;
  treatmentCodes: (TreatmentCodeOption & { searchText: string })[];
  errors: FieldErrors;
  canRemove: boolean;
  onChange: (patch: Partial<EditableTreatment>) => void;
  onRemove: () => void;
}) {
  const [activeCodeIndex, setActiveCodeIndex] = useState(-1);
  const error = (field: string) => errors[`treatments.${index}.${field}`];
  const selectedCode = treatmentCodes.find((item) => item.code === treatment.treatment_code);
  const query = treatment.codeSearch.trim().toLocaleLowerCase();
  const matches = treatment.codePickerOpen
    ? treatmentCodes.filter((item) => !query || item.searchText.includes(query)).slice(0, 20)
    : [];
  const activeCode = activeCodeIndex >= 0 ? matches[activeCodeIndex] : undefined;
  const siteOptions = treatment.site_scope === "arch" ? ARCH_SITES : QUADRANT_SITES;

  function selectTreatment(option: TreatmentCodeOption) {
    onChange({
      treatment_code: option.code,
      codeSearch: `${option.code} — ${option.name}`,
      codePickerOpen: false,
    });
    setActiveCodeIndex(-1);
  }

  function changeScope(scope: TreatmentSiteScope) {
    onChange({
      site_scope: scope,
      site_detail: null,
      tooth_number: null,
      tooth_numbers: [],
      surfaces: [],
    });
  }

  return (
    <fieldset className="rounded-xl border bg-muted/15 p-3 sm:p-4">
      <legend className="px-1 text-sm font-semibold">Treatment {index + 1}</legend>
      <div className="space-y-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_160px_48px]">
          <Field label="Approved dental code" htmlFor={`${idPrefix}-code`} error={error("treatment_code")}>
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground" />
              <Input
                id={`${idPrefix}-code`}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={treatment.codePickerOpen}
                aria-controls={`${idPrefix}-code-options`}
                aria-activedescendant={activeCode ? `${idPrefix}-code-option-${activeCode.code}` : undefined}
                aria-invalid={Boolean(error("treatment_code"))}
                autoComplete="off"
                className="pl-9"
                value={treatment.codeSearch}
                placeholder="Search ICD-10 diagnosis or clinic treatment code"
                onFocus={() => {
                  setActiveCodeIndex(0);
                  onChange({ codePickerOpen: true });
                }}
                onBlur={() => window.setTimeout(() => {
                  setActiveCodeIndex(-1);
                  onChange({ codePickerOpen: false });
                }, 120)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    if (!treatment.codePickerOpen) onChange({ codePickerOpen: true });
                    setActiveCodeIndex((current) => (
                      matches.length === 0 ? -1 : (current + 1 + matches.length) % matches.length
                    ));
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    if (!treatment.codePickerOpen) onChange({ codePickerOpen: true });
                    setActiveCodeIndex((current) => (
                      matches.length === 0
                        ? -1
                        : (current <= 0 ? matches.length - 1 : current - 1)
                    ));
                  } else if (event.key === "Escape") {
                    setActiveCodeIndex(-1);
                    onChange({ codePickerOpen: false });
                  } else if (event.key === "Enter" && (activeCode || matches.length === 1)) {
                    event.preventDefault();
                    selectTreatment(activeCode ?? matches[0]!);
                  }
                }}
                onChange={(event) => {
                  setActiveCodeIndex(0);
                  onChange({
                    codeSearch: event.target.value,
                    treatment_code: "",
                    codePickerOpen: true,
                  });
                }}
              />
              {treatment.codePickerOpen && (
                <div
                  id={`${idPrefix}-code-options`}
                  role="listbox"
                  aria-label="Approved dental codes"
                  className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
                >
                  {matches.length > 0 ? matches.map((option, optionIndex) => (
                    <button
                      key={option.code}
                      id={`${idPrefix}-code-option-${option.code}`}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      aria-selected={optionIndex === activeCodeIndex}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveCodeIndex(optionIndex)}
                      onClick={() => selectTreatment(option)}
                      className={`flex min-h-11 w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none ${
                        optionIndex === activeCodeIndex ? "bg-muted" : ""
                      }`}
                    >
                      <span className="mt-0.5 shrink-0 font-mono text-xs font-semibold text-primary">{option.code}</span>
                      <span className="min-w-0">
                        <span className="block">{option.name}</span>
                        <span className="block text-xs font-medium text-muted-foreground">
                          ICD-10 diagnosis
                          {option.code_level === "category" ? " · category" : ""}
                        </span>
                        {option.category && <span className="block text-xs text-muted-foreground">{option.category}</span>}
                      </span>
                    </button>
                  )) : (
                    <p className="px-3 py-3 text-sm text-muted-foreground">No approved codes match this search.</p>
                  )}
                  {matches.length === 20 && (
                    <p className="border-t px-3 py-2 text-xs text-muted-foreground">Showing the first 20 matches. Refine your search to narrow the list.</p>
                  )}
                </div>
              )}
            </div>
            {selectedCode && (
              <p className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                <Check aria-hidden="true" className="size-3.5" /> Code attached: {selectedCode.code} (ICD-10 diagnosis)
              </p>
            )}
          </Field>
          <Field label="Treatment status" htmlFor={`${idPrefix}-status`} error={error("status")}>
            <select
              id={`${idPrefix}-status`}
              value={treatment.status}
              onChange={(event) => onChange({ status: event.target.value as EditableTreatment["status"] })}
              className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
            >
              <option value="planned">Planned</option>
              <option value="completed">Completed</option>
            </select>
          </Field>
          <div className="flex items-end justify-end">
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              disabled={!canRemove}
              aria-label={`Remove treatment ${index + 1}`}
              onClick={onRemove}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-1">
          <Field label="Treatment site" htmlFor={`${idPrefix}-scope`} error={error("site_scope")}>
            <select
              id={`${idPrefix}-scope`}
              value={treatment.site_scope}
              onChange={(event) => changeScope(event.target.value as TreatmentSiteScope)}
              className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
            >
              {SITE_SCOPE_OPTIONS.map((scope) => <option key={scope.value} value={scope.value}>{scope.label}</option>)}
            </select>
          </Field>
        </div>

        {(treatment.site_scope === "arch" || treatment.site_scope === "quadrant") && (
          <Field label={treatment.site_scope === "arch" ? "Select arch" : "Select quadrant"} htmlFor={`${idPrefix}-site-detail`} error={error("site_detail")}>
            <select
              id={`${idPrefix}-site-detail`}
              value={treatment.site_detail ?? ""}
              aria-invalid={Boolean(error("site_detail"))}
              onChange={(event) => onChange({ site_detail: event.target.value || null })}
              className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:max-w-sm md:text-sm"
            >
              <option value="">Select…</option>
              {siteOptions.map((site) => <option key={site} value={site}>{SITE_LABELS[site]}</option>)}
            </select>
          </Field>
        )}

        {(treatment.site_scope === "tooth" || treatment.site_scope === "multi_tooth") && (
          <ToothSiteEditor
            treatment={treatment}
            multi={treatment.site_scope === "multi_tooth"}
            toothError={error(treatment.site_scope === "multi_tooth" ? "tooth_numbers" : "tooth_number")}
            surfaceError={error("surfaces")}
            onChange={onChange}
          />
        )}

        <Field label="Treatment notes" htmlFor={`${idPrefix}-notes`} error={error("notes")}>
          <Textarea
            id={`${idPrefix}-notes`}
            rows={2}
            maxLength={2_000}
            value={treatment.notes}
            aria-invalid={Boolean(error("notes"))}
            onChange={(event) => onChange({ notes: event.target.value })}
            placeholder="Materials, technique, outcome or follow-up instructions"
          />
        </Field>
      </div>
    </fieldset>
  );
}

function ToothSiteEditor({
  treatment,
  multi,
  toothError,
  surfaceError,
  onChange,
}: {
  treatment: EditableTreatment;
  multi: boolean;
  toothError?: string;
  surfaceError?: string;
  onChange: (patch: Partial<EditableTreatment>) => void;
}) {
  const teeth = treatment.dentition === "permanent" ? INDIAN_PERMANENT_TEETH : INDIAN_PRIMARY_TEETH;
  const half = teeth.length / 2;

  function selectTooth(tooth: string) {
    if (!isIndianToothNumber(tooth)) return;
    if (!multi) {
      onChange({ tooth_number: tooth, tooth_numbers: [tooth], surfaces: [] });
      return;
    }
    const toothNumbers = treatment.tooth_numbers.includes(tooth)
      ? treatment.tooth_numbers.filter((current) => current !== tooth)
      : [...treatment.tooth_numbers, tooth];
    onChange({
      tooth_numbers: toothNumbers,
      tooth_number: toothNumbers[0] ?? null,
      surfaces: [],
    });
  }

  function toggleSurface(surface: DentalSurface) {
    onChange({
      surfaces: treatment.surfaces.includes(surface)
        ? treatment.surfaces.filter((current) => current !== surface)
        : [...treatment.surfaces, surface],
    });
  }

  return (
    <div className="space-y-4 rounded-lg border bg-background p-3">
      <fieldset aria-invalid={Boolean(toothError)} className="space-y-3">
        <legend className="text-sm font-medium">
          {multi ? "Select teeth — Indian Standard IS 8815" : "Tooth number — Indian Standard IS 8815"}
        </legend>
        <div className="flex gap-2" aria-label="Dentition">
          {(["permanent", "primary"] as const).map((dentition) => (
            <Button
              key={dentition}
              type="button"
              size="sm"
              variant={treatment.dentition === dentition ? "default" : "outline"}
              aria-pressed={treatment.dentition === dentition}
              onClick={() => {
                const toothNumbers = treatment.tooth_numbers.filter((tooth) => (
                  dentition === "primary" ? isPrimaryIndianTooth(tooth) : !isPrimaryIndianTooth(tooth)
                ));
                onChange({
                  dentition,
                  tooth_number: multi
                    ? toothNumbers[0] ?? null
                    : treatment.tooth_number && (
                      dentition === "primary" ? isPrimaryIndianTooth(treatment.tooth_number) : !isPrimaryIndianTooth(treatment.tooth_number)
                    ) ? treatment.tooth_number : null,
                  tooth_numbers: toothNumbers,
                  surfaces: [],
                });
              }}
            >
              {dentition === "permanent" ? "Permanent teeth" : "Primary teeth"}
            </Button>
          ))}
        </div>
        <div className="rounded-xl border bg-muted/20 p-3">
          <div className="mb-2 flex items-center justify-between gap-4 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground" aria-hidden="true">
            <span>Patient&apos;s right</span>
            <span>Patient&apos;s left</span>
          </div>
          <div className="overflow-x-auto pb-2" role="group" aria-label={`${treatment.dentition} Indian Standard tooth chart`}>
            <div className="min-w-[46rem] space-y-3">
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Upper arch</p>
                  <ToothChart
                    teeth={teeth.slice(0, half)}
                    selected={multi ? treatment.tooth_numbers : treatment.tooth_number}
                    arch="upper"
                    onSelect={selectTooth}
                />
              </div>
              <div aria-hidden="true" className="border-t-2 border-dashed border-primary/20" />
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Lower arch</p>
                  <ToothChart
                    teeth={teeth.slice(half)}
                    selected={multi ? treatment.tooth_numbers : treatment.tooth_number}
                    arch="lower"
                    onSelect={selectTooth}
                />
              </div>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {multi ? "Select or deselect as many tooth images as needed for this one treatment." : "Select a tooth image."} The Indian Standard number is shown beside each tooth; swipe horizontally on a small screen.
        </p>
        {toothError && <FieldError message={toothError} />}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Tooth surfaces <span className="font-normal text-muted-foreground">(optional)</span></legend>
        <div className="flex flex-wrap gap-2">
          {DENTAL_SURFACES.map((surface) => {
            const selected = treatment.surfaces.includes(surface);
            return (
              <Button
                key={surface}
                type="button"
                size="sm"
                variant={selected ? "secondary" : "outline"}
                aria-pressed={selected}
                onClick={() => toggleSurface(surface)}
              >
                {SURFACE_LABELS[surface]}
              </Button>
            );
          })}
        </div>
        {surfaceError && <FieldError message={surfaceError} />}
      </fieldset>
    </div>
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
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error && <FieldError message={error} />}
    </div>
  );
}

function FieldError({ message }: { message: string }) {
  return <p className="text-xs text-destructive">{message}</p>;
}
