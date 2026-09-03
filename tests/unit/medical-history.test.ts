import { describe, expect, it } from "vitest";
import {
  createMedicalHistoryDraft,
  medicalHistoryDraftSchema,
  normalizeMedicalHistoryDraft,
} from "@/lib/medical-history";

describe("medical-history contract", () => {
  it("normalizes selected conditions to a reviewed condition history", () => {
    expect(normalizeMedicalHistoryDraft({
      reviewStatus: "reviewed_none",
      reviewedToday: true,
      conditions: ["diabetes", "diabetes", "hypertension"],
      description: "  Controlled with regular medicines.  ",
    })).toEqual({
      reviewStatus: "reviewed_conditions",
      reviewedToday: true,
      conditions: ["diabetes", "hypertension"],
      description: "Controlled with regular medicines.",
    });
  });

  it("creates a consistent empty draft from conflicting initial values", () => {
    expect(createMedicalHistoryDraft({ reviewStatus: "reviewed_conditions" }))
      .toEqual({
        reviewStatus: "not_reviewed",
        reviewedToday: false,
        conditions: [],
        description: "",
      });
  });

  it("requires details for an other condition", () => {
    const result = medicalHistoryDraftSchema.safeParse({
      reviewStatus: "reviewed_conditions",
      reviewedToday: true,
      conditions: ["other"],
      description: "   ",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(expect.objectContaining({
        path: ["description"],
        message: "Describe the other medical condition",
      }));
    }
  });

  it("rejects a review status that conflicts with selected conditions", () => {
    const result = medicalHistoryDraftSchema.safeParse({
      reviewStatus: "reviewed_none",
      reviewedToday: true,
      conditions: ["diabetes"],
      description: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(expect.objectContaining({
        path: ["conditions"],
        message: "Selected conditions must be marked as reviewed",
      }));
    }
  });
});
