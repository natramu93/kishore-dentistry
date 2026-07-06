"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { updateInvoiceStatusAction } from "@/actions/invoices";
import { Button } from "@/components/ui/button";
import type { InvoiceStatus } from "@/lib/database.types";

export function InvoiceStatusButtons({
  invoiceId,
  status,
}: {
  invoiceId: string;
  status: InvoiceStatus;
}) {
  const [pending, startTransition] = useTransition();

  function setStatus(next: InvoiceStatus) {
    startTransition(async () => {
      const result = await updateInvoiceStatusAction(invoiceId, next);
      if (!result.ok) toast.error(result.error);
    });
  }

  return (
    <div className="flex gap-2">
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
    </div>
  );
}
