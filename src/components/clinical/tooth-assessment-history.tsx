import { Badge } from "@/components/ui/badge";
import { describeIndianTooth } from "@/lib/clinical";
import { fmt } from "@/lib/tz";
import { cn } from "@/lib/utils";

export type ToothAssessmentHistoryItem = {
  id: string;
  tooth_number: string;
  tooth_state: string;
  conditions: readonly string[] | null;
  surfaces: readonly string[] | null;
  clinical_findings: string | null;
  diagnosis: string | null;
  prognosis: string | null;
  recommended_action: string | null;
  future_plan: string | null;
  notes: string | null;
  assessed_at?: string | null;
  signed_at?: string | null;
  doctor_name?: string | null;
};

export type ToothAssessmentHistoryProps = {
  assessments: readonly ToothAssessmentHistoryItem[];
  className?: string;
  emptyMessage?: string;
};

const STATE_LABELS: Record<string, string> = {
  sound: "Sound / healthy",
  present: "Present — finding noted",
  missing: "Missing",
  unerupted: "Unerupted",
  impacted: "Impacted",
  retained_root: "Retained root",
  implant: "Implant",
};

const CONDITION_LABELS: Record<string, string> = {
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

const SURFACE_LABELS: Record<string, string> = {
  mesial: "Mesial",
  distal: "Distal",
  occlusal: "Occlusal",
  incisal: "Incisal",
  buccal: "Buccal",
  lingual: "Lingual",
  palatal: "Palatal",
  facial: "Facial",
};

const ACTION_LABELS: Record<string, string> = {
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

const PROGNOSIS_LABELS: Record<string, string> = {
  good: "Good",
  fair: "Fair",
  guarded: "Guarded",
  poor: "Poor",
  hopeless: "Hopeless",
};

function formatValue(value: string, labels?: Record<string, string>): string {
  return labels?.[value] ?? value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function recordedText(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function ToothAssessmentHistory({
  assessments,
  className,
  emptyMessage = "No general tooth findings have been recorded.",
}: ToothAssessmentHistoryProps) {
  if (assessments.length === 0) {
    return <p className={cn("text-sm text-muted-foreground", className)}>{emptyMessage}</p>;
  }

  return (
    <ul
      aria-label="General tooth assessment history"
      className={cn("grid gap-3", className)}
    >
      {assessments.map((assessment) => (
        <li key={assessment.id} className="min-w-0">
          <article className="min-w-0 rounded-lg border bg-background p-3 sm:p-4">
            <header className="flex flex-col gap-2 border-b pb-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h4 className="font-semibold leading-snug">
                  IS 8815 tooth <span className="font-mono tabular-nums">{assessment.tooth_number}</span>
                </h4>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {describeIndianTooth(assessment.tooth_number)}
                </p>
                {(assessment.assessed_at || assessment.doctor_name) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {assessment.assessed_at ? `Examined ${fmt(assessment.assessed_at)}` : "Examination date unavailable"}
                    {assessment.doctor_name ? ` · ${assessment.doctor_name}` : " · Clinician not recorded"}
                  </p>
                )}
              </div>
              <Badge variant="secondary" className="h-auto min-h-5 max-w-full justify-start whitespace-normal">
                State: {formatValue(assessment.tooth_state, STATE_LABELS)}
              </Badge>
            </header>

            <dl className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
              <TagDetail
                label="Clinical conditions"
                values={assessment.conditions}
                labels={CONDITION_LABELS}
              />
              <TagDetail
                label="Affected surfaces"
                values={assessment.surfaces}
                labels={SURFACE_LABELS}
              />
              <TextDetail label="Clinical findings / analysis" value={assessment.clinical_findings} />
              <TextDetail label="Tooth-level diagnosis" value={assessment.diagnosis} />
              <TextDetail
                label="Prognosis"
                value={assessment.prognosis}
                labels={PROGNOSIS_LABELS}
              />
              <TextDetail
                label="Recommended future action"
                value={assessment.recommended_action}
                labels={ACTION_LABELS}
              />
              <TextDetail label="Future treatment / follow-up plan" value={assessment.future_plan} />
              <TextDetail label="Additional tooth notes" value={assessment.notes} />
            </dl>
          </article>
        </li>
      ))}
    </ul>
  );
}

function TagDetail({
  label,
  values,
  labels,
}: {
  label: string;
  values: readonly string[] | null;
  labels: Record<string, string>;
}) {
  return (
    <div className="min-w-0 rounded-md bg-muted/40 p-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1.5">
        {values?.length ? (
          <ul className="flex flex-wrap gap-1.5" aria-label={label}>
            {values.map((value, index) => (
              <li key={`${value}-${index}`}>
                <Badge variant="outline" className="h-auto min-h-5 whitespace-normal text-left">
                  {formatValue(value, labels)}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-sm text-muted-foreground">None recorded</span>
        )}
      </dd>
    </div>
  );
}

function TextDetail({
  label,
  value,
  labels,
}: {
  label: string;
  value: string | null;
  labels?: Record<string, string>;
}) {
  const text = recordedText(value);

  return (
    <div className="min-w-0 rounded-md bg-muted/40 p-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 whitespace-pre-wrap break-words text-sm", !text && "text-muted-foreground")}>
        {text ? (labels ? formatValue(text, labels) : text) : "Not recorded"}
      </dd>
    </div>
  );
}
