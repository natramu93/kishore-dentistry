import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getAuthContext } from "@/lib/auth/context";
import { getMyPatientHistory } from "@/data/doctor-portal";
import { getPatientTreatmentProgress } from "@/data/treatment-progress";
import { TreatmentProgressSummary } from "@/components/clinical/treatment-progress-summary";
import { CaseSheetEditLink } from "@/components/clinical/case-sheet-edit-link";
import { PatientSectionNav } from "@/components/patients/patient-section-nav";
import { treatmentProgressLabel } from "@/lib/treatment-progress";
import { NotFoundError } from "@/lib/errors";
import { formatClinicalSite } from "@/lib/clinical";
import { fmt, fmtDate } from "@/lib/tz";
import type {
  PatientMedicalHistoryVersion,
  PrescriptionItem,
  Treatment,
} from "@/lib/database.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PaginationNav } from "@/components/pagination-nav";
import {
  ToothAssessmentHistory,
  type ToothAssessmentHistoryItem,
} from "@/components/clinical/tooth-assessment-history";
import { MedicalHistorySummary } from "@/components/clinical/medical-history-summary";
import { PrescriptionHistory } from "@/components/clinical/prescription-history";
import { ClinicalAttachmentPanel } from "@/components/clinical/clinical-attachment-panel";
import type { ClinicalAttachmentView } from "@/lib/clinical-files";

export const metadata = { title: "Patient History — Dr. Kishor's Dentistry CRM" };

