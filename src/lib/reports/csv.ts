import type { ReportsData, ReportRow } from "@/data/reports";
import { PAYMENT_METHODS, PAYMENT_LABELS } from "./collections";

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
    "",
    "", "", "", "", "",
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
      "Treatment value (INR)",
      "UPI (INR)", "Cash (INR)", "Card (INR)", "NEFT / Net banking (INR)", "Revenue received (INR)",
    ],
    ...reportRows("By doctor", data.byDoctor),
    ...reportRows("By center", data.byCenter),
    ...reportRows("By day", data.byDay),
    ...data.invoiceValues.rows.map((row) => [`Invoice value by ${row.dimension}`, row.label, "", "", row.value, "", "", "", "", ""] as CsvValue[]),
    ...data.collections.byDay.map((row) => ["Receipts by date", row.key, "", "", "", row.upi, row.cash, row.card, row.neft, row.amount] as CsvValue[]),
    ...data.collections.byMonth.map((row) => ["Receipts by month", row.key, "", "", "", row.upi, row.cash, row.card, row.neft, row.amount] as CsvValue[]),
    ...PAYMENT_METHODS.map((method) => ["Receipts by method", PAYMENT_LABELS[method], "", "", "", ...PAYMENT_METHODS.map((column) => column === method ? data.collections.total[method] : 0), data.collections.total[method]] as CsvValue[]),
    [
      "Overall",
      "Total",
      data.totals.leads,
      data.totals.appointments,
      data.totals.revenue,
      data.collections.total.upi, data.collections.total.cash, data.collections.total.card,
      data.collections.total.neft, data.collections.total.amount,
    ],
  ];

  // Separate columns for invoice adjustments; do not mislabel them as treatment value.
  rows[0].push("Invoice discounts (INR)", "Invoice tax (INR)", "Net billed (INR)");
  for (const row of rows.slice(1)) row.push("", "", "");
  rows[rows.length - 1].splice(10, 3, data.invoiceValues.discounts, data.invoiceValues.tax, data.invoiceValues.net);

  return `\uFEFF${rows
    .map((row) => row.map((value) => csvCell(value)).join(","))
    .join("\r\n")}\r\n`;
}
