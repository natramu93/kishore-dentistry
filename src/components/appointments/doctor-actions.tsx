"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { doctorMarkNoShowAction } from "@/actions/appointments";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ClipboardPlus } from "lucide-react";

export function DoctorAppointmentActions({
  appointmentId,
  leadId,
}: {
  appointmentId: string;
  leadId: string;
}) {
  const [noShowOpen, setNoShowOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function noShow() {
    startTransition(async () => {
      const result = await doctorMarkNoShowAction(appointmentId);
      if (result.ok) {
        setNoShowOpen(false);
        toast.success("Appointment marked as no-show");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Button asChild size="sm" disabled={pending}>
        <Link href={`/case-sheets/new?lead=${leadId}&appointment=${appointmentId}`}>
          <ClipboardPlus aria-hidden="true" />
          Open case sheet
        </Link>
      </Button>
      <AlertDialog open={noShowOpen} onOpenChange={setNoShowOpen}>
        <AlertDialogTrigger
          render={
            <Button size="sm" variant="outline" disabled={pending}>
              No-show
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark this appointment as a no-show?</AlertDialogTitle>
            <AlertDialogDescription>
              This updates the appointment and lead workflow. Confirm only after the appointment
              time has passed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Go back</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={noShow}
            >
              {pending ? "Updating…" : "Mark no-show"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
