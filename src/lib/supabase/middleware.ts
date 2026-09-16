import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseEnv } from "@/lib/env";
import { getAuthPathPolicy } from "@/lib/auth/route-policy";
import type { CspContext } from "@/lib/security/csp";

function createUpstreamHeaders(
  request: NextRequest,
  csp: CspContext
): Headers {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", csp.nonce);
  requestHeaders.set("Content-Security-Policy", csp.policy);
  return requestHeaders;
}

function applySecurityHeaders(
  response: NextResponse,
  policy: string,
  privateNoStore = true
): NextResponse {
  response.headers.set("Content-Security-Policy", policy);
  if (privateNoStore && !response.headers.has("Cache-Control")) {
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
  }
  return response;
}

function createPassThroughResponse(
  request: NextRequest,
  csp: CspContext,
  privateNoStore = true
): NextResponse {
  return applySecurityHeaders(
    NextResponse.next({
      request: {
        headers: createUpstreamHeaders(request, csp),
      },
    }),
    csp.policy,
    privateNoStore
  );
}

function createRedirectResponse(
  request: NextRequest,
  destination: string,
  source: NextResponse,
  csp: CspContext
): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = destination;
  url.search = "";
  const response = NextResponse.redirect(url);
  source.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
  for (const header of ["Cache-Control", "Expires", "Pragma"]) {
    const value = source.headers.get(header);
    if (value) response.headers.set(header, value);
  }
  return applySecurityHeaders(response, csp.policy);
}

// Refreshes the auth session cookie and redirects unauthenticated users.
// Authorization (roles/branches) is NOT done here — see src/lib/auth.
export async function updateSession(
  request: NextRequest,
  csp: CspContext
) {
  // Health probes must remain public and must not pay the remote auth-refresh
  // cost. Match exactly so similarly named API paths stay protected.
  if (request.nextUrl.pathname === "/api/health") {
    return createPassThroughResponse(request, csp, false);
  }

  // Webhook providers do not have a Supabase session. Authentication for
  // these write-only endpoints happens in the route with the endpoint secret,
  // so avoid an unnecessary remote auth refresh for every provider event.
  if (request.nextUrl.pathname.startsWith("/api/webhooks/")) {
    return createPassThroughResponse(request, csp, false);
  }

  let supabaseResponse = createPassThroughResponse(request, csp);
  const { url, anonKey } = getPublicSupabaseEnv();

  const supabase = createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = createPassThroughResponse(request, csp);
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
          Object.entries(headers).forEach(([name, value]) =>
            supabaseResponse.headers.set(name, value)
          );
        },
      },
    }
  );

  // Do not run code between createServerClient and getClaims() — a subtle
  // session-refresh bug in @supabase/ssr otherwise.
  const { data: verifiedToken } = await supabase.auth.getClaims();
  const hasVerifiedSession = Boolean(verifiedToken?.claims.sub);

  const pathPolicy = getAuthPathPolicy(request.nextUrl.pathname);

  if (!hasVerifiedSession && !pathPolicy.allowWithoutSession) {
    return createRedirectResponse(request, "/login", supabaseResponse, csp);
  }

  return supabaseResponse;
}
