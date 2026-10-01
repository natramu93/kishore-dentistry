// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { GET } from "@/app/api/invoices/[id]/pdf/route";
import { getInvoice } from "@/data/invoices";

vi.mock("@/lib/auth/context", () => ({ getAuthContext: vi.fn().mockResolvedValue({ userId: "staff-1" }) }));
vi.mock("@/lib/rate-limit", () => ({ assertActionRateLimit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/data/invoices", () => ({ getInvoice: vi.fn() }));

describe("downloadable invoice PDF", () => {
  it("includes the selected date, doctor, every tooth and received amount in words across receipt pages", async () => {
    vi.mocked(getInvoice).mockResolvedValue({ id: "invoice-1", invoice_number: "TEST-001", code_enforced: true,
      invoice_date: "2026-08-01", created_at: "2026-10-01T00:00:00Z", issued_at: "2026-10-01T00:00:00Z",
      consulting_doctor_name: "Dr. Test Doctor", status: "sent", issuer_name: "Test Dentistry", issuer_address: null,
      issuer_phone: null, issuer_email: null, issuer_gst_number: null, branch: null, lead: { name: "Synthetic Patient" },
      items: [{ id: "line-1", description: "Filling", tooth_numbers: ["18", "17", "16"], quantity: 1, unit_price: 1000, amount: 1000 }],
      subtotal: 1000, discount_amount: 0, tax_rate: 0, tax_amount: 0, total: 1000, amount_paid: 400, balance_due: 600,
      payments: Array.from({ length: 70 }, (_, i) => ({ amount: 5, payment_method: "upi", received_at: "2026-10-01T00:00:00Z", reference: `REF-${i}` })),
    } as unknown as NonNullable<Awaited<ReturnType<typeof getInvoice>>>);
    const result = await GET(new Request("http://localhost/api/invoices/invoice-1/pdf"), { params: Promise.resolve({ id: "invoice-1" }) });
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toContain("no-store");
    const pdf = await PDFDocument.load(await result.arrayBuffer());
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    const text = pdf.context.enumerateIndirectObjects().filter((entry) => entry[1] instanceof PDFRawStream)
      .flatMap(([, stream]) => {
        const content = Buffer.from(decodePDFRawStream(stream as PDFRawStream).decode()).toString("latin1");
        return [...content.matchAll(/<([0-9a-f]+)>/gi)].map((match) => Buffer.from(match[1], "hex").toString("latin1"));
      }).join(" ");
    expect(text).toContain("Date: 1 Aug 2026");
    expect(text).toContain("Consulting doctor: Dr. Test Doctor");
    expect(text).toContain("Teeth (IS 8815): 18, 17, 16");
    expect(text).toContain("Received amount in words: Four Hundred Rupees Only");
    expect(text).toContain("REF-69");
  });
});
