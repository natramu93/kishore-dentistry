// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream, type PDFPage } from "pdf-lib";
import { GET } from "@/app/api/invoices/[id]/pdf/route";
import { getInvoice } from "@/data/invoices";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/auth/context", () => ({ getAuthContext: vi.fn().mockResolvedValue({ userId: "staff-1" }) }));
vi.mock("@/lib/rate-limit", () => ({ assertActionRateLimit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/data/invoices", () => ({ getInvoice: vi.fn() }));

function pageText(pdf: PDFDocument, page: PDFPage): string {
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
  return streams.flatMap((reference) => {
    const stream = pdf.context.lookup(reference);
    if (!(stream instanceof PDFRawStream)) return [];
    const content = Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
    return [...content.matchAll(/<([0-9a-f]+)>/gi)].map((match) => Buffer.from(match[1], "hex").toString("latin1"));
  }).join(" ");
}

describe("downloadable invoice PDF", () => {
  it("includes the selected date, doctor, every tooth and received amount in words across receipt pages", async () => {
    vi.mocked(getInvoice).mockResolvedValue({ id: "invoice-1", invoice_number: "TEST-001", code_enforced: true,
      invoice_date: "2026-08-01", created_at: "2026-10-01T00:00:00Z", issued_at: "2026-10-01T00:00:00Z",
      consulting_doctor_name: "Dr. Test Doctor", referring_doctor_name: "Dr. Referrer", status: "sent", issuer_name: "Test Dentistry", issuer_address: null,
      issuer_phone: null, issuer_email: null, issuer_gst_number: null, branch: null, lead: { name: "Synthetic Patient" },
      items: [{ id: "line-1", description: "Filling", tooth_numbers: ["18", "17", "16"], quantity: 1, unit_price: 1000, amount: 1000 }],
      subtotal: 1000, discount_amount: 0, tax_rate: 0, tax_amount: 0, total: 1000, amount_paid: 400, balance_due: 600,
      patient_balance: { amount_paid: 400, invoice_due: 600, earlier_due: 1250, later_due: 0, overall_due: 1850, earlier_invoice_count: 2 },
      payments: Array.from({ length: 70 }, (_, i) => ({ amount: 5, payment_method: "upi", received_at: "2026-10-01T00:00:00Z", reference: `REF-${i}` })),
    } as unknown as NonNullable<Awaited<ReturnType<typeof getInvoice>>>);
    const result = await GET(new Request("http://localhost/api/invoices/invoice-1/pdf"), { params: Promise.resolve({ id: "invoice-1" }) });
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toContain("no-store");
    expect(result.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(result.headers.get("Content-Security-Policy")).toContain("sandbox");
    const bytes = await result.arrayBuffer();
    if (process.env.INVOICE_PDF_PREVIEW_DIR) {
      mkdirSync(process.env.INVOICE_PDF_PREVIEW_DIR, { recursive: true });
      writeFileSync(path.join(process.env.INVOICE_PDF_PREVIEW_DIR, "patient-balance-invoice.pdf"), Buffer.from(bytes));
    }
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    for (const [index, page] of pdf.getPages().entries()) {
      const content = pageText(pdf, page);
      expect(content).toContain("Test Dentistry");
      expect(content).toContain("TEST-001");
      expect(content).toContain("Date: 1 Aug 2026");
      expect(content).toContain(`Page ${index + 1} of ${pdf.getPageCount()}`);
      expect(page.getSize()).toEqual({ width: 595.28, height: 841.89 });
    }
    const text = pdf.context.enumerateIndirectObjects().filter((entry) => entry[1] instanceof PDFRawStream)
      .flatMap(([, stream]) => {
        const content = Buffer.from(decodePDFRawStream(stream as PDFRawStream).decode()).toString("latin1");
        return [...content.matchAll(/<([0-9a-f]+)>/gi)].map((match) => Buffer.from(match[1], "hex").toString("latin1"));
      }).join(" ");
    expect(text).toContain("Date: 1 Aug 2026");
    expect(text).toContain("Consulting doctor: Dr. Test Doctor");
    expect(text).toContain("Referring doctor: Dr. Referrer");
    expect(text).toContain("Teeth (IS 8815): 18, 17, 16");
    expect(text).toContain("Received amount in words: Four Hundred Rupees Only");
    expect(text).toContain("PATIENT OUTSTANDING BALANCE");
    expect(text).toContain("Earlier unpaid bills (2)");
    expect(text).toContain("INR 1,250.00");
    expect(text).toContain("Overall patient due");
    expect(text).toContain("INR 1,850.00");
    expect(text).toContain("REF-69");
  });

  it("repeats the full letterhead and item headings for a 13-line A4 invoice", async () => {
    const invoice = {
      id: "synthetic-invoice", invoice_number: "PREVIEW-013", invoice_date: "2026-10-27", code_enforced: true,
      created_at: "2026-10-27T09:00:00Z", status: "sent", issuer_name: "Dr. KISHOR'S DENTISTRY PVT LTD.,",
      issuer_address: "No. 541, 543/338-34, Tirupur Aadhar Hospital 1st Floor, Opp to KR Bakes, Avinashi Road, Tirupur - 641 602.",
      issuer_phone: "9361135459", issuer_email: "drkishorsdentistry@gmail.com", issuer_gst_number: "33AAKCD3028Q1ZD",
      branch: null, lead: { name: "Synthetic Patient", mobile: "9000000000" },
      consulting_doctor_name: "Dr. Preview", referring_doctor_name: "No referring doctor",
      items: Array.from({ length: 13 }, (_, index) => ({ id: `line-${index}`, description: `Restoration treatment ${index + 1}`,
        tooth_numbers: ["18", "17", "16"], quantity: 1, unit_price: 1000, amount: 1000, line_note: "Synthetic visit note for printing." })),
      subtotal: 13000, discount_amount: 0, tax_rate: 0, tax_amount: 0, total: 13000, amount_paid: 0, balance_due: 13000,
      patient_balance: { amount_paid: 0, invoice_due: 13000, earlier_due: 0, later_due: 0, overall_due: 13000, earlier_invoice_count: 0 }, payments: [],
    } as unknown as NonNullable<Awaited<ReturnType<typeof getInvoice>>>;
    vi.mocked(getInvoice).mockResolvedValue(invoice);
    const response = await GET(new Request("http://localhost/invoice?inline=1"), { params: Promise.resolve({ id: "synthetic-invoice" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toMatch(/^inline;/);
    expect(response.headers.get("Cache-Control")).toContain("private, no-store");
    expect(response.headers.get("Content-Security-Policy")).not.toContain("sandbox");
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    const bytes = await response.arrayBuffer();
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2);
    for (const page of pdf.getPages()) {
      expect(pageText(pdf, page)).toContain("GSTIN: 33AAKCD3028Q1ZD");
      expect(pageText(pdf, page)).toContain("PREVIEW-013");
      expect(pageText(pdf, page)).toContain("Phone: 9361135459");
    }
    expect(pageText(pdf, pdf.getPage(1))).toContain("Description");
    expect(pdf.getPages().map((page) => pageText(pdf, page)).join(" ")).toContain("Restoration treatment 13");
    if (process.env.INVOICE_PDF_PREVIEW_DIR) writeFileSync(path.join(process.env.INVOICE_PDF_PREVIEW_DIR, "thirteen-line-invoice.pdf"), Buffer.from(bytes));
  });
});
