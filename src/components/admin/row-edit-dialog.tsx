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
import { Pencil } from "lucide-react";

/** Per-row "Edit" dialog wrapping a server action that takes FormData. */
export function RowEditDialog({
  title,
  action,
  children,
  triggerLabel = "Edit",
}: {
  title: string;
  action: (formData: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  triggerLabel?: string;
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
        toast.success("Saved");
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
          <Button variant="ghost" size="sm">
            <Pencil className="h-3.5 w-3.5 mr-1" />
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
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
