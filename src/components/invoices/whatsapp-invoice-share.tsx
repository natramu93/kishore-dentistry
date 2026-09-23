"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

function whatsappPhone(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  const normalized = digits.length === 10
    ? `91${digits}`
    : digits.length === 11 && digits.startsWith("0")
      ? `91${digits.slice(1)}`
      : digits;
  return normalized.length >= 10 && normalized.length <= 15 ? normalized : null;
}

function downloadInvoice(file: File): void {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function WhatsAppInvoiceShare({
  invoiceId,
  invoiceNumber,
  patientName,
  patientMobile,
}: {
  invoiceId: string;
  invoiceNumber: string;
  patientName: string | null;
  patientMobile: string | null;
}) {
  const [pending, setPending] = useState(false);
  const phone = whatsappPhone(patientMobile);
  const message = `Hello${patientName ? ` ${patientName}` : ""}, your invoice ${invoiceNumber} is ready. Please find it attached.`;
  const whatsappUrl = phone
    ? `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}`
    : "https://web.whatsapp.com/";

  async function shareInvoice() {
    const supportsFileShare = typeof navigator !== "undefined"
      && typeof navigator.share === "function"
      && typeof navigator.canShare === "function"
      && typeof File !== "undefined"
      && navigator.canShare({ files: [new File([], "invoice.pdf", { type: "application/pdf" })] });

    // Open the signed-in browser's WhatsApp Web tab immediately when the
    // platform cannot hand off files natively; this avoids popup blocking.
    const whatsappWebOpened = !supportsFileShare;
    if (whatsappWebOpened) window.open(whatsappUrl, "_blank", "noopener,noreferrer");

    setPending(true);
    try {
      const response = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/pdf`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not prepare the invoice PDF");
      }
      if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/pdf")) {
        throw new Error("The invoice PDF could not be loaded. Refresh the page and sign in again if your session expired.");
      }
      const blob = await response.blob();
      const file = new File([blob], `${invoiceNumber.replace(/[^A-Za-z0-9._-]/g, "-")}.pdf`, {
        type: "application/pdf",
      });

      if (supportsFileShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: `Invoice ${invoiceNumber}`,
            text: message,
          });
          toast.success("Invoice shared. Choose WhatsApp in the sharing options.");
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            toast.info("Sharing was cancelled.");
            return;
          }
          // Unsupported targets and platform share failures use the browser
          // fallback below so the user can still attach the downloaded file.
        }
      }

      downloadInvoice(file);
      if (whatsappPhone(patientMobile)) {
        toast.success("Invoice PDF downloaded and WhatsApp Web opened. Attach the downloaded PDF in the chat.");
      } else {
        toast.success("Invoice PDF downloaded. The patient’s mobile number is missing or incomplete.");
      }
      if (!whatsappWebOpened) window.open(whatsappUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to prepare the invoice for WhatsApp.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={shareInvoice} disabled={pending}>
          <MessageCircle aria-hidden="true" />
          {pending ? "Preparing invoice…" : "Send on WhatsApp"}
        </Button>
        <Button asChild variant="ghost" size="sm">
          <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
            Open WhatsApp Web<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </Button>
      </div>
      <p className="max-w-sm text-xs text-muted-foreground">
        If file sharing is unavailable, the invoice downloads and WhatsApp Web opens; attach the PDF from Downloads before sending.
      </p>
    </div>
  );
}
