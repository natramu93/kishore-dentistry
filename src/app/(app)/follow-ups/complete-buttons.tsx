"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { completeFollowUpAction } from "@/actions/follow-ups";
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

export function CompleteFollowUpButtons({ followUpId }: { followUpId: string }) {
  const [pending, startTransition] = useTransition();
  const [cancelOpen, setCancelOpen] = useState(false);

  function complete(status: "done" | "cancelled") {
    startTransition(async () => {
      const result = await completeFollowUpAction(followUpId, status);
      if (result.ok) {
        setCancelOpen(false);
        toast.success(status === "done" ? "Follow-up completed" : "Follow-up cancelled");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => complete("done")}>
        Done
      </Button>
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogTrigger
          render={
            <Button size="sm" variant="ghost" disabled={pending}>
              Cancel
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this follow-up?</AlertDialogTitle>
            <AlertDialogDescription>
              It will be removed from the pending follow-up queue.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep follow-up</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => complete("cancelled")}
            >
              {pending ? "Cancelling…" : "Cancel follow-up"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
