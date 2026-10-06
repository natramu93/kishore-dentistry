import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({ getClaims: vi.fn(), signOut: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth }) }));
vi.mock("@/lib/env", () => ({ getPublicSupabaseEnv: () => ({ url: "https://example.supabase.co", anonKey: "public-key" }) }));
import { updateSession } from "@/lib/supabase/middleware";

const csp = { nonce: "test-nonce", policy: "default-src 'self'" };
describe("persistent application sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.getClaims.mockResolvedValue({ data: { claims: { sub: "user-id" } } });
  });
  it.each(["1.invalid", "0", "malformed"])("ignores obsolete idle cookies (%s)", async (cookie) => {
    const request = new NextRequest("https://crm.test/dashboard", { headers: { cookie: `crm-idle-session=${cookie}` } });
    const response = await updateSession(request, csp);
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(response.cookies.get("crm-idle-session")).toBeUndefined();
  });
  it("still requires authentication for protected pages", async () => {
    auth.getClaims.mockResolvedValue({ data: null });
    const response = await updateSession(new NextRequest("https://crm.test/dashboard"), csp);
    expect(response.headers.get("location")).toBe("https://crm.test/login");
  });
  it("keeps login available without a session", async () => {
    auth.getClaims.mockResolvedValue({ data: null });
    expect((await updateSession(new NextRequest("https://crm.test/login"), csp)).status).toBe(200);
  });
});
