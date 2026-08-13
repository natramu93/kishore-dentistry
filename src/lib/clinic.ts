const addressLines = [
  "No-541, 543/338-34, 1st floor, Aadhaar Hospital,",
  "Opp to KR Bakes, Puspha Theatre Bus stop,",
  "Tirupur – 641602.",
] as const;

const mapsQuery = [
  "DR. KISHOR'S DENTISTRY - TIRUPUR",
  ...addressLines,
].join(" ");

/** Public, non-secret identity and contact details for the Tirupur clinic. */
export const TIRUPUR_CLINIC = {
  brandName: "Dr. Kishor's Dentistry",
  officialName: "DR. KISHOR'S DENTISTRY - TIRUPUR",
  branchName: "Tirupur",
  branchCode: "TUP",
  timezone: "Asia/Kolkata",
  addressLines,
  address: addressLines.join("\n"),
  phoneDisplay: "9361135459",
  phoneE164: "+919361135459",
  phoneHref: "tel:+919361135459",
  mapsHref: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`,
  directionsHref: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(mapsQuery)}`,
} as const;

export function addressLinesFromSnapshot(address: string): string[] {
  return address
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function getTelephoneHref(phone: string | null | undefined): string | null {
  const trimmedPhone = phone?.trim();
  if (!trimmedPhone || !/^\+?[\d\s().-]+$/.test(trimmedPhone)) return null;

  const digits = trimmedPhone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;

  return `tel:${trimmedPhone.startsWith("+") ? "+" : ""}${digits}`;
}
