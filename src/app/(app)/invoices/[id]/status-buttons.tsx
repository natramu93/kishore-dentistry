"use client";

import { useState, useTransition } from "react";
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
  version,
}: {
  invoiceId: string;
  status: InvoiceStatus;
  role: UserRole;
  version: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [paidOpen, setPaidOpen] = useState(false);

  function setStatus(next: InvoiceStatus) {
    startTransition(async () => {
      const result = await updateInvoiceStatusAction(invoiceId, next, version);
      if (result.ok) {
        setPaidOpen(false);
        toast.success(next === "paid" ? "Invoice marked paid" : "Invoice marked sent");
      } else {
        toast.error(result.error);
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteInvoiceAction(invoiceId, version);
      if (result.ok) {
        toast.success("Invoice archived");
        router.push("/invoices");
      } else {
        toast.error(result.error);
      }
    });
  }

  const canDelete = role === "admin" || role === "operations";

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
        <AlertDialog open={paidOpen} onOpenChange={setPaidOpen}>
          <AlertDialogTrigger
            render={
              <Button size="sm" variant="outline" disabled={pending}>
                Mark paid
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm payment received?</AlertDialogTitle>
              <AlertDialogDescription>
                Mark this invoice paid only after verifying the payment. Paid invoices can no
                longer be edited.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Go back</AlertDialogCancel>
              <AlertDialogAction type="button" disabled={pending} onClick={() => setStatus("paid")}>
                {pending ? "Updating…" : "Confirm payment"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {canDelete && (
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button size="sm" variant="destructive" disabled={pending}>
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Archive
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive this invoice?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the invoice from active records while retaining
                its protected audit history.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={remove}>Archive</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
