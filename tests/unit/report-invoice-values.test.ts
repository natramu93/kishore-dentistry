import { describe, expect, it } from "vitest";
import { validateInvoiceValues } from "@/lib/reports/invoice-values";

const payload = () => ({
  rows: ["doctor", "center", "day", "month", "category", "treatment"].map((dimension) => ({ dimension, key: dimension, label: "Unspecified", invoices: 2, value: 1000 })),
  subtotal: 1000, discounts: 100, tax: 90, net: 990, invoices: 2,
});
describe("invoice-based treatment values", () => {
  it("counts invoice totals without any clinical treatment mapping", () => {
    expect(validateInvoiceValues(payload()).subtotal).toBe(1000);
  });
  it("rejects invoice-level double counting", () => {
    const data = payload(); data.rows[0].value = 2000;
    expect(() => validateInvoiceValues(data)).toThrow("breakdown");
  });
  it("rejects inconsistent discounts, tax or net value", () => {
    const data = payload(); data.net = 1000;
    expect(() => validateInvoiceValues(data)).toThrow("totals");
  });
  it("accepts an empty report", () => {
    expect(validateInvoiceValues({ rows: [], subtotal: 0, discounts: 0, tax: 0, net: 0, invoices: 0 }).rows).toEqual([]);
  });
});
