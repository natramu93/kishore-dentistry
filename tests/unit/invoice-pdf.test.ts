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

function pageOperators(pdf: PDFDocument, page: PDFPage): string {
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
  return streams.flatMap((reference) => {
    const stream = pdf.context.lookup(reference);
    if (!(stream instanceof PDFRawStream)) return [];
    return Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
  }).join("\n");
}

function pageText(pdf: PDFDocument, page: PDFPage): string {
  return [...pageOperators(pdf, page).matchAll(/<([0-9a-f]+)>/gi)]
    .map((match) => Buffer.from(match[1], "hex").toString("latin1")).join(" ");
}

function expectSingleA4(pdf: PDFDocument) {
  expect(pdf.getPageCount()).toBe(1);
  const page = pdf.getPage(0);
  expect(page.getSize()).toEqual({ width: 595.28, height: 841.89 });
  expect(pageText(pdf, page)).toContain("Page 1 of 1");
  // All text baselines must stay within the one physical page, including the
  // last notes and receipts after automatic compression.
  const positions = [...pageOperators(pdf, page).matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)];
  expect(positions.length).toBeGreaterThan(0);
  for (const [, x, y] of positions) {
    expect(Number(x)).toBeGreaterThanOrEqual(32);
    expect(Number(x)).toBeLessThan(595.28 - 32);
    expect(Number(y)).toBeGreaterThanOrEqual(25);
    expect(Number(y)).toBeLessThanOrEqual(841.89 - 32);
  }
}

