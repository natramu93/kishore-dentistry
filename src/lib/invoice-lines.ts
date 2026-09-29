import { z } from "zod";
import { INDIAN_STANDARD_TEETH } from "@/lib/clinical";

export function invoiceDisplayTotals(items: readonly { quantity: number; unit_price: number }[], taxRate: number, discount: number) {
  const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const subtotal = round(items.reduce((sum, item) => sum + round(item.quantity * item.unit_price), 0));
  const safeDiscount = Math.min(Math.max(0, discount), subtotal);
  const tax = round((subtotal - safeDiscount) * taxRate / 100);
  return { subtotal, safeDiscount, tax, total: round(subtotal - safeDiscount + tax) };
}

/** The quick consultation shortcut uses the same center catalog and editor as other invoices. */
export function consultationInvoicePreset(catalog: readonly {
  id: string; name: string; default_cost: number | null; is_general_consultation: boolean;
}[]) {
  const consultation = catalog.find((item) => item.is_general_consultation);
  if (!consultation) return null;
  return {
    treatment_type_id: consultation.id,
    description: consultation.name,
    site_label: "General / not tooth-specific",
    quantity: 1,
    unit_price: consultation.default_cost ?? 200,
    tooth_numbers: [],
    line_note: "",
  };
}

export const invoiceLineDetailsSchema = z.object({
  tooth_numbers: z.array(z.enum(INDIAN_STANDARD_TEETH)).max(52)
    .refine((teeth) => new Set(teeth).size === teeth.length, "Select each tooth only once")
    .optional(),
  line_note: z.string().trim().max(1000, "Line note must be 1,000 characters or fewer").optional(),
});

/** Invoice teeth describe a charge, not a completed clinical procedure. */
export function invoiceLineToothLabel(item: {
  tooth_numbers?: readonly string[] | null;
  tooth_number?: string | null;
}): string | null {
  const teeth = item.tooth_numbers?.length ? item.tooth_numbers : item.tooth_number ? [item.tooth_number] : [];
  return teeth.length ? `Teeth (IS 8815): ${teeth.join(", ")}` : null;
}
