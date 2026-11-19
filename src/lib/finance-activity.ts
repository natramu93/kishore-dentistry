import { z } from "zod";
import { normalizeSearch } from "@/lib/validation";

export const invoiceSorts = ["created", "number", "patient", "center", "date", "total", "paid", "due", "received", "status"] as const;
export const financeMetrics = ["receipts", "subtotal", "discounts", "tax", "net"] as const;
export type FinanceMetric = typeof financeMetrics[number];
export const financeFilterSchema = z.object({
  from: z.iso.date().optional(), to: z.iso.date().optional(),
  branch: z.uuid().optional(), patient: z.uuid().optional(), doctor: z.uuid().optional(),
  search: z.string().max(120).optional(), status: z.enum(["draft", "sent", "paid", "cancelled"]).optional(),
  due: z.boolean().optional(), method: z.enum(["upi", "cash", "card", "neft"]).optional(),
}).refine((f) => !f.from || !f.to || f.from <= f.to, "From date must be before To date");
export type FinanceFilters = z.infer<typeof financeFilterSchema>;
export const financialDetailSchema = z.object({
  rows: z.array(z.object({
    id: z.string(), invoice_id: z.uuid(), patient_id: z.uuid(),
    invoice_number: z.string(), patient_name: z.string(), center: z.string(),
    date: z.iso.date(), invoice_date: z.iso.date(), description: z.string(),
    method: z.string().nullable(), reference: z.string().nullable(), amount: z.number().finite(),
  })),
  total: z.number().int().nonnegative(), amount: z.number().finite(),
});
export type FinancialDetail = z.infer<typeof financialDetailSchema>;
export function invoiceSort(value?: string) {
  return invoiceSorts.find((s) => s === value) ?? "created";
}
export function invoiceFinanceFilters(opts: {
  fromDate?: string; toDate?: string; branchId?: string; leadId?: string; search?: string;
  status?: FinanceFilters["status"]; dueOnly?: boolean; paymentMethod?: FinanceFilters["method"];
}): FinanceFilters {
  return financeFilterSchema.parse({
    from: opts.fromDate, to: opts.toDate, branch: opts.branchId, patient: opts.leadId,
    search: normalizeSearch(opts.search), status: opts.status, due: opts.dueOnly, method: opts.paymentMethod,
  });
}
