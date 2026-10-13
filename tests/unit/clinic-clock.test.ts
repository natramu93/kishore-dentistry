import { describe, expect, it } from "vitest";
import { splitClinicClock, joinClinicClock } from "@/lib/clinic-clock";
import { clinicTimeToUtc, fmt } from "@/lib/tz";

describe("12-hour clinic scheduling", () => {
  it.each([
    ["2026-10-13T00:00", "12", "00", "AM"],
    ["2026-10-13T12:00", "12", "00", "PM"],
    ["2026-10-13T09:15", "9", "15", "AM"],
    ["2026-10-13T19:30", "7", "30", "PM"],
    ["2017-01-01T23:59", "11", "59", "PM"],
  ])("round-trips %s without shifting the appointment", (value, hour, minute, period) => {
    const parts = splitClinicClock(value);
    expect(parts).toEqual({ date: value.slice(0,10), hour, minute, period });
    expect(joinClinicClock(parts)).toBe(value);
    expect(clinicTimeToUtc(joinClinicClock(parts))).toBe(clinicTimeToUtc(value));
  });
  it("shows historic and current instants consistently, including midnight and noon", () => {
    expect(fmt("2017-01-01T18:29:00Z")).toBe("1 Jan 2017, 11:59 PM");
    expect(fmt("2026-10-12T18:30:00Z")).toBe("13 Oct 2026, 12:00 AM");
    expect(fmt("2026-10-13T06:30:00Z")).toBe("13 Oct 2026, 12:00 PM");
  });
  it("keeps an incomplete selection empty instead of guessing AM or PM", () => {
    expect(joinClinicClock(splitClinicClock(""))).toBe("");
    expect(joinClinicClock({ date:"2026-10-13",hour:"7",minute:"30",period:"" })).toBe("");
  });
  it.each([
    { date:"2026-10-13",hour:"0",minute:"00",period:"AM" as const },
    { date:"2026-10-13",hour:"13",minute:"00",period:"AM" as const },
    { date:"2026-10-13",hour:"9",minute:"60",period:"AM" as const },
    { date:"2026-02-30",hour:"9",minute:"00",period:"AM" as const },
  ])("rejects invalid clock/calendar selections %j", (parts) => {
    expect(() => joinClinicClock(parts)).toThrow();
  });
});
