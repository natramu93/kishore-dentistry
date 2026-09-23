"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { transitionLeadAction } from "@/actions/leads";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { LeadStatus, UserRole } from "@/lib/database.types";

type Option = { id: string; label: string };
type DialogKind =
  | "assign"
  | "book"
  | "follow_up"
  | "drop"
  | "reengage"
  | null;

type QuickConfirmation = {
  title: string;
  description: string;
  confirmLabel: string;
  to: LeadStatus;
  extra?: Record<string, string>;
  destructive?: boolean;
};

export function TransitionActions({
  lead,
  activeAppointmentId,
  assignableUsers,
  doctors,
  role,
  userId,
}: {
  lead: { id: string; status: LeadStatus };
  activeAppointmentId: string | null;
  assignableUsers: Option[];
  doctors: Option[];
  role: UserRole;
  userId: string;
}) {
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [confirmation, setConfirmation] = useState<QuickConfirmation | null>(null);
  const [pending, startTransition] = useTransition();

  function run(to: LeadStatus, formData: FormData) {
    startTransition(async () => {
      const result = await transitionLeadAction(lead.id, to, formData);
      if (result.ok) {
        toast.success("Lead status updated");
        setDialog(null);
        setConfirmation(null);
      } else {
        toast.error(result.error);
      }
    });
  }

  function quick(to: LeadStatus, extra: Record<string, string> = {}) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    run(to, fd);
  }

  const s = lead.status;
  const isFrontOffice = role === "front_office";

  return (
    <div className="flex flex-wrap gap-2">
      {s === "open" && (
        <>
          {isFrontOffice ? (
            <Button size="sm" disabled={pending} onClick={() => quick("assigned", { assignee_id: userId })}>
              Claim lead
            </Button>
          ) : (
            <Button size="sm" onClick={() => setDialog("assign")}>Assign</Button>
          )}
        </>
      )}

      {s === "assigned" && (
        <>
          <Button size="sm" onClick={() => setDialog("book")}>Book appointment</Button>
          {!isFrontOffice && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => quick("open")}>
              Unassign
            </Button>
          )}
        </>
      )}

      {s === "appointment_booked" && (
        <>
          <Button size="sm" onClick={() => setDialog("book")}>Book another appointment</Button>
          {(role === "admin" || role === "clinical_head") && activeAppointmentId && (
            <Button size="sm" asChild>
              <Link href={`/case-sheets/new?lead=${lead.id}&appointment=${activeAppointmentId}`}>
                Open digital case sheet
              </Link>
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              setConfirmation({
                title: "Mark this appointment as a no-show?",
                description: "This moves the lead to Missed and updates the active appointment.",
                confirmLabel: "Mark no-show",
                to: "missed",
                extra: activeAppointmentId ? { appointment_id: activeAppointmentId } : {},
                destructive: true,
              })
            }
          >
            No-show → Missed
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              setConfirmation({
                title: "Cancel the active appointment?",
                description: "The appointment will be cancelled and the lead will return to Assigned.",
                confirmLabel: "Cancel appointment",
                to: "assigned",
                extra: activeAppointmentId
                  ? { cancelled_appointment_id: activeAppointmentId }
                  : {},
                destructive: true,
              })
            }
          >
            Cancel appointment
          </Button>
        </>
      )}

      {s === "visited_treated" && (
        <Button size="sm" onClick={() => setDialog("follow_up")}>Schedule follow-up</Button>
      )}

      {s === "follow_up" && (
        <Button size="sm" onClick={() => setDialog("book")}>Book next appointment</Button>
      )}

      {s === "missed" && (
        <Button size="sm" onClick={() => (isFrontOffice ? quick("assigned", { assignee_id: userId }) : setDialog("reengage"))}>
          Re-engage
        </Button>
      )}

      {!["closed", "dropped"].includes(s) && (
        <Button size="sm" variant="destructive" onClick={() => setDialog("drop")}>
          Drop lead
        </Button>
      )}

      {/* ---------- Dialogs ---------- */}

      <Dialog open={dialog === "assign" || dialog === "reengage"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog === "reengage" ? "Re-engage lead" : "Assign lead"}</DialogTitle>
          </DialogHeader>
          <form action={(fd) => run("assigned", fd)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="assignee_id">Assign to</Label>
              <select
                id="assignee_id"
                name="assignee_id"
                required
                className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                {assignableUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.label}</option>
                ))}
              </select>
            </div>
            <SubmitRow pending={pending} label="Assign" />
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "book"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Book appointment</DialogTitle>
          </DialogHeader>
          <form action={(fd) => run("appointment_booked", fd)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="scheduled_at">Date &amp; time (IST)</Label>
              <Input id="scheduled_at" name="scheduled_at" type="datetime-local" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="doctor_id">Doctor</Label>
              <select
                id="doctor_id"
                name="doctor_id"
                className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                defaultValue=""
              >
                <option value="">— Not decided —</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="duration_minutes">Duration (minutes)</Label>
              <Input id="duration_minutes" name="duration_minutes" type="number" defaultValue={15} min={5} max={480} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" rows={2} />
            </div>
            <SubmitRow pending={pending} label="Book" />
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "follow_up"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule follow-up</DialogTitle>
          </DialogHeader>
          <form action={(fd) => run("follow_up", fd)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="due_at">Due (IST)</Label>
              <Input id="due_at" name="due_at" type="datetime-local" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reason">Reason</Label>
              <Input id="reason" name="reason" placeholder="e.g. Review healing, discuss braces plan" />
            </div>
            <SubmitRow pending={pending} label="Schedule" />
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "drop"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Drop lead</DialogTitle>
          </DialogHeader>
          <form
            action={(fd) => {
              if (activeAppointmentId) fd.set("appointment_id", activeAppointmentId);
              run("dropped", fd);
            }}
            className="space-y-4"
          >
            <p className="text-sm text-muted-foreground">
              This is a terminal state — the lead can&apos;t re-enter the pipeline.
            </p>
            <div className="space-y-2">
              <Label htmlFor="drop_reason">Reason</Label>
              <Textarea id="drop_reason" name="reason" rows={2} placeholder="Why is this lead being dropped?" />
            </div>
            <SubmitRow pending={pending} label="Drop lead" destructive />
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirmation(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmation?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Go back</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant={confirmation?.destructive ? "destructive" : "default"}
              disabled={pending}
              onClick={() => {
                if (confirmation) quick(confirmation.to, confirmation.extra);
              }}
            >
              {pending ? "Updating…" : confirmation?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SubmitRow({ pending, label, destructive }: { pending: boolean; label: string; destructive?: boolean }) {
  return (
    <div className="flex justify-end">
      <Button type="submit" disabled={pending} variant={destructive ? "destructive" : "default"}>
        {pending ? "Saving…" : label}
      </Button>
    </div>
  );
}
