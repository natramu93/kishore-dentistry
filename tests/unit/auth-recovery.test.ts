import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { GET } from "@/app/(auth)/auth/callback/route";

describe("password recovery callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({
      auth: {
        exchangeCodeForSession: mocks.exchangeCodeForSession,
        verifyOtp: mocks.verifyOtp,
      },
    });
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
    mocks.verifyOtp.mockResolvedValue({ error: null });
  });

  it("exchanges a PKCE recovery code and redirects with a relative location", async () => {
    const response = await GET(
      new Request("https://crm.example.test/auth/callback?code=opaque-code")
    );

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("opaque-code");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/reset-password");
  });

  it("supports token-hash recovery email templates", async () => {
    const response = await GET(
      new Request(
        "https://crm.example.test/auth/callback?token_hash=opaque-hash&type=recovery"
      )
    );

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: "opaque-hash",
      type: "recovery",
    });
    expect(response.headers.get("location")).toBe("/reset-password");
  });

  it("supports token-hash invitation templates with a fixed set-password target", async () => {
    const response = await GET(
      new Request(
        "https://crm.example.test/auth/callback?token_hash=opaque-invite&type=invite"
      )
    );

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: "opaque-invite",
      type: "invite",
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/auth/set-password");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("maps an exchanged invitation code only to the fixed set-password path", async () => {
    const response = await GET(
      new Request(
        "https://attacker.example/auth/callback?code=opaque-code&type=invite&next=https://attacker.example"
      )
    );

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("opaque-code");
    expect(response.headers.get("location")).toBe("/auth/set-password");
  });

  it("fails safely for missing, invalid, or unrelated callback parameters", async () => {
    mocks.exchangeCodeForSession.mockResolvedValueOnce({
      error: new Error("expired"),
    });
    const expired = await GET(
      new Request("https://attacker.example/auth/callback?code=expired")
    );
    expect(expired.headers.get("location")).toBe("/login?error=recovery");

    const unrelated = await GET(
      new Request(
        "https://attacker.example/auth/callback?token_hash=opaque&type=signup"
      )
    );
    expect(unrelated.headers.get("location")).toBe("/login?error=recovery");
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });
});
