import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clinicDayRange,
  clinicTimeToUtc,
  clinicToday,
  fmt,
  fmtDate,
  fmtTime,
  formatINR,
  toClinicInputValue,
} from "@/lib/tz";

describe("Asia/Kolkata clinic time boundaries", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("converts clinic wall time to the correct UTC instant", () => {
    expect(clinicTimeToUtc("2026-07-26T00:00")).toBe(
      "2026-07-25T18:30:00.000Z"
    );
    expect(clinicTimeToUtc("2026-07-26T23:59:59")).toBe(
      "2026-07-26T18:29:59.000Z"
    );
  });

  it("round-trips stored instants through datetime-local values", () => {
    const stored = "2026-12-31T18:45:00.000Z";
    const local = toClinicInputValue(stored);
    expect(local).toBe("2027-01-01T00:15");
    expect(clinicTimeToUtc(local)).toBe(stored);
  });

  it("changes displayed clinic date at 18:30 UTC, not UTC midnight", () => {
    expect(fmtDate("2026-07-25T18:29:59.999Z")).toBe("25 Jul 2026");
    expect(fmtDate("2026-07-25T18:30:00.000Z")).toBe("26 Jul 2026");
    expect(fmtTime("2026-07-25T18:30:00.000Z")).toBe("12:00 AM");
    expect(
      fmt("2026-07-25T18:30:00.000Z", "yyyy-MM-dd HH:mm")
    ).toBe("2026-07-26 00:00");
  });

  it("computes half-open UTC boundaries for an IST clinic day", () => {
    expect(clinicDayRange("2026-01-01")).toEqual({
      start: "2025-12-31T18:30:00.000Z",
      end: "2026-01-01T18:30:00.000Z",
    });
    const leapDay = clinicDayRange("2024-02-29");
    expect(leapDay).toEqual({
      start: "2024-02-28T18:30:00.000Z",
      end: "2024-02-29T18:30:00.000Z",
    });
    expect(Date.parse(leapDay.end) - Date.parse(leapDay.start)).toBe(
      24 * 60 * 60 * 1_000
    );
  });

  it("derives today from clinic time across the UTC boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T18:29:59.999Z"));
    expect(clinicToday()).toBe("2026-07-25");
    vi.setSystemTime(new Date("2026-07-25T18:30:00.000Z"));
    expect(clinicToday()).toBe("2026-07-26");
  });

  it.each([
    "",
    "2026-07-26",
    "2026/07/26 10:00",
    "2026-02-30T10:00",
    "not-a-date",
    "2026-07-26T10:00:00.000",
  ])("rejects invalid clinic-local input %j", (value) => {
    expect(() => clinicTimeToUtc(value)).toThrow("Date and time is invalid");
  });

  it("rejects invalid clinic day strings through shared date validation", () => {
    expect(() => clinicDayRange("2025-02-29")).toThrow("Date is invalid");
  });

  it("formats Indian currency without inheriting the process timezone", () => {
    expect(formatINR(1_234.5)).toBe("₹1,234.50");
    expect(formatINR(12_345_678.25)).toBe("₹1,23,45,678.25");
  });

  it("rejects invalid wall-clock values instead of normalizing them", () => {
    expect(() => clinicTimeToUtc("2026-07-26T24:00")).toThrow(
      "Date and time is invalid"
    );
    expect(() => clinicTimeToUtc("2026-07-26T23:60")).toThrow(
      "Date and time is invalid"
    );
    expect(() => clinicTimeToUtc("2026-07-26T23:59:60")).toThrow(
      "Date and time is invalid"
    );
  });
});
