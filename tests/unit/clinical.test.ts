import { describe, expect, it } from "vitest";
import {
  caseSheetTreatmentSchema,
  caseSheetPayloadSchema,
  describeIndianTooth,
  INDIAN_PERMANENT_TEETH,
  INDIAN_PRIMARY_TEETH,
  isIndianToothNumber,
  isPermanentIndianTooth,
  isPrimaryIndianTooth,
  treatmentSiteSchema,
  toothAssessmentSchema,
  validateTreatmentSite,
} from "@/lib/clinical";

describe("Indian Standard IS 8815 dental notation", () => {
  it("contains each valid permanent and primary tooth exactly once", () => {
    expect(INDIAN_PERMANENT_TEETH).toHaveLength(32);
    expect(INDIAN_PRIMARY_TEETH).toHaveLength(20);
    expect(new Set([...INDIAN_PERMANENT_TEETH, ...INDIAN_PRIMARY_TEETH]).size).toBe(52);
    expect([...INDIAN_PERMANENT_TEETH, ...INDIAN_PRIMARY_TEETH].every(isIndianToothNumber)).toBe(true);
  });

  it("distinguishes permanent and primary tooth numbers", () => {
    expect(isPermanentIndianTooth("11")).toBe(true);
    expect(isPermanentIndianTooth("48")).toBe(true);
    expect(isPrimaryIndianTooth("51")).toBe(true);
    expect(isPrimaryIndianTooth("85")).toBe(true);
    expect(isPrimaryIndianTooth("11")).toBe(false);
  });

  it("provides the Indian-standard quadrant and anatomical tooth name", () => {
    expect(describeIndianTooth("11")).toBe("Upper right central incisor");
    expect(describeIndianTooth("36")).toBe("Lower left first molar");
    expect(describeIndianTooth("74")).toBe("Lower left first molar");
  });

  it.each(["", "0", "19", "49", "50", "56", "68", "75 ", 11, null])(
    "rejects invalid tooth number %j",
    (value) => expect(isIndianToothNumber(value)).toBe(false),
  );
});

describe("general tooth examination validation", () => {
  const assessment = {
    tooth_number: "16",
    tooth_state: "present" as const,
    conditions: ["caries" as const],
    surfaces: ["occlusal" as const],
    clinical_findings: "Occlusal cavitation",
    diagnosis: "Dentinal caries",
    prognosis: "good" as const,
    recommended_action: "restorative" as const,
    future_plan: "Review for restoration",
    notes: "",
  };

  it("accepts a structured tooth assessment independent of treatment", () => {
    expect(toothAssessmentSchema.safeParse(assessment).success).toBe(true);
    expect(caseSheetPayloadSchema.safeParse({
      lead_id: "00000000-0000-4000-8000-000000000001",
      appointment_id: "00000000-0000-4000-8000-000000000002",
      doctor_id: "00000000-0000-4000-8000-000000000003",
      visit_at: "2042-01-14T09:05",
      chief_complaint: "Routine examination",
      findings: "",
      diagnosis: "Dental examination",
      plan: "",
      medical_history: {
        reviewStatus: "reviewed_none",
        reviewedToday: true,
        conditions: [],
        description: "",
      },
      prescriptions: [],
      tooth_assessments: [assessment],
      treatments: [],
    }).success).toBe(true);
  });

  it("requires an explicit medical-history review for the current visit", () => {
    const result = caseSheetPayloadSchema.safeParse({
      lead_id: "00000000-0000-4000-8000-000000000001",
      appointment_id: "00000000-0000-4000-8000-000000000002",
      doctor_id: "00000000-0000-4000-8000-000000000003",
      visit_at: "2042-01-14T09:05",
      chief_complaint: "Routine examination",
      findings: "",
      diagnosis: "Dental examination",
      plan: "",
      medical_history: {
        reviewStatus: "reviewed_none",
        reviewedToday: false,
        conditions: [],
        description: "",
      },
      prescriptions: [],
      tooth_assessments: [],
      treatments: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(expect.objectContaining({
        path: ["medical_history", "reviewedToday"],
      }));
    }
  });

  it("rejects incompatible states and duplicate tooth entries", () => {
    expect(toothAssessmentSchema.safeParse({
      ...assessment,
      tooth_state: "missing",
    }).success).toBe(false);
    expect(toothAssessmentSchema.safeParse({
      ...assessment,
      tooth_state: "sound",
    }).success).toBe(false);

    const payload = {
      lead_id: "00000000-0000-4000-8000-000000000001",
      appointment_id: "00000000-0000-4000-8000-000000000002",
      doctor_id: "00000000-0000-4000-8000-000000000003",
      visit_at: "2042-01-14T09:05",
      chief_complaint: "Routine examination",
      findings: "",
      diagnosis: "Dental examination",
      plan: "",
      medical_history: {
        reviewStatus: "reviewed_none" as const,
        reviewedToday: true,
        conditions: [],
        description: "",
      },
      prescriptions: [],
      tooth_assessments: [assessment, assessment],
      treatments: [],
    };
    expect(caseSheetPayloadSchema.safeParse(payload).success).toBe(false);
  });
});

describe("dental treatment site validation", () => {
  it("requires an Indian Standard tooth for a tooth-level treatment", () => {
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
      treatment_code: "K02.9",
    }).success).toBe(true);
    expect(caseSheetTreatmentSchema.safeParse({
      ...baseTreatment,
      treatment_code: "Root canal",
    }).success).toBe(false);
    expect(caseSheetTreatmentSchema.safeParse({
      ...baseTreatment,
      treatment_code: "TMT_123",
    }).success).toBe(false);
  });
});
