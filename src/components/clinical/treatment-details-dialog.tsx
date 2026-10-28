"use client";

import { useRef, useState, type ReactNode } from "react";
import { loadTreatmentDetailsAction } from "@/actions/treatment-details";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClinicalAttachmentPanel } from "./clinical-attachment-panel";
import { CommentThread } from "@/components/comment-thread";
import { formatClinicalSite } from "@/lib/clinical";
import { fmt } from "@/lib/tz";
import { treatmentProgressLabel, type TreatmentDetails } from "@/lib/treatment-progress";

export function TreatmentDetailsDialog({ leadId, treatmentId, name, children }: {
  leadId: string; treatmentId: string; name: string; children: ReactNode;
}) {
  const [details, setDetails] = useState<TreatmentDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  async function load(silent = false) {
    const current = ++request.current;
    if (!silent) { setLoading(true); setDetails(null); }
    setError(null);
    try {
      const result = await loadTreatmentDetailsAction(leadId, treatmentId);
      if (current !== request.current) return;
      if (result.ok) setDetails(result.details);
      else setError(result.error);
    } catch {
      if (current === request.current) setError("Unable to load treatment details. Please try again.");
    } finally {
      if (current === request.current) setLoading(false);
    }
  }

  return <Dialog onOpenChange={(open) => {
    if (open) void load();
    else { request.current++; setDetails(null); setLoading(false); setError(null); }
  }}>
    <DialogTrigger render={<button type="button" aria-label={`View treatment details: ${name}`}
      className="w-full min-w-0 rounded-md border bg-background p-3 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />}>
      {children}
    </DialogTrigger>
    <DialogContent className="sm:max-w-2xl" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{name}</DialogTitle></DialogHeader>
      {loading && <p role="status">Loading treatment details…</p>}
      {error && <div role="alert" className="space-y-2"><p>{error}</p><Button variant="outline" onClick={() => void load()}>Try again</Button></div>}
      {details && <div className="min-w-0 space-y-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono">{details.treatment.treatment_code}</Badge>
            <Badge>{treatmentProgressLabel(details.treatment.clinical_status)}</Badge>
            {details.invoiced && <Badge variant="secondary">Invoiced</Badge>}
          </div>
          <p className="text-sm">{formatClinicalSite(details.treatment)}</p>
          <p className="text-xs text-muted-foreground">{fmt(details.treatment.performed_at ?? details.treatment.treated_at)}{details.treatment.doctor?.full_name ? ` · ${details.treatment.doctor.full_name}` : ""}</p>
          {details.treatment.notes && <p className="whitespace-pre-wrap break-words text-sm">{details.treatment.notes}</p>}
        </div>
        {details.showComments && <CommentThread leadId={leadId} entityId={treatmentId} entityType="treatment"
          comments={details.comments} currentUserId={details.currentUserId} canModerate={details.canModerate}
          canWrite={details.canWriteComments} compact onChanged={() => void load(true)} />}
        {details.filesAvailable && <ClinicalAttachmentPanel treatmentId={treatmentId}
          initialAttachments={details.attachments} canUpload={details.canUpload} />}
      </div>}
    </DialogContent>
  </Dialog>;
}
