import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/data/db", () => ({ db: {} }));
import { DEFAULT_REPORT_DAYS, defaultReportRange } from "@/data/reports";
import { clinicDateFilterDefaults, followUpDayFilters } from "@/lib/date-filter-defaults";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-06T20:00:00Z")); });
afterEach(() => vi.useRealTimers());
const start = "2026-10-06T18:30:00.000Z";
const end = "2026-10-07T18:30:00.000Z";

describe("today-only filter defaults", () => {
  it("uses clinic today rather than the UTC date", () => {
    expect(clinicDateFilterDefaults({})).toEqual({
      fromValue: "2026-10-07", toValue: "2026-10-07", from: start, to: end,
    });
    expect(clinicDateFilterDefaults({ from: "invalid" }).fromValue).toBe("2026-10-07");
  });
  it("retains custom ranges and explicitly cleared/all-date filters", () => {
    expect(clinicDateFilterDefaults({ from: "2026-10-01", to: "2026-10-03" }).from).toBe("2026-09-30T18:30:00.000Z");
    expect(clinicDateFilterDefaults({ from: "", to: "" }).from).toBeUndefined();
    expect(clinicDateFilterDefaults({ dates: "all", from: "2026-10-01" }).from).toBeUndefined();
    expect(clinicDateFilterDefaults({ dates: "all" }).to).toBeUndefined();
  });
  it("defaults reports and exports to one full clinic day", () => {
    expect(DEFAULT_REPORT_DAYS).toBe(1);
    expect(defaultReportRange()).toEqual({ from: start, to: end });
    expect(defaultReportRange(0)).toEqual({ from: start, to: end });
  });
  it("retains user-selected longer report presets", () => {
    expect(defaultReportRange(7)).toEqual({ from: "2026-09-30T18:30:00.000Z", to: end });
    expect(defaultReportRange(30).to).toBe(end);
  });
  it("includes earlier follow-ups today without overlapping overdue/upcoming", () => {
    expect(followUpDayFilters()).toEqual({
      overdue: { dueBefore: start }, today: { dueFrom: start, dueBefore: end }, upcoming: { dueFrom: end },
    });
  });
});
