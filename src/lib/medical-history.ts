import { z } from "zod";

export const MEDICAL_HISTORY_CONDITIONS = [
  {
    value: "diabetes",
    label: "Diabetes",
  },
  {
    value: "hypertension",
    label: "Blood pressure / hypertension",
  },
  {
    value: "thyroid_disorder",
    label: "Thyroid disorder",
  },
  {
    value: "pregnancy",
    label: "Pregnancy",
  },
  {
    value: "kidney_disease",
    label: "Kidney disease",
  },
  {
    value: "liver_disease",
    label: "Liver disease",
  },
  {
    value: "heart_condition",
    label: "Heart condition",
  },
  {
    value: "asthma",
    label: "Asthma",
  },
  {
    value: "bleeding_disorder",
    label: "Bleeding disorder",
  },
  {
    value: "allergies",
    label: "Allergies",
  },
  {
    value: "other",
    label: "Other condition",
  },
] as const;

export const MEDICAL_HISTORY_CONDITION_VALUES = MEDICAL_HISTORY_CONDITIONS.map(
  ({ value }) => value,
) as [MedicalHistoryCondition, ...MedicalHistoryCondition[]];

export const MEDICAL_HISTORY_REVIEW_STATUSES = [
  "not_reviewed",
  "reviewed_none",
  "reviewed_conditions",
] as const;

export type MedicalHistoryCondition =
  (typeof MEDICAL_HISTORY_CONDITIONS)[number]["value"];

export type MedicalHistoryReviewStatus =
  (typeof MEDICAL_HISTORY_REVIEW_STATUSES)[number];

export type MedicalHistoryDraft = {
  reviewStatus: MedicalHistoryReviewStatus;
  reviewedToday: boolean;
  conditions: MedicalHistoryCondition[];
  description: string;
};

export const EMPTY_MEDICAL_HISTORY_DRAFT: Readonly<MedicalHistoryDraft> = {
  reviewStatus: "not_reviewed",
  reviewedToday: false,
  conditions: [],
  description: "",
};

export const medicalHistoryConditionSchema = z.enum(
  MEDICAL_HISTORY_CONDITION_VALUES,
);

export const medicalHistoryReviewStatusSchema = z.enum(
  MEDICAL_HISTORY_REVIEW_STATUSES,
);

export const medicalHistoryDraftSchema = z
  .object({
    reviewStatus: medicalHistoryReviewStatusSchema,
    reviewedToday: z.boolean(),
    conditions: z
      .array(medicalHistoryConditionSchema)
      .max(MEDICAL_HISTORY_CONDITIONS.length, "Too many medical-history conditions"),
    description: z
      .string()
      .trim()
      .max(4_000, "Medical-history description is too long"),
  })
  .superRefine((draft, context) => {
    if (new Set(draft.conditions).size !== draft.conditions.length) {
      context.addIssue({
        code: "custom",
        path: ["conditions"],
        message: "Each medical-history condition can be selected only once",
      });
    }

    if (draft.reviewStatus === "reviewed_conditions" && draft.conditions.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["conditions"],
        message: "Select at least one condition",
      });
    }

    if (draft.reviewStatus !== "reviewed_conditions" && draft.conditions.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["conditions"],
        message: "Selected conditions must be marked as reviewed",
      });
    }

    if (draft.conditions.includes("other") && draft.description.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["description"],
        message: "Describe the other medical condition",
      });
    }
  });

export function createMedicalHistoryDraft(
  initial?: Partial<MedicalHistoryDraft>,
): MedicalHistoryDraft {
  const conditions = initial?.conditions ? [...new Set(initial.conditions)] : [];
  const reviewStatus = conditions.length > 0
    ? "reviewed_conditions"
    : initial?.reviewStatus === "reviewed_none"
      ? "reviewed_none"
      : "not_reviewed";

  return {
    reviewStatus,
    reviewedToday: initial?.reviewedToday ?? false,
    conditions,
    description: initial?.description ?? "",
  };
}

export function normalizeMedicalHistoryDraft(
  draft: MedicalHistoryDraft,
): MedicalHistoryDraft {
  const conditions = [...new Set(draft.conditions)];
  const reviewStatus: MedicalHistoryReviewStatus = conditions.length > 0
    ? "reviewed_conditions"
    : draft.reviewStatus === "reviewed_none"
      ? "reviewed_none"
      : "not_reviewed";

  return {
    reviewStatus,
    reviewedToday: draft.reviewedToday,
    conditions,
    description: draft.description.trim(),
  };
}
