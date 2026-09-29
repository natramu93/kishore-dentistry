import { Badge } from "@/components/ui/badge";
import { formatClinicalSite } from "@/lib/clinical";
import { fmt } from "@/lib/tz";
import { treatmentProgressLabel, type PatientTreatmentProgress } from "@/lib/treatment-progress";

export function TreatmentProgressSummary({ progress }: { progress: PatientTreatmentProgress }) {
  return (
    <section aria-label="Treatment progress across all visits" className="space-y-3 rounded-xl border p-4">
      <div>
        <h2 className="text-base font-semibold">Treatment progress</h2>
        <p className="mt-1 text-xs text-muted-foreground">Across all recorded visits. Later care resolves a plan only when explicitly linked and marked completed, never from an invoice or payment. Tooth findings remain part of the clinical review until reassessed.</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {(["planned", "completed"] as const).map((status) => {
          const group = progress[status];
          const label = treatmentProgressLabel(status);
          const more = group.total !== null && group.total > group.records.length;
          return (
            <section key={status} aria-label={label} className={`min-w-0 rounded-lg border p-3 ${status === "planned" ? "border-amber-300 bg-amber-50/50 dark:bg-amber-950/15" : "border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/15"}`}>
              <h3 className="flex items-center justify-between gap-2 font-semibold">{label}<Badge variant="secondary">{group.total ?? `${group.records.length}+`}</Badge></h3>
              <p className="mt-1 text-xs text-muted-foreground">{status === "planned" ? "Oldest planned work first" : "Most recently recorded treatment first"}</p>
              {group.total === null && <p className="mt-2 text-sm" role="status">Total unavailable; only the loaded records are shown.</p>}
              {more && <p className="mt-2 rounded-md border p-2 text-sm" role="status">Showing {group.records.length} of {group.total}. {group.total! - group.records.length} more {status === "planned" ? "planned" : "completed"} treatments remain in the visit history below.</p>}
              {group.records.length === 0 && <p className="py-3 text-sm text-muted-foreground">{status === "planned" ? "No planned treatments recorded." : "No completed treatments recorded."}</p>}
              <ul className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto" aria-label={`${label} treatments`}>
                {group.records.map((treatment) => (
                  <li key={treatment.id} className="rounded-md border bg-background p-3 text-sm">
                    <p className="font-medium">{treatment.treatment_name ?? "Treatment"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{treatment.treatment_code ? `${treatment.treatment_code} · ` : ""}{formatClinicalSite(treatment)}</p>
                    {status === "planned" && treatment.remaining_tooth_numbers && treatment.remaining_tooth_numbers.length < treatment.tooth_numbers.length && (
                      <p className="mt-2 font-medium text-amber-800 dark:text-amber-300">Partly treated · Still to treat: {treatment.remaining_tooth_numbers.join(", ")}</p>
                    )}
                    {treatment.planned_treatment_id && <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">Completed from an earlier treatment plan</p>}
                    <p className="mt-1 text-xs text-muted-foreground">{status === "completed" ? "Treated" : "Planned"} {fmt(status === "completed" ? treatment.performed_at ?? treatment.treated_at : treatment.treated_at)}{treatment.doctor?.full_name ? ` · ${treatment.doctor.full_name}` : ""}</p>
                    {treatment.notes && <p className="mt-2 whitespace-pre-wrap break-words">{treatment.notes}</p>}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </section>
  );
}
