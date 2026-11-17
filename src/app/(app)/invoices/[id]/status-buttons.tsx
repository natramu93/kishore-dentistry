"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateInvoiceStatusAction, deleteInvoiceAction, cancelInvoiceAction } from "@/actions/invoices";
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Pencil, Trash2 } from "lucide-react";

export function InvoiceActions({
  invoiceId,
  status,
  role,
  version,
  codeEnforced,
  consultation,
  hasPayments = false,
}: {
  invoiceId: string;
  status: InvoiceStatus;
  role: UserRole;
  version: number;
  codeEnforced: boolean;
  consultation: boolean;
  hasPayments?: boolean;
  hasPrimaryTreatment: boolean;
}) {
  const router = useRouter();
  const [voidReason, setVoidReason] = useState("");
  const [voidOpen, setVoidOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  function setStatus(next: "sent") {
    startTransition(async () => {
      const result = await updateInvoiceStatusAction(invoiceId, next, version);
      if (result.ok) {
        toast.success("Invoice marked sent");
        router.refresh();
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

  function cancelInvoice(archive: boolean) {
    const reason = voidReason.trim();
    if (!reason) return;
    startTransition(async () => {
      const result = await cancelInvoiceAction(invoiceId, reason, version, archive);
      if (result.ok) {
        toast.success(archive ? "Invoice archived" : "Invoice voided");
        setVoidOpen(false);
        setVoidReason("");
        if (archive) router.push("/invoices");
        else router.refresh();
      } else toast.error(result.error);
    });
  }

  const canDelete = role === "admin" || role === "operations";
  const voided = status === "cancelled";
  const hasRecordedPayment = hasPayments || status === "paid";

  return (
    <div className="flex flex-wrap gap-2">
      {(codeEnforced || consultation) && !voided && (
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
      {role === "admin" && (
        <AlertDialog open={voidOpen} onOpenChange={setVoidOpen}>
          <AlertDialogTrigger render={<Button size="sm" variant="destructive" disabled={pending}>{voided ? "Archive" : "Void invoice"}</Button>} />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{voided ? "Archive this voided invoice?" : "Void this invoice?"}</AlertDialogTitle>
              <AlertDialogDescription>{voided
                ? "Archiving removes this invoice from the list and retains its audit history. It already counts as zero in totals."
                : hasRecordedPayment
                  ? "This removes the invoice and its payments from billing and collection totals. The original invoice and receipts are retained for audit. This does not refund the patient."
                  : "This removes the invoice from billing and balance totals but retains its audit history. This cannot be undone."}</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2"><Label htmlFor="invoice-void-reason">{voided ? "Reason for archiving" : "Reason for voiding"}</Label>
              <Textarea id="invoice-void-reason" value={voidReason} onChange={(event) => setVoidReason(event.target.value)} disabled={pending} required maxLength={1000} placeholder="e.g. Wrong treatment or duplicate bill" /></div>
            <AlertDialogFooter><AlertDialogCancel disabled={pending}>Keep invoice</AlertDialogCancel>
              {!voided && <Button variant="destructive" disabled={pending || !voidReason.trim()} onClick={() => cancelInvoice(false)}>Confirm void</Button>}
              {(hasRecordedPayment || voided) && <Button variant="destructive" disabled={pending || !voidReason.trim()} onClick={() => cancelInvoice(true)}>{voided ? "Confirm archive" : "Void & archive"}</Button>}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {canDelete && !voided && !hasRecordedPayment && (
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
