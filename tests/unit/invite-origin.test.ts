import { describe, expect, it } from "vitest";
import { buildInviteRedirect, buildRecoveryRedirect } from "@/lib/invite-origin";

describe("trusted invitation redirect", () => {
  it("builds the password setup URL from a matching HTTPS origin and proxy host", () => {
    expect(
      buildInviteRedirect(
        "https://crm.example.test",
        "crm.example.test",
        "internal-proxy:8080"
      )
    ).toBe("https://crm.example.test/auth/set-password");
  });

  it("allows local HTTP development origins", () => {
    expect(
      buildInviteRedirect(
        "http://localhost:3000",
        null,
        "localhost:3000"
      )
    ).toBe("http://localhost:3000/auth/set-password");
  });

  it.each([
    [null, null, "crm.example.test"],
    ["https://evil.example", null, "crm.example.test"],
    ["http://crm.example.test", null, "crm.example.test"],
    ["not a URL", null, "crm.example.test"],
  ])(
    "rejects an untrusted origin %j",
    (origin, forwardedHost, host) => {
      expect(() =>
        buildInviteRedirect(origin, forwardedHost, host)
      ).toThrow("Unable to determine the invitation address");
    }
  );
});

describe("trusted password recovery redirect", () => {
  it("builds the callback URL from the request origin", () => {
    expect(
      buildRecoveryRedirect(
        "https://crm.example.test",
        "crm.example.test",
        "internal-proxy:8080"
      )
    ).toBe("https://crm.example.test/auth/callback");
  });

  it("rejects an origin that does not match the request host", () => {
    expect(() =>
      buildRecoveryRedirect("https://evil.example", null, "crm.example.test")
    ).toThrow("Unable to determine the password reset address");
  });
});
