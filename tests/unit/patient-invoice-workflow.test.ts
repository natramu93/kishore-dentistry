import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/auth/context";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/data/db", () => ({ db: mocks }));
import { getLeadRelated } from "@/data/leads";
import { listInvoices } from "@/data/invoices";

const leadId = "20000000-0000-4000-8000-000000000001";
const branchId = "20000000-0000-4000-8000-000000000002";
const userId = "20000000-0000-4000-8000-000000000003";
const context = (role: AuthContext["role"] = "front_office") => ({
  role, userId, branchIds: [branchId], fullName: "Test staff", email: "staff@example.test", doctorId: null,
}) as unknown as AuthContext;

function chain(result: { data: unknown; error: unknown; count?: number }) {
  const query = {
    select: vi.fn(), eq: vi.fn(), is: vi.fn(), in: vi.fn(), or: vi.fn(), order: vi.fn(),
    limit: vi.fn().mockResolvedValue(result), maybeSingle: vi.fn().mockResolvedValue(result),
    range: vi.fn().mockResolvedValue(result),
  };
  for (const key of ["select", "eq", "is", "in", "or", "order"] as const) query[key].mockReturnValue(query);
  return query;
}
beforeEach(() => vi.resetAllMocks());

describe("patient invoice history", () => {
  it("uses exact totals rather than summing a capped preview, with no debt for cancelled rows", async () => {
    const lead = chain({ data: { id: leadId, branch_id: branchId, assignee_id: userId }, error: null });
    const empty = () => chain({ data: [], error: null });
    const invoices = chain({ data: [
      { id: "cancelled", status: "cancelled", total: 200, payments: [] },
      { id: "partial", status: "sent", total: 200, payments: [{ amount: 40 }, { amount: 60 }] },
    ], error: null, count: 225 });
    mocks.from.mockReturnValueOnce(lead).mockReturnValueOnce(empty()).mockReturnValueOnce(empty())
      .mockReturnValueOnce(empty()).mockReturnValueOnce(invoices).mockReturnValueOnce(empty());
    const summary = { invoice_count: 224, total_invoiced: 15000, amount_paid: 4000, balance_due: 11000 };
    mocks.rpc.mockReturnValue({ single: vi.fn().mockResolvedValue({ data: summary, error: null }) });
    const result = await getLeadRelated(context(), leadId);
    expect(result?.invoiceSummary).toEqual(summary);
    expect(result?.invoiceTotal).toBe(225);
    expect(result?.invoices[0]?.balance_due).toBe(0);
    expect(result?.invoices[1]?.amount_paid).toBe(100);
    expect(result?.invoices[1]?.balance_due).toBe(100);
    expect(mocks.rpc).toHaveBeenCalledWith("get_patient_invoice_summary", { p_lead_id: leadId, p_actor: userId });
    expect(invoices.select).toHaveBeenCalledWith(expect.any(String), { count: "exact" });
  });

  it.each(["doctor", "front_office"] as const)("does not load financial details for an unauthorized %s", async (role) => {
    mocks.from.mockReturnValue(chain({ data: { id: leadId, branch_id: branchId, assignee_id: "another-user" }, error: null }));
    expect(await getLeadRelated(context(role), leadId)).toBeNull();
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps patient filtering inside the existing branch and front-desk access scope", async () => {
    const query = chain({ data: [], error: null, count: 0 });
    mocks.from.mockReturnValue(query);
    await listInvoices(context(), { leadId, page: 2, pageSize: 20 });
    expect(query.eq).toHaveBeenCalledWith("lead_id", leadId);
    expect(query.in).toHaveBeenCalledWith("branch_id", [branchId]);
    expect(query.or).toHaveBeenCalledWith(`assignee_id.eq.${userId},assignee_id.is.null`, { referencedTable: "lead" });
    expect(query.range).toHaveBeenCalledWith(20, 39);
  });
});
