import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("Next static security headers", () => {
  it("leaves per-request CSP to the proxy while retaining static defenses", async () => {
    const rules = await nextConfig.headers?.();
    const headers = rules?.flatMap((rule) => rule.headers) ?? [];
    const byName = new Map(
      headers.map((header) => [header.key.toLowerCase(), header.value])
    );

    expect(byName.has("content-security-policy")).toBe(false);
    expect(byName.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(byName.get("x-content-type-options")).toBe("nosniff");
    expect(byName.get("x-frame-options")).toBe("DENY");
  });
});
