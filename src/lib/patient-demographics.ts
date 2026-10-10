export const PATIENT_TITLES = ["Mr", "Ms", "Mrs", "Baby", "Master"] as const;
export type PatientTitle = (typeof PATIENT_TITLES)[number];
export const PATIENT_GENDERS = ["male", "female", "other"] as const;
export type PatientGender = (typeof PATIENT_GENDERS)[number];

export function genderForTitle(title: string | null | undefined): PatientGender | null {
  if (title === "Mr" || title === "Master") return "male";
  if (title === "Ms" || title === "Mrs") return "female";
  return null;
}

/** Capitalize whitespace-separated names without changing punctuation inside a word. */
export function patientNameTitleCase(name: string): string {
  return name.trim().split(/\s+/u).filter(Boolean).map((word) => {
    const [first, ...rest] = Array.from(word.toLowerCase());
    return first.toUpperCase() + rest.join("");
  }).join(" ");
}

export function patientDisplayName(patient: { name: string; title?: string | null }): string {
  return [patient.title, patientNameTitleCase(patient.name)].filter(Boolean).join(" ");
}
