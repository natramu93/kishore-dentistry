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
  editWindowOpen,
}: {
  invoiceId: string;
  status: InvoiceStatus;
  role: UserRole;
  version: number;
  codeEnforced: boolean;
  consultation: boolean;
  hasPayments?: boolean;
  editWindowOpen: boolean;
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

  function cancelInvoice() {
    const reason = voidReason.trim();
    if (!reason) return;
    startTransition(async () => {
      const result = await cancelInvoiceAction(invoiceId, reason, version);
      if (result.ok) {
        toast.success("Invoice voided");
        setVoidOpen(false);
        router.refresh();
      } else toast.error(result.error);
    });
  }

  const canDelete = role === "admin" || role === "operations";

  return (
    <div className="flex flex-wrap gap-2">
      {(codeEnforced || consultation) && editWindowOpen && !hasPayments && status !== "paid" && status !== "cancelled" && (
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
      {role === "admin" && !hasPayments && status !== "cancelled" && status !== "paid" && (
        <AlertDialog open={voidOpen} onOpenChange={setVoidOpen}>
          <AlertDialogTrigger render={<Button size="sm" variant="destructive" disabled={pending}>Void invoice</Button>} />
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Void this invoice?</AlertDialogTitle>
              <AlertDialogDescription>The invoice and its history will be retained, but the balance will be removed. This cannot be undone. Create a replacement invoice if needed.</AlertDialogDescription></AlertDialogHeader>
            <div className="space-y-2"><Label htmlFor="invoice-void-reason">Reason for voiding</Label>
              <Textarea id="invoice-void-reason" value={voidReason} onChange={(event) => setVoidReason(event.target.value)} required maxLength={1000} placeholder="e.g. Wrong treatment or duplicate bill" /></div>
            <AlertDialogFooter><AlertDialogCancel disabled={pending}>Keep invoice</AlertDialogCancel>
              <Button variant="destructive" disabled={pending || !voidReason.trim()} onClick={cancelInvoice}>{pending ? "Voiding…" : "Confirm void"}</Button></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {canDelete && status !== "paid" && !hasPayments && (
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
