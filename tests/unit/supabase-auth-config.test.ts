import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("local Supabase auth configuration", () => {
  it("explicitly enables TOTP enrollment and verification", () => {
    const config = readFileSync("supabase/config.toml", "utf8");
    const totpSection = config.match(
      /\[auth\.mfa\.totp\]([\s\S]*?)(?=\r?\n\[|$)/
    )?.[1];

    expect(totpSection).toBeDefined();
    expect(totpSection).toMatch(/\benroll_enabled\s*=\s*true\b/);
    expect(totpSection).toMatch(/\bverify_enabled\s*=\s*true\b/);
  });
});
