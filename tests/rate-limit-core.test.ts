import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter } from "@/lib/rate-limit-core";

describe("FixedWindowRateLimiter", () => {
  it("rejects requests after the per-key limit", () => {
    const limiter = new FixedWindowRateLimiter(10);
    const options = { limit: 2, windowMs: 1_000 };
    expect(limiter.consume("user:invoice", options, 100)).toBe(true);
    expect(limiter.consume("user:invoice", options, 200)).toBe(true);
    expect(limiter.consume("user:invoice", options, 300)).toBe(false);
  });

  it("opens a fresh bucket after the window resets", () => {
    const limiter = new FixedWindowRateLimiter(10);
    const options = { limit: 1, windowMs: 1_000 };
    expect(limiter.consume("user:lead", options, 100)).toBe(true);
    expect(limiter.consume("user:lead", options, 1_099)).toBe(false);
    expect(limiter.consume("user:lead", options, 1_100)).toBe(true);
  });

  it("evicts reset-soonest buckets until capacity is bounded", () => {
    const limiter = new FixedWindowRateLimiter(2);
    const options = { limit: 1, windowMs: 1_000 };
    expect(limiter.consume("first", options, 0)).toBe(true);
    expect(limiter.consume("second", options, 100)).toBe(true);
    expect(limiter.consume("third", options, 200)).toBe(true);
    expect(limiter.size).toBe(2);
    // "first" had the earliest reset and was evicted.
    expect(limiter.consume("first", options, 300)).toBe(true);
    expect(limiter.size).toBe(2);
  });
});
