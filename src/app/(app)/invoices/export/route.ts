import { getAuthContext } from "@/lib/auth/context";
import { listInvoices } from "@/data/invoices";
import { getLead } from "@/data/leads";
import { NotFoundError, PublicError, ValidationError } from "@/lib/errors";
import { invoiceListFilters, invoiceStatusLabel } from "@/lib/invoice-policy";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { csvCell } from "@/lib/reports/csv";
import { clinicToday } from "@/lib/tz";
import { MAX_PAGE_SIZE } from "@/lib/validation";

export const dynamic = "force-dynamic";
const MAX_ROWS = 10_000;
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
const csvRow = (cells: (string | number)[]) => cells.map(csvCell).join(",");

export async function GET(request: Request) {
  const ctx = await getAuthContext();
  try {
    await assertActionRateLimit(ctx.userId, "invoice-export", { limit: 5, windowMs: 60_000 });
    const { dates, options } = invoiceListFilters(Object.fromEntries(new URL(request.url).searchParams));
    if (dates.error) throw new ValidationError(dates.error);
    if (options.leadId && !await getLead(ctx, options.leadId)) throw new NotFoundError("Patient");

    const rows = [csvRow(["Invoice number", "Invoice date", "Patient", "Center", "Status",
      "Subtotal (INR)", "Discount (INR)", "Tax (INR)", "Total (INR)", "Received (INR)", "Due (INR)"])];
    const seen = new Set<string>();
    for (let page = 1; ; page++) {
      const result = await listInvoices(ctx, { ...options, page, pageSize: MAX_PAGE_SIZE });
      if (result.total > MAX_ROWS) throw new ValidationError("More than 10,000 invoices match. Narrow the filters to download.");
      for (const invoice of result.invoices) {
        if (seen.has(invoice.id)) continue;
        seen.add(invoice.id);
        const amounts = invoice.status === "cancelled" ? [0, 0, 0, 0, 0, 0]
          : [invoice.subtotal, invoice.discount_amount ?? 0, invoice.tax_amount, invoice.total, invoice.amount_paid, invoice.balance_due];
        rows.push(csvRow([invoice.invoice_number, invoice.billing_date, invoice.lead?.name ?? "",
          invoice.branch?.name ?? "", invoiceStatusLabel(invoice.status), ...amounts]));
      }
      if (page * result.pageSize >= result.total) break;
    }
    return new Response(`\uFEFF${rows.join("\r\n")}\r\n`, {
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="invoices-${clinicToday()}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof PublicError) {
      const status = error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : error.code === "RATE_LIMITED" ? 429 : 400;
      return Response.json({ error: error.message }, { status, headers: PRIVATE_HEADERS });
    }
    console.error("Invoice export failed", error);
    return Response.json({ error: "Could not download invoices. Please try again." }, { status: 500, headers: PRIVATE_HEADERS });
  }
}
