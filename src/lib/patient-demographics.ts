export const PATIENT_TITLES = ["Mr", "Ms", "Mrs", "Baby", "Master"] as const;
export type PatientTitle = (typeof PATIENT_TITLES)[number];
export const PATIENT_GENDERS = ["male", "female", "other"] as const;
export type PatientGender = (typeof PATIENT_GENDERS)[number];

export function patientTitleLabel(title: string | null | undefined): string {
  const value = title?.trim() ?? "";
  const labels: Record<string, string> = { mr: "Mr.", ms: "Ms.", mrs: "Mrs.", baby: "Baby", master: "Master" };
  return labels[value.replace(/\.$/, "").toLowerCase()] ?? value;
}

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
  const name = patient.name.trim();
  // Legacy intake sometimes included the title in the name itself. Prefer a
  // separately saved title and display only one prefix; never rewrite the name.
  const embedded = /^(Mr|Mrs|Ms|Baby|Master)(?:\.\s*|\s+|$)/i.exec(name);
  const title = patientTitleLabel(patient.title) || patientTitleLabel(embedded?.[1]);
  const plainName = embedded ? name.slice(embedded[0].length) : name;
  return [title, patientNameTitleCase(plainName)].filter(Boolean).join(" ");
}
