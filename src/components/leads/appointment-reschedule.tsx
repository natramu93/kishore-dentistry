"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { rescheduleAppointmentAction } from "@/actions/appointments";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CalendarClock } from "lucide-react";

type DoctorOption = { id: string; label: string };

export function AppointmentReschedule({
  appointmentId,
  leadId,
  doctors,
  defaultScheduledAt,
  defaultDoctorId,
  defaultDuration,
  defaultNotes,
}: {
  appointmentId: string;
  leadId: string;
  doctors: DoctorOption[];
  defaultScheduledAt: string; // datetime-local value (clinic tz)
  defaultDoctorId: string | null;
  defaultDuration: number;
  defaultNotes: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [whatsappFallbackUrl, setWhatsappFallbackUrl] = useState<string | null>(null);

  function submit(formData: FormData) {
    // Reserve a tab during the user's click so the browser won't block the
    // WhatsApp handoff while the server saves the reschedule.
    let whatsappTab: Window | null = null;
    try {
      whatsappTab = window.open("about:blank", "_blank");
      if (whatsappTab) whatsappTab.opener = null;
    } catch {
      whatsappTab = null;
    }

    setWhatsappFallbackUrl(null);
    startTransition(async () => {
      const result = await rescheduleAppointmentAction(appointmentId, leadId, formData);
      if (result.ok) {
        setOpen(false);
        if (result.whatsappUrl && whatsappTab) {
          whatsappTab.location.href = result.whatsappUrl;
          toast.success("Appointment updated. Review and send the WhatsApp message.");
        } else if (result.whatsappUrl) {
          setWhatsappFallbackUrl(result.whatsappUrl);
          toast.success("Appointment updated. Open the WhatsApp message below.");
        } else {
          whatsappTab?.close();
          toast.success("Appointment updated");
        }
      } else {
        whatsappTab?.close();
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={
            <Button size="sm" variant="outline">
              <CalendarClock className="h-3.5 w-3.5 mr-1" />
              Reschedule / reassign
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reschedule or reassign appointment</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit(new FormData(event.currentTarget));
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor={`resched-at-${appointmentId}`}>Date &amp; time (IST)</Label>
              <Input
                id={`resched-at-${appointmentId}`}
                name="scheduled_at"
                type="datetime-local"
                defaultValue={defaultScheduledAt}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`resched-doc-${appointmentId}`}>Doctor</Label>
              <select
                id={`resched-doc-${appointmentId}`}
                name="doctor_id"
                defaultValue={defaultDoctorId ?? ""}
                className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">— Not assigned —</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`resched-dur-${appointmentId}`}>Duration (minutes)</Label>
              <Input
                id={`resched-dur-${appointmentId}`}
                name="duration_minutes"
                type="number"
                min={5}
                max={480}
                defaultValue={defaultDuration}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`resched-notes-${appointmentId}`}>Notes</Label>
              <Textarea
                id={`resched-notes-${appointmentId}`}
                name="notes"
                rows={2}
                defaultValue={defaultNotes ?? ""}
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save changes & open WhatsApp"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {whatsappFallbackUrl && (
        <a
          className="ml-2 text-sm font-medium text-primary underline underline-offset-4"
          href={whatsappFallbackUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open appointment message in WhatsApp<span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
    </>
  );
}
