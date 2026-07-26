import { describe, expect, it } from "vitest";
import {
  getMfaErrorMessage,
  isSafeTotpQrCode,
  normalizeTotpCode,
  requiresMfa,
} from "@/lib/auth/mfa-policy";

describe("MFA policy", () => {
  it.each(["admin", "operations", "clinical_head"] as const)(
    "requires MFA for privileged role %s",
    (role) => {
      expect(requiresMfa(role)).toBe(true);
    }
  );

  it.each(["front_office", "doctor"] as const)(
    "does not require MFA for non-privileged role %s",
    (role) => {
      expect(requiresMfa(role)).toBe(false);
    }
  );

  it("accepts only a six-digit TOTP code", () => {
    expect(normalizeTotpCode("123456")).toBe("123456");
    expect(normalizeTotpCode("123 456")).toBe("123456");
    expect(normalizeTotpCode("12345")).toBeNull();
    expect(normalizeTotpCode("12345a")).toBeNull();
  });

  it("only accepts bounded Supabase SVG data QR codes", () => {
    expect(
      isSafeTotpQrCode("data:image/svg+xml;utf-8,<svg></svg>")
    ).toBe(true);
    expect(isSafeTotpQrCode("https://attacker.example/qr.svg")).toBe(false);
    expect(isSafeTotpQrCode(`data:image/svg+xml;utf-8,${"x".repeat(100_001)}`))
      .toBe(false);
  });

  it("returns safe, non-sensitive verification errors", () => {
    expect(getMfaErrorMessage({ status: 429 })).toContain("Too many");
    expect(getMfaErrorMessage(new Error("backend secret"))).not.toContain(
      "backend secret"
    );
  });
});
