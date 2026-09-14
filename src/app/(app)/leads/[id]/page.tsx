import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache, type ReactNode } from "react";
import { getAuthContext } from "@/lib/auth/context";
import { canDelete } from "@/lib/auth/guards";
import { getLeadRelated, getLeadActivity } from "@/data/leads";
import { listComments } from "@/data/comments";
import { listCaseSheetsForLead } from "@/data/case-sheets";
import { listAssignableUsers } from "@/data/users";
import { listDoctors, listTreatmentTypes, listLeadSources } from "@/data/catalogs";
import { LeadStatusBadge } from "@/components/lead-status-badge";
import { StatusStepper } from "@/components/leads/status-stepper";
import { TransitionActions } from "@/components/leads/transition-actions";
import { AppointmentReschedule } from "@/components/leads/appointment-reschedule";
import {
  ToothAssessmentHistory,
  type ToothAssessmentHistoryItem,
} from "@/components/clinical/tooth-assessment-history";
import { MedicalHistorySummary } from "@/components/clinical/medical-history-summary";
import { PrescriptionHistory } from "@/components/clinical/prescription-history";
import { ClinicalAttachmentPanel } from "@/components/clinical/clinical-attachment-panel";
import { LeadDeleteButton } from "@/components/leads/lead-delete-button";
import { ContactActions } from "@/components/contact-actions";
import { RowEditDialog } from "@/components/admin/row-edit-dialog";
import { updateLeadAction } from "@/actions/leads";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CommentThread } from "@/components/comment-thread";
import { PaginationNav } from "@/components/pagination-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STATUS_LABELS } from "@/lib/leads/transitions";
import { groupByCategory } from "@/lib/dental";
import { formatClinicalSite } from "@/lib/clinical";
import { fmt, fmtDate, formatINR, toClinicInputValue } from "@/lib/tz";
import { ClipboardPlus, ReceiptText } from "lucide-react";
import type {
  PatientMedicalHistoryVersion,
  PrescriptionItem,
} from "@/lib/database.types";
import type { ClinicalAttachmentView } from "@/lib/clinical-files";

