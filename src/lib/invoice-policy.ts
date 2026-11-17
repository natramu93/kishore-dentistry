import { assertDateOnly, normalizeSearch } from "@/lib/validation";
import { clinicToday } from "@/lib/tz";
import type { Invoice, InvoicePayment, InvoicePaymentMethod, InvoiceStatus } from "@/lib/database.types";

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
      search: normalizeSearch(params.q),
      branchId: params.branch || undefined,
      status: INVOICE_STATUSES.find((status) => status === params.status),
      dueOnly: params.balance === "due",
      paymentMethod: METHODS.find((method) => method === params.method),
    },
  };
}

export function invoiceStatusLabel(status: string): string {
  return status === "cancelled" ? "Voided" : status;
}

export function invoicePaymentEditIssue(total: number, received: number, legacyPaidTotal?: number): string | undefined {
  if (legacyPaidTotal !== undefined && Math.round(total * 100) !== Math.round(legacyPaidTotal * 100)) {
    return "This historical invoice is marked paid without receipts. You can edit its details, but its total must stay unchanged.";
  }
  if (Math.round(total * 100) < Math.round(received * 100)) {
    return "The invoice total cannot be less than the amount already received.";
  }
}

export function invoicePaymentTotals(
  invoice: Pick<Invoice, "total" | "status" | "deleted_at">,
  payments: readonly Pick<InvoicePayment, "amount">[],
) {
  if (invoice.status === "cancelled" || invoice.deleted_at) return { amount_paid: 0, balance_due: 0 };
  // Preserve historic paid invoices that predate the receipt ledger.
  const amount_paid = invoice.status === "paid" && payments.length === 0
    ? Number(invoice.total)
    : Math.round(payments.reduce((sum, payment) => sum + Number(payment.amount), 0) * 100) / 100;
  return { amount_paid, balance_due: Math.max(0, Math.round((Number(invoice.total) - amount_paid) * 100) / 100) };
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
