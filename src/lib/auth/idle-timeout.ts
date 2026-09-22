import { IDLE_TIMEOUT_SECONDS } from "./idle-timeout-constants";

export {
  IDLE_COOKIE_MAX_AGE_SECONDS,
  IDLE_COOKIE_NAME,
  IDLE_TIMEOUT_SECONDS,
} from "./idle-timeout-constants";

const COOKIE_VERSION = "v1";
const MAX_FUTURE_SKEW_SECONDS = 30;

export type IdleCookieStatus = Readonly<{
  valid: boolean;
  expired: boolean;
  lastActivityAt: number | null;
}>;

function getSigningSecret(): string {
  // The service-role key is already a runtime-only secret in App Hosting. It
  // is used only as an HMAC key here and is never sent to the browser.
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY for idle-session signing");
  }
  return "local-development-idle-session-secret";
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array | null {
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===";
    const binary = atob(padded.slice(0, padded.length - (padded.length % 4)));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function getSigningKey(usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSigningSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usage,
  );
}

async function signPayload(payload: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await getSigningKey(["sign"]),
    new TextEncoder().encode(payload),
  );
  return encodeBase64Url(new Uint8Array(signature));
}

/** Creates the signed, HttpOnly cookie value used by the request boundary. */
export async function createIdleCookieValue(
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const payload = `${COOKIE_VERSION}.${nowSeconds}`;
  return `${payload}.${await signPayload(payload)}`;
}

/**
 * Verifies an idle cookie without trusting any timestamp supplied by the
 * browser. Invalid cookies are treated as a fresh session; valid but stale
 * cookies are explicitly marked expired so the caller can sign the user out.
 */
export async function inspectIdleCookie(
  value: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<IdleCookieStatus> {
  if (!value) return { valid: false, expired: false, lastActivityAt: null };

  const [version, timestampText, signatureText, ...extra] = value.split(".");
  const timestamp = Number(timestampText);
  if (
    version !== COOKIE_VERSION ||
    extra.length > 0 ||
    !Number.isSafeInteger(timestamp) ||
    timestamp <= 0 ||
    timestamp > nowSeconds + MAX_FUTURE_SKEW_SECONDS
  ) {
    return { valid: false, expired: false, lastActivityAt: null };
  }

  const signature = decodeBase64Url(signatureText ?? "");
  if (!signature) return { valid: false, expired: false, lastActivityAt: null };

  const payload = `${version}.${timestamp}`;
  const signatureBuffer = new Uint8Array(signature).buffer as ArrayBuffer;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await getSigningKey(["verify"]),
    signatureBuffer,
    new TextEncoder().encode(payload),
  );
  if (!valid) return { valid: false, expired: false, lastActivityAt: null };

  return {
    valid: true,
    expired: nowSeconds - timestamp >= IDLE_TIMEOUT_SECONDS,
    lastActivityAt: timestamp,
  };
}
