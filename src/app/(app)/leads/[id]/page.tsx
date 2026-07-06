import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { getLeadRelated, getLeadActivity } from "@/data/leads";
import { listComments } from "@/data/comments";
import { listAssignableUsers } from "@/data/users";
import { listDoctors, listTreatmentTypes } from "@/data/catalogs";
import { LeadStatusBadge } from "@/components/lead-status-badge";
import { StatusStepper } from "@/components/leads/status-stepper";
import { TransitionActions } from "@/components/leads/transition-actions";
import { CommentThread } from "@/components/comment-thread";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STATUS_LABELS } from "@/lib/leads/transitions";
import { fmt, fmtDate, formatINR } from "@/lib/tz";
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

  const [activity, comments, assignableUsers, doctors, treatmentTypes] = await Promise.all([
    getLeadActivity(ctx, id),
    listComments(ctx, id),
    listAssignableUsers(ctx, lead.branch_id),
    listDoctors(ctx, { branchId: lead.branch_id }),
    listTreatmentTypes(ctx),
  ]);

  const activeAppointment = appointments.find((a) => a.status === "scheduled") ?? null;
  const canModerate = ctx.role !== "agent";
  const commentProps = {
    leadId: lead.id,
    comments,
    currentUserId: ctx.userId,
    canModerate,
  } as const;

  return (
    <div className="space-y-6">
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
          }))}
          role={ctx.role}
          userId={ctx.userId}
        />
      </div>

      <StatusStepper status={lead.status} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* Contact details */}
          <Card>
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
              </dl>
              {lead.notes && (
                <p className="mt-4 text-sm whitespace-pre-wrap border-t pt-3 text-muted-foreground">
                  {lead.notes}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Appointments */}
          <Card>
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
                  <CommentThread {...commentProps} entityType="appointment" entityId={a.id} compact />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Treatments */}
          <Card>
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
          <Card>
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
          <Card>
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
          <Card>
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
          <Card>
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
