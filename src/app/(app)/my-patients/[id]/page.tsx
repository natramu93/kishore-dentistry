import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Phone } from "lucide-react";
import { getAuthContext } from "@/lib/auth/context";
import { getMyPatientHistory } from "@/data/doctor-portal";
import { NotFoundError } from "@/lib/errors";
import { formatClinicalSite } from "@/lib/clinical";
import { fmt, fmtDate, formatINR } from "@/lib/tz";
import type { Treatment } from "@/lib/database.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PaginationNav } from "@/components/pagination-nav";
import {
  ToothAssessmentHistory,
  type ToothAssessmentHistoryItem,
} from "@/components/clinical/tooth-assessment-history";

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
    caseSheetTotal,
    caseSheetPage,
    caseSheetPageSize,
  } = history;
  const branch = lead.branch as { name: string } | null;

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
        <Button asChild variant="outline">
          <a href={`tel:${lead.mobile}`}>
            <Phone aria-hidden="true" /> {lead.mobile}
          </a>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Patient details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Mobile" value={lead.mobile} />
            <Field label="Email" value={lead.email} />
            <Field label="Date of birth" value={lead.dob ? fmtDate(lead.dob) : null} />
            <Field label="Age" value={lead.age != null ? `${lead.age} years` : null} />
          </dl>
        </CardContent>
      </Card>

      {currentToothAssessments.length > 0 && (
        <section aria-labelledby="current-tooth-summary" className="space-y-3">
          <div>
            <h2 id="current-tooth-summary" className="text-lg font-semibold">Latest recorded whole-mouth tooth summary</h2>
            <p className="text-sm text-muted-foreground">Most recent signed assessment for each recorded tooth, with its examination date and clinician.</p>
          </div>
          <ToothAssessmentHistory assessments={currentToothAssessments} />
        </section>
      )}

      <section aria-labelledby="digital-history-heading" className="space-y-3">
        <div>
          <h2 id="digital-history-heading" className="text-lg font-semibold">Finalized digital case sheets</h2>
          <p className="text-sm text-muted-foreground">
            Signed clinical history is read-only. Planned care is shown separately from completed treatment.
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
          const treatments = (sheet.treatments ?? []) as Treatment[];
          const toothAssessments = ((sheet.tooth_assessments ?? []) as ToothAssessmentHistoryItem[]).map(
            (assessment) => ({ ...assessment, doctor_name: doctor?.full_name ?? null })
          );
          return (
            <Card key={sheet.id}>
              <CardHeader className="gap-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">Visit {fmt(sheet.visit_at)}</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {doctor?.full_name ?? "Doctor not recorded"} · Signed {fmt(sheet.finalized_at)}
                    </p>
                  </div>
                  <Badge variant="secondary">Finalized</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <dl className="grid gap-3 rounded-md bg-muted/40 p-3 text-sm sm:grid-cols-2">
                  <Field label="Chief complaint" value={sheet.chief_complaint} />
                  <Field label="Clinical findings" value={sheet.findings} />
                  <Field label="Diagnosis" value={sheet.diagnosis} />
                  <Field label="Treatment plan" value={sheet.plan} />
                  <Field label="Medical alerts" value={sheet.medical_alerts} />
                </dl>
                {toothAssessments.length > 0 && (
                  <details className="rounded-md border bg-muted/20 p-3">
                    <summary className="cursor-pointer text-sm font-semibold">
                      General tooth examination ({toothAssessments.length})
                    </summary>
                    <ToothAssessmentHistory assessments={toothAssessments} className="mt-3" />
                  </details>
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
                              {treatment.clinical_status}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatClinicalSite(treatment)}
                            {(treatment.quantity ?? 1) !== 1 ? ` · Qty ${treatment.quantity}` : ""}
                          </p>
                          {treatment.notes && <p className="mt-1 text-sm">{treatment.notes}</p>}
                        </div>
                        {treatment.cost != null && (
                          <span className="text-sm font-semibold">
                            {formatINR(treatment.cost * (treatment.quantity ?? 1))}
                          </span>
                        )}
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
                    {treatment.cost != null && <span className="font-semibold">{formatINR(treatment.cost)}</span>}
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
      <dd className="font-medium">{value || "—"}</dd>
    </div>
  );
}
