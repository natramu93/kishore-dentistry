import { describe, expect, it } from "vitest";
import {
  caseSheetTreatmentSchema,
  FDI_PERMANENT_TEETH,
  FDI_PRIMARY_TEETH,
  isFdiToothNumber,
  isPermanentFdiTooth,
  isPrimaryFdiTooth,
  treatmentSiteSchema,
  validateTreatmentSite,
} from "@/lib/clinical";

describe("FDI dental notation", () => {
  it("contains each valid permanent and primary tooth exactly once", () => {
    expect(FDI_PERMANENT_TEETH).toHaveLength(32);
    expect(FDI_PRIMARY_TEETH).toHaveLength(20);
    expect(new Set([...FDI_PERMANENT_TEETH, ...FDI_PRIMARY_TEETH]).size).toBe(52);
    expect([...FDI_PERMANENT_TEETH, ...FDI_PRIMARY_TEETH].every(isFdiToothNumber)).toBe(true);
  });

  it("distinguishes permanent and primary tooth numbers", () => {
    expect(isPermanentFdiTooth("11")).toBe(true);
    expect(isPermanentFdiTooth("48")).toBe(true);
    expect(isPrimaryFdiTooth("51")).toBe(true);
    expect(isPrimaryFdiTooth("85")).toBe(true);
    expect(isPrimaryFdiTooth("11")).toBe(false);
  });

  it.each(["", "0", "19", "49", "50", "56", "68", "75 ", 11, null])(
    "rejects invalid tooth number %j",
    (value) => expect(isFdiToothNumber(value)).toBe(false),
  );
});

describe("dental treatment site validation", () => {
  it("requires an FDI tooth for a tooth-level treatment", () => {
    const invalid = treatmentSiteSchema.safeParse({
      site_scope: "tooth",
      site_detail: null,
      tooth_number: null,
      surfaces: [],
    });
    expect(invalid.success).toBe(false);

    const valid = treatmentSiteSchema.safeParse({
      site_scope: "tooth",
      site_detail: null,
      tooth_number: "26",
      surfaces: ["mesial", "occlusal"],
    });
    expect(valid.success).toBe(true);
  });

  it("requires a known site for arch and quadrant scopes", () => {
    expect(validateTreatmentSite({
      site_scope: "arch",
      site_detail: "upper",
      tooth_number: null,
      surfaces: [],
    }).valid).toBe(true);
    expect(validateTreatmentSite({
      site_scope: "quadrant",
      site_detail: "north_east",
      tooth_number: null,
      surfaces: [],
    }).valid).toBe(false);
  });

  it("does not allow tooth surfaces on non-tooth scopes", () => {
    const result = validateTreatmentSite({
      site_scope: "full_mouth",
      site_detail: null,
      tooth_number: null,
      surfaces: ["buccal"],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Surfaces can only be recorded for a tooth");
  });

  it("rejects invalid or duplicate surfaces", () => {
    expect(validateTreatmentSite({
      site_scope: "tooth",
      site_detail: null,
      tooth_number: "14",
      surfaces: ["mesial", "mesial"],
    }).valid).toBe(false);
    expect(validateTreatmentSite({
      site_scope: "tooth",
      site_detail: null,
      tooth_number: "14",
      surfaces: ["unknown"],
    }).valid).toBe(false);
  });

  it("requires an approved treatment-code format", () => {
    const baseTreatment = {
      status: "completed" as const,
      site_scope: "tooth" as const,
      site_detail: null,
      tooth_number: "36",
      surfaces: ["occlusal" as const],
      quantity: 1,
      unit_price: 2_500,
      notes: "",
    };
    expect(caseSheetTreatmentSchema.safeParse({
      ...baseTreatment,
      treatment_code: "TMT_123",
    }).success).toBe(true);
    expect(caseSheetTreatmentSchema.safeParse({
      ...baseTreatment,
      treatment_code: "Root canal",
    }).success).toBe(false);
  });
});
