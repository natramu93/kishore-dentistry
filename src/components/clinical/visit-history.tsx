import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmt } from "@/lib/tz";
import { formatClinicalSite } from "@/lib/clinical";
import type { TreatmentProgressGroup } from "@/lib/treatment-progress";
import { TreatmentDetailsDialog } from "./treatment-details-dialog";

/** A compact list of recorded, completed care. The clinical record opens on demand. */
export function VisitHistory({ leadId, completed }: { leadId: string; completed: TreatmentProgressGroup }) {
  const { records, total } = completed;
  return (
    <section id="visit-history" aria-labelledby="visit-history-title" className="min-w-0 scroll-mt-20">
      <Card className="border-l-4 border-l-emerald-400">
        <CardHeader>
          <CardTitle id="visit-history-title">Visit History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!records.length && <p className="text-sm text-muted-foreground">No completed treatments recorded.</p>}
          {records.length > 0 && (
            <ul className="max-h-[28rem] space-y-2 overflow-y-auto p-1">
              {records.map((record) => {
                const description = record.treatment_name ?? (record.treatment_code ? `Treatment ${record.treatment_code}` : "Treatment");
                return (
                  <li key={record.id}>
                    <TreatmentDetailsDialog leadId={leadId} treatmentId={record.id} name={description}
                      triggerLabel={`View treatment details: ${description}, ${record.doctor?.full_name ?? "Doctor not recorded"}, ${fmt(record.treated_at)}`}>
                      <span className="block break-words font-medium">{description}</span>
                      <span className="mt-1 block break-words text-xs text-muted-foreground">{formatClinicalSite(record)}</span>
                      {record.notes && <span className="mt-2 block whitespace-pre-wrap break-words text-sm">{record.notes}</span>}
                      {record.visit_remarks && record.visit_remarks.trim() !== record.notes?.trim() && <span className="mt-2 block whitespace-pre-wrap break-words text-sm">{record.visit_remarks}</span>}
                      <span className="mt-1 block break-words text-xs text-muted-foreground">{record.doctor?.full_name ?? "Doctor not recorded"}</span>
                      <time dateTime={record.treated_at} className="block text-xs text-muted-foreground">{fmt(record.treated_at)}</time>
                    </TreatmentDetailsDialog>
                  </li>
                );
              })}
            </ul>
          )}
          {total !== null && total > records.length && (
            <p className="text-xs text-muted-foreground">Showing the latest {records.length} of {total} completed treatments.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
