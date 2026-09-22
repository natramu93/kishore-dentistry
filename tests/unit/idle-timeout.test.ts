import { describe, expect, it } from "vitest";
import {
  createIdleCookieValue,
  IDLE_TIMEOUT_SECONDS,
  inspectIdleCookie,
} from "@/lib/auth/idle-timeout";

describe("signed idle-session cookie", () => {
  it("accepts a current cookie and rejects a tampered timestamp", async () => {
    const now = 1_800_000_000;
    const value = await createIdleCookieValue(now);

    await expect(inspectIdleCookie(value, now + 30)).resolves.toMatchObject({
      valid: true,
      expired: false,
      lastActivityAt: now,
    });

    const [version, , signature] = value.split(".");
    const tampered = `${version}.${now - 1}.${signature}`;
    await expect(inspectIdleCookie(tampered, now + 30)).resolves.toMatchObject({
      valid: false,
      expired: false,
      lastActivityAt: null,
    });
  });

  it("expires a valid cookie at the ten-minute boundary", async () => {
    const now = 1_800_000_000;
    const value = await createIdleCookieValue(now);

    await expect(inspectIdleCookie(value, now + IDLE_TIMEOUT_SECONDS - 1)).resolves.toMatchObject({
      valid: true,
      expired: false,
    });
    await expect(inspectIdleCookie(value, now + IDLE_TIMEOUT_SECONDS)).resolves.toMatchObject({
      valid: true,
      expired: true,
    });
  });
});
