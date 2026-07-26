import type { UserRole } from "@/lib/database.types";

export const MFA_REQUIRED_ROLES = [
  "admin",
  "operations",
  "clinical_head",
] as const satisfies readonly UserRole[];

export function requiresMfa(role: UserRole): boolean {
  return (MFA_REQUIRED_ROLES as readonly UserRole[]).includes(role);
}

export function normalizeTotpCode(value: string): string | null {
  const code = value.replace(/\s/g, "");
  return /^\d{6}$/.test(code) ? code : null;
}

export function isSafeTotpQrCode(value: string): boolean {
  return (
    value.length <= 100_000 &&
    value.startsWith("data:image/svg+xml;utf-8,")
  );
}

export function getMfaErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "We couldn't verify that code. Please try again.";
  }

  const status = "status" in error ? error.status : undefined;
  if (status === 429) {
    return "Too many attempts. Wait a minute, then try again.";
  }

  return "That code is invalid or expired. Enter the current six-digit code.";
}
