"use client";

import { useState } from "react";
import { ClipboardPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToothChart } from "@/components/clinical/tooth-chart";
import {
  DENTAL_SURFACES,
  describeIndianTooth,
  INDIAN_PERMANENT_TEETH,
  INDIAN_PRIMARY_TEETH,
  TOOTH_CONDITIONS,
  TOOTH_PROGNOSES,
  TOOTH_RECOMMENDED_ACTIONS,
  TOOTH_STATES,
  type DentalSurface,
  type ToothAssessmentInput,
  type ToothCondition,
  type ToothState,
} from "@/lib/clinical";
import { cn } from "@/lib/utils";

type OdontogramEditorProps = {
  value: ToothAssessmentInput[];
  errors: Record<string, string>;
  onChange: (value: ToothAssessmentInput[]) => void;
  onAddTreatment: (tooth: string) => void;
};

const STATE_LABELS: Record<ToothState, string> = {
  sound: "Sound / healthy",
  present: "Present — finding noted",
  missing: "Missing",
  unerupted: "Unerupted",
  impacted: "Impacted",
  retained_root: "Retained root",
  implant: "Implant",
};

const CONDITION_LABELS: Record<ToothCondition, string> = {
  caries: "Caries",
  existing_restoration: "Existing restoration",
  crown: "Crown",
  bridge_abutment: "Bridge abutment",
  root_canal_treated: "Root canal treated",
  fracture: "Fracture / chip",
  mobility: "Mobility",
  periodontal_involvement: "Periodontal involvement",
  recession: "Recession",
  wear_erosion: "Wear / erosion",
  periapical_pathology: "Periapical pathology",
  discoloration: "Discoloration",
  sensitivity: "Sensitivity",
  other: "Other",
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

const ACTION_LABELS: Record<(typeof TOOTH_RECOMMENDED_ACTIONS)[number], string> = {
  monitor: "Monitor",
  investigate: "Investigate",
  preventive: "Preventive care",
  restorative: "Restorative",
  endodontic: "Endodontic",
  periodontal: "Periodontal",
  surgical: "Surgical",
  prosthetic: "Prosthetic",
  orthodontic: "Orthodontic",
  referral: "Referral",
  other: "Other",
};

const NO_SURFACE_STATES = new Set<ToothState>([
  "missing",
  "unerupted",
  "impacted",
  "retained_root",
  "implant",
]);

function blankAssessment(tooth: string): ToothAssessmentInput {
  return {
    tooth_number: tooth as ToothAssessmentInput["tooth_number"],
    tooth_state: "present",
    conditions: [],
    surfaces: [],
    clinical_findings: "",
    diagnosis: "",
    prognosis: null,
    recommended_action: null,
    future_plan: "",
    notes: "",
  };
}

export function OdontogramEditor({ value, errors, onChange, onAddTreatment }: OdontogramEditorProps) {
  const [dentition, setDentition] = useState<"permanent" | "primary">("permanent");
  const [selectedTooth, setSelectedTooth] = useState<string | null>(null);
  const teeth = dentition === "permanent" ? INDIAN_PERMANENT_TEETH : INDIAN_PRIMARY_TEETH;
  const half = teeth.length / 2;
  const selectedIndex = selectedTooth
    ? value.findIndex((assessment) => assessment.tooth_number === selectedTooth)
    : -1;
  const assessment = selectedIndex >= 0 ? value[selectedIndex]! : null;
  const displayed = selectedTooth ? assessment ?? blankAssessment(selectedTooth) : null;
  const documentedTeeth = value.map((item) => item.tooth_number);

  function update(patch: Partial<ToothAssessmentInput>) {
    if (!selectedTooth) return;
    const next = { ...(assessment ?? blankAssessment(selectedTooth)), ...patch };
    if (selectedIndex >= 0) {
      onChange(value.map((item, index) => index === selectedIndex ? next : item));
    } else {
      onChange([...value, next]);
    }
  }

  function updateState(toothState: ToothState) {
    update({
      tooth_state: toothState,
      ...(toothState === "sound" ? { conditions: [] } : {}),
      ...(NO_SURFACE_STATES.has(toothState) ? { surfaces: [] } : {}),
    });
  }

  function toggleCondition(condition: ToothCondition) {
    const current = assessment?.conditions ?? [];
    update({
      tooth_state: assessment?.tooth_state === "sound" ? "present" : assessment?.tooth_state ?? "present",
      conditions: current.includes(condition)
        ? current.filter((item) => item !== condition)
        : [...current, condition],
    });
  }

  function toggleSurface(surface: DentalSurface) {
    const current = assessment?.surfaces ?? [];
    update({
      surfaces: current.includes(surface)
        ? current.filter((item) => item !== surface)
        : [...current, surface],
    });
  }

  function removeAssessment() {
    if (selectedIndex < 0) return;
    onChange(value.filter((_, index) => index !== selectedIndex));
  }

  const error = (field: string) => selectedIndex >= 0
    ? errors[`tooth_assessments.${selectedIndex}.${field}`]
    : undefined;

  return (
    <section aria-labelledby="odontogram-heading" className="space-y-4">
      <div>
        <h2 id="odontogram-heading" className="text-base font-semibold">Tooth chart &amp; examination</h2>
        <p className="text-sm text-muted-foreground">
          Indian Standard IS 8815 two-digit numbering. Record findings here even when no treatment is performed today.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2" aria-label="Dentition shown">
          <Button
            type="button"
            size="sm"
            variant={dentition === "permanent" ? "default" : "outline"}
            aria-pressed={dentition === "permanent"}
            onClick={() => { setDentition("permanent"); setSelectedTooth(null); }}
          >
            Permanent teeth
          </Button>
          <Button
            type="button"
            size="sm"
            variant={dentition === "primary" ? "default" : "outline"}
            aria-pressed={dentition === "primary"}
            onClick={() => { setDentition("primary"); setSelectedTooth(null); }}
          >
            Primary (milk) teeth
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          <span aria-hidden="true" className="mr-1 inline-block size-2 rounded-full bg-emerald-500" />
          {value.length} tooth record{value.length === 1 ? "" : "s"} documented
        </p>
      </div>

      <div className="rounded-xl border bg-muted/20 p-3">
        <div className="mb-2 flex items-center justify-between gap-4 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground" aria-hidden="true">
          <span>Patient&apos;s right</span>
          <span>Patient&apos;s left</span>
        </div>
        <div className="overflow-x-auto pb-2" role="group" aria-label={`${dentition} teeth — Indian Standard dental chart`}>
          <div className={cn("space-y-3", dentition === "permanent" ? "min-w-[46rem]" : "min-w-[30rem]")}>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Upper arch</p>
              <ToothChart
                teeth={teeth.slice(0, half)}
                selected={selectedTooth}
                documentedTeeth={documentedTeeth}
                arch="upper"
                onSelect={setSelectedTooth}
              />
            </div>
            <div aria-hidden="true" className="border-t-2 border-dashed border-primary/20" />
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Lower arch</p>
              <ToothChart
                teeth={teeth.slice(half)}
                selected={selectedTooth}
                documentedTeeth={documentedTeeth}
                arch="lower"
                onSelect={setSelectedTooth}
              />
            </div>
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Select a tooth image to record or review its examination. Swipe horizontally on a small screen.</p>
      </div>

      <p className="sr-only" aria-live="polite">
        {selectedTooth ? `Selected tooth ${selectedTooth}, ${describeIndianTooth(selectedTooth)}` : "No tooth selected"}
      </p>

      {!displayed ? (
        <div className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
          Select a tooth above to enter its general findings and future treatment analysis.
        </div>
      ) : (
        <fieldset className="space-y-5 rounded-xl border bg-background p-3 sm:p-4">
          <legend className="px-1 text-sm font-semibold">
            Tooth {displayed.tooth_number} · {describeIndianTooth(displayed.tooth_number)}
          </legend>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`tooth-${displayed.tooth_number}-state`}>Tooth state</Label>
              <select
                id={`tooth-${displayed.tooth_number}-state`}
                value={displayed.tooth_state}
                onChange={(event) => updateState(event.target.value as ToothState)}
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
              >
                {TOOTH_STATES.map((state) => <option key={state} value={state}>{STATE_LABELS[state]}</option>)}
              </select>
              {error("tooth_state") && <FieldError message={error("tooth_state")!} />}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`tooth-${displayed.tooth_number}-prognosis`}>Prognosis</Label>
              <select
                id={`tooth-${displayed.tooth_number}-prognosis`}
                value={displayed.prognosis ?? ""}
                onChange={(event) => update({ prognosis: event.target.value ? event.target.value as ToothAssessmentInput["prognosis"] : null })}
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base capitalize outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
              >
                <option value="">Not recorded</option>
                {TOOTH_PROGNOSES.map((prognosis) => <option key={prognosis} value={prognosis}>{prognosis}</option>)}
              </select>
            </div>
          </div>

          {displayed.tooth_state !== "sound" && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Clinical conditions</legend>
              <div className="flex flex-wrap gap-2">
                {TOOTH_CONDITIONS.map((condition) => (
                  <Button
                    key={condition}
                    type="button"
                    size="sm"
                    variant={displayed.conditions.includes(condition) ? "secondary" : "outline"}
                    aria-pressed={displayed.conditions.includes(condition)}
                    onClick={() => toggleCondition(condition)}
                  >
                    {CONDITION_LABELS[condition]}
                  </Button>
                ))}
              </div>
              {error("conditions") && <FieldError message={error("conditions")!} />}
            </fieldset>
          )}

          {!NO_SURFACE_STATES.has(displayed.tooth_state) && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Affected surfaces <span className="font-normal text-muted-foreground">(optional)</span></legend>
              <div className="flex flex-wrap gap-2">
                {DENTAL_SURFACES.map((surface) => (
                  <Button
                    key={surface}
                    type="button"
                    size="sm"
                    variant={displayed.surfaces.includes(surface) ? "secondary" : "outline"}
                    aria-pressed={displayed.surfaces.includes(surface)}
                    onClick={() => toggleSurface(surface)}
                  >
                    {SURFACE_LABELS[surface]}
                  </Button>
                ))}
              </div>
              {error("surfaces") && <FieldError message={error("surfaces")!} />}
            </fieldset>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id={`tooth-${displayed.tooth_number}-findings`}
              label="Clinical findings / analysis"
              value={displayed.clinical_findings}
              error={error("clinical_findings")}
              placeholder="Examination findings, measurements or observations"
              onChange={(clinical_findings) => update({ clinical_findings })}
            />
            <TextField
              id={`tooth-${displayed.tooth_number}-diagnosis`}
              label="Tooth-level diagnosis"
              value={displayed.diagnosis}
              error={error("diagnosis")}
              maxLength={1_000}
              placeholder="Diagnosis specific to this tooth"
              onChange={(diagnosis) => update({ diagnosis })}
            />
            <div className="space-y-1.5">
              <Label htmlFor={`tooth-${displayed.tooth_number}-action`}>Recommended future action</Label>
              <select
                id={`tooth-${displayed.tooth_number}-action`}
                value={displayed.recommended_action ?? ""}
                onChange={(event) => update({ recommended_action: event.target.value ? event.target.value as ToothAssessmentInput["recommended_action"] : null })}
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
              >
                <option value="">Not recorded</option>
                {TOOTH_RECOMMENDED_ACTIONS.map((action) => <option key={action} value={action}>{ACTION_LABELS[action]}</option>)}
              </select>
            </div>
            <TextField
              id={`tooth-${displayed.tooth_number}-plan`}
              label="Future treatment / follow-up plan"
              value={displayed.future_plan}
              error={error("future_plan")}
              placeholder="Planned review, investigation or possible future care"
              onChange={(future_plan) => update({ future_plan })}
            />
          </div>

          <TextField
            id={`tooth-${displayed.tooth_number}-notes`}
            label="Additional tooth notes"
            value={displayed.notes}
            error={error("notes")}
            placeholder="Any other tooth-specific context"
            onChange={(notes) => update({ notes })}
          />

          <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-between">
            <Button type="button" variant="ghost" size="sm" disabled={selectedIndex < 0} onClick={removeAssessment}>
              <Trash2 aria-hidden="true" /> Remove tooth record
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => onAddTreatment(displayed.tooth_number)}>
              <ClipboardPlus aria-hidden="true" /> Add coded treatment for this tooth
            </Button>
          </div>
        </fieldset>
      )}
    </section>
  );
}

function TextField({
  id,
  label,
  value,
  error,
  maxLength = 2_000,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  maxLength?: number;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        rows={2}
        maxLength={maxLength}
        value={value}
        aria-invalid={Boolean(error)}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && <FieldError message={error} />}
    </div>
  );
}

function FieldError({ message }: { message: string }) {
  return <p className="text-xs text-destructive">{message}</p>;
}
