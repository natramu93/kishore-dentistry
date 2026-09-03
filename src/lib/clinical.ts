import { z } from "zod";
import { medicalHistoryDraftSchema } from "@/lib/medical-history";
import { prescriptionItemsDraftSchema } from "@/lib/prescriptions";

export const INDIAN_PERMANENT_TEETH = [
  "18", "17", "16", "15", "14", "13", "12", "11",
  "21", "22", "23", "24", "25", "26", "27", "28",
  "48", "47", "46", "45", "44", "43", "42", "41",
  "31", "32", "33", "34", "35", "36", "37", "38",
] as const;

export const INDIAN_PRIMARY_TEETH = [
  "55", "54", "53", "52", "51",
  "61", "62", "63", "64", "65",
  "85", "84", "83", "82", "81",
  "71", "72", "73", "74", "75",
] as const;

export const INDIAN_STANDARD_TEETH = [
  ...INDIAN_PERMANENT_TEETH,
  ...INDIAN_PRIMARY_TEETH,
] as const;

export const TREATMENT_SITE_SCOPES = [
  "not_applicable",
  "full_mouth",
  "arch",
  "quadrant",
  "tooth",
] as const;

export const DENTAL_SURFACES = [
  "mesial",
  "distal",
  "occlusal",
  "incisal",
  "buccal",
  "lingual",
  "palatal",
  "facial",
] as const;

export const TOOTH_STATES = [
  "sound",
  "present",
  "missing",
  "unerupted",
  "impacted",
  "retained_root",
  "implant",
] as const;

export const TOOTH_CONDITIONS = [
  "caries",
  "existing_restoration",
  "crown",
  "bridge_abutment",
  "root_canal_treated",
  "fracture",
  "mobility",
  "periodontal_involvement",
  "recession",
  "wear_erosion",
  "periapical_pathology",
  "discoloration",
  "sensitivity",
  "other",
] as const;

export const TOOTH_PROGNOSES = ["good", "fair", "guarded", "poor", "hopeless"] as const;

export const TOOTH_RECOMMENDED_ACTIONS = [
  "monitor",
  "investigate",
  "preventive",
  "restorative",
  "endodontic",
  "periodontal",
  "surgical",
  "prosthetic",
  "orthodontic",
  "referral",
  "other",
] as const;

export const ARCH_SITES = ["upper", "lower"] as const;

export const QUADRANT_SITES = [
  "upper_right",
  "upper_left",
  "lower_left",
  "lower_right",
] as const;

export type IndianToothNumber = (typeof INDIAN_STANDARD_TEETH)[number];
export type TreatmentSiteScope = (typeof TREATMENT_SITE_SCOPES)[number];
export type DentalSurface = (typeof DENTAL_SURFACES)[number];
export type ToothState = (typeof TOOTH_STATES)[number];
export type ToothCondition = (typeof TOOTH_CONDITIONS)[number];
export type ToothPrognosis = (typeof TOOTH_PROGNOSES)[number];
export type ToothRecommendedAction = (typeof TOOTH_RECOMMENDED_ACTIONS)[number];

const indianToothSet = new Set<string>(INDIAN_STANDARD_TEETH);
const permanentToothSet = new Set<string>(INDIAN_PERMANENT_TEETH);
const primaryToothSet = new Set<string>(INDIAN_PRIMARY_TEETH);
const surfaceSet = new Set<string>(DENTAL_SURFACES);
const archSiteSet = new Set<string>(ARCH_SITES);
const quadrantSiteSet = new Set<string>(QUADRANT_SITES);

export function isIndianToothNumber(value: unknown): value is IndianToothNumber {
  return typeof value === "string" && indianToothSet.has(value);
}

export function isPermanentIndianTooth(value: unknown): value is (typeof INDIAN_PERMANENT_TEETH)[number] {
  return typeof value === "string" && permanentToothSet.has(value);
}

export function isPrimaryIndianTooth(value: unknown): value is (typeof INDIAN_PRIMARY_TEETH)[number] {
  return typeof value === "string" && primaryToothSet.has(value);
}

const PERMANENT_TOOTH_NAMES = [
  "central incisor",
  "lateral incisor",
  "canine",
  "first premolar",
  "second premolar",
  "first molar",
  "second molar",
  "third molar",
] as const;

const PRIMARY_TOOTH_NAMES = [
  "central incisor",
  "lateral incisor",
  "canine",
  "first molar",
  "second molar",
] as const;

