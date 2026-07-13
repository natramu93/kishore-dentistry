"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { transitionLeadAction } from "@/actions/leads";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { LeadStatus, UserRole } from "@/lib/database.types";

type Option = { id: string; label: string };
type TreatmentOption = { id: string; label: string; cost: number | null };

type DialogKind =
  | "assign"
  | "book"
  | "treat"
  | "follow_up"
  | "drop"
  | "reengage"
  | null;

export function TransitionActions({
  lead,
  activeAppointmentId,
  assignableUsers,
  doctors,
  treatmentTypes,
  role,
  userId,
  defaultTreatmentTypeId,
}: {
  lead: { id: string; status: LeadStatus };
  activeAppointmentId: string | null;
  assignableUsers: Option[];
  doctors: Option[];
  treatmentTypes: TreatmentOption[];
  role: UserRole;
  userId: string;
  defaultTreatmentTypeId?: string | null;
}) {
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [pending, startTransition] = useTransition();
  // Default the treatment stage to the lead's captured interest.
  const defaultTreatment = treatmentTypes.find((t) => t.id === defaultTreatmentTypeId);
  const [treatCost, setTreatCost] = useState(
    defaultTreatment?.cost != null ? String(defaultTreatment.cost) : ""
  );

  function run(to: LeadStatus, formData: FormData) {
    startTransition(async () => {
      const result = await transitionLeadAction(lead.id, to, formData);
      if (result.ok) {
        toast.success("Updated");
        setDialog(null);
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
          <Button size="sm" onClick={() => setDialog("treat")}>
            Mark visited / treated
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              quick("missed", activeAppointmentId ? { appointment_id: activeAppointmentId } : {})
            }
          >
            No-show → Missed
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              quick(
                "assigned",
                activeAppointmentId ? { cancelled_appointment_id: activeAppointmentId } : {}
              )
            }
          >
            Cancel appointment
          </Button>
        </>
      )}

      {s === "visited_treated" && (
        <>
          <Button size="sm" onClick={() => setDialog("follow_up")}>Schedule follow-up</Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => quick("closed")}>
            Close lead
          </Button>
        </>
      )}

      {s === "follow_up" && (
        <>
          <Button size="sm" onClick={() => setDialog("book")}>Book next appointment</Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => quick("closed")}>
            Close lead
          </Button>
        </>
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
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
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
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
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
              <Input id="duration_minutes" name="duration_minutes" type="number" defaultValue={30} min={5} max={480} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" rows={2} />
            </div>
            <SubmitRow pending={pending} label="Book" />
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "treat"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record visit &amp; treatment</DialogTitle>
          </DialogHeader>
          <form action={(fd) => run("visited_treated", fd)} className="space-y-4">
            {activeAppointmentId && (
              <input type="hidden" name="appointment_id" value={activeAppointmentId} />
            )}
            <div className="space-y-2">
              <Label htmlFor="treatment_type_id">Treatment</Label>
              <select
                id="treatment_type_id"
                name="treatment_type_id"
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                defaultValue={defaultTreatmentTypeId ?? ""}
                onChange={(e) => {
                  const t = treatmentTypes.find((x) => x.id === e.target.value);
                  if (t && t.cost != null) setTreatCost(String(t.cost));
                }}
              >
                <option value="">— Select —</option>
                {treatmentTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="t_doctor_id">Doctor</Label>
              <select
                id="t_doctor_id"
                name="doctor_id"
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                defaultValue=""
              >
                <option value="">— Select —</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cost">Cost (₹) — auto-filled from catalog, editable</Label>
              <Input
                id="cost"
                name="cost"
                type="number"
                min="0"
                step="0.01"
                value={treatCost}
                onChange={(e) => setTreatCost(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="t_notes">Treatment notes</Label>
              <Textarea id="t_notes" name="notes" rows={2} />
            </div>
            <SubmitRow pending={pending} label="Save" />
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
