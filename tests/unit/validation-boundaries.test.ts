import { describe, expect, it } from "vitest";
import {
  MAX_LIST_ROWS,
  MAX_PAGE_SIZE,
  assertAppointmentStatus,
  assertDateOnly,
  assertFollowUpStatus,
  assertIsoDateTime,
  assertLeadStatus,
  assertUserRole,
  booleanInputSchema,
  normalizeLimit,
  normalizePagination,
  normalizeSearch,
  validateIsoRange,
} from "@/lib/validation";

describe("pagination and bounded list validation", () => {
  it.each([
    [undefined, undefined, { page: 1, pageSize: 25 }],
    ["2", "50", { page: 2, pageSize: 50 }],
    [3, MAX_PAGE_SIZE + 1, { page: 3, pageSize: MAX_PAGE_SIZE }],
    ["0", "-1", { page: 1, pageSize: 25 }],
    ["1.5", "20.5", { page: 1, pageSize: 25 }],
    [Number.MAX_SAFE_INTEGER + 1, Infinity, { page: 1, pageSize: 25 }],
    ["not-a-number", "NaN", { page: 1, pageSize: 25 }],
  ])("normalizes page=%j and pageSize=%j", (page, pageSize, expected) => {
    expect(normalizePagination(page, pageSize)).toEqual(expected);
  });

  it("honors a bounded custom default page size", () => {
    expect(normalizePagination(undefined, undefined, 40)).toEqual({
      page: 1,
      pageSize: 40,
    });
  });

  it.each([
    [undefined, 25],
    [null, 25],
    [0, 25],
    [-5, 25],
    [1.5, 25],
    ["50", 50],
    [MAX_LIST_ROWS + 1, MAX_LIST_ROWS],
  ])("normalizes list limit %j", (value, expected) => {
    expect(normalizeLimit(value, 25)).toBe(expected);
  });
});

describe("search normalization", () => {
  it("removes every PostgREST control character and collapses whitespace", () => {
    expect(normalizeSearch(" Ann%_,(*)\\,status.eq.closed ")).toBe(
      "Ann status.eq.closed"
    );
  });

  it("returns undefined for empty, non-string, or syntax-only searches", () => {
    expect(normalizeSearch(undefined)).toBeUndefined();
    expect(normalizeSearch(123)).toBeUndefined();
    expect(normalizeSearch("  %,(_*)\\  ")).toBeUndefined();
  });

  it("bounds search work before returning the normalized value", () => {
    expect(normalizeSearch("x".repeat(200))).toBe("x".repeat(120));
    expect(normalizeSearch("abcdef", 3)).toBe("abc");
  });

  it("preserves ordinary Unicode patient names", () => {
    expect(normalizeSearch("  கிஷோர்   कुमार  ")).toBe("கிஷோர் कुमार");
  });
});

describe("calendar and ISO range validation", () => {
  it("canonicalizes valid ISO instants", () => {
    expect(assertIsoDateTime("2026-07-26T05:30:00+05:30")).toBe(
      "2026-07-26T00:00:00.000Z"
    );
    expect(assertIsoDateTime("2026-07-26")).toBe(
      "2026-07-26T00:00:00.000Z"
    );
  });

  it.each([
    "",
    "not-a-date",
    "x".repeat(65),
    null,
    Number.POSITIVE_INFINITY,
  ])("rejects invalid ISO value %j", (value) => {
    expect(() => assertIsoDateTime(value)).toThrow("Date and time is invalid");
  });

  it.each([
    "2026-02-30",
    "2026-04-31T10:00:00Z",
    "2025-02-29T10:00:00+05:30",
    "2026-07-26T24:00:00Z",
    "2026-07-26T23:60:00Z",
    "2026-07-26T23:59:60Z",
    "2026-07-26T10:00:00",
    "2026-07-26T10:00:00+24:00",
  ])("rejects impossible or ambiguous ISO value %j", (value) => {
    expect(() => assertIsoDateTime(value)).toThrow(
      "Date and time is invalid"
    );
  });

  it("handles leap years and rejects impossible date-only values", () => {
    expect(assertDateOnly("2024-02-29")).toBe("2024-02-29");
    expect(() => assertDateOnly("2025-02-29")).toThrow("Date is invalid");
    expect(() => assertDateOnly("2026-04-31")).toThrow("Date is invalid");
    expect(() => assertDateOnly("26-07-26")).toThrow("Date is invalid");
  });

  it("accepts a range exactly at the configured boundary", () => {
    expect(
      validateIsoRange(
        "2026-01-01T00:00:00.000Z",
        "2026-01-02T00:00:00.000Z",
        {
          from: "2025-01-01T00:00:00.000Z",
          to: "2025-01-02T00:00:00.000Z",
        },
        1
      )
    ).toEqual({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-02T00:00:00.000Z",
    });
  });

  it("rejects reversed, zero-length, and over-bound ranges", () => {
    const defaults = {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-02T00:00:00.000Z",
    };
    expect(() =>
      validateIsoRange(defaults.to, defaults.from, defaults, 1)
    ).toThrow("End date must be after start date");
    expect(() =>
      validateIsoRange(defaults.from, defaults.from, defaults, 1)
    ).toThrow("End date must be after start date");
    expect(() =>
      validateIsoRange(
        defaults.from,
        "2026-01-02T00:00:00.001Z",
        defaults,
        1
      )
    ).toThrow("Date range cannot exceed 1 days");
  });

  it("validates and canonicalizes default range inputs too", () => {
    expect(
      validateIsoRange(undefined, undefined, {
        from: "2026-07-26T05:30:00+05:30",
        to: "2026-07-27T05:30:00+05:30",
      })
    ).toEqual({
      from: "2026-07-26T00:00:00.000Z",
      to: "2026-07-27T00:00:00.000Z",
    });
  });
});

describe("runtime enum and boolean validation", () => {
  it.each([
    ["true", true],
    ["on", true],
    ["1", true],
    [true, true],
    ["false", false],
    ["off", false],
    ["0", false],
    [false, false],
  ])("coerces boolean input %j", (value, expected) => {
    expect(booleanInputSchema.parse(value)).toBe(expected);
  });

  it("does not invent truthiness for unknown values", () => {
    expect(booleanInputSchema.safeParse("yes").success).toBe(false);
    expect(booleanInputSchema.safeParse(1).success).toBe(false);
  });

  it("accepts only current workflow enums", () => {
    expect(assertUserRole("clinical_head")).toBe("clinical_head");
    expect(() => assertUserRole("agent")).toThrow("Role is invalid");
    expect(assertLeadStatus("appointment_booked")).toBe(
      "appointment_booked"
    );
    expect(() => assertLeadStatus("booked")).toThrow("Lead status is invalid");
    expect(assertAppointmentStatus("no_show")).toBe("no_show");
    expect(() => assertAppointmentStatus("missed")).toThrow(
      "Appointment status is invalid"
    );
    expect(assertFollowUpStatus("cancelled")).toBe("cancelled");
    expect(() => assertFollowUpStatus("closed")).toThrow(
      "Follow-up status is invalid"
    );
  });
});
