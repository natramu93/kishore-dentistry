import { assertDateOnly } from "@/lib/validation";
import { clinicToday } from "@/lib/tz";
import type { InvoicePaymentMethod, InvoiceStatus } from "@/lib/database.types";

export const INVOICE_STATUSES: readonly InvoiceStatus[] = ["draft", "sent", "paid", "cancelled"];
const METHODS: readonly InvoicePaymentMethod[] = ["cash", "upi", "card", "neft"];

export function invoiceListFilters(params: Record<string, string | undefined>) {
  const dates = invoiceDateFilter(params);
  return {
    dates,
    options: {
      fromDate: dates.from,
      toDate: dates.to,
      leadId: params.lead || undefined,
      branchId: params.branch || undefined,
      status: INVOICE_STATUSES.find((status) => status === params.status),
      dueOnly: params.balance === "due",
      paymentMethod: METHODS.find((method) => method === params.method),
    },
  };
}

export const INVOICE_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function invoiceEditWindowOpen(createdAt: string, now = Date.now()): boolean {
  const created = Date.parse(createdAt);
  return Number.isFinite(created) && now >= created && now < created + INVOICE_EDIT_WINDOW_MS;
}

export function invoiceStatusLabel(status: string): string {
  return status === "cancelled" ? "Voided" : status;
}

export function invoiceDateFilter(params: Record<string, string | undefined>, today = clinicToday()) {
  const mode = params.dates === "all" ? "all" : params.dates !== "today" && (params.dates === "range" || params.from || params.to) ? "range" : "today";
  if (mode === "all") return { mode, from: undefined, to: undefined } as const;
  if (mode === "today") return { mode, from: today, to: today } as const;
  try {
    const from = params.from ? assertDateOnly(params.from, "From date") : undefined;
    const to = params.to ? assertDateOnly(params.to, "To date") : undefined;
    if (!from && !to) return { mode, error: "Choose a from or to date, or select All dates." } as const;
    if (from && to && from > to) return { mode, error: "From date must be on or before To date." } as const;
    return { mode, from, to } as const;
  } catch {
    return { mode, error: "Enter valid invoice filter dates." } as const;
  }
}
