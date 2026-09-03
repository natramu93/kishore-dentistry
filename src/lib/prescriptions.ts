import { z } from "zod";

export const MAX_PRESCRIPTION_ITEMS = 30;

export const PRESCRIPTION_FOOD_TIMINGS = [
  { value: "not_applicable", label: "Not specified" },
  { value: "before_food", label: "Before food" },
  { value: "after_food", label: "After food" },
  { value: "with_food", label: "With food" },
] as const;

export const PRESCRIPTION_FOOD_TIMING_VALUES = PRESCRIPTION_FOOD_TIMINGS.map(
  ({ value }) => value,
) as [PrescriptionFoodTiming, ...PrescriptionFoodTiming[]];

export type PrescriptionFoodTiming =
  (typeof PRESCRIPTION_FOOD_TIMINGS)[number]["value"];

export type PrescriptionItemDraft = {
  client_id: string;
  medicine_name: string;
  strength: string;
  dosage: string;
  morning: boolean;
  noon: boolean;
  night: boolean;
  food_timing: PrescriptionFoodTiming;
  duration_days: number | null;
  instructions: string;
};

export const prescriptionFoodTimingSchema = z.enum(
  PRESCRIPTION_FOOD_TIMING_VALUES,
);

export const prescriptionItemDraftSchema = z
  .object({
    client_id: z.string().trim().min(1).max(200),
    medicine_name: z
      .string()
      .trim()
      .min(1, "Enter the medicine name")
      .max(200, "Medicine name is too long"),
    strength: z.string().trim().max(100, "Strength is too long"),
    dosage: z.string().trim().max(100, "Dosage is too long"),
    morning: z.boolean(),
    noon: z.boolean(),
    night: z.boolean(),
    food_timing: prescriptionFoodTimingSchema,
    duration_days: z
      .number()
      .int("Duration must be a whole number of days")
      .min(1, "Duration must be at least 1 day")
      .max(3_650, "Duration cannot exceed 3,650 days")
      .nullable(),
    instructions: z.string().trim().max(1_000, "Instructions are too long"),
  })
  .refine((item) => item.morning || item.noon || item.night, {
    path: ["morning"],
    message: "Select at least one time of day",
  });

export const prescriptionItemsDraftSchema = z
  .array(prescriptionItemDraftSchema)
  .max(MAX_PRESCRIPTION_ITEMS, `Add no more than ${MAX_PRESCRIPTION_ITEMS} medicines`);

export function createPrescriptionItemDraft(clientId: string): PrescriptionItemDraft {
  return {
    client_id: clientId,
    medicine_name: "",
    strength: "",
    dosage: "",
    morning: false,
    noon: false,
    night: false,
    food_timing: "not_applicable",
    duration_days: null,
    instructions: "",
  };
}

export function normalizePrescriptionItemDraft(
  item: PrescriptionItemDraft,
): PrescriptionItemDraft {
  return {
    ...item,
    client_id: item.client_id.trim(),
    medicine_name: item.medicine_name.trim(),
    strength: item.strength.trim(),
    dosage: item.dosage.trim(),
    instructions: item.instructions.trim(),
  };
}

export function normalizePrescriptionItemsDraft(
  items: PrescriptionItemDraft[],
): PrescriptionItemDraft[] {
  return items.map(normalizePrescriptionItemDraft);
}
