"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
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
import type { ActionResult } from "@/actions/util";

export function ToggleActiveButton({
  isActive,
  action,
}: {
  isActive: boolean;
  action: () => Promise<ActionResult>;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button variant="ghost" size="sm" disabled={pending}>
            {isActive ? "Deactivate" : "Activate"}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isActive ? "Deactivate this record?" : "Activate this record?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isActive
              ? "It will no longer be available for new records, but existing history is kept."
              : "It will become available for new records immediately."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Go back</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            variant={isActive ? "destructive" : "default"}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await action();
                if (result.ok) {
                  setOpen(false);
                  toast.success(isActive ? "Record deactivated" : "Record activated");
                } else {
                  toast.error(result.error);
                }
              })
            }
          >
            {pending ? "Updating…" : isActive ? "Deactivate" : "Activate"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
