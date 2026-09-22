import { ValidationError } from "@/lib/errors";

export function buildInviteRedirect(
  originValue: string | null,
  forwardedHost: string | null,
  host: string | null
): string {
  const requestHost = (forwardedHost ?? host ?? "").split(",")[0].trim();
  let origin: URL;
  try {
    if (!originValue) throw new Error();
    origin = new URL(originValue);
  } catch {
    throw new ValidationError("Unable to determine the invitation address");
  }

  const local =
    origin.hostname === "localhost" || origin.hostname === "127.0.0.1";
  if (
    !requestHost ||
    origin.host !== requestHost ||
    (origin.protocol !== "https:" && !local)
  ) {
    throw new ValidationError("Unable to determine the invitation address");
  }

  return new URL("/auth/set-password", origin).toString();
}

/** Trusted callback for recovery emails sent from the admin user-management UI. */
export function buildRecoveryRedirect(
  originValue: string | null,
  forwardedHost: string | null,
  host: string | null
): string {
  const requestHost = (forwardedHost ?? host ?? "").split(",")[0].trim();
  let origin: URL;
  try {
    if (!originValue) throw new Error();
    origin = new URL(originValue);
  } catch {
    throw new ValidationError("Unable to determine the password reset address");
  }

  const local = origin.hostname === "localhost" || origin.hostname === "127.0.0.1";
  if (
    !requestHost ||
    origin.host !== requestHost ||
    (origin.protocol !== "https:" && !local)
  ) {
    throw new ValidationError("Unable to determine the password reset address");
  }

  return new URL("/auth/callback", origin).toString();
}
