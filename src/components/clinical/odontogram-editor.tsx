"use client";

import { useState } from "react";
import { ClipboardPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToothSelector } from "@/components/clinical/tooth-selector";
import {
  DENTAL_SURFACES,
  describeIndianTooth,
  TOOTH_CONDITIONS,
  TOOTH_PROGNOSES,
  TOOTH_RECOMMENDED_ACTIONS,
  TOOTH_STATES,
  type DentalSurface,
  type ToothAssessmentInput,
  type ToothCondition,
  type ToothState,
} from "@/lib/clinical";

type OdontogramEditorProps = {
  value: ToothAssessmentInput[];
  errors: Record<string, string>;
  onChange: (value: ToothAssessmentInput[]) => void;
  onAddTreatment: (teeth: string[]) => void;
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
  const [multiple, setMultiple] = useState(false);
  const [selectedTeeth, setSelectedTeeth] = useState<string[]>([]);
  const selectedTooth = selectedTeeth[0] ?? null;
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

  const error = (field: string) => {
    if (selectedIndex < 0) return undefined;
    const path = `tooth_assessments.${selectedIndex}.${field}`;
    return errors[path] ?? Object.entries(errors).find(([key]) => key.startsWith(`${path}.`))?.[1];
  };
  const teethWithErrors = [...new Set(Object.keys(errors).flatMap((key) => {
    const match = /^tooth_assessments\.(\d+)\./.exec(key);
    const tooth = match ? value[Number(match[1])]?.tooth_number : undefined;
    return tooth ? [tooth] : [];
  }))];

  return (
    <section aria-labelledby="odontogram-heading" className="space-y-4">
      <div>
        <h2 id="odontogram-heading" className="text-base font-semibold">Tooth chart &amp; examination</h2>
        <p className="text-sm text-muted-foreground">
          Select teeth and add a remark, even when no treatment is performed today. Indian Standard IS 8815 numbering.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" aria-label="Tooth entry mode">
          <Button type="button" size="sm" variant={!multiple ? "default" : "outline"} aria-pressed={!multiple} onClick={() => { setMultiple(false); setSelectedTeeth(selectedTeeth.slice(0, 1)); }}>
            Review one tooth
          </Button>
          <Button type="button" size="sm" variant={multiple ? "default" : "outline"} aria-pressed={multiple} onClick={() => setMultiple(true)}>
            Add to multiple teeth
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          <span aria-hidden="true" className="mr-1 inline-block size-2 rounded-full bg-emerald-500" />
          {value.length} tooth record{value.length === 1 ? "" : "s"} documented
        </p>
      </div>

      <ToothSelector value={selectedTeeth} onChange={setSelectedTeeth} multiple={multiple} documentedTeeth={documentedTeeth} />

      {teethWithErrors.length > 0 && (
        <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p>Review the highlighted details for these teeth:</p>
          <div className="flex flex-wrap gap-2">
            {teethWithErrors.map((tooth) => <Button key={tooth} type="button" size="sm" variant="outline" onClick={() => { setMultiple(false); setSelectedTeeth([tooth]); }}>Review tooth {tooth}</Button>)}
          </div>
        </div>
      )}

      {!displayed ? (
        <div className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
          Select a tooth above to enter its general findings and future treatment analysis.
        </div>
      ) : multiple ? (
        <MultipleToothEntry key={selectedTeeth.join(",")} value={value} selectedTeeth={selectedTeeth} onChange={onChange} onAddTreatment={onAddTreatment} />
      ) : (
        <fieldset className="space-y-5 rounded-xl border bg-background p-3 sm:p-4">
          <legend className="px-1 text-sm font-semibold">
            Tooth {displayed.tooth_number} · {describeIndianTooth(displayed.tooth_number)}
          </legend>

          <TextField
            id={`tooth-${displayed.tooth_number}-notes`}
            label="Remark"
            value={displayed.notes}
            error={error("notes")}
            placeholder="Finding, review and suggested next steps for this tooth"
            onChange={(notes) => update({ notes })}
          />

          <EarlierDetails assessment={displayed} />

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
              <Label htmlFor={`tooth-${displayed.tooth_number}-action`}>Next action <span className="font-normal text-muted-foreground">(optional)</span></Label>
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
          </div>

          <details className="rounded-lg border p-3" open={Boolean(error("conditions") || error("surfaces")) || undefined}>
            <summary className="cursor-pointer text-sm font-medium">Clinical details <span className="font-normal text-muted-foreground">{displayed.conditions.length > 0 ? `· ${displayed.conditions.length} condition${displayed.conditions.length === 1 ? "" : "s"} recorded` : "(optional)"}</span></summary>
            <div className="mt-4 space-y-4">
              {(displayed.conditions.length > 0 || displayed.surfaces.length > 0) && <p className="text-xs text-muted-foreground">{displayed.conditions.map((condition) => CONDITION_LABELS[condition]).join(", ")}{displayed.surfaces.length > 0 ? ` · ${displayed.surfaces.map((surface) => SURFACE_LABELS[surface]).join(", ")}` : ""}</p>}
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
          </details>

          <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-between">
            <Button type="button" variant="ghost" size="sm" disabled={selectedIndex < 0} onClick={removeAssessment}>
              <Trash2 aria-hidden="true" /> Remove tooth record
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => onAddTreatment([displayed.tooth_number])}>
              <ClipboardPlus aria-hidden="true" /> Add treatment for this tooth
            </Button>
          </div>
        </fieldset>
      )}
    </section>
  );
}

