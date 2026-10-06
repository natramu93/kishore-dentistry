import { z } from "zod";

export const PAYMENT_METHODS = ["upi", "cash", "card", "neft"] as const;
export const PAYMENT_LABELS = { upi: "UPI", cash: "Cash", card: "Card", neft: "NEFT / Net banking" };
export type CollectionRow = {
  key: string;
  upi: number;
  cash: number;
  card: number;
  neft: number;
  amount: number;
};

const receiptSchema = z.array(z.object({
  day: z.iso.date(),
  method: z.enum(PAYMENT_METHODS),
  amount: z.number().finite().nonnegative(),
})).max(367 * 4);

/** Sum in paise so split-payment totals reconcile across every view. */
export function summarizeCollections(input: unknown) {
  const receipts = receiptSchema.parse(input);
  const days = new Map<string, CollectionRow>();
  const months = new Map<string, CollectionRow>();
  const total: CollectionRow = { key: "Total", upi: 0, cash: 0, card: 0, neft: 0, amount: 0 };
  for (const receipt of receipts) {
    const paise = Math.round(receipt.amount * 100);
    for (const [groups, key] of [[days, receipt.day], [months, receipt.day.slice(0, 7)]] as const) {
      const row = groups.get(key) ?? { key, upi: 0, cash: 0, card: 0, neft: 0, amount: 0 };
      row[receipt.method] += paise;
      row.amount += paise;
      groups.set(key, row);
    }
    total[receipt.method] += paise;
    total.amount += paise;
  }
  const rupees = (row: CollectionRow): CollectionRow => ({
    key: row.key, upi: row.upi / 100, cash: row.cash / 100,
    card: row.card / 100, neft: row.neft / 100, amount: row.amount / 100,
  });
  const sorted = (groups: Map<string, CollectionRow>) => [...groups.values()]
    .sort((a, b) => a.key.localeCompare(b.key)).map(rupees);
  return { byDay: sorted(days), byMonth: sorted(months), total: rupees(total) };
}
