import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getClaims: vi.fn(),
  getProfileWithBranches: vi.fn(),
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
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));
vi.mock("@/data/users", () => ({
  getProfileWithBranches: mocks.getProfileWithBranches,
}));

import { getAuthContext } from "@/lib/auth/context";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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
        getClaims: mocks.getClaims,
      },
    });
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: USER_ID, email: "verified@example.test" } },
      error: null,
    });
    mocks.getProfileWithBranches.mockResolvedValue(activeProfile);
    mocks.redirect.mockImplementation((path: string) => {
      throw new Error(`NEXT_REDIRECT:${path}`);
    });
  });

  it("builds an immutable context only from a verified user and active profile", async () => {
    const ctx = await getAuthContext();

    expect(mocks.getClaims).toHaveBeenCalledTimes(1);
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
    mocks.getClaims.mockResolvedValue({
      data: null,
      error: { status: 401 },
    });

    await expect(getAuthContext()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mocks.getProfileWithBranches).not.toHaveBeenCalled();
  });

  it("redirects a transiently unverifiable request without retrying Auth", async () => {
    mocks.getClaims.mockResolvedValue({
      data: null,
      error: { status: 503 },
    });

    await expect(getAuthContext()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mocks.getClaims).toHaveBeenCalledTimes(1);
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

  it("allows every active role to continue after primary authentication", async () => {
    for (const role of [
      "admin",
      "operations",
      "front_office",
      "clinical_head",
      "doctor",
    ] as const) {
      mocks.getProfileWithBranches.mockResolvedValueOnce({
        ...activeProfile,
        role,
      });
      await expect(getAuthContext()).resolves.toMatchObject({ role });
    }
  });
});
