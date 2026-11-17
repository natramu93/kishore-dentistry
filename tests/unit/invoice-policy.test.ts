import { describe, expect, it } from "vitest";
import { invoiceDateFilter, invoicePaymentTotals, invoiceStatusLabel } from "@/lib/invoice-policy";

describe("invoice date filters", () => {
  it("defaults to the current clinic date and retains today with other filters", () => {
    expect(invoiceDateFilter({}, "2026-10-07")).toEqual({ mode: "today", from: "2026-10-07", to: "2026-10-07" });
    expect(invoiceDateFilter({ status: "paid", dates: "today", from: "2026-01-01" }, "2026-10-07").mode).toBe("today");
  });
  it("allows all dates and inclusive single-day, open-ended or range filters", () => {
    expect(invoiceDateFilter({ dates: "all", from: "invalid" })).toEqual({ mode: "all", from: undefined, to: undefined });
    expect(invoiceDateFilter({ dates: "range", from: "2026-10-01", to: "2026-10-07" })).toEqual({ mode: "range", from: "2026-10-01", to: "2026-10-07" });
    expect(invoiceDateFilter({ from: "2026-10-07", to: "2026-10-07" }).error).toBeUndefined();
    expect(invoiceDateFilter({ dates: "range", from: "2026-10-07" }).to).toBeUndefined();
  });
  it("rejects reversed, empty and invalid ranges", () => {
    expect(invoiceDateFilter({ dates: "range" }).error).toBeTruthy();
    expect(invoiceDateFilter({ from: "2026-10-07", to: "2026-10-06" }).error).toBeTruthy();
    expect(invoiceDateFilter({ from: "2026-02-30" }).error).toBeTruthy();
  });
  it("labels cancelled invoices as voided without changing stored status", () => {
    expect(invoiceStatusLabel("cancelled")).toBe("Voided");
    expect(invoiceStatusLabel("paid")).toBe("paid");
  });
});

describe("invoice payment totals", () => {
  it("excludes original payments and balance on both voided and archived invoices", () => {
    const receipts = [{ amount: 30 }, { amount: 70 }];
    expect(invoicePaymentTotals({ status: "cancelled", total: 100, deleted_at: null }, receipts))
      .toEqual({ amount_paid: 0, balance_due: 0 });
    expect(invoicePaymentTotals({ status: "paid", total: 100, deleted_at: "2026-11-17T00:00:00Z" }, receipts))
      .toEqual({ amount_paid: 0, balance_due: 0 });
  });
  it("keeps legacy settled invoices and normal split payments in active totals", () => {
    expect(invoicePaymentTotals({ status: "paid", total: 100, deleted_at: null }, []))
      .toEqual({ amount_paid: 100, balance_due: 0 });
    expect(invoicePaymentTotals({ status: "sent", total: 100, deleted_at: null }, [{ amount: 30 }, { amount: 50 }]))
      .toEqual({ amount_paid: 80, balance_due: 20 });
  });
});
