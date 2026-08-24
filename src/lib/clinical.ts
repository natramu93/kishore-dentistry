import { z } from "zod";

export const FDI_PERMANENT_TEETH = [
  "18", "17", "16", "15", "14", "13", "12", "11",
  "21", "22", "23", "24", "25", "26", "27", "28",
  "48", "47", "46", "45", "44", "43", "42", "41",
  "31", "32", "33", "34", "35", "36", "37", "38",
] as const;

export const FDI_PRIMARY_TEETH = [
  "55", "54", "53", "52", "51",
  "61", "62", "63", "64", "65",
  "85", "84", "83", "82", "81",
  "71", "72", "73", "74", "75",
] as const;

export const FDI_TEETH = [
  ...FDI_PERMANENT_TEETH,
  ...FDI_PRIMARY_TEETH,
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

export const ARCH_SITES = ["upper", "lower"] as const;

export const QUADRANT_SITES = [
  "upper_right",
  "upper_left",
  "lower_left",
  "lower_right",
] as const;

export type FdiToothNumber = (typeof FDI_TEETH)[number];
export type TreatmentSiteScope = (typeof TREATMENT_SITE_SCOPES)[number];
export type DentalSurface = (typeof DENTAL_SURFACES)[number];

const fdiToothSet = new Set<string>(FDI_TEETH);
const permanentToothSet = new Set<string>(FDI_PERMANENT_TEETH);
const primaryToothSet = new Set<string>(FDI_PRIMARY_TEETH);
const surfaceSet = new Set<string>(DENTAL_SURFACES);
const archSiteSet = new Set<string>(ARCH_SITES);
const quadrantSiteSet = new Set<string>(QUADRANT_SITES);

export function isFdiToothNumber(value: unknown): value is FdiToothNumber {
  return typeof value === "string" && fdiToothSet.has(value);
}

export function isPermanentFdiTooth(value: unknown): value is (typeof FDI_PERMANENT_TEETH)[number] {
  return typeof value === "string" && permanentToothSet.has(value);
}

export function isPrimaryFdiTooth(value: unknown): value is (typeof FDI_PRIMARY_TEETH)[number] {
  return typeof value === "string" && primaryToothSet.has(value);
}

export const fdiToothNumberSchema = z.string().refine(isFdiToothNumber, {
  message: "Select a valid FDI tooth number",
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
    return `FDI tooth ${site.tooth_number ?? "not recorded"}${surfaces}`;
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
      if (!hasTooth || !isFdiToothNumber(site.tooth_number)) {
        errors.push("Select a valid FDI tooth number for a tooth-level treatment");
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
  medical_alerts: z.string().trim().max(2_000),
  treatments: z.array(caseSheetTreatmentSchema).min(1, "Add at least one coded treatment").max(50),
});

export type CaseSheetTreatmentInput = z.infer<typeof caseSheetTreatmentSchema>;
export type CaseSheetPayload = z.infer<typeof caseSheetPayloadSchema>;