const getLeadPageData = cache(async (id: string) => {
  const ctx = await getAuthContext();
  const related = await getLeadRelated(ctx, id);
  return { ctx, related };
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { related } = await getLeadPageData(id);
  const leadName = related?.lead.name.replace(/\s+/g, " ").trim().slice(0, 80);
  return {
    title: related
      ? `${leadName || "Lead"} — Lead — Dr. Kishor's Dentistry CRM`
      : "Lead not found — Dr. Kishor's Dentistry CRM",
  };
}

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const queryParams = await searchParams;
  const { ctx, related } = await getLeadPageData(id);
  if (!related) notFound();
  const {
    lead,
    appointments: appointmentRows,
    treatments: treatmentRows,
    followUps: followUpRows,
    invoices: invoiceRows,
  } = related;
  const appointments = appointmentRows ?? [];
  const treatments = treatmentRows ?? [];
  const followUps = followUpRows ?? [];
  const invoices = invoiceRows ?? [];

  const [activity, comments, caseSheetResult, assignableUsers, doctors, treatmentTypes, sources] = await Promise.all([
    getLeadActivity(ctx, id),
    listComments(ctx, id),
    listCaseSheetsForLead(ctx, id, { page: Number(queryParams.page) }),
    listAssignableUsers(ctx, lead.branch_id),
    listDoctors(ctx, { branchId: lead.branch_id }),
    listTreatmentTypes(ctx),
    listLeadSources(ctx),
  ]);
  const {
    caseSheets,
    currentToothAssessments,
    currentMedicalHistory,
    total: caseSheetTotal,
    page: caseSheetPage,
    pageSize: caseSheetPageSize,
  } = caseSheetResult;
  const canManage = canDelete(ctx.role);
  const canAuthorCaseSheet = ctx.role === "admin" || ctx.role === "clinical_head";
  const canViewClinicalNarrative =
    canAuthorCaseSheet || ctx.role === "operations" || ctx.role === "front_office";

  const activeAppointment = appointments.find((a) => a.status === "scheduled") ?? null;
  const interestGroups = groupByCategory(treatmentTypes).map((g) => ({
    category: g.category,
    items: g.items.map((t) => ({ id: t.id, name: t.name })),
  }));
  const canModerate = ctx.role !== "front_office" && ctx.role !== "doctor";
  const canWriteComments =
    ctx.role !== "doctor" &&
    (ctx.role !== "front_office" || lead.assignee_id === ctx.userId);
  const commentsByScope = new Map<string, typeof comments>();
  for (const comment of comments) {
    const key = `${comment.entity_type}:${comment.entity_id ?? ""}`;
    const bucket = commentsByScope.get(key);
    if (bucket) bucket.push(comment);
    else commentsByScope.set(key, [comment]);
  }
  const commentsFor = (entityType: string, entityId: string | null) =>
    commentsByScope.get(`${entityType}:${entityId ?? ""}`) ?? [];
  const commentProps = {
    leadId: lead.id,
    currentUserId: ctx.userId,
    canModerate,
    canWrite: canWriteComments,
  } as const;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{lead.name}</h1>
            <LeadStatusBadge status={lead.status} />
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {lead.branch?.name} · {lead.source?.name ?? "Unknown source"} · Added {fmtDate(lead.created_at)}
          </p>
        </div>
        <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
          <TransitionActions
            lead={{ id: lead.id, status: lead.status }}
            activeAppointmentId={activeAppointment?.id ?? null}
            assignableUsers={assignableUsers.map((u) => ({
              id: u.id,
              label: `${u.full_name || u.email} (${u.role})`,
            }))}
            doctors={doctors.map((d) => ({ id: d.id, label: d.full_name }))}
            role={ctx.role}
            userId={ctx.userId}
          />
          <div className="flex flex-wrap items-center gap-1">
            <RowEditDialog title="Edit lead details" action={updateLeadAction.bind(null, lead.id)}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-name">Name</Label>
                  <Input id="edit-name" name="name" defaultValue={lead.name} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-mobile">Mobile</Label>
                  <Input id="edit-mobile" name="mobile" type="tel" inputMode="tel" autoComplete="tel" defaultValue={lead.mobile} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-email">Email (optional)</Label>
                  <Input
                    id="edit-email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    enterKeyHint="next"
                    spellCheck={false}
                    defaultValue={lead.email ?? ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-source">Source</Label>
                  <select
                    id="edit-source"
                    name="source_id"
                    defaultValue={lead.source_id ?? ""}
                    className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  >
                    <option value="">— None —</option>
                    {sources.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-interest">Treatment interest</Label>
                  <select
                    id="edit-interest"
                    name="interest_id"
                    defaultValue={lead.interest_id ?? ""}
                    className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  >
                    <option value="">— None —</option>
                    {interestGroups.map((g) => (
                      <optgroup key={g.category} label={g.category}>
                        {g.items.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-age">Age</Label>
                  <Input id="edit-age" name="age" type="number" min="0" max="120" defaultValue={lead.age ?? ""} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-dob">Date of birth</Label>
                  <Input id="edit-dob" name="dob" type="date" defaultValue={lead.dob ?? ""} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-notes">Notes</Label>
                <Textarea id="edit-notes" name="notes" rows={3} defaultValue={lead.notes ?? ""} />
              </div>
            </RowEditDialog>
            {canManage && <LeadDeleteButton leadId={lead.id} />}
          </div>
        </div>
      </div>

      <StatusStepper status={lead.status} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          {/* Contact details */}
          <Card className="border-l-4 border-l-gold">
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2 md:grid-cols-3">
                <Field
                  label="Mobile"
                  value={
                    <a href={`tel:${lead.mobile}`} className="underline-offset-2 hover:underline">
                      {lead.mobile}
                    </a>
                  }
                />
                <Field
                  label="Email"
                  value={
                    lead.email ? (
                      <a href={`mailto:${lead.email}`} className="break-all underline-offset-2 hover:underline">
                        {lead.email}
                      </a>
                    ) : null
                  }
                />
                <Field label="Age" value={lead.age?.toString()} />
                <Field label="Date of birth" value={lead.dob ? fmtDate(lead.dob) : null} />
                <Field label="Assignee" value={lead.assignee?.full_name ?? "Unassigned"} />
                <Field label="Center" value={lead.branch?.name} />
                <Field label="Treatment interest" value={lead.interest?.name} />
                <Field label="Source" value={lead.source?.name} />
              </dl>
              <ContactActions mobile={lead.mobile} email={lead.email} />
              {lead.notes && (
                <p className="mt-4 text-sm whitespace-pre-wrap border-t pt-3 text-muted-foreground">
                  {lead.notes}
                </p>
              )}
            </CardContent>
          </Card>

          {canViewClinicalNarrative && (
            <Card className="border-l-4 border-l-rose-400">
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
                    Medical history has not yet been reviewed. It will be recorded with the next digital case sheet.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Appointments */}
          <Card className="border-l-4 border-l-violet-400">
            <CardHeader>
              <CardTitle className="text-base">Appointments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {appointments.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  None yet — book one from the actions above when the lead is assigned.
                </p>
              )}
              {appointments.map((a) => (
                <div key={a.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="text-sm font-medium">{fmt(a.scheduled_at)}</div>
                    <Badge
                      variant={a.status === "scheduled" ? "default" : "secondary"}
                      className="capitalize"
                    >
                      {a.status.replaceAll("_", " ")}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {(a.doctor as { full_name: string } | null)?.full_name ?? "Doctor TBD"} ·{" "}
                    {a.duration_minutes} min
                    {a.notes ? ` · ${a.notes}` : ""}
                  </p>
                  {a.status === "scheduled" && (
                    <div className="mt-2">
                      <AppointmentReschedule
                        appointmentId={a.id}
                        leadId={lead.id}
                        doctors={doctors.map((d) => ({ id: d.id, label: d.full_name }))}
                        defaultScheduledAt={toClinicInputValue(a.scheduled_at)}
                        defaultDoctorId={a.doctor_id}
                        defaultDuration={a.duration_minutes}
                        defaultNotes={a.notes}
                      />
                    </div>
                  )}
                  <CommentThread
                    {...commentProps}
                    comments={commentsFor("appointment", a.id)}
                    entityType="appointment"
                    entityId={a.id}
                    compact
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Treatments */}
          <Card className="border-l-4 border-l-emerald-400">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Digital case sheets &amp; treatment history</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Invoice eligibility comes only from finalized, coded, completed treatments.
                </p>
              </div>
              {canAuthorCaseSheet && activeAppointment && (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/case-sheets/new?lead=${lead.id}&appointment=${activeAppointment.id}`}>
                    <ClipboardPlus aria-hidden="true" />
                    Add case sheet
                  </Link>
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {caseSheets.length === 0 && treatments.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No case sheet has been recorded yet.
                </p>
              )}
              {canViewClinicalNarrative && currentToothAssessments.length > 0 && (
                <section className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3" aria-labelledby="current-tooth-summary">
                  <div>
                    <h3 id="current-tooth-summary" className="text-sm font-semibold">Latest recorded whole-mouth tooth summary</h3>
                    <p className="text-xs text-muted-foreground">Most recent signed assessment for each recorded tooth, with its examination date and clinician.</p>
                  </div>
                  <ToothAssessmentHistory assessments={currentToothAssessments} />
                </section>
              )}
              {caseSheets.map((sheet) => {
                const doctor = sheet.doctor as { full_name: string } | null;
                const lines = (sheet.treatments ?? []) as Array<{
                  id: string;
                  treatment_code: string | null;
                  treatment_name: string | null;
                  treatment_category: string | null;
                  clinical_status: string;
                  site_scope: string;
                  site_detail: string | null;
                  tooth_number: string | null;
                  surfaces: string[];
                  quantity: number;
                  cost: number | null;
                  notes: string | null;
                  invoice_items?: Array<{
                    id: string;
                    invoice_id: string;
                    active_billing: boolean;
                  }>;
                  treatment_attachments?: ClinicalAttachmentView[];
                }>;
                const toothAssessments = ((sheet.tooth_assessments ?? []) as ToothAssessmentHistoryItem[]).map(
                  (assessment) => ({ ...assessment, doctor_name: doctor?.full_name ?? null })
                );
                const historyLink = sheet.medical_history as {
                  history: PatientMedicalHistoryVersion | null;
                } | null | undefined;
                const visitMedicalHistory = historyLink?.history ?? null;
                const prescriptionItems = (sheet.prescription_items ?? []) as PrescriptionItem[];
                const clinicalAttachments = (
                  (sheet.case_sheet_attachments ?? []) as ClinicalAttachmentView[]
                ).filter((attachment) => attachment.status === "ready" && !attachment.treatment_id);
                return (
                  <section key={sheet.id} className="rounded-lg border p-3" aria-labelledby={`case-${sheet.id}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 id={`case-${sheet.id}`} className="text-sm font-semibold">
                          Visit {fmt(sheet.visit_at)}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {doctor?.full_name ?? "Doctor not recorded"} · Digitally finalized {fmt(sheet.finalized_at)}
                        </p>
                      </div>
                      <Badge variant="secondary">Finalized</Badge>
                    </div>
                    {canViewClinicalNarrative && (
                      <>
                        <dl className="mt-3 grid gap-2 rounded-md bg-muted/40 p-3 text-sm sm:grid-cols-2">
                          <Field label="Chief complaint" value={sheet.chief_complaint} />
                          <Field label="Findings" value={sheet.findings} />
                          <Field label="Diagnosis" value={sheet.diagnosis} />
                          <Field label="Treatment plan" value={sheet.plan} />
                        </dl>
                        <div className="mt-3">
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
                          <details className="mt-3 rounded-md border bg-muted/20 p-3">
                            <summary className="cursor-pointer text-sm font-semibold">
                              General tooth examination ({toothAssessments.length})
                            </summary>
                            <ToothAssessmentHistory assessments={toothAssessments} className="mt-3" />
                          </details>
                        )}
                        <div className="mt-3">
                          <PrescriptionHistory items={prescriptionItems} />
                        </div>
                        <div className="mt-3">
                          <ClinicalAttachmentPanel
                            caseSheetId={sheet.id}
                            initialAttachments={clinicalAttachments}
                            canUpload={canAuthorCaseSheet}
                          />
                        </div>
                      </>
                    )}
                    <div className="mt-3 space-y-3">
                      {lines.length === 0 && (
                        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                          This finalized visit has no coded treatment lines, so there is nothing to invoice yet.
                        </p>
                      )}
                      {lines.map((t) => {
                        const billed = t.invoice_items?.some((item) => item.active_billing) ?? false;
                        const invoiceEligible =
                          t.clinical_status === "completed" && Boolean(t.treatment_code) && !billed;
                        return (
                          <div key={t.id} className="rounded-md border bg-background p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant="outline" className="font-mono">
                                    {t.treatment_code}
                                  </Badge>
                                  <span className="text-sm font-medium">
                                    {t.treatment_name ?? "Coded treatment"}
                                  </span>
                                  <Badge variant={t.clinical_status === "completed" ? "default" : "secondary"}>
                                    {t.clinical_status}
                                  </Badge>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {formatClinicalSite(t)}
                                  {t.quantity !== 1 ? ` · Qty ${t.quantity}` : ""}
                                  {t.notes ? ` · ${t.notes}` : ""}
                                </p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                {t.cost != null && (
                                  <span className="text-right text-sm font-semibold">
                                    {formatINR(t.cost * (t.quantity ?? 1))}
                                    <span className="block text-xs font-normal text-muted-foreground">
                                      Line total
                                    </span>
                                  </span>
                                )}
                                {invoiceEligible && (
                                  <Button asChild size="sm" variant="outline">
                                    <Link href={`/invoices/new?lead=${lead.id}&treatment=${t.id}`}>
                                      <ReceiptText aria-hidden="true" />
                                      Raise invoice
                                    </Link>
                                  </Button>
                                )}
                                {billed && <Badge variant="secondary">Invoiced</Badge>}
                                {t.clinical_status !== "completed" && !billed && (
                                  <span className="text-xs text-muted-foreground">
                                    Complete this treatment before invoicing
                                  </span>
                                )}
                                </div>
                            </div>
                            <CommentThread
                              {...commentProps}
                              comments={commentsFor("treatment", t.id)}
                              entityType="treatment"
                              entityId={t.id}
                              compact
                            />
                            <div className="mt-3">
                              <ClinicalAttachmentPanel
                                treatmentId={t.id}
                                initialAttachments={(t.treatment_attachments ?? []).filter(
                                  (attachment) => attachment.status === "ready"
                                )}
                                canUpload={canAuthorCaseSheet}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
              <PaginationNav
                pathname={`/leads/${id}`}
                searchParams={queryParams}
                page={caseSheetPage}
                pageSize={caseSheetPageSize}
                total={caseSheetTotal}
              />
              {treatments.filter((t) => !t.case_sheet_id).length > 0 && (
                <section className="rounded-lg border border-dashed p-3">
                  <h3 className="text-sm font-semibold">Legacy treatment history</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    These records predate digital treatment codes. They remain in history but are not invoice-eligible.
                  </p>
                  <ul className="mt-3 space-y-2">
                    {treatments.filter((t) => !t.case_sheet_id).map((t) => (
                      <li key={t.id} className="text-sm">
                        {(t.treatment_type as { name: string } | null)?.name ?? "Legacy treatment"} · {fmt(t.treated_at)}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </CardContent>
          </Card>

          {/* Follow-ups */}
          <Card className="border-l-4 border-l-amber-400">
            <CardHeader>
              <CardTitle className="text-base">Follow-ups</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {followUps.length === 0 && (
                <p className="text-sm text-muted-foreground">No follow-ups scheduled.</p>
              )}
              {followUps.map((f) => (
                <div key={f.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="text-sm font-medium">Due {fmt(f.due_at)}</div>
                    <Badge
                      variant={f.status === "pending" ? "default" : "secondary"}
                      className="capitalize"
                    >
                      {f.status}
                    </Badge>
                  </div>
                  {(f.reason || f.outcome_notes) && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {f.reason}
                      {f.outcome_notes ? ` — ${f.outcome_notes}` : ""}
                    </p>
                  )}
                  <CommentThread
                    {...commentProps}
                    comments={commentsFor("follow_up", f.id)}
                    entityType="follow_up"
                    entityId={f.id}
                    compact
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Invoices */}
          <Card className="border-l-4 border-l-blue-400">
            <CardHeader>
              <CardTitle className="text-base">Invoices</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {invoices.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Raise one from a treatment record above.
                </p>
              )}
              {invoices.map((inv) => (
                <div key={inv.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <Link href={`/invoices/${inv.id}`} className="text-sm font-medium hover:underline">
                      {inv.invoice_number}
                    </Link>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{formatINR(inv.total)}</span>
                      <Badge variant={inv.status === "paid" ? "default" : "secondary"} className="capitalize">
                        {inv.status}
                      </Badge>
                    </div>
                  </div>
                  <CommentThread
                    {...commentProps}
                    comments={commentsFor("invoice", inv.id)}
                    entityType="invoice"
                    entityId={inv.id}
                    compact
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* General comments — bottom of the lead page */}
          <Card className="border-l-4 border-l-muted-foreground/30">
            <CardHeader>
              <CardTitle className="text-base">Comments</CardTitle>
            </CardHeader>
            <CardContent>
              <CommentThread
                {...commentProps}
                comments={commentsFor("lead", null)}
                entityType="lead"
                entityId={null}
              />
            </CardContent>
          </Card>
        </div>

        {/* Activity timeline */}
        <div>
          <Card className="border-l-4 border-l-gold">
            <CardHeader>
              <CardTitle className="text-base">Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {activity.length === 0 && (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              )}
              <ul className="space-y-4">
                {activity.map((a) => {
                  const actor = a.actor as { full_name: string } | null;
                  return (
                    <li key={a.id} className="relative pl-4 border-l text-sm">
                      <div className="font-medium">
                        {a.type === "status_change" && a.to_status
                          ? `Status → ${STATUS_LABELS[a.to_status]}`
                          : a.type.replaceAll("_", " ")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {actor?.full_name ? `${actor.full_name} · ` : ""}
                        {fmt(a.created_at)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
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
