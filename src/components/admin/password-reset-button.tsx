"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/actions/util";

export function PasswordResetButton({
  email,
  action,
}: {
  email: string;
  action: (formData: FormData) => Promise<ActionResult>;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    startTransition(async () => {
      const result = await action(new FormData(form));
      if (result.ok) {
        form.reset();
        setOpen(false);
        toast.success("Password updated");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) formRef.current?.reset();
      }}
    >
      <AlertDialogTrigger
        render={
          <Button variant="ghost" size="sm" disabled={pending}>
            <KeyRound className="mr-1 h-3.5 w-3.5" />
            Reset password
          </Button>
        }
      />
      <AlertDialogContent>
        <form ref={formRef} onSubmit={submit} className="space-y-5">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset password</AlertDialogTitle>
            <AlertDialogDescription>
              Set a new password for {email}. It will not be shown again after
              this update.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="admin-reset-password">New password</Label>
            <Input
              id="admin-reset-password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="admin-reset-password-confirmation">
              Confirm new password
            </Label>
            <Input
              id="admin-reset-password-confirmation"
              name="password_confirmation"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
              disabled={pending}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={pending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction type="submit" disabled={pending}>
              {pending ? "Updating…" : "Update password"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
