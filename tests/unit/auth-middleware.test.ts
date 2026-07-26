import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getClaims: vi.fn(),
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
      auth: { getClaims: mocks.getClaims },
    });
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

  it("allows an authenticated AAL1 user to reach the MFA challenge route", async () => {
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: "authenticated-user" } },
      error: null,
    });

    const response = await updateSession(
      new NextRequest("https://crm.example.test/mfa"),
      TEST_CSP
    );

    expect(response.headers.get("location")).toBeNull();
  });

  it("keeps MFA protected from unauthenticated requests", async () => {
    mocks.getClaims.mockResolvedValue({
      data: null,
      error: { status: 401 },
    });

    const response = await updateSession(
      new NextRequest(
        "https://crm.example.test/mfa?patient=secret&search=private"
      ),
      TEST_CSP
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("content-security-policy")).toBe(
      TEST_CSP.policy
    );
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0"
    );
    expect(response.headers.get("location")).toBe(
      "https://crm.example.test/login"
    );
  });

  it("preserves the convenience redirect only for guest-only pages", async () => {
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: "authenticated-user" } },
      error: null,
    });

    const response = await updateSession(
      new NextRequest("https://crm.example.test/login"),
      TEST_CSP
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://crm.example.test/dashboard"
    );
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
            }[]
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
            ]);
            return {
              data: null,
              error: { status: 401 },
            };
          },
        },
      };
    });

    const response = await updateSession(
      new NextRequest("https://crm.example.test/dashboard"),
      TEST_CSP
    );

    expect(response.cookies.get("sb-refresh")?.value).toBe("rotated");
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0"
    );
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
});
