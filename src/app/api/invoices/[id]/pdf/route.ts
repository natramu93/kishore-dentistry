import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getInvoice } from "@/data/invoices";
import { getAuthContext } from "@/lib/auth/context";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { fmtDate, formatINR } from "@/lib/tz";
import { TIRUPUR_CLINIC } from "@/lib/clinic";
import { NotFoundError, PublicError } from "@/lib/errors";

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
  _request: Request,
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
    const pageSize: [number, number] = [595.28, 841.89];
    const margin = 48;
    const ink = rgb(0.08, 0.16, 0.25);
    const muted = rgb(0.37, 0.43, 0.49);
    const accent = rgb(0.05, 0.39, 0.57);
    const pale = rgb(0.91, 0.95, 0.97);
    let page = pdf.addPage(pageSize);
    let y = page.getHeight() - margin;

    const draw = (text: string, x: number, atY: number, size = 10, font = regular, color = ink) => {
      page.drawText(safeText(text), { x, y: atY, size, font, color, maxWidth: page.getWidth() - x - margin });
    };
    const ensureSpace = (needed: number) => {
      if (y - needed < margin) {
        page = pdf.addPage(pageSize);
        y = page.getHeight() - margin;
      }
    };
    const wrap = (text: string, maxWidth: number, size: number, font = regular): string[] => {
      const words = safeText(text).split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      let line = "";
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      if (line) lines.push(line);
      return lines.length ? lines : ["—"];
    };

    const issuerName = invoice.issuer_name
      ?? (invoice.branch?.code === TIRUPUR_CLINIC.branchCode
        ? TIRUPUR_CLINIC.officialName
        : `${TIRUPUR_CLINIC.brandName}${invoice.branch?.name ? ` - ${invoice.branch.name}` : ""}`);
    const issuerAddress = invoice.issuer_address ?? invoice.branch?.address;
    const issuerPhone = invoice.issuer_phone ?? invoice.branch?.phone;

    draw(issuerName, margin, y, 17, bold, accent);
    y -= 22;
    for (const paragraph of (issuerAddress ?? "").split(/\r?\n/).filter(Boolean)) {
      for (const line of wrap(paragraph, page.getWidth() - margin * 2, 9)) {
        draw(line, margin, y, 9, regular, muted);
        y -= 13;
      }
    }
    if (issuerPhone) {
      draw(`Phone: ${issuerPhone}`, margin, y, 9, regular, muted);
      y -= 13;
    }
    if (invoice.issuer_email) { draw(`Email: ${invoice.issuer_email}`, margin, y, 9, regular, muted); y -= 13; }
    if (invoice.issuer_gst_number) { draw(`GSTIN: ${invoice.issuer_gst_number}`, margin, y, 9, regular, muted); y -= 13; }
    page.drawText("INVOICE", {
      x: 385, y: page.getHeight() - margin - 2, size: 20, font: bold, color: ink,
    });
    page.drawText(safeText(invoice.invoice_number), {
      x: 385, y: page.getHeight() - margin - 25, size: 10, font: regular, color: muted,
    });
    page.drawText(`Date: ${fmtDate(invoice.issued_at ?? invoice.created_at)}`, {
      x: 385, y: page.getHeight() - margin - 41, size: 9, font: regular, color: muted,
    });
    page.drawText(`Status: ${invoice.status}`, {
      x: 385, y: page.getHeight() - margin - 56, size: 9, font: regular, color: muted,
    });

    y -= 12;
    page.drawLine({ start: { x: margin, y }, end: { x: page.getWidth() - margin, y }, thickness: 1.5, color: accent });
    y -= 25;
    draw("BILLED TO", margin, y, 8, bold, muted);
    y -= 17;
    draw(invoice.lead?.name ?? "Patient", margin, y, 12, bold);
    y -= 16;
    if (invoice.lead?.mobile) { draw(invoice.lead.mobile, margin, y, 9, regular, muted); y -= 13; }
    if (invoice.lead?.email) { draw(invoice.lead.email, margin, y, 9, regular, muted); y -= 13; }
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
      const descLines = wrap(item.description, 300, 9);
      const surfaceLines = item.surfaces?.length
        ? wrap(`Surfaces: ${item.surfaces.join(", ")}`, 300, 8)
        : [];
      const lines = [...descLines, ...surfaceLines];
      const rowHeight = Math.max(22, lines.length * 12 + 10);
      ensureSpace(rowHeight + 10);
      if (y === page.getHeight() - margin) drawTableHeader();
      draw(String(index + 1), columns.number + 5, y - 11, 9);
      lines.forEach((line, lineIndex) => draw(line, columns.description, y - 11 - lineIndex * 12, lineIndex >= descLines.length ? 8 : 9, regular, lineIndex >= descLines.length ? muted : ink));
      draw(String(item.quantity), columns.qty, y - 11, 9);
      draw(pdfAmount(item.unit_price), columns.unit, y - 11, 8);
      draw(pdfAmount(item.amount), columns.amount, y - 11, 8);
      y -= rowHeight;
      page.drawLine({ start: { x: margin, y }, end: { x: page.getWidth() - margin, y }, thickness: 0.4, color: pale });
      y -= 8;
    }

    ensureSpace(90);
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
    totalRow(`Tax (${invoice.tax_rate}%)`, invoice.tax_amount);
    page.drawLine({ start: { x: totalsX, y: y + 7 }, end: { x: page.getWidth() - margin, y: y + 7 }, thickness: 1, color: accent });
    totalRow("Total", invoice.total, true);
    totalRow("Paid", invoice.amount_paid);
    totalRow("Balance due", invoice.balance_due, true);

    if (invoice.payments.length > 0) {
      ensureSpace(24 + invoice.payments.length * 14);
      y -= 4;
      draw("PAYMENTS RECEIVED", margin, y, 8, bold, muted);
      y -= 15;
      for (const payment of invoice.payments) {
        draw(`${fmtDate(payment.received_at)} | ${payment.payment_method.toUpperCase()} | ${payment.reference ?? "No reference"}`, margin, y, 8, regular, muted);
        draw(pdfAmount(payment.amount), 480, y, 8, regular, ink);
        y -= 13;
      }
    }

    if (invoice.notes) {
      const noteLines = wrap(`Notes: ${invoice.notes}`, page.getWidth() - margin * 2, 9);
      ensureSpace(noteLines.length * 13 + 20);
      y -= 5;
      for (const line of noteLines) { draw(line, margin, y, 9, regular, muted); y -= 13; }
    }
    draw(`Thank you for choosing ${TIRUPUR_CLINIC.brandName}.`, margin, margin - 5, 8, regular, muted);

    const bytes = await pdf.save({ useObjectStreams: true });
    const filename = `${safeFileName(invoice.invoice_number)}.pdf`;
    return new Response(bytes as BodyInit, {
      status: 200,
      headers: {
        ...privateHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
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
