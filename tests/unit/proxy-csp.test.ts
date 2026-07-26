import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  updateSession: vi.fn(),
}));

vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: mocks.updateSession,
}));

vi.mock("@/lib/env", () => ({
  getPublicSupabaseEnv: () => ({
    url: "https://project-ref.supabase.co",
    anonKey: "public-anon-key",
  }),
}));

import { proxy } from "@/proxy";

describe("proxy CSP generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSession.mockImplementation(
      async (_request: NextRequest, csp: { nonce: string; policy: string }) =>
        NextResponse.json(csp)
    );
  });

  it("passes a fresh nonce and matching policy to each session update", async () => {
    await proxy(new NextRequest("https://crm.example.test/dashboard"));
    await proxy(new NextRequest("https://crm.example.test/leads"));

    const first = mocks.updateSession.mock.calls[0][1];
    const second = mocks.updateSession.mock.calls[1][1];
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.policy).toContain(`'nonce-${first.nonce}'`);
    expect(second.policy).toContain(`'nonce-${second.nonce}'`);
  });
});
