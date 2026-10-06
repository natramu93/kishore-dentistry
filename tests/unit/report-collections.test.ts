import { describe, expect, it } from "vitest";
import { PAYMENT_METHODS, summarizeCollections } from "@/lib/reports/collections";

describe("payment-method revenue", () => {
  it("reconciles split receipts, dates and months without floating-point drift", () => {
    const result = summarizeCollections([
      { day: "2026-10-01", method: "upi", amount: 0.1 },
      { day: "2026-10-01", method: "upi", amount: 0.2 },
      { day: "2026-10-01", method: "cash", amount: 200 },
      { day: "2026-09-30", method: "card", amount: 300 },
      { day: "2026-10-02", method: "neft", amount: 400 },
    ]);
    expect(result.total).toEqual({ key: "Total", upi: 0.3, cash: 200, card: 300, neft: 400, amount: 900.3 });
    expect(result.byDay[0].key).toBe("2026-09-30");
    expect(result.byMonth[1].amount).toBe(600.3);
  });
  it("includes zero balances for every method when there are no receipts", () => {
    expect(summarizeCollections([])).toEqual({ byDay: [], byMonth: [], total: { key: "Total", upi: 0, cash: 0, card: 0, neft: 0, amount: 0 } });
  });
  it("handles a full year across all methods without a 1000-row truncation", () => {
    const receipts = Array.from({ length: 366 }, (_, index) => {
      const day = new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10);
      return PAYMENT_METHODS.map((method) => ({ day, method, amount: 1 }));
    }).flat();
    const result = summarizeCollections(receipts);
    expect(result.byDay).toHaveLength(366);
    expect(result.byMonth).toHaveLength(12);
    expect(result.total.amount).toBe(1464);
  });
  it.each([
    [{ day: "2026-10-01", method: "other", amount: 10 }],
    [{ day: "2026-10-01", method: "cash", amount: -10 }],
    [{ day: "invalid", method: "cash", amount: 10 }],
  ])("rejects malformed receipt payloads", (row) => {
    expect(() => summarizeCollections([row])).toThrow();
  });
});
