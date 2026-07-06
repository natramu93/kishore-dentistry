"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateInvoiceStatusAction, deleteInvoiceAction } from "@/actions/invoices";
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
import type { InvoiceStatus, UserRole } from "@/lib/database.types";
import { Pencil, Trash2 } from "lucide-react";

export function InvoiceActions({
  invoiceId,
  status,
  role,
}: {
  invoiceId: string;
  status: InvoiceStatus;
  role: UserRole;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function setStatus(next: InvoiceStatus) {
    startTransition(async () => {
      const result = await updateInvoiceStatusAction(invoiceId, next);
      if (!result.ok) toast.error(result.error);
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteInvoiceAction(invoiceId);
      if (result.ok) {
        toast.success("Invoice deleted");
        router.push("/invoices");
      } else {
        toast.error(result.error);
      }
    });
  }

  const canDelete = role !== "agent";

  return (
    <div className="flex flex-wrap gap-2">
      {status !== "paid" && (
        <Button asChild size="sm" variant="outline">
          <Link href={`/invoices/${invoiceId}/edit`}>
            <Pencil className="h-3.5 w-3.5 mr-1" />
            Edit
          </Link>
        </Button>
      )}
      {status === "draft" && (
        <Button size="sm" disabled={pending} onClick={() => setStatus("sent")}>
          Mark sent
        </Button>
      )}
      {status !== "paid" && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setStatus("paid")}>
          Mark paid
        </Button>
      )}
      {canDelete && (
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button size="sm" variant="destructive" disabled={pending}>
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Delete
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this invoice?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes the invoice and its line items. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
