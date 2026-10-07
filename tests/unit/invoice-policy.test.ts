import { describe, expect, it } from "vitest";
import { invoiceDateFilter, invoiceEditWindowOpen, invoiceStatusLabel, INVOICE_EDIT_WINDOW_MS } from "@/lib/invoice-policy";

describe("invoice editing window", () => {
  const created = "2026-10-07T00:00:00Z";
  const start = Date.parse(created);
  it("allows edits until, but not at, the 24-hour deadline", () => {
    expect(invoiceEditWindowOpen(created, start)).toBe(true);
    expect(invoiceEditWindowOpen(created, start + INVOICE_EDIT_WINDOW_MS - 1)).toBe(true);
    expect(invoiceEditWindowOpen(created, start + INVOICE_EDIT_WINDOW_MS)).toBe(false);
    expect(invoiceEditWindowOpen(created, start + INVOICE_EDIT_WINDOW_MS + 1)).toBe(false);
  });
  it("does not allow invalid or future creation timestamps", () => {
    expect(invoiceEditWindowOpen("invalid", start)).toBe(false);
    expect(invoiceEditWindowOpen(created, start - 1)).toBe(false);
  });
});

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