function EarlierDetails({ assessment }: { assessment: ToothAssessmentInput }) {
  const previous = [
    ["Finding", assessment.clinical_findings],
    ["Diagnosis", assessment.diagnosis],
    ["Plan", assessment.future_plan],
  ].filter(([, text]) => text?.trim());
  if (previous.length === 0) return null;
  return (
    <details className="rounded-lg bg-muted/30 p-3">
      <summary className="cursor-pointer text-sm font-medium">Earlier recorded details</summary>
      <p className="mt-2 text-xs text-muted-foreground">These details are kept unchanged. Add updates in the remark above.</p>
      <dl className="mt-2 space-y-2 text-sm">
        {previous.map(([label, text]) => <div key={label}><dt className="font-medium">{label}</dt><dd className="whitespace-pre-wrap break-words text-muted-foreground">{text}</dd></div>)}
      </dl>
    </details>
  );
}

function MultipleToothEntry({
  value,
  selectedTeeth,
  onChange,
  onAddTreatment,
}: {
  value: ToothAssessmentInput[];
  selectedTeeth: string[];
  onChange: (value: ToothAssessmentInput[]) => void;
  onAddTreatment: (teeth: string[]) => void;
}) {
  const [remark, setRemark] = useState("");
  const [conditions, setConditions] = useState<ToothCondition[]>([]);
  const [action, setAction] = useState<ToothAssessmentInput["recommended_action"]>(null);
  // The original values are the base for this shared entry. Keystrokes replace only
  // this entry's contribution, never a tooth's earlier, potentially different note.
  const [original] = useState(() => new Map(value.map((item) => [item.tooth_number, item])));
  const [error, setError] = useState("");

  function updateShared(nextRemark: string, nextConditions: ToothCondition[], nextAction: ToothAssessmentInput["recommended_action"]) {
    setError("");
    const updated = selectedTeeth.map((tooth) => {
      const existing = original.get(tooth as ToothAssessmentInput["tooth_number"]) ?? blankAssessment(tooth);
      const notes = [existing.notes, nextRemark].filter(Boolean).join("\n\n");
      return {
        ...existing,
        notes,
        conditions: [...new Set([...existing.conditions, ...nextConditions])],
        tooth_state: existing.tooth_state === "sound" && nextConditions.length > 0 ? "present" as const : existing.tooth_state,
        recommended_action: nextAction ?? existing.recommended_action,
      };
    });
    const tooLong = updated.filter((item) => item.notes.length > 2_000);
    if (tooLong.length > 0) {
      setError(`The combined remark is too long for ${tooLong.map((item) => item.tooth_number).join(", ")}. Shorten this remark or review those teeth individually. The last change was not added.`);
      return;
    }
    const byTooth = new Map(updated.map((item) => [item.tooth_number, item]));
    const existingTeeth = new Set(value.map((item) => item.tooth_number));
    onChange([
      ...value.map((item) => byTooth.get(item.tooth_number) ?? item),
      ...updated.filter((item) => !existingTeeth.has(item.tooth_number)),
    ]);
    setRemark(nextRemark);
    setConditions(nextConditions);
    setAction(nextAction);
  }

  return (
    <fieldset className="space-y-4 rounded-xl border bg-background p-3 sm:p-4">
      <legend className="px-1 text-sm font-semibold">Shared entry · {selectedTeeth.join(", ")}</legend>
      <p className="text-xs text-muted-foreground">Choose teeth first, then enter the shared remark. Updates are included when you save the case sheet. Each tooth&apos;s earlier findings and remarks are preserved.</p>
      <TextField id="shared-tooth-remark" label="Remark for selected teeth" value={remark} placeholder="Finding, review and suggested next steps for these teeth" onChange={(text) => updateShared(text, conditions, action)} />
      <div className="space-y-1.5">
        <Label htmlFor="shared-tooth-action">Next action <span className="font-normal text-muted-foreground">(optional)</span></Label>
        <select id="shared-tooth-action" value={action ?? ""} onChange={(event) => updateShared(remark, conditions, event.target.value ? event.target.value as ToothAssessmentInput["recommended_action"] : null)} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm">
          <option value="">Keep each tooth&apos;s current action</option>
          {TOOTH_RECOMMENDED_ACTIONS.map((item) => <option key={item} value={item}>{ACTION_LABELS[item]}</option>)}
        </select>
      </div>
      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">Add clinical conditions <span className="font-normal text-muted-foreground">(optional)</span></summary>
        <div className="mt-3 flex flex-wrap gap-2">
          {TOOTH_CONDITIONS.map((condition) => <Button key={condition} type="button" size="sm" variant={conditions.includes(condition) ? "secondary" : "outline"} aria-pressed={conditions.includes(condition)} onClick={() => updateShared(remark, conditions.includes(condition) ? conditions.filter((item) => item !== condition) : [...conditions, condition], action)}>{CONDITION_LABELS[condition]}</Button>)}
        </div>
      </details>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {(remark || conditions.length > 0 || action) && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">Entry added to {selectedTeeth.length} {selectedTeeth.length === 1 ? "tooth" : "teeth"}. Save the case sheet to keep these updates.</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="outline" onClick={() => onAddTreatment(selectedTeeth)}><ClipboardPlus aria-hidden="true" /> Add treatment for selected teeth</Button>
      </div>
    </fieldset>
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
        rows={3}
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
