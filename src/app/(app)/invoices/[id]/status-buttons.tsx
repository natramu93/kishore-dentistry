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
  version,
  codeEnforced,
  consultation,
}: {
  invoiceId: string;
  status: InvoiceStatus;
  role: UserRole;
  version: number;
  codeEnforced: boolean;
  consultation: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function setStatus(next: "sent") {
    startTransition(async () => {
      const result = await updateInvoiceStatusAction(invoiceId, next, version);
      if (result.ok) {
        toast.success("Invoice marked sent");
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
      {codeEnforced && status !== "paid" && (
        <Button asChild size="sm" variant="outline">
          <Link href={`/invoices/${invoiceId}/edit`}>
            <Pencil className="h-3.5 w-3.5 mr-1" />
            Edit
          </Link>
        </Button>
      )}
      {(codeEnforced || consultation) && status === "draft" && (
        <Button size="sm" disabled={pending} onClick={() => setStatus("sent")}>
          Mark sent
        </Button>
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
