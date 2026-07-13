import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { canDelete } from "@/lib/auth/guards";
import { getLeadRelated, getLeadActivity } from "@/data/leads";
import { listComments } from "@/data/comments";
import { listAssignableUsers } from "@/data/users";
import { listDoctors, listTreatmentTypes, listLeadSources } from "@/data/catalogs";
import { LeadStatusBadge } from "@/components/lead-status-badge";
import { StatusStepper } from "@/components/leads/status-stepper";
import { TransitionActions } from "@/components/leads/transition-actions";
import { AppointmentReschedule } from "@/components/leads/appointment-reschedule";
import { LeadDeleteButton } from "@/components/leads/lead-delete-button";
import { RowEditDialog } from "@/components/admin/row-edit-dialog";
import { updateLeadAction } from "@/actions/leads";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CommentThread } from "@/components/comment-thread";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STATUS_LABELS } from "@/lib/leads/transitions";
import { groupByCategory } from "@/lib/dental";
import { fmt, fmtDate, formatINR, toClinicInputValue } from "@/lib/tz";
import { ReceiptText } from "lucide-react";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getAuthContext();
  const related = await getLeadRelated(ctx, id);
  if (!related) notFound();
  const { lead, appointments, treatments, followUps, invoices } = related;

  const [activity, comments, assignableUsers, doctors, treatmentTypes, sources] = await Promise.all([
    getLeadActivity(ctx, id),
    listComments(ctx, id),
    listAssignableUsers(ctx, lead.branch_id),
    listDoctors(ctx, { branchId: lead.branch_id }),
    listTreatmentTypes(ctx),
    listLeadSources(ctx),
  ]);
  const canManage = canDelete(ctx.role);

  const activeAppointment = appointments.find((a) => a.status === "scheduled") ?? null;
  const interestGroups = groupByCategory(treatmentTypes).map((g) => ({
    category: g.category,
    items: g.items.map((t) => ({ id: t.id, name: t.name })),
  }));
  const canModerate = ctx.role !== "front_office" && ctx.role !== "doctor";
  const commentProps = {
    leadId: lead.id,
    comments,
    currentUserId: ctx.userId,
    canModerate,
  } as const;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{lead.name}</h1>
            <LeadStatusBadge status={lead.status} />
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {lead.branch?.name} · {lead.source?.name ?? "Unknown source"} · Added {fmtDate(lead.created_at)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <TransitionActions
            lead={{ id: lead.id, status: lead.status }}
            activeAppointmentId={activeAppointment?.id ?? null}
            assignableUsers={assignableUsers.map((u) => ({
              id: u.id,
              label: `${u.full_name || u.email} (${u.role})`,
            }))}
            doctors={doctors.map((d) => ({ id: d.id, label: d.full_name }))}
            treatmentTypes={treatmentTypes.map((t) => ({
              id: t.id,
              label: t.default_cost != null ? `${t.name} — ${formatINR(t.default_cost)}` : t.name,
              cost: t.default_cost,
            }))}
            role={ctx.role}
            userId={ctx.userId}
            defaultTreatmentTypeId={lead.interest_id}
          />
          <div className="flex items-center gap-1">
            <RowEditDialog title="Edit lead details" action={updateLeadAction.bind(null, lead.id)}>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="edit-name">Name</Label>
                  <Input id="edit-name" name="name" defaultValue={lead.name} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-mobile">Mobile</Label>
                  <Input id="edit-mobile" name="mobile" defaultValue={lead.mobile} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-email">Email</Label>
                  <Input id="edit-email" name="email" type="email" defaultValue={lead.email ?? ""} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-source">Source</Label>
                  <select
                    id="edit-source"
                    name="source_id"
                    defaultValue={lead.source_id ?? ""}
                    className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
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
                    className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
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
              <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3 text-sm">
                <Field label="Mobile" value={lead.mobile} />
                <Field label="Email" value={lead.email} />
                <Field label="Age" value={lead.age?.toString()} />
                <Field label="Date of birth" value={lead.dob ? fmtDate(lead.dob) : null} />
                <Field label="Assignee" value={lead.assignee?.full_name ?? "Unassigned"} />
                <Field label="Center" value={lead.branch?.name} />
                <Field label="Treatment interest" value={lead.interest?.name} />
                <Field label="Source" value={lead.source?.name} />
              </dl>
              {lead.notes && (
                <p className="mt-4 text-sm whitespace-pre-wrap border-t pt-3 text-muted-foreground">
                  {lead.notes}
                </p>
              )}
            </CardContent>
          </Card>

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
                  <div className="flex items-center justify-between gap-2">
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
                  <CommentThread {...commentProps} entityType="appointment" entityId={a.id} compact />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Treatments */}
          <Card className="border-l-4 border-l-emerald-400">
            <CardHeader>
              <CardTitle className="text-base">Treatments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {treatments.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Recorded when an appointment is marked visited / treated.
                </p>
              )}
              {treatments.map((t) => (
                <div key={t.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">
                      {(t.treatment_type as { name: string } | null)?.name ?? "Treatment"}
                    </div>
                    <div className="flex items-center gap-2">
                      {t.cost != null && (
                        <span className="text-sm font-semibold">{formatINR(t.cost)}</span>
                      )}
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/invoices/new?lead=${lead.id}&treatment=${t.id}`}>
                          <ReceiptText className="h-3.5 w-3.5 mr-1" />
                          Raise invoice
                        </Link>
                      </Button>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {(t.doctor as { full_name: string } | null)?.full_name ?? "Doctor not recorded"} ·{" "}
                    {fmt(t.treated_at)}
                    {t.notes ? ` · ${t.notes}` : ""}
                  </p>
                  <CommentThread {...commentProps} entityType="treatment" entityId={t.id} compact />
                </div>
              ))}
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
                  <div className="flex items-center justify-between gap-2">
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
                  <CommentThread {...commentProps} entityType="follow_up" entityId={f.id} compact />
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
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/invoices/${inv.id}`} className="text-sm font-medium hover:underline">
                      {inv.invoice_number}
                    </Link>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{formatINR(inv.total)}</span>
                      <Badge variant={inv.status === "paid" ? "default" : "secondary"} className="capitalize">
                        {inv.status}
                      </Badge>
                    </div>
                  </div>
                  <CommentThread {...commentProps} entityType="invoice" entityId={inv.id} compact />
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
              <CommentThread {...commentProps} entityType="lead" entityId={null} />
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

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value || "—"}</dd>
    </div>
  );
}