export function describeIndianTooth(tooth: string): string {
  if (!isIndianToothNumber(tooth)) return "Unknown tooth";
  const quadrant = tooth[0];
  const position = Number(tooth[1]) - 1;
  const area = quadrant === "1" || quadrant === "5"
    ? "Upper right"
    : quadrant === "2" || quadrant === "6"
      ? "Upper left"
      : quadrant === "3" || quadrant === "7"
        ? "Lower left"
        : "Lower right";
  const names = isPrimaryIndianTooth(tooth) ? PRIMARY_TOOTH_NAMES : PERMANENT_TOOTH_NAMES;
  return `${area} ${names[position]}`;
}

export const indianToothNumberSchema = z.string().refine(isIndianToothNumber, {
  message: "Select a valid Indian Standard tooth number",
});

export type TreatmentSiteInput = {
  site_scope: TreatmentSiteScope;
  site_detail: string | null;
  tooth_number: string | null;
  surfaces: string[];
};

export function formatClinicalSite(site: {
  site_scope: string | null;
  site_detail: string | null;
  tooth_number: string | null;
  surfaces: string[] | null;
}): string {
  if (site.site_scope === "tooth") {
    const surfaces = site.surfaces?.length
      ? ` · surfaces ${site.surfaces.join(", ")}`
      : "";
    return `Tooth ${site.tooth_number ?? "not recorded"} (IS 8815)${surfaces}`;
  }
  if (site.site_scope === "full_mouth") return "Full mouth";
  if (site.site_scope === "arch") {
    return `${(site.site_detail ?? "").replaceAll("_", " ")} arch`.trim();
  }
  if (site.site_scope === "quadrant") {
    return `${(site.site_detail ?? "").replaceAll("_", " ")} quadrant`.trim();
  }
  return "General / not tooth-specific";
}

export function validateTreatmentSite(site: TreatmentSiteInput): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const hasTooth = site.tooth_number !== null && site.tooth_number !== "";
  const hasDetail = site.site_detail !== null && site.site_detail !== "";

  if (site.surfaces.some((surface) => !surfaceSet.has(surface))) {
    errors.push("One or more tooth surfaces are invalid");
  }
  if (new Set(site.surfaces).size !== site.surfaces.length) {
    errors.push("A tooth surface cannot be selected more than once");
  }

  switch (site.site_scope) {
    case "tooth":
      if (!hasTooth || !isIndianToothNumber(site.tooth_number)) {
        errors.push("Select a valid Indian Standard tooth number for a tooth-level treatment");
      }
      if (hasDetail) errors.push("Tooth-level treatments cannot have an arch or quadrant");
      break;
    case "arch":
      if (!hasDetail || !archSiteSet.has(site.site_detail ?? "")) {
        errors.push("Select the upper or lower arch");
      }
      if (hasTooth) errors.push("Arch-level treatments cannot also select a tooth");
      if (site.surfaces.length > 0) errors.push("Surfaces can only be recorded for a tooth");
      break;
    case "quadrant":
      if (!hasDetail || !quadrantSiteSet.has(site.site_detail ?? "")) {
        errors.push("Select a valid dental quadrant");
      }
      if (hasTooth) errors.push("Quadrant-level treatments cannot also select a tooth");
      if (site.surfaces.length > 0) errors.push("Surfaces can only be recorded for a tooth");
      break;
    case "full_mouth":
    case "not_applicable":
      if (hasDetail) errors.push("This treatment scope cannot have an arch or quadrant");
      if (hasTooth) errors.push("This treatment scope cannot have a tooth number");
      if (site.surfaces.length > 0) errors.push("Surfaces can only be recorded for a tooth");
      break;
  }

  return { valid: errors.length === 0, errors };
}

export const treatmentSiteSchema = z.object({
  site_scope: z.enum(TREATMENT_SITE_SCOPES),
  site_detail: z.string().trim().max(40).nullable(),
  tooth_number: z.string().nullable(),
  surfaces: z.array(z.enum(DENTAL_SURFACES)).max(DENTAL_SURFACES.length),
}).superRefine((site, context) => {
  const result = validateTreatmentSite(site);
  for (const message of result.errors) {
    const path = message.toLowerCase().includes("surface")
      ? ["surfaces"]
      : message.toLowerCase().includes("tooth")
        ? ["tooth_number"]
        : ["site_detail"];
    context.addIssue({ code: "custom", path, message });
  }
});

