import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/auth/context";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/data/db", () => ({ db: mocks }));
import { createInvoice, createConsultationInvoice, updateConsultationInvoice, computeInvoiceTotalWithDiscount, confirmInvoiceCarryForward } from "@/data/invoices";

const leadId = "c2500000-0000-4000-8000-000000000001";
const invoiceId = "c2500000-0000-4000-8000-000000000002";
const typeId = "c2500000-0000-4000-8000-000000000003";
const branchId = "c2500000-0000-4000-8000-000000000004";
const ctx = { userId: "c2500000-0000-4000-8000-000000000005", role: "operations", branchIds: [branchId],
  fullName: "Test Operations", email: "ops@example.test", doctorId: null } as unknown as AuthContext;
const doctors = { consulting_doctor_name: "Dr. Consultant", referring_doctor_name: "No referring doctor" };
function query(data: unknown) {
  const result = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), in: vi.fn(), maybeSingle: vi.fn(), then: vi.fn() };
  for (const method of ["select", "eq", "is", "in"] as const) result[method].mockReturnValue(result);
  result.maybeSingle.mockResolvedValue({ data, error: null });
  result.then.mockImplementation((resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data, error: null })));
  return result;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.rpc.mockResolvedValue({ data: { id: invoiceId, total: 0 }, error: null });
});

describe("zero invoice persistence", () => {
  const unpaidInvoice = (extra = {}) => ({ id: invoiceId, branch_id: branchId, lead: { assignee_id: ctx.userId },
    invoice_kind: "treatment", code_enforced: true, status: "draft", ...extra });

  it.each([0, 800])("confirms a bill of %s with no payment using only the read-only ledger", async (total) => {
    mocks.from.mockReturnValueOnce(query(unpaidInvoice({ total })));
    const balance = { amount_paid: "0", invoice_due: String(total), earlier_due: "200", later_due: "0", overall_due: String(200 + total), earlier_invoice_count: "1" };
    mocks.rpc.mockReturnValueOnce({ single: vi.fn().mockResolvedValue({ data: balance, error: null }) });
    expect(await confirmInvoiceCarryForward(ctx, invoiceId)).toEqual({ amount_paid: 0, invoice_due: total, earlier_due: 200, later_due: 0, overall_due: 200 + total, earlier_invoice_count: 1 });
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith("invoices");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("get_invoice_patient_balance", { p_invoice_id: invoiceId, p_actor: ctx.userId });
  });
  it("preserves earlier receipts on a partially paid invoice and confirms the current remaining balance", async () => {
    mocks.from.mockReturnValueOnce(query(unpaidInvoice({ total: 800, status: "sent" })));
    const balance = { amount_paid: 300, invoice_due: 500, earlier_due: 200, later_due: 50, overall_due: 750, earlier_invoice_count: 1 };
    mocks.rpc.mockReturnValueOnce({ single: vi.fn().mockResolvedValue({ data: balance, error: null }) });
    expect(await confirmInvoiceCarryForward(ctx, invoiceId)).toEqual(balance);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([
    { status: "paid" }, { status: "cancelled" }, { code_enforced: false }, { branch_id: "c2500000-0000-4000-8000-000000000099" },
  ])("does not confirm a locked or out-of-scope invoice %j", async (extra) => {
    mocks.from.mockReturnValueOnce(query(unpaidInvoice(extra)));
    await expect(confirmInvoiceCarryForward(ctx, invoiceId)).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires the front desk to have access to the assigned patient", async () => {
    mocks.from.mockReturnValueOnce(query(unpaidInvoice({ lead: { assignee_id: "another-staff" } })));
    await expect(confirmInvoiceCarryForward({ ...ctx, role: "front_office" }, invoiceId)).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not report success for a missing invoice or an unauthorized doctor", async () => {
    mocks.from.mockReturnValueOnce(query(null));
    await expect(confirmInvoiceCarryForward(ctx, invoiceId)).rejects.toThrow("not found");
    await expect(confirmInvoiceCarryForward({ ...ctx, role: "doctor" }, invoiceId)).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("sends zero-priced catalog items to the database without a receipt", async () => {
    mocks.from.mockReturnValueOnce(query({ branch_id: branchId, assignee_id: ctx.userId })).mockReturnValueOnce(query([{ id: typeId }]));
    const items = [{ treatment_type_id: typeId, quantity: 1, unit_price: 0 }];
    expect(await createInvoice(ctx, { lead_id: leadId, ...doctors, tax_rate: 0, items })).toMatchObject({ total: 0 });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("create_patient_invoice", expect.objectContaining({ p_items: [expect.objectContaining({ unit_price: 0 })] }));
  });
  it("sends an explicit zero consultation to the database", async () => {
    mocks.from.mockReturnValue(query({ branch_id: branchId, assignee_id: ctx.userId }));
    expect(await createConsultationInvoice(ctx, { lead_id: leadId, amount: 0, ...doctors })).toMatchObject({ total: 0 });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("create_consultation_invoice", expect.objectContaining({ p_amount: 0 }));
  });
  it("allows editing an unpaid consultation to zero within its edit window", async () => {
    mocks.from.mockReturnValue(query({ id: invoiceId, branch_id: branchId, lead: { assignee_id: ctx.userId }, invoice_kind: "consultation", status: "draft", discount_amount: 0, tax_rate: 0, created_at: new Date().toISOString() }));
    await updateConsultationInvoice(ctx, invoiceId, { amount: 0, invoice_date: "2026-10-06", expected_version: 1 });
    expect(mocks.rpc).toHaveBeenCalledWith("update_invoice_with_date", expect.objectContaining({
      p_invoice_date: "2026-10-06", p_expected_version: 1, p_items: [{ description: "Consultation", quantity: 1, unit_price: 0 }],
    }));
  });
  it("keeps a fully discounted invoice at zero even with tax", () => {
    expect(computeInvoiceTotalWithDiscount([{ treatment_type_id: typeId, quantity: 1, unit_price: 200 }], 18, 200)).toEqual({ subtotal: 200, tax_amount: 0, total: 0 });
  });
  it.each([-1, 0.001, NaN, Infinity])("rejects invalid consultation amount %s before writing", async (amount) => {
    await expect(createConsultationInvoice(ctx, { lead_id: leadId, amount, ...doctors })).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
