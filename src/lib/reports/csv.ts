import type { ReportsData, ReportRow } from "@/data/reports";

type CsvValue = string | number;

const FORMULA_PREFIX = /^[\t\r\n]|^\s*[=+\-@]/;

/**
 * Quote every field and neutralize spreadsheet formula prefixes in
 * user-controlled labels. Numeric values remain numeric for spreadsheet use.
 */
export function csvCell(value: CsvValue): string {
  const text = String(value);
  const safe =
    typeof value === "string" && FORMULA_PREFIX.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function reportRows(section: string, rows: ReportRow[]): CsvValue[][] {
  return rows.map((row) => [
    section,
    row.label,
    row.leads,
    row.appointments,
    row.followUps,
    row.revenue,
  ]);
}

/** Build a patient-safe aggregate export that opens cleanly in Excel. */
export function buildReportCsv(data: ReportsData): string {
  const rows: CsvValue[][] = [
    [
      "Section",
      "Name",
      "Leads",
      "Appointments",
      "Follow-ups",
      "Revenue (INR)",
    ],
    ...reportRows("By doctor", data.byDoctor),
    ...reportRows("By center", data.byCenter),
    ...reportRows("By day", data.byDay),
    ...reportRows("By treatment", data.byTreatment),
    [
      "Overall",
      "Total",
      data.totals.leads,
      data.totals.appointments,
      data.totals.followUps,
      data.totals.revenue,
    ],
  ];

  return `\uFEFF${rows
    .map((row) => row.map((value) => csvCell(value)).join(","))
    .join("\r\n")}\r\n`;
}
