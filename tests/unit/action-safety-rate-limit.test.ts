import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const consumeActionRateLimitMock = vi.hoisted(() => vi.fn());
vi.mock("@/data/rate-limits", () => ({
  consumeActionRateLimit: consumeActionRateLimitMock,
}));

import { runAction, runActionWithValue } from "@/actions/util";
import {
  AuthorizationError,
  RateLimitError,
  ValidationError,
} from "@/lib/errors";
import { FixedWindowRateLimiter } from "@/lib/rate-limit-core";
import { assertActionRateLimit } from "@/lib/rate-limit";

describe("Server Action-safe error envelopes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns stable success envelopes with and without values", async () => {
    await expect(runAction(async () => undefined)).resolves.toEqual({
      ok: true,
    });
    await expect(
      runActionWithValue(async () => ({ id: "record-1", count: 2 }))
    ).resolves.toEqual({ ok: true, id: "record-1", count: 2 });
  });

  it.each([
    [new ValidationError("Date is invalid"), "Date is invalid"],
    [new AuthorizationError("No access to this branch"), "No access to this branch"],
    [new RateLimitError(), "Too many requests. Please wait a moment and try again."],
  ])("returns only deliberate PublicError messages", async (error, message) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      runAction(async () => {
        throw error;
      })
    ).resolves.toEqual({ ok: false, error: message });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("hides infrastructure details, logs the original error, and supplies a trace reference", async () => {
    const databaseError = new Error(
      "password authentication failed for secret-host.internal"
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runAction(async () => {
      throw databaseError;
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected action failure");
    expect(result.error).not.toContain("password");
    expect(result.error).not.toContain("secret-host");
    expect(result.error).toMatch(
      /^Something went wrong\. Please try again\. Reference: [0-9a-f-]{36}$/
    );
    const reference = result.error.split("Reference: ")[1];
    expect(consoleError).toHaveBeenCalledWith(
      `Server Action failed [${reference}]`,
      databaseError
    );
  });

  it("uses the same safe mapping for value-returning actions", async () => {
    await expect(
      runActionWithValue(async () => {
        throw new ValidationError("Invoice is invalid");
      })
    ).resolves.toEqual({ ok: false, error: "Invoice is invalid" });
  });
});

describe("fixed-window rate limiting", () => {
  beforeEach(() => {
    consumeActionRateLimitMock.mockReset();
    consumeActionRateLimitMock.mockResolvedValue(true);
  });

  it("allows exactly the configured number of requests per window", () => {
    const limiter = new FixedWindowRateLimiter(10);
    const options = { limit: 3, windowMs: 1_000 };

    expect(limiter.consume("user:write", options, 10_000)).toBe(true);
    expect(limiter.consume("user:write", options, 10_100)).toBe(true);
    expect(limiter.consume("user:write", options, 10_999)).toBe(true);
    expect(limiter.consume("user:write", options, 10_999)).toBe(false);
  });

  it("resets at the exact boundary and isolates keys", () => {
    const limiter = new FixedWindowRateLimiter(10);
    const options = { limit: 1, windowMs: 1_000 };

    expect(limiter.consume("user-a:write", options, 5_000)).toBe(true);
    expect(limiter.consume("user-a:write", options, 5_999)).toBe(false);
    expect(limiter.consume("user-b:write", options, 5_999)).toBe(true);
    expect(limiter.consume("user-a:write", options, 6_000)).toBe(true);
  });

  it("caps bucket memory and keeps the newly consumed key", () => {
    const limiter = new FixedWindowRateLimiter(2);
    const options = { limit: 1, windowMs: 10_000 };

    limiter.consume("oldest", options, 1_000);
    limiter.consume("newer", options, 2_000);
    limiter.consume("protected-new", options, 3_000);

    expect(limiter.size).toBe(2);
    expect(limiter.consume("protected-new", options, 3_001)).toBe(false);
    expect(limiter.consume("oldest", options, 3_001)).toBe(true);
  });

  it("can be deterministically reset", () => {
    const limiter = new FixedWindowRateLimiter(5);
    limiter.consume("key", { limit: 1, windowMs: 10_000 }, 1);
    expect(limiter.size).toBe(1);
    limiter.reset();
    expect(limiter.size).toBe(0);
    expect(limiter.consume("key", { limit: 1, windowMs: 10_000 }, 2)).toBe(
      true
    );
  });

  it("throws a public-safe error when the durable limiter rejects a request", async () => {
    const options = { limit: 2, windowMs: 60_000 };
    consumeActionRateLimitMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(
      assertActionRateLimit("user-a", "scope-a", options)
    ).resolves.toBeUndefined();
    await expect(
      assertActionRateLimit("user-a", "scope-a", options)
    ).rejects.toBeInstanceOf(
      RateLimitError
    );
    expect(consumeActionRateLimitMock).toHaveBeenNthCalledWith(
      1,
      "user-a",
      "scope-a",
      options
    );
  });

  it("fails closed when the durable limiter is unavailable", async () => {
    const databaseError = new Error("database unavailable");
    consumeActionRateLimitMock.mockRejectedValueOnce(databaseError);

    await expect(
      assertActionRateLimit("user-a", "scope-a", {
        limit: 2,
        windowMs: 60_000,
      })
    ).rejects.toBe(databaseError);
  });
});
