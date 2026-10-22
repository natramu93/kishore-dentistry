import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRIMARY_NAV, navForRole } from "@/components/nav-items";
import { PIPELINE_ORDER } from "@/lib/leads/transitions";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ getAuthContext: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("redirect"); }) }));
import { getAuthContext } from "@/lib/auth/context";
import { redirect } from "next/navigation";
import RetiredFollowUpsPage from "@/app/(app)/follow-ups/page";

beforeEach(() => vi.clearAllMocks());

describe("retired follow-up workflow", () => {
  it.each(["admin", "operations", "front_office", "clinical_head", "doctor"] as const)("does not show a follow-up route to %s", (role) => {
    expect(navForRole(PRIMARY_NAV, role).map((item) => item.href)).not.toContain("/follow-ups");
    expect(PIPELINE_ORDER).not.toContain("follow_up");
  });
  it("authenticates old bookmarks and sends them to appointments", async () => {
    await expect(RetiredFollowUpsPage()).rejects.toThrow("redirect");
    expect(getAuthContext).toHaveBeenCalledOnce();
    expect(redirect).toHaveBeenCalledWith("/appointments");
  });
  it("does not redirect past an authentication failure", async () => {
    vi.mocked(getAuthContext).mockRejectedValueOnce(new Error("Sign in required"));
    await expect(RetiredFollowUpsPage()).rejects.toThrow("Sign in required");
    expect(redirect).not.toHaveBeenCalled();
  });
});