describe("downloadable invoice PDF", () => {
  it("does not generate a payable document for voided invoices", async () => {
    vi.mocked(getInvoice).mockResolvedValueOnce({ id: "voided", code_enforced: true, status: "cancelled" } as
      NonNullable<Awaited<ReturnType<typeof getInvoice>>>);
    const response = await GET(new Request("http://localhost/api/invoices/voided/pdf"), { params: Promise.resolve({ id: "voided" }) });
    expect(response.status).toBe(404);
  });

  it("keeps the selected date, doctors, teeth, words and all 70 receipts on one A4 page", async () => {
    vi.mocked(getInvoice).mockResolvedValue({ id: "invoice-1", invoice_number: "TEST-001", code_enforced: true,
      invoice_date: "2026-08-01", created_at: "2026-10-01T00:00:00Z", issued_at: "2026-10-01T00:00:00Z",
      consulting_doctor_name: "Dr. Test Doctor", referring_doctor_name: "Dr. Referrer", status: "sent", issuer_name: "Test Dentistry", issuer_address: null,
      issuer_phone: null, issuer_email: null, issuer_gst_number: null, branch: null, lead: { name: "Synthetic Patient" },
      items: [{ id: "line-1", description: "Filling", tooth_numbers: ["18", "17", "16"], quantity: 1, unit_price: 1000, amount: 1000 }],
      subtotal: 1000, discount_amount: 0, tax_rate: 0, tax_amount: 0, total: 1000, amount_paid: 400, balance_due: 600,
      patient_balance: { amount_paid: 400, invoice_due: 600, earlier_due: 1250, later_due: 0, overall_due: 1850, earlier_invoice_count: 2 },
      payments: Array.from({ length: 70 }, (_, i) => ({ amount: 5, payment_method: ["upi", "cash", "card", "neft"][i % 4], received_at: "2026-10-01T00:00:00Z", reference: `REF-${i}` })),
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
    expectSingleA4(pdf);
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
    for (let index = 0; index < 70; index++) expect(text).toContain(`REF-${index}`);
    for (const method of ["UPI", "CASH", "CARD", "NEFT"]) expect(text).toContain(method);
  });

  it("uses compact typography to keep a full 13-line invoice and letterhead on one A4 page", async () => {
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
    expectSingleA4(pdf);
    for (const page of pdf.getPages()) {
      expect(pageText(pdf, page)).toContain("GSTIN: 33AAKCD3028Q1ZD");
      expect(pageText(pdf, page)).toContain("PREVIEW-013");
      expect(pageText(pdf, page)).toContain("Phone: 9361135459");
    }
    expect(pageText(pdf, pdf.getPage(0))).toContain("Treatment / teeth / notes");
    expect(pdf.getPages().map((page) => pageText(pdf, page)).join(" ")).toContain("Restoration treatment 13");
    if (process.env.INVOICE_PDF_PREVIEW_DIR) writeFileSync(path.join(process.env.INVOICE_PDF_PREVIEW_DIR, "thirteen-line-invoice.pdf"), Buffer.from(bytes));
  });

  it.each([35, 150])("automatically compresses %i detailed lines without clipping or omitting the final item", async (count) => {
    vi.mocked(getInvoice).mockResolvedValue({ id: "long-invoice", invoice_number: `LONG-${count}`, code_enforced: true,
      invoice_date: "2026-10-27", created_at: "2026-10-27T09:00:00Z", status: "sent", issuer_name: "Synthetic Dentistry",
      issuer_address: "A synthetic clinic address for a long invoice layout test.", issuer_phone: "9000000000",
      issuer_email: "clinic@example.test", issuer_gst_number: "TEST-GST", branch: null,
      lead: { name: "Synthetic Patient", mobile: "9000000000", email: "patient@example.test" },
      referring_doctor_name: "Dr. Referring", consulting_doctor_name: "Dr. Consulting",
      items: Array.from({ length: count }, (_, index) => ({ id: `long-line-${index}`, description: `Treatment ${index + 1}`,
        tooth_numbers: ["18", "17", "16"], surfaces: ["mesial", "occlusal"], quantity: 1, unit_price: 99999999, amount: 99999999,
        line_note: `LINE-${index + 1}-START ${"unbrokentext".repeat(80)} LINE-${index + 1}-END` })),
      subtotal: 99999999, discount_amount: 100, discount_given_by: "Dr. Discount Approver ".repeat(8), tax_rate: 18,
      tax_amount: 100, total: 99999999, amount_paid: 400, balance_due: 99999599,
      patient_balance: { amount_paid: 400, invoice_due: 99999599, earlier_due: 1250, later_due: 600, overall_due: 100001449, earlier_invoice_count: 2 },
      payments: [{ amount: 400, payment_method: "neft", received_at: "2026-10-27T09:00:00Z", reference: "FINAL-PAYMENT" }],
      notes: "Invoice note ".repeat(50) + "FINAL-NOTE", mention: "FINAL-MENTION",
    } as unknown as NonNullable<Awaited<ReturnType<typeof getInvoice>>>);
    const response = await GET(new Request("http://localhost/invoice?inline=1"), { params: Promise.resolve({ id: "long-invoice" }) });
    expect(response.status).toBe(200);
    const bytes = await response.arrayBuffer();
    const pdf = await PDFDocument.load(bytes);
    expectSingleA4(pdf);
    const text = pageText(pdf, pdf.getPage(0));
    for (let index = 1; index <= count; index++) {
      expect(text).toContain(`Treatment ${index}`);
      expect(text).toContain(`LINE-${index}-END`);
    }
    for (const detail of ["FINAL-PAYMENT", "FINAL-NOTE", "FINAL-MENTION", "Newer unpaid bills", "Overall patient due", "Surfaces: mesial, occlusal"]) expect(text).toContain(detail);
    const fontSizes = [...pageOperators(pdf, pdf.getPage(0)).matchAll(/\/[^\s]+ ([\d.]+) Tf/g)].map((match) => Number(match[1]));
    expect(Math.max(...fontSizes)).toBeLessThan(16);
    if (process.env.INVOICE_PDF_PREVIEW_DIR) writeFileSync(path.join(process.env.INVOICE_PDF_PREVIEW_DIR, `compressed-${count}-line-invoice.pdf`), Buffer.from(bytes));
  });

  it.each([false, true])("fits zero-value invoices with long branch and patient details: %s", async (longDetails) => {
    vi.mocked(getInvoice).mockResolvedValue({ id: "zero-invoice", invoice_number: "ZERO-001", invoice_kind: "consultation", code_enforced: false,
      invoice_date: "2026-10-27", created_at: "2026-10-27T09:00:00Z", status: "paid",
      issuer_name: "Synthetic Dentistry ".repeat(longDetails ? 20 : 1),
      issuer_address: "Synthetic branch address ".repeat(longDetails ? 150 : 1) + "ADDRESS-END",
      issuer_phone: "9000000000", issuer_email: "clinic@example.test", issuer_gst_number: "TEST-GST", branch: null,
      lead: { name: "Synthetic Patient ".repeat(longDetails ? 20 : 1) + "PATIENT-END", mobile: "9000000000", email: "patient@example.test" },
      referring_doctor_name: "Dr. Referring ".repeat(longDetails ? 15 : 1) + "REFERRER-END",
      consulting_doctor_name: "Dr. Consulting ".repeat(longDetails ? 15 : 1) + "CONSULTANT-END",
      items: [{ id: "zero-item", description: "General consultation", quantity: 1, unit_price: 0, amount: 0 }],
      subtotal: 0, discount_amount: 0, tax_rate: 0, tax_amount: 0, total: 0, amount_paid: 0, balance_due: 0,
      patient_balance: { amount_paid: 0, invoice_due: 0, earlier_due: 0, later_due: 0, overall_due: 0, earlier_invoice_count: 0 }, payments: [],
    } as unknown as NonNullable<Awaited<ReturnType<typeof getInvoice>>>);
    const response = await GET(new Request("http://localhost/invoice"), { params: Promise.resolve({ id: "zero-invoice" }) });
    expect(response.status).toBe(200);
    const pdf = await PDFDocument.load(await response.arrayBuffer());
    expectSingleA4(pdf);
    const text = pageText(pdf, pdf.getPage(0));
    for (const detail of ["ADDRESS-END", "PATIENT-END", "REFERRER-END", "CONSULTANT-END", "General consultation", "Zero Rupees Only", "INR 0.00"]) expect(text).toContain(detail);
  });
});
