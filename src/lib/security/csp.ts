import { Buffer } from "node:buffer";
import { getPublicSupabaseEnv } from "@/lib/env";

export type CspContext = Readonly<{
  nonce: string;
  policy: string;
}>;

const NONCE_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

function getSupabaseConnectionSources(
  supabaseUrl: string,
  isDevelopment: boolean
): readonly [string, string] {
  let parsed: URL;

  try {
    parsed = new URL(supabaseUrl);
  } catch {
    throw new Error("Invalid Supabase URL for Content Security Policy");
  }

  const isLoopback =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  const isAllowedProtocol =
    parsed.protocol === "https:" ||
    (isDevelopment && isLoopback && parsed.protocol === "http:");

  if (
    !isAllowedProtocol ||
    !parsed.hostname ||
    parsed.hostname.includes("*") ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("Invalid Supabase URL for Content Security Policy");
  }

  const websocketUrl = new URL(parsed.origin);
  websocketUrl.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";

  return [parsed.origin, websocketUrl.origin];
}

export function buildContentSecurityPolicy(
  nonce: string,
  environment: string | undefined = process.env.NODE_ENV,
  supabaseUrl: string = getPublicSupabaseEnv().url
): string {
  if (!NONCE_PATTERN.test(nonce)) {
    throw new Error("Invalid CSP nonce");
  }

  const isDevelopment = environment === "development";
  const supabaseSources = getSupabaseConnectionSources(
    supabaseUrl,
    isDevelopment
  );
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${
      isDevelopment ? " 'unsafe-eval'" : ""
    }`,
    "script-src-attr 'none'",
    isDevelopment
      ? "style-src 'self' 'unsafe-inline'"
      : `style-src 'self' 'nonce-${nonce}'`,
    // React style attributes are used for chart widths, image placeholders,
    // and toast variables. Production <style> elements still require a nonce.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self'",
    "font-src 'self' data:",
    `connect-src 'self' ${supabaseSources.join(" ")}${
      isDevelopment
        ? " http://127.0.0.1:54321 http://localhost:54321 ws: wss:"
        : ""
    }`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
  ];

  return `${directives.join("; ")};`;
}

export function createCspContext(
  environment: string | undefined = process.env.NODE_ENV,
  supabaseUrl: string = getPublicSupabaseEnv().url
): CspContext {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  return Object.freeze({
    nonce,
    policy: buildContentSecurityPolicy(nonce, environment, supabaseUrl),
  });
}
