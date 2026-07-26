"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ActionResult } from "@/actions/util";
import { Plus } from "lucide-react";

/** Generic "create X" dialog wrapping a server action that takes FormData. */
export function FormDialog({
  triggerLabel,
  title,
  action,
  children,
  submitLabel = "Save",
  successMessage = "Saved",
}: {
  triggerLabel: string;
  title: string;
  action: (formData: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  submitLabel?: string;
  successMessage?: string;
}) {
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();

  function changeOpen(nextOpen: boolean) {
    if (
      !nextOpen &&
      dirty &&
      !pending &&
      !window.confirm("Discard your unsaved changes?")
    ) {
      return;
    }
    setOpen(nextOpen);
    if (!nextOpen) setDirty(false);
  }

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await action(formData);
      if (result.ok) {
        toast.success(successMessage);
        setDirty(false);
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger
        render={
          <Button size="sm">
            <Plus className="h-4 w-4 mr-1" />
            {triggerLabel}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          action={submit}
          className="space-y-4"
          onChange={() => setDirty(true)}
        >
          {children}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
