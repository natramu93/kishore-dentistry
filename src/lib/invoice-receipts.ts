import { z } from "zod";

export const PAYMENT_METHODS = [
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "cash", label: "Cash" },
  { value: "neft", label: "NEFT" },
] as const;

export const paymentReceiptSchema = z.object({
  amount: z.coerce.number().finite().positive().max(9_999_999_999.99)
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, "Amounts support at most two decimals"),
  method: z.enum(["upi", "card", "cash", "neft"]),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
});

const small = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function integerWords(value: number): string {
  if (value < 20) return small[value];
  if (value < 100) return `${tens[Math.floor(value / 10)]}${value % 10 ? ` ${small[value % 10]}` : ""}`;
  for (const [scale, name] of [[10_000_000, "Crore"], [100_000, "Lakh"], [1_000, "Thousand"], [100, "Hundred"]] as const) {
    if (value >= scale) return `${integerWords(Math.floor(value / scale))} ${name}${value % scale ? ` ${integerWords(value % scale)}` : ""}`;
  }
  return "Zero";
}

/** Indian grouping, calculated in paise so rounding carries into the rupees. */
export function receivedAmountInWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0 || amount > 9_999_999_999.99) throw new RangeError("Received amount is invalid");
  const paiseTotal = Math.round((amount + Number.EPSILON) * 100);
  const rupees = Math.floor(paiseTotal / 100);
  const paise = paiseTotal % 100;
  return `${integerWords(rupees)} ${rupees === 1 ? "Rupee" : "Rupees"}${paise ? ` and ${integerWords(paise)} ${paise === 1 ? "Paisa" : "Paise"}` : ""} Only`;
}
