import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getInvoice } from "@/data/invoices";
import { getAuthContext } from "@/lib/auth/context";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { fmtDate, formatINR } from "@/lib/tz";
import { TIRUPUR_CLINIC } from "@/lib/clinic";
import { NotFoundError, PublicError } from "@/lib/errors";
import { invoiceLineToothLabel } from "@/lib/invoice-lines";
import { receivedAmountInWords } from "@/lib/invoice-receipts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'none'; sandbox",
};

function safeText(value: string | null | undefined): string {
  return (value ?? "—")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "?");
}

function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 100) || "invoice";
}

function pdfAmount(value: number): string {
  return `INR ${formatINR(value).replace(/[^\d,.-]/g, "")}`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthContext();

  try {
    await assertActionRateLimit(ctx.userId, "invoice:pdf", {
      limit: 30,
      windowMs: 60_000,
    });
    const { id } = await context.params;
    const invoice = await getInvoice(ctx, id);
    if (!invoice || invoice.status === "cancelled" || (!invoice.code_enforced && invoice.invoice_kind !== "consultation")) {
      throw new NotFoundError("Invoice");
    }

    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const logo = await pdf.embedPng(await readFile(path.join(process.cwd(), "public/brand/kishors-dentistry-mark.png")));
    const pageSize: [number, number] = [595.28, 841.89];
    const margin = 32;
    const ink = rgb(0.08, 0.16, 0.25);
    const muted = rgb(0.37, 0.43, 0.49);
    const accent = rgb(0.05, 0.39, 0.57);
    const pale = rgb(0.91, 0.95, 0.97);
    // The document has exactly one A4 page. Measure before drawing, then reduce
    // font sizes and vertical spacing together if the complete invoice is long.
    const page = pdf.addPage(pageSize);
    const top = page.getHeight() - margin;
    const bottom = 42;
    const width = page.getWidth() - margin * 2;
    // Standard-font widths scale linearly. Reuse unit-size measurements across
    // fitting passes and repeated notes; the cache lives only for this request.
    const widthCache = new Map<PDFFont, Map<string, number>>();
    const textWidth = (text: string, size: number, font = regular): number => {
      let measurements = widthCache.get(font);
      if (!measurements) { measurements = new Map(); widthCache.set(font, measurements); }
      let measured = measurements.get(text);
      if (measured === undefined) { measured = font.widthOfTextAtSize(text, 1); measurements.set(text, measured); }
      return measured * size;
    };
    const wrap = (text: string, maxWidth: number, size: number, font = regular): string[] => {
      const lines: string[] = [];
      for (const paragraph of text.split(/\r?\n/)) {
        let line = "";
        for (const word of safeText(paragraph).split(/\s+/).filter(Boolean)) {
          const candidate = line ? `${line} ${word}` : word;
          if (textWidth(candidate, size, font) <= maxWidth) { line = candidate; continue; }
          if (line) { lines.push(line); line = ""; }
          // Split long unbroken references/notes by measured prefixes, rather
          // than repeatedly measuring an ever-growing string per character.
          let remainder = word;
          while (remainder) {
            let low = 1;
            let high = remainder.length;
            while (low < high) {
              const middle = Math.ceil((low + high) / 2);
              if (textWidth(remainder.slice(0, middle), size, font) <= maxWidth) low = middle;
              else high = middle - 1;
            }
            const fragment = remainder.slice(0, low);
            remainder = remainder.slice(low);
            if (remainder) lines.push(fragment);
            else line = fragment;
          }
        }
        if (line) lines.push(line);
      }
      return lines.length ? lines : ["-"];
    };

    const issuerName = invoice.issuer_name
      ?? (invoice.branch?.code === TIRUPUR_CLINIC.branchCode
        ? TIRUPUR_CLINIC.officialName
        : `${TIRUPUR_CLINIC.brandName}${invoice.branch?.name ? ` - ${invoice.branch.name}` : ""}`);
    const issuerAddress = invoice.issuer_address ?? invoice.branch?.address;
    const issuerPhone = invoice.issuer_phone ?? invoice.branch?.phone;

    const layout = (scale: number, render: boolean): number => {
      const s = (value: number) => value * scale;
      const draw = (text: string, x: number, atY: number, size = s(8), font = regular, color = ink) => {
        if (render) page.drawText(safeText(text), { x, y: atY, size, font, color });
      };
      const rule = (atY: number, x = margin, lineWidth = width, color = pale) => {
        if (render) page.drawLine({ start: { x, y: atY }, end: { x: x + lineWidth, y: atY }, thickness: s(0.5), color });
      };
      const paragraph = (text: string, x: number, startY: number, maxWidth: number, size: number, font = regular, color = ink) => {
        let lineY = startY;
        for (const line of wrap(text, maxWidth, size, font)) {
          draw(line, x, lineY, size, font, color);
          lineY -= size * 1.25;
        }
        return lineY;
      };
      const right = (text: string, rightX: number, atY: number, maxWidth: number, size: number, font = regular, color = ink) => {
        const measured = textWidth(safeText(text), size, font);
        const fittedSize = size * Math.min(1, maxWidth / Math.max(measured, 0.01));
        draw(text, rightX - textWidth(safeText(text), fittedSize, font), atY, fittedSize, font, color);
      };

      // Compact letterhead: address/contact information beside the logo, with
      // invoice metadata in its own column rather than stacked underneath.
      const metaX = 426;
      const brandX = margin + s(42);
      if (render) page.drawImage(logo, { x: margin, y: top - s(32), width: s(34), height: s(34) });
      let brandY = paragraph(issuerName, brandX, top, metaX - brandX - 16, s(12), bold, accent);
      for (const detail of [
        issuerAddress,
        [issuerPhone ? `Phone: ${issuerPhone}` : null, invoice.issuer_email ? `Email: ${invoice.issuer_email}` : null].filter(Boolean).join(" | "),
        invoice.issuer_gst_number ? `GSTIN: ${invoice.issuer_gst_number}` : null,
      ]) {
        if (detail) brandY = paragraph(detail, brandX, brandY, metaX - brandX - 16, s(7.2), regular, muted);
      }
      draw("INVOICE", metaX, top, s(16), bold);
      let metaY = top - s(19);
      for (const detail of [invoice.invoice_number, `Date: ${fmtDate(invoice.invoice_date ?? invoice.issued_at ?? invoice.created_at)}`, `Status: ${invoice.status}`]) {
        metaY = paragraph(detail, metaX, metaY, page.getWidth() - margin - metaX, s(7.5), regular, muted);
      }
      let y = Math.min(brandY, metaY, top - s(34)) - s(4);
      rule(y, margin, width, accent);
      y -= s(14);

      const gap = 22;
      const halfWidth = (width - gap) / 2;
      const secondX = margin + halfWidth + gap;
      let patientY = paragraph(`Patient: ${invoice.lead?.name ?? "Patient"}`, margin, y, halfWidth, s(9), bold);
      const contact = [invoice.lead?.mobile, invoice.lead?.email].filter(Boolean).join(" | ");
      if (contact) patientY = paragraph(contact, margin, patientY, halfWidth, s(7.5), regular, muted);
      let doctorY = y;
      for (const detail of [`Referring doctor: ${invoice.referring_doctor_name || "Not recorded"}`, `Consulting doctor: ${invoice.consulting_doctor_name || "Not recorded"}`]) {
        doctorY = paragraph(detail, secondX, doctorY, halfWidth, s(7.5));
      }
      y = Math.min(patientY, doctorY) - s(6);

      const columns = { description: margin + 21, qtyRight: 408, unitRight: 485, amountRight: page.getWidth() - margin };
      const descriptionWidth = 372 - columns.description;
      if (render) page.drawRectangle({ x: margin, y: y - s(14), width, height: s(14), color: pale });
      draw("#", margin + 3, y - s(10), s(7), bold, accent);
      draw("Treatment / teeth / notes", columns.description, y - s(10), s(7), bold, accent);
      right("Qty", columns.qtyRight, y - s(10), 28, s(7), bold, accent);
      right("Unit (INR)", columns.unitRight, y - s(10), 69, s(7), bold, accent);
      right("Amount (INR)", columns.amountRight, y - s(10), 70, s(7), bold, accent);
      y -= s(25);
      for (const [index, item] of invoice.items.entries()) {
        draw(String(index + 1), margin + 3, y, s(7.5));
        let rowY = paragraph(item.description, columns.description, y, descriptionWidth, s(8));
        const details = [
          invoiceLineToothLabel(item),
          item.surfaces?.length ? `Surfaces: ${item.surfaces.join(", ")}` : null,
          item.line_note,
        ].filter(Boolean).join(" | ");
        if (details) rowY = paragraph(details, columns.description, rowY, descriptionWidth, s(7), regular, muted);
        right(String(item.quantity), columns.qtyRight, y, 28, s(8));
        right(pdfAmount(item.unit_price), columns.unitRight, y, 69, s(7.5));
        right(pdfAmount(item.amount), columns.amountRight, y, 70, s(7.5));
        y = rowY + s(3);
        rule(y);
        y -= s(7);
      }

      // Keep account carry-forward separate from this invoice's financial
      // totals, but place the two blocks side-by-side to avoid empty space.
      const summaryTop = y;
      const moneyRows = (title: string, rows: { label: string; amount: number; strong?: boolean }[], x: number) => {
        draw(title, x, summaryTop, s(8), bold, accent);
        let rowY = summaryTop - s(14);
        for (const row of rows) {
          const font = row.strong ? bold : regular;
          const size = s(row.strong ? 8.5 : 7.5);
          const nextY = paragraph(row.label, x, rowY, halfWidth * 0.55 - s(8), size, font, row.strong ? ink : muted);
          right(pdfAmount(row.amount), x + halfWidth, rowY, halfWidth * 0.45, size, font);
          rowY = nextY - s(2);
        }
        return rowY;
      };
      const balance = invoice.patient_balance;
      const accountY = moneyRows("PATIENT OUTSTANDING BALANCE", [
        { label: `Earlier unpaid bills (${balance.earlier_invoice_count})`, amount: balance.earlier_due },
        { label: "This invoice due", amount: balance.invoice_due },
        ...(balance.later_due > 0 ? [{ label: "Newer unpaid bills", amount: balance.later_due }] : []),
        { label: "Overall patient due", amount: balance.overall_due, strong: true },
      ], margin);
      const totalsY = moneyRows("INVOICE TOTALS", [
        { label: "Subtotal", amount: invoice.subtotal },
        { label: `Discount${invoice.discount_given_by ? ` (${invoice.discount_given_by})` : ""}`, amount: invoice.discount_amount ?? 0 },
        { label: `Tax (${invoice.tax_rate}%)`, amount: invoice.tax_amount },
        { label: "Total", amount: invoice.total, strong: true },
        { label: "Amount received", amount: invoice.amount_paid },
        { label: "Balance due", amount: invoice.balance_due, strong: true },
      ], secondX);
      y = Math.min(accountY, totalsY) - s(3);
      y = paragraph("Earlier dues are not charged again. Record payments against their original invoice.", margin, y, width, s(6.5), regular, muted);
      y = paragraph(`Received amount in words: ${receivedAmountInWords(invoice.amount_paid)}`, margin, y, width, s(7.5));

      if (invoice.payments.length > 0) {
        y -= s(4);
        draw("PAYMENTS RECEIVED", margin, y, s(7.5), bold, accent);
        y -= s(12);
        // Two receipts per row, preserving every date, method, reference and amount.
        for (let index = 0; index < invoice.payments.length; index += 2) {
          const rowBottoms = invoice.payments.slice(index, index + 2).map((payment, column) => paragraph(
            `${fmtDate(payment.received_at)} | ${payment.payment_method.toUpperCase()} | ${payment.reference ?? "No reference"} | ${pdfAmount(payment.amount)}`,
            column === 0 ? margin : secondX, y, halfWidth, s(7), regular, muted,
          ));
          y = Math.min(...rowBottoms) - s(2);
        }
      }
      for (const detail of [invoice.notes ? `Notes: ${invoice.notes}` : null, invoice.mention ? `Mention: ${invoice.mention}` : null]) {
        if (detail) { y -= s(4); y = paragraph(detail, margin, y, width, s(7.5), regular, muted); }
      }
      return y;
    };

    const measuredBottom = layout(1, false);
    let scale = 1;
    if (measuredBottom < bottom) {
      // Start with a conservative fit: smaller fonts can only remove wrapped
      // lines. Then find the largest fitting size, avoiding unnecessary shrink
      // when reflow removes many lines. The search is bounded to eight passes.
      scale = (top - bottom) / (top - measuredBottom) * 0.995;
      let upper = 1;
      for (let pass = 0; pass < 8; pass++) {
        const candidate = (scale + upper) / 2;
        if (layout(candidate, false) >= bottom + 1) scale = candidate;
        else upper = candidate;
      }
    }
    layout(scale, true);
    page.drawText(safeText(`Thank you for choosing ${TIRUPUR_CLINIC.brandName}.`), { x: margin, y: 25, size: 7, font: regular, color: muted });
    const counter = "Page 1 of 1";
    page.drawText(counter, { x: page.getWidth() - margin - regular.widthOfTextAtSize(counter, 7), y: 25, size: 7, font: regular, color: muted });

    const bytes = await pdf.save({ useObjectStreams: true });
    const filename = `${safeFileName(invoice.invoice_number)}.pdf`;
    const inline = new URL(request.url).searchParams.get("inline") === "1";
    return new Response(bytes as BodyInit, {
      status: 200,
      headers: {
        ...privateHeaders,
        // CSP sandbox disables native PDF viewers. Only our generated, static
        // print document uses this policy; downloads/errors keep the sandbox.
        ...(inline && { "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" }),
        "Content-Type": "application/pdf",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
        "Content-Length": String(bytes.byteLength),
      },
    });
  } catch (error) {
    if (error instanceof PublicError) {
      const status = error.code === "FORBIDDEN" ? 403
        : error.code === "NOT_FOUND" ? 404
        : error.code === "RATE_LIMITED" ? 429 : 400;
      return Response.json({ error: error.message }, { status, headers: privateHeaders });
    }
    const reference = crypto.randomUUID();
    console.error(`Invoice PDF generation failed [${reference}]`, error);
    return Response.json(
      { error: `Unable to prepare this invoice. Please try again. Reference: ${reference}` },
      { status: 500, headers: privateHeaders },
    );
  }
}
