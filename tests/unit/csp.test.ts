import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  createCspContext,
} from "@/lib/security/csp";

describe("nonce Content Security Policy", () => {
  it("creates an unpredictable nonce for every request", () => {
    const first = createCspContext(
      "production",
      "https://project-ref.supabase.co"
    );
    const second = createCspContext(
      "production",
      "https://project-ref.supabase.co"
    );

    expect(first.nonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(second.nonce).not.toBe(first.nonce);
    expect(first.policy).toContain(`'nonce-${first.nonce}'`);
    expect(second.policy).toContain(`'nonce-${second.nonce}'`);
  });

  it("builds a strict production script policy while retaining required sources", () => {
    const policy = buildContentSecurityPolicy(
      "cHJvZHVjdGlvbi1ub25jZQ==",
      "production",
      "https://project-ref.supabase.co"
    );

    expect(policy).toContain(
      "script-src 'self' 'nonce-cHJvZHVjdGlvbi1ub25jZQ==' 'strict-dynamic'"
    );
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain(
      "connect-src 'self' https://project-ref.supabase.co wss://project-ref.supabase.co"
    );
    expect(policy).not.toContain("*.supabase.co");
    expect(policy).toContain("img-src 'self' data: blob:");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("adds only the development allowances required by Next and HMR", () => {
    const policy = buildContentSecurityPolicy(
      "ZGV2ZWxvcG1lbnQtbm9uY2U=",
      "development",
      "http://localhost:54321"
    );

    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).toContain("http://127.0.0.1:54321");
    expect(policy).toContain("http://localhost:54321");
    expect(policy).toContain(" ws: wss:");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it.each([
    "not a URL",
    "http://project-ref.supabase.co",
    "https://*.supabase.co",
    "https://user:password@project-ref.supabase.co",
  ])("rejects the malformed or unsafe Supabase origin %s", (supabaseUrl) => {
    expect(() =>
      buildContentSecurityPolicy(
        "cHJvZHVjdGlvbi1ub25jZQ==",
        "production",
        supabaseUrl
      )
    ).toThrow("Invalid Supabase URL for Content Security Policy");
  });

  it("allows HTTP only for an explicit loopback development origin", () => {
    expect(() =>
      buildContentSecurityPolicy(
        "ZGV2ZWxvcG1lbnQtbm9uY2U=",
        "development",
        "http://127.0.0.1:54321"
      )
    ).not.toThrow();
    expect(() =>
      buildContentSecurityPolicy(
        "ZGV2ZWxvcG1lbnQtbm9uY2U=",
        "production",
        "http://127.0.0.1:54321"
      )
    ).toThrow("Invalid Supabase URL for Content Security Policy");
  });

  it("rejects a nonce that could inject a CSP directive", () => {
    expect(() =>
      buildContentSecurityPolicy(
        "safe'; script-src *",
        "production",
        "https://project-ref.supabase.co"
      )
    ).toThrow("Invalid CSP nonce");
  });
});
