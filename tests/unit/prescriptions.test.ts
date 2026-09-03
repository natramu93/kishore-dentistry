import { describe, expect, it } from "vitest";
import {
  createPrescriptionItemDraft,
  MAX_PRESCRIPTION_ITEMS,
  normalizePrescriptionItemsDraft,
  prescriptionItemDraftSchema,
  prescriptionItemsDraftSchema,
} from "@/lib/prescriptions";

describe("prescription draft contract", () => {
  it("creates a blank, stable client-side line item", () => {
    expect(createPrescriptionItemDraft("medicine-1")).toEqual({
      client_id: "medicine-1",
      medicine_name: "",
      strength: "",
      dosage: "",
      morning: false,
      noon: false,
      night: false,
      food_timing: "not_applicable",
      duration_days: null,
      instructions: "",
    });
  });

  it("requires a medicine name and at least one time of day", () => {
    const result = prescriptionItemDraftSchema.safeParse(
      createPrescriptionItemDraft("medicine-1"),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ["medicine_name"] }),
        expect.objectContaining({
          path: ["morning"],
          message: "Select at least one time of day",
        }),
      ]));
    }
  });

  it("accepts and normalizes a complete prescription line", () => {
    const item = {
      ...createPrescriptionItemDraft(" medicine-1 "),
      medicine_name: "  Amoxicillin  ",
      strength: " 500 mg ",
      dosage: " 1 tablet ",
      morning: true,
      food_timing: "after_food" as const,
      duration_days: 5,
      instructions: " Complete the course. ",
    };

    expect(prescriptionItemDraftSchema.safeParse(item).success).toBe(true);
    expect(normalizePrescriptionItemsDraft([item])).toEqual([{
      ...item,
      client_id: "medicine-1",
      medicine_name: "Amoxicillin",
      strength: "500 mg",
      dosage: "1 tablet",
      instructions: "Complete the course.",
    }]);
  });

  it("limits each visit to the supported number of medicines", () => {
    const item = {
      ...createPrescriptionItemDraft("medicine"),
      medicine_name: "Medicine",
      morning: true,
    };
    const tooMany = Array.from({ length: MAX_PRESCRIPTION_ITEMS + 1 }, (_, index) => ({
      ...item,
      client_id: `medicine-${index}`,
    }));

    expect(prescriptionItemsDraftSchema.safeParse(tooMany).success).toBe(false);
  });
});
