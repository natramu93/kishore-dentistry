import { describe, expect, it } from "vitest";
import { buildReportCsv, csvCell } from "@/lib/reports/csv";
import type { ReportsData } from "@/data/reports";

describe("report CSV export", () => {
  it.each([
    ["=SUM(1,1)", "\"'=SUM(1,1)\""],
    ["  +CMD", "\"'  +CMD\""],
    ["-2+3", "\"'-2+3\""],
    ["@danger", "\"'@danger\""],
    ["\tformula", "\"'\tformula\""],
  ])("neutralizes spreadsheet formula label %j", (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it("keeps numeric values numeric and escapes CSV punctuation", () => {
    expect(csvCell(1250.5)).toBe("\"1250.5\"");
    expect(csvCell("Dr. \"A\", B")).toBe("\"Dr. \"\"A\"\", B\"");
  });

  it("exports only aggregate fields with Excel-compatible line endings", () => {
    const data: ReportsData = {
      byDoctor: [
        {
          key: "doctor-id",
          label: "=HYPERLINK(\"https://example.test\")",
          leads: 2,
          appointments: 3,
          followUps: 1,
          revenue: 500,
        },
      ],
      byCenter: [],
      byDay: [],
      byTreatment: [],
      totals: {
        leads: 2,
        appointments: 3,
        followUps: 1,
        revenue: 500,
      },
      range: {
        from: "2026-07-01T18:30:00.000Z",
        to: "2026-07-03T18:30:00.000Z",
      },
    };

    const csv = buildReportCsv(data);

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain(
      "\"By doctor\",\"'=HYPERLINK(\"\"https://example.test\"\")\",\"2\",\"3\",\"1\",\"500\""
    );
    expect(csv).toContain("\"Overall\",\"Total\",\"2\",\"3\",\"1\",\"500\"");
    expect(csv).not.toContain("doctor-id");
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.replaceAll("\r\n", "")).not.toContain("\n");
  });
});
