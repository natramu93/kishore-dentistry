"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { doctorCompleteAppointmentAction, doctorMarkNoShowAction } from "@/actions/appointments";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatINR } from "@/lib/tz";
import { CheckCircle2 } from "lucide-react";

type TreatmentOption = { id: string; name: string; default_cost: number | null };

export function DoctorAppointmentActions({
  appointmentId,
  treatmentTypes,
}: {
  appointmentId: string;
  treatmentTypes: TreatmentOption[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function complete(formData: FormData) {
    startTransition(async () => {
      const result = await doctorCompleteAppointmentAction(appointmentId, formData);
      if (result.ok) {
        toast.success("Marked treated");
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  function noShow() {
    startTransition(async () => {
      const result = await doctorMarkNoShowAction(appointmentId);
      if (!result.ok) toast.error(result.error);
    });
  }

  return (
    <div className="flex gap-1 justify-end">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={
            <Button size="sm" disabled={pending}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              Mark treated
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log treatment</DialogTitle>
          </DialogHeader>
          <form action={complete} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`dt-${appointmentId}`}>Treatment</Label>
              <select
                id={`dt-${appointmentId}`}
                name="treatment_type_id"
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                defaultValue=""
              >
                <option value="">— Select —</option>
                {treatmentTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.default_cost != null ? ` — ${formatINR(t.default_cost)}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`cost-${appointmentId}`}>Cost (₹)</Label>
              <Input id={`cost-${appointmentId}`} name="cost" type="number" min="0" step="0.01" />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`notes-${appointmentId}`}>Treatment notes</Label>
              <Textarea id={`notes-${appointmentId}`} name="notes" rows={2} />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Button size="sm" variant="outline" disabled={pending} onClick={noShow}>
        No-show
      </Button>
    </div>
  );
}