export const caseSheetTreatmentSchema = z.object({
  treatment_code: z.string().trim().regex(/^TMT_\d+$/, "Select a valid treatment code"),
  status: z.enum(["planned", "completed"]),
  site_scope: z.enum(TREATMENT_SITE_SCOPES),
  site_detail: z.string().trim().max(40).nullable(),
  tooth_number: z.string().nullable(),
  surfaces: z.array(z.enum(DENTAL_SURFACES)).max(DENTAL_SURFACES.length),
  quantity: z.number().finite().positive("Quantity must be greater than zero").max(999),
  unit_price: z.number().finite().min(0, "Price cannot be negative").max(99_999_999.99),
  notes: z.string().trim().max(2_000),
}).superRefine((treatment, context) => {
  const result = validateTreatmentSite(treatment);
  for (const message of result.errors) {
    const path = message.toLowerCase().includes("surface")
      ? ["surfaces"]
      : message.toLowerCase().includes("tooth")
        ? ["tooth_number"]
        : ["site_detail"];
    context.addIssue({ code: "custom", path, message });
  }
});

export const toothAssessmentSchema = z.object({
  tooth_number: indianToothNumberSchema,
  tooth_state: z.enum(TOOTH_STATES),
  conditions: z.array(z.enum(TOOTH_CONDITIONS)).max(TOOTH_CONDITIONS.length),
  surfaces: z.array(z.enum(DENTAL_SURFACES)).max(DENTAL_SURFACES.length),
  clinical_findings: z.string().trim().max(2_000),
  diagnosis: z.string().trim().max(1_000),
  prognosis: z.enum(TOOTH_PROGNOSES).nullable(),
  recommended_action: z.enum(TOOTH_RECOMMENDED_ACTIONS).nullable(),
  future_plan: z.string().trim().max(2_000),
  notes: z.string().trim().max(2_000),
}).superRefine((assessment, context) => {
  if (new Set(assessment.conditions).size !== assessment.conditions.length) {
    context.addIssue({ code: "custom", path: ["conditions"], message: "A tooth finding cannot be selected more than once" });
  }
  if (new Set(assessment.surfaces).size !== assessment.surfaces.length) {
    context.addIssue({ code: "custom", path: ["surfaces"], message: "A tooth surface cannot be selected more than once" });
  }
  if (["missing", "unerupted", "impacted", "retained_root", "implant"].includes(assessment.tooth_state) && assessment.surfaces.length > 0) {
    context.addIssue({ code: "custom", path: ["surfaces"], message: "Surfaces cannot be recorded for this tooth state" });
  }
  if (assessment.tooth_state === "sound" && assessment.conditions.length > 0) {
    context.addIssue({ code: "custom", path: ["conditions"], message: "A sound tooth cannot also have a clinical condition" });
  }
});

const localDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

export const caseSheetPayloadSchema = z.object({
  lead_id: z.string().uuid("Patient reference is invalid"),
  appointment_id: z.string().uuid("Appointment reference is invalid").nullable(),
  doctor_id: z.string().uuid("Select a doctor"),
  visit_at: z.string().regex(localDateTimePattern, "Enter a valid visit date and time"),
  chief_complaint: z.string().trim().min(1, "Chief complaint is required").max(2_000),
  findings: z.string().trim().max(5_000),
  diagnosis: z.string().trim().min(1, "Diagnosis is required").max(2_000),
  plan: z.string().trim().max(5_000),
  medical_history: medicalHistoryDraftSchema,
  prescriptions: prescriptionItemsDraftSchema,
  tooth_assessments: z.array(toothAssessmentSchema).max(52),
  treatments: z.array(caseSheetTreatmentSchema).max(50),
}).superRefine((payload, context) => {
  if (payload.medical_history.reviewStatus === "not_reviewed") {
    context.addIssue({
      code: "custom",
      path: ["medical_history", "reviewStatus"],
      message: "Review the patient’s medical history before finalizing the case sheet",
    });
  }
  if (!payload.medical_history.reviewedToday) {
    context.addIssue({
      code: "custom",
      path: ["medical_history", "reviewedToday"],
      message: "Confirm that the medical history was reviewed with the patient today",
    });
  }
  const seen = new Set<string>();
  payload.tooth_assessments.forEach((assessment, index) => {
    if (seen.has(assessment.tooth_number)) {
      context.addIssue({
        code: "custom",
        path: ["tooth_assessments", index, "tooth_number"],
        message: `Tooth ${assessment.tooth_number} can only be recorded once per case sheet`,
      });
    }
    seen.add(assessment.tooth_number);
  });
});

export type CaseSheetTreatmentInput = z.infer<typeof caseSheetTreatmentSchema>;
export type ToothAssessmentInput = z.infer<typeof toothAssessmentSchema>;
export type CaseSheetPayload = z.infer<typeof caseSheetPayloadSchema>;
