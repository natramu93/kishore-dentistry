import { Badge } from "@/components/ui/badge";
import { formatClinicalSite } from "@/lib/clinical";
import { fmt } from "@/lib/tz";
import type { TreatmentProgressGroup } from "@/lib/treatment-progress";
import { TreatmentDetailsDialog } from "./treatment-details-dialog";

export function TreatmentProgressSummary({ planned, leadId }: { planned: TreatmentProgressGroup; leadId: string }) {
  return (
    <section aria-labelledby="pending-treatment-title" className="space-y-3 rounded-xl border border-amber-300 bg-amber-50/50 p-4 dark:bg-amber-950/15">
      <h2 id="pending-treatment-title" className="flex items-center justify-between gap-2 text-base font-semibold">
        Yet to treat <Badge aria-label="Pending treatment count" variant="secondary">{planned.total ?? `${planned.records.length}+`}</Badge>
      </h2>
      {planned.total === null && <p className="text-sm" role="status">Total unavailable; only loaded records are shown.</p>}
      {planned.total !== null && planned.total > planned.records.length && (
        <p className="text-sm" role="status">Showing {planned.records.length} of {planned.total} pending treatments.</p>
      )}
      {planned.records.length === 0 ? (
        <p className="text-sm text-muted-foreground">No planned treatments recorded.</p>
      ) : (
        <ul className="max-h-[28rem] space-y-2 overflow-y-auto p-1">
          {planned.records.map((treatment) => (
            <li key={treatment.id}>
              <TreatmentDetailsDialog leadId={leadId} treatmentId={treatment.id} name={treatment.treatment_name ?? "Treatment"}>
                <span className="block font-medium">{treatment.treatment_name ?? "Treatment"}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{treatment.treatment_code ? `${treatment.treatment_code} · ` : ""}{formatClinicalSite(treatment)}</span>
                {treatment.remaining_tooth_numbers && treatment.remaining_tooth_numbers.length < treatment.tooth_numbers.length && (
                  <span className="mt-2 block font-medium text-amber-800 dark:text-amber-300">Partly treated · Still to treat: {treatment.remaining_tooth_numbers.join(", ")}</span>
                )}
                <span className="mt-1 block text-xs text-muted-foreground">Planned {fmt(treatment.treated_at)}{treatment.doctor?.full_name ? ` · ${treatment.doctor.full_name}` : ""}</span>
                {treatment.notes && <span className="mt-2 block whitespace-pre-wrap break-words">{treatment.notes}</span>}
              </TreatmentDetailsDialog>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
