import { describe, expect, it } from "vitest";
import {
  assertDateOnly,
  assertInvoiceStatus,
  assertUuid,
  normalizePagination,
  normalizeSearch,
  validateIsoRange,
} from "@/lib/validation";

describe("request validation", () => {
  it("accepts valid identifiers and rejects malformed ones", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(assertUuid(id)).toBe(id);
    expect(() => assertUuid("not-an-id")).toThrow("Identifier is invalid");
  });

  it("validates invoice states at runtime", () => {
    expect(assertInvoiceStatus("paid")).toBe("paid");
    expect(() => assertInvoiceStatus("refunded")).toThrow(
      "Invoice status is invalid"
    );
  });

  it("normalizes hostile or unbounded pagination", () => {
    expect(normalizePagination("Infinity", "-10")).toEqual({
      page: 1,
      pageSize: 25,
    });
    expect(normalizePagination("2", "10000")).toEqual({
      page: 2,
      pageSize: 100,
    });
  });

  it("removes PostgREST filter syntax from free-text search", () => {
    expect(normalizeSearch("Ann%,(status.eq.closed)")).toBe(
      "Ann status.eq.closed"
    );
  });

  it("rejects impossible calendar dates", () => {
    expect(assertDateOnly("2026-02-28")).toBe("2026-02-28");
    expect(() => assertDateOnly("2026-02-30")).toThrow("Date is invalid");
  });

  it("requires ordered and bounded report ranges", () => {
    const defaults = {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-31T00:00:00.000Z",
    };
    expect(validateIsoRange(undefined, undefined, defaults)).toEqual(defaults);
    expect(() =>
      validateIsoRange(
        "2026-02-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
        defaults
      )
    ).toThrow("End date must be after start date");
    expect(() =>
      validateIsoRange(
        "2025-01-01T00:00:00.000Z",
        "2026-12-31T00:00:00.000Z",
        defaults
      )
    ).toThrow("Date range cannot exceed");
  });
});
