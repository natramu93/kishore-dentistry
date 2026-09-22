import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getClaims: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

vi.mock("@/lib/env", () => ({
  getPublicSupabaseEnv: () => ({
    url: "https://project.example.test",
    anonKey: "public-anon-key",
  }),
}));

import { updateSession } from "@/lib/supabase/middleware";

const TEST_CSP = {
  nonce: "dGVzdC1ub25jZQ==",
  policy:
    "default-src 'self'; script-src 'self' 'nonce-dGVzdC1ub25jZQ==' 'strict-dynamic';",
} as const;

describe("auth session middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServerClient.mockReturnValue({
      auth: { getClaims: mocks.getClaims, signOut: mocks.signOut },
    });
    mocks.signOut.mockResolvedValue({ error: null });
  });

  it.each(["/auth/callback", "/auth/set-password", "/reset-password"])(
    "does not bounce an authenticated in-progress auth flow at %s",
    async (pathname) => {
      mocks.getClaims.mockResolvedValue({
        data: { claims: { sub: "authenticated-user" } },
        error: null,
      });

      const response = await updateSession(
        new NextRequest(`https://crm.example.test${pathname}`),
        TEST_CSP
      );

      expect(response.headers.get("location")).toBeNull();
    }
  );

  it.each(["/auth/callback", "/auth/set-password", "/reset-password"])(
    "lets %s establish an invite/recovery session from a link",
    async (pathname) => {
      mocks.getClaims.mockResolvedValue({
        data: null,
        error: { status: 401 },
      });

      const response = await updateSession(
        new NextRequest(`https://crm.example.test${pathname}`),
        TEST_CSP
      );

      expect(response.headers.get("location")).toBeNull();
    }
  );

  it("keeps login stable when a downstream auth check disagrees with Proxy", async () => {
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: "authenticated-user" } },
      error: null,
    });

    const response = await updateSession(
      new NextRequest("https://crm.example.test/login"),
      TEST_CSP
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("preserves refreshed auth cookies on a protected redirect", async () => {
    mocks.createServerClient.mockImplementationOnce((...args: unknown[]) => {
      const options = args[2] as {
        cookies: {
          setAll: (
            cookies: {
              name: string;
              value: string;
              options: { httpOnly: boolean; path: string };
            }[],
            headers: Record<string, string>
          ) => void;
        };
      };
      return {
        auth: {
          getClaims: async () => {
            options.cookies.setAll([
              {
                name: "sb-refresh",
                value: "rotated",
                options: { httpOnly: true, path: "/" },
              },
            ], {
              "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
              Expires: "0",
              Pragma: "no-cache",
            });
            return {
              data: null,
              error: { status: 401 },
            };
          },
        },
      };
    });

    const response = await updateSession(
      new NextRequest(
        "https://crm.example.test/dashboard?patient=secret&search=private"
      ),
      TEST_CSP
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://crm.example.test/login"
    );
    expect(response.cookies.get("sb-refresh")?.value).toBe("rotated");
    expect(response.headers.get("cache-control")).toBe(
      "private, no-cache, no-store, must-revalidate, max-age=0"
    );
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });

  it("propagates the nonce and policy upstream and on the response", async () => {
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: "authenticated-user" } },
      error: null,
    });

    const response = await updateSession(
      new NextRequest("https://crm.example.test/dashboard"),
      TEST_CSP
    );

    expect(response.headers.get("content-security-policy")).toBe(
      TEST_CSP.policy
    );
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0"
    );
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(
      TEST_CSP.nonce
    );
    expect(
      response.headers.get("x-middleware-request-content-security-policy")
    ).toBe(TEST_CSP.policy);
  });

  it("refreshes the idle cookie for an active protected request", async () => {
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: "authenticated-user" } },
      error: null,
    });

    const response = await updateSession(
      new NextRequest("https://crm.example.test/dashboard"),
      TEST_CSP,
    );

    expect(response.cookies.get("crm-idle-session")?.value).toBeTruthy();
    expect(response.cookies.get("crm-idle-session")?.httpOnly).toBe(true);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("signs out and redirects after ten minutes without activity", async () => {
    const now = Math.floor(Date.now() / 1000);
    const { createIdleCookieValue, IDLE_TIMEOUT_SECONDS } = await import("@/lib/auth/idle-timeout");
    const staleCookie = await createIdleCookieValue(now - IDLE_TIMEOUT_SECONDS);
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: "authenticated-user" } },
      error: null,
    });

    const response = await updateSession(
      new NextRequest("https://crm.example.test/dashboard", {
        headers: { cookie: `crm-idle-session=${staleCookie}` },
      }),
      TEST_CSP,
    );

    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.headers.get("location")).toBe(
      "https://crm.example.test/login?error=idle",
    );
    expect(response.cookies.get("crm-idle-session")?.maxAge).toBe(0);
  });

  it("applies CSP to the public health response without calling auth", async () => {
    const response = await updateSession(
      new NextRequest("https://crm.example.test/api/health"),
      TEST_CSP
    );

    expect(mocks.getClaims).not.toHaveBeenCalled();
    expect(response.headers.get("content-security-policy")).toBe(
      TEST_CSP.policy
    );
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(
      TEST_CSP.nonce
    );
  });

  it("keeps provider webhooks public to Supabase auth while preserving CSP", async () => {
    const response = await updateSession(
      new NextRequest("https://crm.example.test/api/webhooks/call-tracking/provider-key"),
      TEST_CSP
    );

    expect(mocks.getClaims).not.toHaveBeenCalled();
    expect(response.headers.get("content-security-policy")).toBe(TEST_CSP.policy);
  });
});
