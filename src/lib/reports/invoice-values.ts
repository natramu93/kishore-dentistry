import { z } from "zod";

const money = z.number().finite().nonnegative();
export const invoiceValuesSchema = z.object({
  rows: z.array(z.object({
    dimension: z.enum(["doctor", "center", "day", "month", "category", "treatment"]),
    key: z.string(), label: z.string(), invoices: z.number().int().nonnegative(), value: money,
  })),
  subtotal: money, discounts: money, tax: money, net: money,
  invoices: z.number().int().nonnegative(),
});
export type InvoiceValues = z.infer<typeof invoiceValuesSchema>;

/** Financial activity is sourced only from invoices; never add clinical costs. */
export function validateInvoiceValues(input: unknown): InvoiceValues {
  const result = invoiceValuesSchema.parse(input);
  const cents = (value: number) => Math.round(value * 100);
  if (cents(result.subtotal) - cents(result.discounts) + cents(result.tax) !== cents(result.net)) {
    throw new Error("Invoice report totals do not reconcile");
  }
  for (const dimension of ["doctor", "center", "day", "month", "category", "treatment"] as const) {
    const total = result.rows.filter((row) => row.dimension === dimension)
      .reduce((sum, row) => sum + cents(row.value), 0);
    if (total !== cents(result.subtotal)) throw new Error("Invoice report breakdown does not reconcile");
  }
  return result;
}
