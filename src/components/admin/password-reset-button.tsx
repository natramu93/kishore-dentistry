"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
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

export function PasswordResetButton({
  email,
  action,
}: {
  email: string;
  action: () => Promise<ActionResult>;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button variant="ghost" size="sm" disabled={pending}>
            <KeyRound className="mr-1 h-3.5 w-3.5" />
            Reset password
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Send a password reset link?</AlertDialogTitle>
          <AlertDialogDescription>
            Supabase will send a secure, expiring recovery link to {email}. The current password will not be shown or shared with you.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await action();
                if (result.ok) {
                  setOpen(false);
                  toast.success("Password reset link sent");
                } else {
                  toast.error(result.error);
                }
              })
            }
          >
            {pending ? "Sending…" : "Send reset link"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

