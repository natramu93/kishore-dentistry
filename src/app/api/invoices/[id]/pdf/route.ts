import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getInvoice } from "@/data/invoices";
import { getAuthContext } from "@/lib/auth/context";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { fmtDate, formatINR } from "@/lib/tz";
import { TIRUPUR_CLINIC } from "@/lib/clinic";
import { NotFoundError, PublicError, ValidationError } from "@/lib/errors";
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
    if (!invoice || (!invoice.code_enforced && invoice.invoice_kind !== "consultation")) {
      throw new NotFoundError("Invoice");
    }

    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const logo = await pdf.embedPng(await readFile(path.join(process.cwd(), "public/brand/kishors-dentistry-mark.png")));
    const pageSize: [number, number] = [595.28, 841.89];
    const margin = 48;
    const ink = rgb(0.08, 0.16, 0.25);
    const muted = rgb(0.37, 0.43, 0.49);
    const accent = rgb(0.05, 0.39, 0.57);
    const pale = rgb(0.91, 0.95, 0.97);
    let page = pdf.addPage(pageSize);
    let y = page.getHeight() - margin;

    const draw = (text: string, x: number, atY: number, size = 10, font = regular, color = ink) => {
      page.drawText(safeText(text), { x, y: atY, size, font, color });
    };
    const wrap = (text: string, maxWidth: number, size: number, font = regular): string[] => {
      const lines: string[] = [];
      for (const paragraph of text.split(/\r?\n/)) {
        let line = "";
        for (const word of safeText(paragraph).split(/\s+/).filter(Boolean)) {
          const candidate = line ? `${line} ${word}` : word;
          if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { line = candidate; continue; }
          if (line) { lines.push(line); line = ""; }
          for (const char of word) {
            if (line && font.widthOfTextAtSize(line + char, size) > maxWidth) { lines.push(line); line = ""; }
            line += char;
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

    const drawLetterhead = () => {
      y = page.getHeight() - margin;
      const top = y;
      page.drawImage(logo, { x: margin, y: top - 36, width: 40, height: 40 });
      let nameY = top - 1;
      for (const line of wrap(issuerName, 270, 14, bold)) {
        draw(line, margin + 50, nameY, 14, bold, accent);
        nameY -= 18;
      }
      const rightX = 385;
      draw("INVOICE", rightX, top - 2, 20, bold);
      let metaY = top - 24;
      for (const detail of [
        invoice.invoice_number,
        `Date: ${fmtDate(invoice.invoice_date ?? invoice.issued_at ?? invoice.created_at)}`,
        `Status: ${invoice.status}`,
      ]) {
        for (const line of wrap(detail, page.getWidth() - margin - rightX, 9)) {
          draw(line, rightX, metaY, 9, regular, muted);
          metaY -= 13;
        }
      }
      // Contact details sit below both columns, never behind invoice metadata.
      y = Math.min(nameY - 8, metaY - 4, top - 48);
      for (const detail of [
        issuerAddress,
        issuerPhone ? `Phone: ${issuerPhone}` : null,
        invoice.issuer_email ? `Email: ${invoice.issuer_email}` : null,
        invoice.issuer_gst_number ? `GSTIN: ${invoice.issuer_gst_number}` : null,
      ]) {
        if (!detail) continue;
        for (const line of wrap(detail, page.getWidth() - margin * 2, 9)) {
          draw(line, margin, y, 9, regular, muted);
          y -= 13;
        }
      }
      y -= 5;
      if (y < page.getHeight() / 2) throw new ValidationError("The invoice letterhead is too long to print. Review the branch address.");
      page.drawLine({ start: { x: margin, y }, end: { x: page.getWidth() - margin, y }, thickness: 1.5, color: accent });
      y -= 24;
    };
    const newPage = () => {
      page = pdf.addPage(pageSize);
      drawLetterhead();
    };
    const ensureSpace = (needed: number) => {
      if (y - needed >= margin + 12) return false;
      newPage();
      return true;
    };

    drawLetterhead();
    draw("BILLED TO", margin, y, 8, bold, muted);
    y -= 17;
    for (const line of wrap(invoice.lead?.name ?? "Patient", page.getWidth() - margin * 2, 12, bold)) {
      ensureSpace(18); draw(line, margin, y, 12, bold); y -= 16;
    }
    if (invoice.lead?.mobile) { draw(invoice.lead.mobile, margin, y, 9, regular, muted); y -= 13; }
    if (invoice.lead?.email) { draw(invoice.lead.email, margin, y, 9, regular, muted); y -= 13; }
    for (const detail of [
      `Referring doctor: ${invoice.referring_doctor_name || "Not recorded"}`,
      `Consulting doctor: ${invoice.consulting_doctor_name || "Not recorded"}`,
    ]) {
      for (const line of wrap(detail, page.getWidth() - margin * 2, 9)) {
        ensureSpace(16); draw(line, margin, y, 9); y -= 13;
      }
    }
    y -= 16;

    const columns = { number: margin, description: margin + 32, qty: 390, unit: 430, amount: 490 };
    const headerHeight = 22;
    const drawTableHeader = () => {
      page.drawRectangle({ x: margin, y: y - headerHeight + 3, width: page.getWidth() - margin * 2, height: headerHeight, color: pale });
      draw("#", columns.number + 5, y - 12, 8, bold, accent);
      draw("Description", columns.description, y - 12, 8, bold, accent);
      draw("Qty", columns.qty, y - 12, 8, bold, accent);
      draw("Unit", columns.unit, y - 12, 8, bold, accent);
      draw("Amount", columns.amount, y - 12, 8, bold, accent);
      y -= headerHeight + 2;
    };
    drawTableHeader();

    for (const [index, item] of invoice.items.entries()) {
      // Keep descriptions out of the quantity/price columns, even at large values.
      const descriptionWidth = columns.qty - columns.description - 12;
      const descLines = wrap(item.description, descriptionWidth, 9);
      const toothLabel = invoiceLineToothLabel(item);
      const lines = [
        ...descLines.map((text) => ({ text, size: 9, color: ink })),
        ...(toothLabel ? wrap(toothLabel, descriptionWidth, 8) : []).map((text) => ({ text, size: 8, color: muted })),
        ...(item.surfaces?.length ? wrap(`Surfaces: ${item.surfaces.join(", ")}`, descriptionWidth, 8) : []).map((text) => ({ text, size: 8, color: muted })),
        ...(item.line_note ? wrap(item.line_note, descriptionWidth, 8) : []).map((text) => ({ text, size: 8, color: muted })),
      ];
      let offset = 0;
      while (offset < lines.length) {
        const remainingHeight = (lines.length - offset) * 12 + 18;
        const fullPageSpace = pageSize[1] - margin * 2 - 240;
        // Normal lines stay together; unusually long notes split safely across pages.
        if (ensureSpace(Math.min(remainingHeight, fullPageSpace))) drawTableHeader();
        let capacity = Math.floor((y - margin - 30) / 12);
        if (capacity < 1) { newPage(); drawTableHeader(); capacity = Math.floor((y - margin - 30) / 12); }
        const chunk = lines.slice(offset, offset + capacity);
        draw(offset === 0 ? String(index + 1) : `${index + 1} cont.`, columns.number + 3, y - 11, offset === 0 ? 9 : 7);
        chunk.forEach((line, lineIndex) => draw(line.text, columns.description, y - 11 - lineIndex * 12, line.size, regular, line.color));
        if (offset === 0) {
          const cells = [
            { text: String(item.quantity), right: columns.unit - 10, size: 9 },
            { text: pdfAmount(item.unit_price), right: columns.amount - 8, size: 8 },
            { text: pdfAmount(item.amount), right: page.getWidth() - margin, size: 8 },
          ];
          for (const cell of cells) {
            const size = Math.min(cell.size, cell.size * 54 / Math.max(54, regular.widthOfTextAtSize(cell.text, cell.size)));
            draw(cell.text, cell.right - regular.widthOfTextAtSize(cell.text, size), y - 11, size);
          }
        }
        y -= Math.max(22, chunk.length * 12 + 10);
        page.drawLine({ start: { x: margin, y }, end: { x: page.getWidth() - margin, y }, thickness: 0.4, color: pale });
        y -= 8;
        offset += chunk.length;
      }
    }

    ensureSpace(130);
    const totalsX = 370;
    const totalRow = (label: string, amount: number, strong = false) => {
      const font = strong ? bold : regular;
      const amountText = pdfAmount(amount);
      const amountWidth = font.widthOfTextAtSize(amountText, strong ? 11 : 9);
      page.drawText(label, { x: totalsX, y, size: strong ? 11 : 9, font, color: strong ? ink : muted });
      page.drawText(amountText, {
        x: page.getWidth() - margin - amountWidth, y, size: strong ? 11 : 9, font, color: strong ? ink : muted,
      });
      y -= strong ? 20 : 16;
    };
    totalRow("Subtotal", invoice.subtotal);
    totalRow(`Discount${invoice.discount_given_by ? ` (${invoice.discount_given_by})` : ""}`, invoice.discount_amount ?? 0);
    totalRow(`Tax (${invoice.tax_rate}%)`, invoice.tax_amount);
    page.drawLine({ start: { x: totalsX, y: y + 11 }, end: { x: page.getWidth() - margin, y: y + 11 }, thickness: 1, color: accent });
    totalRow("Total", invoice.total, true);
    totalRow("Amount received", invoice.amount_paid);
    totalRow("Balance due", invoice.balance_due, true);

    const balance = invoice.patient_balance;
    // A separate, full-width account summary: carried dues are not invoice revenue.
    ensureSpace(balance.later_due > 0 ? 145 : 130);
    y -= 8;
    draw("PATIENT OUTSTANDING BALANCE", margin, y, 10, bold, accent);
    y -= 20;
    const accountRow = (label: string, amount: number, strong = false) => {
      const font = strong ? bold : regular;
      draw(label, margin, y, 10, font);
      const amountText = pdfAmount(amount);
      draw(amountText, page.getWidth() - margin - font.widthOfTextAtSize(amountText, 10), y, 10, font);
      y -= 18;
    };
    accountRow(`Earlier unpaid bills (${balance.earlier_invoice_count})`, balance.earlier_due);
    accountRow("This invoice due", balance.invoice_due);
    if (balance.later_due > 0) accountRow("Newer unpaid bills", balance.later_due);
    accountRow("Overall patient due", balance.overall_due, true);
    for (const line of wrap("Current unpaid balances across active bills; earlier dues are not charged again. Record payments against their original invoice.", page.getWidth() - margin * 2, 8)) {
      ensureSpace(14); draw(line, margin, y, 8, regular, muted); y -= 12;
    }
    y -= 8;

    for (const line of wrap(`Received amount in words: ${receivedAmountInWords(invoice.amount_paid)}`, page.getWidth() - margin * 2, 9)) {
      ensureSpace(16); draw(line, margin, y, 9, regular, muted); y -= 13;
    }

    if (invoice.payments.length > 0) {
      ensureSpace(40);
      y -= 4;
      draw("PAYMENTS RECEIVED", margin, y, 8, bold, muted);
      y -= 15;
      for (const payment of invoice.payments) {
        const receiptLines = wrap(`${fmtDate(payment.received_at)} | ${payment.payment_method.toUpperCase()} | ${payment.reference ?? "No reference"}`, 350, 8);
        if (ensureSpace(receiptLines.length * 13 + 20)) {
          draw("PAYMENTS RECEIVED (CONTINUED)", margin, y, 8, bold, muted);
          y -= 15;
        }
        const receiptAmount = pdfAmount(payment.amount);
        draw(receiptAmount, page.getWidth() - margin - regular.widthOfTextAtSize(receiptAmount, 8), y, 8, regular, ink);
        for (const line of receiptLines) { draw(line, margin, y, 8, regular, muted); y -= 13; }
      }
    }

    if (invoice.notes) {
      const noteLines = wrap(`Notes: ${invoice.notes}`, page.getWidth() - margin * 2, 9);
      y -= 5;
      for (const line of noteLines) { ensureSpace(16); draw(line, margin, y, 9, regular, muted); y -= 13; }
    }
    if (invoice.mention) {
      const mentionLines = wrap(`Mention: ${invoice.mention}`, page.getWidth() - margin * 2, 9);
      y -= 5;
      for (const line of mentionLines) { ensureSpace(16); draw(line, margin, y, 9, regular, muted); y -= 13; }
    }
    for (const [index, printedPage] of pdf.getPages().entries()) {
      printedPage.drawText(safeText(`Thank you for choosing ${TIRUPUR_CLINIC.brandName}.`), { x: margin, y: 28, size: 8, font: regular, color: muted });
      const counter = `Page ${index + 1} of ${pdf.getPageCount()}`;
      printedPage.drawText(counter, { x: printedPage.getWidth() - margin - regular.widthOfTextAtSize(counter, 8), y: 28, size: 8, font: regular, color: muted });
    }

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