export default async function MyPatientHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const queryParams = await searchParams;
  const ctx = await getAuthContext();
  if (ctx.role !== "doctor") redirect("/dashboard");

  let history: Awaited<ReturnType<typeof getMyPatientHistory>>;
  try {
    history = await getMyPatientHistory(ctx, id, { page: Number(queryParams.page) });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const {
    lead,
    caseSheets,
    legacyTreatments,
    currentToothAssessments,
    currentMedicalHistory,
    caseSheetTotal,
    caseSheetPage,
    caseSheetPageSize,
  } = history;
  const branch = lead.branch as { name: string } | null;
  const treatmentProgress = await getPatientTreatmentProgress(ctx, id);
  // This authenticated Server Component renders per request; the DB rechecks on save.
  // eslint-disable-next-line react-hooks/purity
  const pageRenderedAt = Date.now();

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Button asChild variant="ghost" size="sm">
        <Link href="/my-patients">
          <ArrowLeft aria-hidden="true" /> Back to my patients
        </Link>
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{lead.name}</h1>
          <p className="text-sm text-muted-foreground">
            Digital dental history · {branch?.name ?? "Clinic"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Access is limited to clinicians with a current appointment or treatment relationship to this patient.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/appointments">Open my schedule</Link>
        </Button>
      </div>

      <PatientSectionNav sections={[
        { id: "patient-overview", label: "Overview" },
        { id: "patient-medical-history", label: "Medical history" },
        { id: "patient-clinical", label: "Treatment progress" },
        ...(currentToothAssessments.length > 0 ? [{ id: "patient-teeth", label: "Tooth chart" }] : []),
        { id: "patient-visit-history", label: "Visits & files" },
      ]} />

      <Card id="patient-overview" className="scroll-mt-20">
        <CardHeader>
          <CardTitle className="text-base">Patient details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Email" value={lead.email} />
            <Field label="Date of birth" value={lead.dob ? fmtDate(lead.dob) : null} />
            <Field label="Age" value={lead.age != null ? `${lead.age} years` : null} />
          </dl>
        </CardContent>
      </Card>

      <Card id="patient-medical-history" className="scroll-mt-20 border-l-4 border-l-rose-400">
        <CardHeader>
          <CardTitle className="text-base">Medical history</CardTitle>
        </CardHeader>
        <CardContent>
          {currentMedicalHistory ? (
            <MedicalHistorySummary
              reviewStatus={currentMedicalHistory.review_status}
              conditions={currentMedicalHistory.conditions}
              description={currentMedicalHistory.description}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Medical history has not yet been reviewed. Review it while completing the next case sheet.
            </p>
          )}
        </CardContent>
      </Card>

      <div id="patient-clinical" className="scroll-mt-20">
        <TreatmentProgressSummary progress={treatmentProgress} />
      </div>

      {currentToothAssessments.length > 0 && (
        <section id="patient-teeth" aria-labelledby="current-tooth-summary" className="scroll-mt-20 space-y-3">
          <div>
            <h2 id="current-tooth-summary" className="text-lg font-semibold">Latest recorded whole-mouth tooth summary</h2>
            <p className="text-sm text-muted-foreground">Most recent signed assessment for each recorded tooth, with its examination date and clinician.</p>
          </div>
          <ToothAssessmentHistory assessments={currentToothAssessments} />
        </section>
      )}

      <section id="patient-visit-history" aria-labelledby="digital-history-heading" className="scroll-mt-20 space-y-3">
        <div>
          <h2 id="digital-history-heading" className="text-lg font-semibold">Visits, case sheets &amp; files</h2>
          <p className="text-sm text-muted-foreground">
            Amend your signed case sheet within 24 hours. Older visits stay read-only; record further care in a new appointment. Treatment progress is independent of billing.
          </p>
        </div>
        {caseSheets.length === 0 && (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              No digital case sheet is available yet.
            </CardContent>
          </Card>
        )}
        {caseSheets.map((sheet) => {
          const doctor = sheet.doctor as { full_name: string } | null;
          const treatments = (sheet.treatments ?? []) as Array<Treatment & {
            treatment_attachments?: ClinicalAttachmentView[];
          }>;
          const toothAssessments = ((sheet.tooth_assessments ?? []) as ToothAssessmentHistoryItem[]).map(
            (assessment) => ({ ...assessment, doctor_name: doctor?.full_name ?? null })
          );
          const historyLink = sheet.medical_history as {
            history: PatientMedicalHistoryVersion | null;
          } | null;
          const visitMedicalHistory = historyLink?.history ?? null;
          const prescriptions = (sheet.prescription_items ?? []) as PrescriptionItem[];
          const amendments = (sheet.amendments ?? []) as Array<{
            id: string;
            revision: number;
            reason: string;
            changed_by_name: string;
            changed_at: string;
          }>;
          const clinicalAttachments = (
            (sheet.case_sheet_attachments ?? []) as ClinicalAttachmentView[]
          ).filter((attachment) => attachment.status === "ready" && !attachment.treatment_id);
          const canManageClinicalFiles = sheet.doctor_id === ctx.doctorId;
          return (
            <Card key={sheet.id} id={`case-${sheet.id}`} className="scroll-mt-20">
              <CardHeader className="gap-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">Visit {fmt(sheet.visit_at)}</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {doctor?.full_name ?? "Doctor not recorded"} · Signed {fmt(sheet.finalized_at)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <CaseSheetEditLink caseSheetId={sheet.id} finalizedAt={sheet.finalized_at} canEdit={canManageClinicalFiles} now={pageRenderedAt} />
                    <Badge variant="secondary">Finalized · v{sheet.version ?? 1}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {amendments.length > 0 && (
                  <details className="rounded-md border bg-muted/20 p-3">
                    <summary className="cursor-pointer text-sm font-semibold">
                      Amendment history ({amendments.length})
                    </summary>
                    <ol className="mt-2 space-y-2 text-sm">
                      {amendments.map((amendment) => (
                        <li key={amendment.id} className="border-l-2 border-primary/30 pl-3">
                          <p className="font-medium">Revision {amendment.revision} · {fmt(amendment.changed_at)} · {amendment.changed_by_name}</p>
                          <p className="text-muted-foreground">{amendment.reason}</p>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
                <dl className="grid gap-3 rounded-md bg-muted/40 p-3 text-sm sm:grid-cols-2">
                  <Field label="Chief complaint" value={sheet.chief_complaint} />
                  <Field label="Clinical remarks" value={sheet.findings} />
                  {sheet.diagnosis && <Field label="Previously recorded diagnosis" value={sheet.diagnosis} />}
                  {sheet.plan && <Field label="Previously recorded plan" value={sheet.plan} />}
                </dl>
                <div>
                  <p className="mb-2 text-sm font-semibold">Medical history at this visit</p>
                  {visitMedicalHistory ? (
                    <MedicalHistorySummary
                      reviewStatus={visitMedicalHistory.review_status}
                      conditions={visitMedicalHistory.conditions}
                      description={visitMedicalHistory.description}
                      compact
                    />
                  ) : (
                    <dl>
                      <Field label="Medical history" value={sheet.medical_alerts} />
                    </dl>
                  )}
                </div>
                {toothAssessments.length > 0 && (
                  <details className="rounded-md border bg-muted/20 p-3">
                    <summary className="cursor-pointer text-sm font-semibold">
                      General tooth examination ({toothAssessments.length})
                    </summary>
                    <ToothAssessmentHistory assessments={toothAssessments} className="mt-3" />
                  </details>
                )}
                <PrescriptionHistory items={prescriptions} />
                {canManageClinicalFiles && (
                  <ClinicalAttachmentPanel
                    caseSheetId={sheet.id}
                    initialAttachments={clinicalAttachments}
                  />
                )}
                <div className="space-y-2">
                  {treatments.length === 0 && (
                    <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                      Examination-only visit — no coded treatment was recorded.
                    </p>
                  )}
                  {treatments.map((treatment) => (
                    <div key={treatment.id} className="rounded-md border p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="font-mono">{treatment.treatment_code}</Badge>
                            <span className="text-sm font-medium">{treatment.treatment_name}</span>
                            <Badge variant={treatment.clinical_status === "completed" ? "default" : "secondary"}>
                              {treatmentProgressLabel(treatment.clinical_status)}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatClinicalSite(treatment)}
                          </p>
                          {treatment.notes && <p className="mt-1 text-sm">{treatment.notes}</p>}
                        </div>
                      </div>
                      <div className="mt-3">
                        <ClinicalAttachmentPanel
                          treatmentId={treatment.id}
                          initialAttachments={(treatment.treatment_attachments ?? []).filter(
                            (attachment) => attachment.status === "ready"
                          )}
                          canUpload={canManageClinicalFiles}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
        <PaginationNav
          pathname={`/my-patients/${id}`}
          searchParams={queryParams}
          page={caseSheetPage}
          pageSize={caseSheetPageSize}
          total={caseSheetTotal}
        />
      </section>

      {legacyTreatments.length > 0 && (
        <section aria-labelledby="legacy-history-heading" className="space-y-3">
          <div>
            <h2 id="legacy-history-heading" className="text-lg font-semibold">Historical treatment records</h2>
            <p className="text-sm text-muted-foreground">These records predate coded digital case sheets.</p>
          </div>
          <Card>
            <CardContent className="divide-y py-2">
              {legacyTreatments.map((treatment) => {
                const treatmentType = treatment.treatment_type as { name: string } | null;
                const doctor = treatment.doctor as { full_name: string } | null;
                return (
                  <div key={treatment.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
                    <div>
                      <p className="font-medium">{treatmentType?.name ?? "Legacy treatment"}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmt(treatment.treated_at)} · {doctor?.full_name ?? "Doctor not recorded"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-wrap break-words font-medium">{value || "—"}</dd>
    </div>
  );
}
