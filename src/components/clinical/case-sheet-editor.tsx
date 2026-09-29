"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { amendCaseSheetAction, finalizeCaseSheetAction } from "@/actions/case-sheets";
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
import { ToothSelector } from "@/components/clinical/tooth-selector";
import { OdontogramEditor } from "@/components/clinical/odontogram-editor";
import { PrescriptionItemsEditor } from "@/components/clinical/prescription-items-editor";
import { MedicalHistoryFields } from "@/components/patients/medical-history-fields";
import {
  createMedicalHistoryDraft,
  type MedicalHistoryDraft,
} from "@/lib/medical-history";
import type { PrescriptionItemDraft } from "@/lib/prescriptions";
import type { MedicationSuggestion } from "@/lib/database.types";
import type { TreatmentProgressGroup, TreatmentProgressRecord } from "@/lib/treatment-progress";
import {
  ARCH_SITES,
  caseSheetPayloadSchema,
  DENTAL_SURFACES,
  formatClinicalSite,
  isIndianToothNumber,
  QUADRANT_SITES,
  type CaseSheetPayload,
  type CaseSheetTreatmentInput,
  type DentalSurface,
  type ToothAssessmentInput,
  type TreatmentSiteScope,
} from "@/lib/clinical";
import { toClinicInputValue } from "@/lib/tz";

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
  medicationSuggestions?: MedicationSuggestion[];
  initialMedicalHistory?: MedicalHistoryDraft;
  initialValues?: CaseSheetEditorInitialValues;
  caseSheetId?: string;
  expectedVersion?: number;
  successHref?: string;
  pendingPlans?: TreatmentProgressGroup;
};

export type CaseSheetEditorInitialValues = {
  doctorId: string;
  visitAt: string;
  chiefComplaint: string;
  findings: string;
  diagnosis: string;
  plan: string;
  medicalHistory: MedicalHistoryDraft;
  prescriptions: PrescriptionItemDraft[];
  toothAssessments: ToothAssessmentInput[];
  treatments: Array<CaseSheetTreatmentInput & {
    treatment_id: string;
    treatment_name: string;
    locked: boolean;
    hasAttachments: boolean;
    sourcePlanNotes?: string | null;
    availablePlanTeeth?: string[];
    hasLaterCare?: boolean;
  }>;
};

type EditableTreatment = CaseSheetTreatmentInput & {
  rowKey: string;
  codeSearch: string;
  codePickerOpen: boolean;
  locked: boolean;
  hasAttachments: boolean;
  sourcePlanNotes?: string | null;
  availablePlanTeeth?: string[];
  hasLaterCare?: boolean;
};

type FieldErrors = Record<string, string>;

