import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/context", () => ({ getAuthContext: vi.fn().mockResolvedValue({ userId: "staff-1", role: "operations" }) }));
vi.mock("@/lib/rate-limit", () => ({ assertActionRateLimit: vi.fn() }));
vi.mock("@/data/invoices", () => ({ createInvoice: vi.fn(), createConsultationInvoice: vi.fn(), updateInvoice: vi.fn(), updateConsultationInvoice: vi.fn(), recordInvoicePayment: vi.fn(), confirmInvoiceCarryForward: vi.fn() }));
import * as invoices from "@/data/invoices";
import { createInvoiceAction, createConsultationInvoiceAction, updateConsultationInvoiceAction, recordInvoicePaymentAction, confirmInvoiceCarryForwardAction } from "@/actions/invoices";
import { AuthorizationError } from "@/lib/errors";

const leadId = "c2500000-0000-4000-8000-000000000001";
const invoiceId = "c2500000-0000-4000-8000-000000000002";
const typeId = "c2500000-0000-4000-8000-000000000003";
const doctors = { consulting_doctor_name: "Dr. Consultant", referring_doctor_name: "No referring doctor" };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoices.createInvoice).mockResolvedValue({ id: invoiceId } as Awaited<ReturnType<typeof invoices.createInvoice>>);
  vi.mocked(invoices.createConsultationInvoice).mockResolvedValue({ id: invoiceId } as Awaited<ReturnType<typeof invoices.createConsultationInvoice>>);
});

describe("zero invoice action validation", () => {
  it("creates an invoice with only the consulting doctor and keeps the database compatibility default", async () => {
    expect(await createInvoiceAction({ lead_id: leadId, consulting_doctor_name: "Dr. Consultant", items: [{ treatment_type_id: typeId, quantity: 1, unit_price: 200 }] })).toEqual({ ok: true, id: invoiceId });
    expect(invoices.createInvoice).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ referring_doctor_name: "No referring doctor" }));
  });
  it("confirms zero received using the saved ledger balance without recording a payment", async () => {
    const balance = { amount_paid: 0, invoice_due: 800, earlier_due: 200, later_due: 0, overall_due: 1000, earlier_invoice_count: 1 };
    vi.mocked(invoices.confirmInvoiceCarryForward).mockResolvedValueOnce(balance);
    expect(await confirmInvoiceCarryForwardAction(invoiceId)).toEqual({ ok: true, balance });
    expect(invoices.confirmInvoiceCarryForward).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ role: "operations" }), invoiceId);
    expect(invoices.recordInvoicePayment).not.toHaveBeenCalled();
  });
  it("rejects an invalid invoice before confirming the carry forward", async () => {
    expect(await confirmInvoiceCarryForwardAction("invalid")).toEqual({ ok: false, error: "Invoice is invalid" });
    expect(invoices.confirmInvoiceCarryForward).not.toHaveBeenCalled();
  });
  it("returns an authorization error instead of claiming a balance was carried forward", async () => {
    vi.mocked(invoices.confirmInvoiceCarryForward).mockRejectedValueOnce(new AuthorizationError("No invoice access"));
    expect(await confirmInvoiceCarryForwardAction(invoiceId)).toEqual({ ok: false, error: "No invoice access" });
  });
  it("saves zero-priced treatment lines with tooth details", async () => {
    const items = [{ treatment_type_id: typeId, quantity: 1, unit_price: 0, tooth_numbers: ["18", "17"] }];
    expect(await createInvoiceAction({ lead_id: leadId, ...doctors, items })).toEqual({ ok: true, id: invoiceId });
    expect(invoices.createInvoice).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ items }));
  });
  it("saves a complimentary consultation and allows editing its amount to zero", async () => {
    expect(await createConsultationInvoiceAction({ lead_id: leadId, amount: "0", ...doctors })).toEqual({ ok: true, id: invoiceId });
    expect(invoices.createConsultationInvoice).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ amount: 0 }));
    expect(await updateConsultationInvoiceAction(invoiceId, { amount: "0", expected_version: 1 })).toEqual({ ok: true });
    expect(invoices.updateConsultationInvoice).toHaveBeenCalledWith(expect.anything(), invoiceId, expect.objectContaining({ amount: 0 }));
  });
  it.each([-1, 0.001, Infinity, NaN, "", " ", null])("still rejects invalid consultation amount %s", async (amount) => {
    expect(await createConsultationInvoiceAction({ lead_id: leadId, amount, ...doctors })).toMatchObject({ ok: false });
    expect(invoices.createConsultationInvoice).not.toHaveBeenCalled();
  });
  it("still requires a treatment line and refuses zero-valued receipts", async () => {
    expect(await createInvoiceAction({ lead_id: leadId, ...doctors, items: [] })).toMatchObject({ ok: false });
    expect(await recordInvoicePaymentAction(invoiceId, { amount: 0, method: "cash" })).toMatchObject({ ok: false });
    expect(invoices.createInvoice).not.toHaveBeenCalled();
    expect(invoices.recordInvoicePayment).not.toHaveBeenCalled();
  });
});
