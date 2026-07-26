import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  getProfileWithBranches: vi.fn(),
  getAuthenticatorAssuranceLevel: vi.fn(),
  cookies: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  };
});
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));
vi.mock("@/data/users", () => ({
  getProfileWithBranches: mocks.getProfileWithBranches,
}));

import {
  getAuthContext,
  getMfaSetupContext,
} from "@/lib/auth/context";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const verifiedUser = {
  id: USER_ID,
  email: "verified@example.test",
};

const activeProfile = {
  id: USER_ID,
  full_name: "Verified User",
  email: "verified@example.test",
  phone: null,
  role: "operations" as const,
  is_active: true,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  branchIds: [BRANCH_ID],
  doctorId: null,
};

describe("request authentication context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: mocks.getUser,
        mfa: {
          getAuthenticatorAssuranceLevel:
            mocks.getAuthenticatorAssuranceLevel,
        },
      },
    });
    mocks.getUser.mockResolvedValue({
      data: { user: verifiedUser },
      error: null,
    });
    mocks.getProfileWithBranches.mockResolvedValue(activeProfile);
    mocks.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: {
        currentLevel: "aal2",
        nextLevel: "aal2",
        currentAuthenticationMethods: [],
      },
      error: null,
    });
    mocks.cookies.mockResolvedValue({ getAll: () => [] });
    mocks.redirect.mockImplementation((path: string) => {
      throw new Error(`NEXT_REDIRECT:${path}`);
    });
  });

  it("builds an immutable context only from a verified user and active profile", async () => {
    const ctx = await getAuthContext();

    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(mocks.getAuthenticatorAssuranceLevel).toHaveBeenCalledTimes(1);
    expect(mocks.getProfileWithBranches).toHaveBeenCalledWith(USER_ID);
    expect(ctx).toMatchObject({
      userId: USER_ID,
      role: "operations",
      branchIds: [BRANCH_ID],
      fullName: "Verified User",
      email: "verified@example.test",
      doctorId: null,
    });
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(Object.isFrozen(ctx.branchIds)).toBe(true);
  });

  it("redirects an unverified request before loading a CRM profile", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { status: 401 },
    });

    await expect(getAuthContext()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mocks.getProfileWithBranches).not.toHaveBeenCalled();
  });

  it("retries one transient validation failure only when a session cookie exists", async () => {
    mocks.getUser
      .mockResolvedValueOnce({
        data: { user: null },
        error: { status: 503 },
      })
      .mockResolvedValueOnce({
        data: { user: verifiedUser },
        error: null,
      });
    mocks.cookies.mockResolvedValue({
      getAll: () => [
        {
          name: "sb-project-auth-token",
          value: "opaque-session",
        },
      ],
    });

    await expect(getAuthContext()).resolves.toMatchObject({ userId: USER_ID });
    expect(mocks.getUser).toHaveBeenCalledTimes(2);
  });

  it("does not retry a transient failure without evidence of a session", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { status: 503 },
    });

    await expect(getAuthContext()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
  });

  it("redirects missing and inactive profiles through the inactive path", async () => {
    mocks.getProfileWithBranches.mockResolvedValueOnce(null);
    await expect(getAuthContext()).rejects.toThrow(
      "NEXT_REDIRECT:/login?error=inactive"
    );

    mocks.getProfileWithBranches.mockResolvedValueOnce({
      ...activeProfile,
      is_active: false,
    });
    await expect(getAuthContext()).rejects.toThrow(
      "NEXT_REDIRECT:/login?error=inactive"
    );
  });

  it("requires AAL2 for every privileged role and fails closed on assurance errors", async () => {
    for (const role of ["admin", "operations", "clinical_head"] as const) {
      mocks.getProfileWithBranches.mockResolvedValueOnce({
        ...activeProfile,
        role,
      });
      mocks.getAuthenticatorAssuranceLevel.mockResolvedValueOnce({
        data: {
          currentLevel: "aal1",
          nextLevel: "aal2",
          currentAuthenticationMethods: [],
        },
        error: null,
      });

      await expect(getAuthContext()).rejects.toThrow("NEXT_REDIRECT:/mfa");
    }

    mocks.getAuthenticatorAssuranceLevel.mockResolvedValueOnce({
      data: null,
      error: { status: 503 },
    });
    await expect(getAuthContext()).rejects.toThrow("NEXT_REDIRECT:/mfa");
  });

  it("allows non-privileged roles to continue at AAL1 without an MFA lookup", async () => {
    for (const role of ["front_office", "doctor"] as const) {
      mocks.getProfileWithBranches.mockResolvedValueOnce({
        ...activeProfile,
        role,
      });
      await expect(getAuthContext()).resolves.toMatchObject({ role });
    }

    expect(mocks.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
  });

  it("lets an AAL1 privileged user enter MFA setup without a redirect loop", async () => {
    mocks.getAuthenticatorAssuranceLevel.mockResolvedValueOnce({
      data: {
        currentLevel: "aal1",
        nextLevel: "aal2",
        currentAuthenticationMethods: [],
      },
      error: null,
    });

    await expect(getMfaSetupContext()).resolves.toMatchObject({
      userId: USER_ID,
      role: "operations",
    });
  });

  it("redirects completed or non-privileged MFA-page visits to the dashboard", async () => {
    await expect(getMfaSetupContext()).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard"
    );

    mocks.getProfileWithBranches.mockResolvedValueOnce({
      ...activeProfile,
      role: "front_office",
    });
    await expect(getMfaSetupContext()).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard"
    );
  });
});