const SITE_SCOPE_OPTIONS: { value: TreatmentSiteScope; label: string }[] = [
  { value: "not_applicable", label: "Not tooth-specific" },
  { value: "full_mouth", label: "Full mouth" },
  { value: "arch", label: "Arch" },
  { value: "quadrant", label: "Quadrant" },
  { value: "tooth", label: "Teeth — select one or more" },
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
    treatment_code: "",
    status: "planned",
    site_scope: "not_applicable",
    site_detail: null,
    tooth_number: null,
    tooth_numbers: [],
    surfaces: [],
    notes: "",
    locked: false,
    hasAttachments: false,
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
  medicationSuggestions = [],
  initialMedicalHistory,
  initialValues,
  caseSheetId,
  expectedVersion,
  successHref,
  pendingPlans,
}: CaseSheetEditorProps) {
  const router = useRouter();
  const idPrefix = useId();
  const nextRowKey = useRef((initialValues?.treatments.length ?? 0) + 1);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const [pending, startTransition] = useTransition();
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [doctorId, setDoctorId] = useState(() => initialValues?.doctorId ?? (doctors.length === 1 ? doctors[0]!.id : ""));
  const [visitAt] = useState(() => initialValues ? toClinicInputValue(initialValues.visitAt) : localDateTimeNow());
  const [chiefComplaint, setChiefComplaint] = useState(initialValues?.chiefComplaint ?? "");
  const [remarks, setRemarks] = useState(initialValues?.findings ?? "");
  // These historical sections remain intact; new narrative is stored in findings.
  const diagnosis = initialValues?.diagnosis ?? "";
  const plan = initialValues?.plan ?? "";
  const [medicalHistory, setMedicalHistory] = useState<MedicalHistoryDraft>(() => (
    createMedicalHistoryDraft(initialValues?.medicalHistory ?? initialMedicalHistory)
  ));
  const [prescriptions, setPrescriptions] = useState<PrescriptionItemDraft[]>(initialValues?.prescriptions ?? []);
  const [toothAssessments, setToothAssessments] = useState<ToothAssessmentInput[]>(initialValues?.toothAssessments ?? []);
  const [amendmentReason, setAmendmentReason] = useState("");
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [treatments, setTreatments] = useState<EditableTreatment[]>(() => (
    initialValues?.treatments.map((treatment, index) => ({
      ...treatment,
      rowKey: `treatment-${index + 1}`,
      codeSearch: `${treatment.treatment_code} — ${treatment.treatment_name}`,
      codePickerOpen: false,
    })) ?? []
  ));

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

  function continuePlan(source: TreatmentProgressRecord) {
    if (!source.treatment_code || treatments.some((t) => t.planned_treatment_id === source.id)) return;
    const teeth = (source.remaining_tooth_numbers ?? source.tooth_numbers).filter(isIndianToothNumber);
    const rowKey = `treatment-${nextRowKey.current++}`;
    setDirty(true);
    setTreatments((current) => [...current, {
      ...blankTreatment(rowKey),
      planned_treatment_id: source.id,
      treatment_code: source.treatment_code!,
      codeSearch: `${source.treatment_code} — ${source.treatment_name ?? "Earlier treatment plan"}`,
      // Selecting a plan is not clinical confirmation of completed care.
      status: "planned",
      site_scope: source.site_scope === "tooth" || source.site_scope === "multi_tooth"
        ? teeth.length > 1 ? "multi_tooth" : "tooth" : source.site_scope ?? "not_applicable",
      site_detail: source.site_detail,
      tooth_number: teeth[0] ?? null,
      tooth_numbers: teeth,
      surfaces: (source.surfaces ?? []) as DentalSurface[],
      sourcePlanNotes: source.notes,
      availablePlanTeeth: teeth,
    }]);
    setSelectedPlanId("");
  }

  function addTreatmentForTeeth(teeth: string[]) {
    const toothNumbers = [...new Set(teeth.filter(isIndianToothNumber))];
    if (!toothNumbers.length) return;
    const rowKey = `treatment-${nextRowKey.current}`;
    nextRowKey.current += 1;
    setDirty(true);
    setTreatments((current) => [
      ...current,
      {
        ...blankTreatment(rowKey),
        site_scope: toothNumbers.length > 1 ? "multi_tooth" : "tooth",
        tooth_number: toothNumbers[0]!,
        tooth_numbers: toothNumbers,
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
      findings: remarks,
      diagnosis,
      plan,
      medical_history: medicalHistory,
      prescriptions,
      tooth_assessments: toothAssessments,
      treatments: treatments.map(({
        treatment_id,
        planned_treatment_id,
        treatment_code,
        status,
        site_scope,
        site_detail,
        tooth_number,
        tooth_numbers,
        surfaces,
        notes,
      }) => ({
        ...(treatment_id ? { treatment_id } : {}),
        ...(planned_treatment_id ? { planned_treatment_id } : {}),
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
    treatments.forEach((treatment, index) => {
      if (treatment.treatment_code && !treatment.locked && !treatment.treatment_id && !treatmentCodeSet.has(treatment.treatment_code)) {
        nextErrors[`treatments.${index}.treatment_code`] = "Select a treatment from the approved code list";
      }
    });
    if (caseSheetId && amendmentReason.trim().length < 5) {
      nextErrors.amendment_reason = "Enter why this case sheet is being amended (at least 5 characters)";
    }

    if (!parsed.success || Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      requestAnimationFrame(() => errorSummaryRef.current?.focus());
      return;
    }

    setErrors({});
    startTransition(async () => {
      try {
        const result = caseSheetId && expectedVersion
          ? await amendCaseSheetAction({
              ...parsed.data,
              case_sheet_id: caseSheetId,
              expected_version: expectedVersion,
              amendment_reason: amendmentReason,
            })
          : await finalizeCaseSheetAction(parsed.data);
        if (result.ok) {
          setDirty(false);
          toast.success(caseSheetId ? "Case sheet amendment saved" : "Case sheet saved");
          if (successHref) router.push(successHref);
          else router.refresh();
        } else {
          setErrors({ form: result.error });
          requestAnimationFrame(() => errorSummaryRef.current?.focus());
          toast.error(result.error);
        }
      } catch {
        const message = "We could not confirm that the case sheet was saved. Your entries are still here. Check the patient history before retrying.";
        setErrors({ form: message });
        requestAnimationFrame(() => errorSummaryRef.current?.focus());
        toast.error(message);
      }
    });
  }

  const errorMessages = [...new Set(Object.values(errors))];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{caseSheetId ? "Amend digital dental case sheet" : "Digital dental case sheet"}</CardTitle>
        <CardDescription>
          {caseSheetId
            ? "Update the remarks and treatment progress. The original visit time and audit history are preserved."
            : "Add the patient’s concern and one clinical remark, review medical history, then save. Tooth findings, treatments and prescriptions can be added when needed."}
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
                  disabled={doctorLocked || Boolean(caseSheetId)}
                  aria-invalid={Boolean(errors.doctor_id)}
                  onChange={(event) => { setDirty(true); setDoctorId(event.target.value); }}
                  className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm"
                >
                  <option value="">Select doctor…</option>
                  {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.label}</option>)}
                </select>
                {(doctorLocked || caseSheetId) && (
                  <p className="text-xs text-muted-foreground">
                    The treating doctor is fixed for this visit.
                  </p>
                )}
              </Field>
              <Field label={caseSheetId ? "Original visit date and time" : "Visit date and time (captured on save)"} htmlFor={`${idPrefix}-visit-at`} error={errors.visit_at}>
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
                  {caseSheetId
                    ? "The original patient visit time is preserved; this amendment records its own separate audit time."
                    : "The server records the entry time when this case sheet is finalized; it does not change or need to match the appointment schedule."}
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
            <Field label="Clinical remarks" htmlFor={`${idPrefix}-remarks`} error={errors.findings}>
              <Textarea
                id={`${idPrefix}-remarks`}
                rows={4}
                required={!diagnosis && !plan}
                maxLength={5_000}
                value={remarks}
                aria-invalid={Boolean(errors.findings)}
                aria-describedby={`${idPrefix}-remarks-help`}
                onChange={(event) => { setDirty(true); setRemarks(event.target.value); }}
                placeholder="Examination, assessment, advice and next steps — all in one note"
              />
              <p id={`${idPrefix}-remarks-help`} className="text-xs text-muted-foreground">
                One note is enough. Add tooth-specific findings or planned treatments below when needed.
              </p>
            </Field>
            {(diagnosis || plan) && (
              <details className="rounded-lg border bg-muted/15 p-3">
                <summary className="cursor-pointer text-sm font-medium">Previously recorded diagnosis and plan</summary>
                <p className="mt-2 text-xs text-muted-foreground">Preserved from the original record. Describe any correction or updated plan in Clinical remarks.</p>
                {diagnosis && <div className="mt-3"><p className="text-xs font-medium text-muted-foreground">Previous diagnosis</p><p className="whitespace-pre-wrap text-sm">{diagnosis}</p></div>}
                {plan && <div className="mt-3"><p className="text-xs font-medium text-muted-foreground">Previous plan</p><p className="whitespace-pre-wrap text-sm">{plan}</p></div>}
              </details>
            )}
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

          {caseSheetId && (
            <Field label="Reason for amendment" htmlFor={`${idPrefix}-amendment-reason`} error={errors.amendment_reason}>
              <Textarea
                id={`${idPrefix}-amendment-reason`}
                rows={2}
                maxLength={1000}
                required
                value={amendmentReason}
                aria-invalid={Boolean(errors.amendment_reason)}
                onChange={(event) => { setDirty(true); setAmendmentReason(event.target.value); }}
                placeholder="Explain what needs correcting or updating"
              />
            </Field>
          )}

          <OdontogramEditor
            value={toothAssessments}
            errors={errors}
            onChange={(next) => {
              setDirty(true);
              setToothAssessments(next);
            }}
            onAddTreatment={addTreatmentForTeeth}
          />

          <section aria-labelledby={`${idPrefix}-treatments-heading`} className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 id={`${idPrefix}-treatments-heading`} className="text-base font-semibold">Treatment plan &amp; completed work <span className="font-normal text-muted-foreground">(optional)</span></h2>
                <p className="text-sm text-muted-foreground">Choose a code, select the teeth, then mark whether treatment is planned or completed. Billing is handled separately.</p>
                {treatments.length > 0 && <p className="mt-1 text-sm font-medium" aria-live="polite">{treatments.filter((treatment) => treatment.status === "planned").length} planned · {treatments.filter((treatment) => treatment.status === "completed").length} completed</p>}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addTreatment}>
                <Plus aria-hidden="true" /> Add treatment
              </Button>
            </div>

            {pendingPlans && pendingPlans.records.length > 0 && (
              <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/40 p-3 dark:bg-amber-950/15">
                <Label htmlFor={`${idPrefix}-earlier-plan`}>Continue an earlier treatment plan</Label>
                <p className="text-xs text-muted-foreground">Select pending work, choose only teeth treated today, then explicitly mark it completed. The original signed plan and notes are retained.</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <select id={`${idPrefix}-earlier-plan`} value={selectedPlanId} onChange={(event) => setSelectedPlanId(event.target.value)} className="h-11 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm">
                    <option value="">Choose pending work…</option>
                    {pendingPlans.records.filter((plan) => plan.case_sheet_id && plan.treatment_code && plan.case_sheet_id !== caseSheetId && !treatments.some((t) => t.planned_treatment_id === plan.id)).map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.treatment_name ?? plan.treatment_code} · {plan.remaining_tooth_numbers?.length ? `Teeth ${plan.remaining_tooth_numbers.join(", ")}` : formatClinicalSite(plan)}
                      </option>
                    ))}
                  </select>
                  <Button type="button" variant="outline" disabled={!selectedPlanId} onClick={() => {
                    const plan = pendingPlans.records.find((item) => item.id === selectedPlanId);
                    if (plan) continuePlan(plan);
                  }}>Add to this visit</Button>
                </div>
                {pendingPlans.total !== null && pendingPlans.total > pendingPlans.records.length && <p role="status" className="text-xs">Showing the oldest {pendingPlans.records.length} of {pendingPlans.total} pending plans. Review the patient history for the remaining plans.</p>}
              </div>
            )}
            <div className="space-y-4">
              {treatments.length === 0 && (
                <div className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
                  No treatment added. You can save the examination on its own.
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
                  canRemove={!treatment.treatment_id && !treatment.locked && !treatment.hasAttachments && !treatment.hasLaterCare}
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
                suggestions={medicationSuggestions}
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

          <div className="sticky bottom-0 z-10 flex flex-col-reverse gap-2 border-t bg-background py-4 sm:flex-row sm:justify-end">
            <Button type="submit" disabled={pending} className="sm:min-w-44">
              {pending ? "Saving…" : "Save case sheet"}
            </Button>
          </div>
          {treatmentCodes.length === 0 && treatments.some((treatment) => !treatment.locked) && (
            <p role="alert" className="text-sm text-destructive">
              Treatment codes are unavailable. Remove any new treatment rows to save just the examination, or try again later.
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
    <fieldset disabled={treatment.locked} className="rounded-xl border bg-muted/15 p-3 sm:p-4 disabled:opacity-75">
      <legend className="px-1 text-sm font-semibold">Treatment {index + 1}</legend>
      {treatment.treatment_id && <p className="mb-3 text-xs text-muted-foreground">Saved treatments remain in history; edit details within the 24-hour window.</p>}
      {treatment.locked && (
        <p className="mb-3 text-xs text-muted-foreground">
          This treatment is locked because it is linked to an invoice.
        </p>
      )}
      {treatment.planned_treatment_id && (
        <div className="mb-3 space-y-2 rounded-md border border-amber-300 p-3 text-sm">
          <p className="font-medium">Continuation of an earlier signed plan</p>
          <p className="text-xs text-muted-foreground">Only the selected teeth are recorded as completed. Unselected teeth stay pending. {treatment.treatment_id ? "This signed completion remains in history; its notes and selected teeth may be corrected within the amendment window." : "Remove this line if treatment has not been completed today."}</p>
          {treatment.sourcePlanNotes && <p className="whitespace-pre-wrap break-words"><span className="font-medium">Original plan note: </span>{treatment.sourcePlanNotes}</p>}
        </div>
      )}
      {treatment.hasLaterCare && <p className="mb-3 text-sm text-muted-foreground">Later visits have completed work from this plan. Its code, teeth and status are retained; you can clarify its notes within the amendment window.</p>}
      {!treatment.locked && treatment.hasAttachments && (
        <p className="mb-3 text-xs text-muted-foreground">
          This treatment has linked files. Its code and tooth/site are protected, but its status can still be updated.
        </p>
      )}
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
                disabled={treatment.hasAttachments || treatment.hasLaterCare || Boolean(treatment.planned_treatment_id)}
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
              disabled={treatment.hasLaterCare || Boolean(treatment.treatment_id && treatment.planned_treatment_id)}
              value={treatment.status}
              onChange={(event) => onChange({ status: event.target.value as EditableTreatment["status"] })}
              className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
            >
              <option value="planned">{treatment.planned_treatment_id ? "Confirm completed care…" : "Planned"}</option>
              <option value="completed">Completed</option>
            </select>
          </Field>
          {canRemove && <div className="flex items-end justify-end">
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              aria-label={`Remove treatment ${index + 1}`}
              onClick={onRemove}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>}
        </div>

        <div className="grid gap-4 sm:grid-cols-1">
          <Field label="Treatment site" htmlFor={`${idPrefix}-scope`} error={error("site_scope")}>
            <select
              id={`${idPrefix}-scope`}
              value={treatment.site_scope === "multi_tooth" ? "tooth" : treatment.site_scope}
              disabled={treatment.hasAttachments || treatment.hasLaterCare || Boolean(treatment.planned_treatment_id)}
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
              disabled={treatment.hasAttachments || treatment.hasLaterCare || Boolean(treatment.planned_treatment_id)}
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
            toothError={error(treatment.site_scope === "multi_tooth" ? "tooth_numbers" : "tooth_number")}
            surfaceError={error("surfaces")}
            onChange={onChange}
            disabled={treatment.hasAttachments || treatment.hasLaterCare}
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
  toothError,
  surfaceError,
  onChange,
  disabled = false,
}: {
  treatment: EditableTreatment;
  toothError?: string;
  surfaceError?: string;
  onChange: (patch: Partial<EditableTreatment>) => void;
  disabled?: boolean;
}) {
  const [chartOpen, setChartOpen] = useState(treatment.tooth_numbers.length === 0);
  const toothErrorId = useId();
  function selectTeeth(teeth: string[]) {
    const toothNumbers = [...new Set(teeth.filter(isIndianToothNumber))];
    onChange({
      site_scope: toothNumbers.length > 1 ? "multi_tooth" : "tooth",
      tooth_numbers: toothNumbers,
      tooth_number: toothNumbers[0] ?? null,
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
      <details
        open={chartOpen || Boolean(toothError)}
        onToggle={(event) => setChartOpen(event.currentTarget.open)}
        aria-describedby={toothError ? toothErrorId : undefined}
        className="space-y-3"
      >
        <summary className="cursor-pointer text-sm font-medium">
          {treatment.tooth_numbers.length ? `Selected teeth: ${treatment.tooth_numbers.join(", ")} · change` : "Select teeth for this treatment"}
        </summary>
        <div className="pt-3">
          <ToothSelector
            value={treatment.tooth_numbers}
            selectableTeeth={treatment.planned_treatment_id ? treatment.availablePlanTeeth : undefined}
            onChange={selectTeeth}
            disabled={disabled}
            label="Teeth for this treatment — select one or more"
          />
        </div>
        {toothError && <div id={toothErrorId}><FieldError message={toothError} /></div>}
      </details>

      <details open={treatment.surfaces.length > 0 || Boolean(surfaceError)}>
        <summary className="cursor-pointer text-sm font-medium">Tooth surfaces <span className="font-normal text-muted-foreground">(optional)</span></summary>
        <fieldset disabled={disabled || Boolean(treatment.planned_treatment_id)} className="mt-3 space-y-2">
          <legend className="sr-only">Tooth surfaces</legend>
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
      </details>
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
