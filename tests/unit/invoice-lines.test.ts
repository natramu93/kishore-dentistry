import { describe, expect, it } from "vitest";
import { consultationInvoicePreset, invoiceDisplayTotals, invoiceLineDetailsSchema, invoiceLineToothLabel } from "@/lib/invoice-lines";

describe("invoice tooth details", () => {
  it("rounds each line before adding tax and discount, matching database totals", () => {
    expect(invoiceDisplayTotals(Array.from({ length: 3 }, () => ({ quantity: 0.5, unit_price: 0.01 })), 0, 0).total).toBe(0.03);
  });
  it("accepts general services, permanent and primary multi-tooth lines", () => {
    expect(invoiceLineDetailsSchema.safeParse({}).success).toBe(true);
    expect(invoiceLineDetailsSchema.safeParse({ tooth_numbers: ["11", "12", "55"], line_note: " Review " }).data)
      .toEqual({ tooth_numbers: ["11", "12", "55"], line_note: "Review" });
  });
  it.each([["11", "11"], ["99"], [11]])("rejects invalid or repeated tooth numbers %j", (...teeth) => {
    expect(invoiceLineDetailsSchema.safeParse({ tooth_numbers: teeth }).success).toBe(false);
  });
  it("rejects oversized notes", () => {
    expect(invoiceLineDetailsSchema.safeParse({ line_note: "x".repeat(1001) }).success).toBe(false);
  });
  it("formats multi-tooth and historic single-tooth invoice snapshots", () => {
    expect(invoiceLineToothLabel({ tooth_numbers: ["11", "12"] })).toBe("Teeth (IS 8815): 11, 12");
    expect(invoiceLineToothLabel({ tooth_number: "55" })).toBe("Teeth (IS 8815): 55");
    expect(invoiceLineToothLabel({})).toBeNull();
  });
});

describe("consultation invoice shortcut", () => {
  const item = { id: "center-consultation", name: "Consultation", default_cost: 350, is_general_consultation: true };
  it("uses the center's configured rate and creates an independent editable catalog line", () => {
    expect(consultationInvoicePreset([item])).toEqual({
      treatment_type_id: item.id, description: "Consultation", site_label: "General / not tooth-specific",
      quantity: 1, unit_price: 350, tooth_numbers: [], line_note: "",
    });
  });
  it("defaults only an unconfigured price, not an explicitly configured zero", () => {
    expect(consultationInvoicePreset([{ ...item, default_cost: null }])?.unit_price).toBe(200);
    expect(consultationInvoicePreset([{ ...item, default_cost: 0 }])?.unit_price).toBe(0);
  });
  it("does not invent a catalog item when consultation is not configured", () => {
    expect(consultationInvoicePreset([{ ...item, is_general_consultation: false }])).toBeNull();
    expect(consultationInvoicePreset([])).toBeNull();
  });
});
