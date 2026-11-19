import { beforeEach, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/auth/context";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), auth: vi.fn(), limit: vi.fn() }));
vi.mock("@/data/db", () => ({ db: { rpc: mocks.rpc } }));
vi.mock("@/lib/auth/context", () => ({ getAuthContext: mocks.auth }));
vi.mock("@/lib/rate-limit", () => ({ assertActionRateLimit: mocks.limit }));
import { financeDetailsAction } from "@/actions/finance-details";

const userId = "c3400000-0000-4000-8000-000000000001";
const branchId = "c3400000-0000-4000-8000-000000000002";
const context = (role: AuthContext["role"] = "admin") => ({
  role, userId, branchIds: [branchId], fullName: "Test", email: "staff@example.test", doctorId: null,
}) as unknown as AuthContext;
const input = { filters: { from: "2026-11-19", to: "2026-11-19", branch: branchId, method: "upi" },
  source: "reports", metric: "receipts", page: 2 };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(context());
  mocks.rpc.mockResolvedValue({ data: { rows: [], total: 0, amount: 0 }, error: null });
});

it("uses the authenticated actor and validated filters, ignoring caller-supplied identity", async () => {
  expect(await financeDetailsAction({ ...input, actor: "another-user" })).toEqual({ ok: true, details: { rows: [], total: 0, amount: 0 } });
  expect(mocks.rpc).toHaveBeenCalledWith("get_finance_details", {
    p_actor: userId, p_filters: input.filters, p_source: "reports", p_metric: "receipts", p_page: 2, p_page_size: 100,
  });
  expect(mocks.limit).toHaveBeenCalledWith(userId, "finance-details", { limit: 90, windowMs: 60000 });
});

it.each(["doctor", "front_office"] as const)("rejects report financial details for %s", async (role) => {
  mocks.auth.mockResolvedValue(context(role));
  expect(await financeDetailsAction(input)).toMatchObject({ ok: false });
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("allows front desk invoice collections through the independently scoped database request", async () => {
  mocks.auth.mockResolvedValue(context("front_office"));
  expect(await financeDetailsAction({ ...input, source: "invoices" })).toMatchObject({ ok: true });
  expect(mocks.rpc).toHaveBeenCalledWith("get_finance_details", expect.objectContaining({ p_actor: userId, p_source: "invoices" }));
});

it.each([
  { ...input, page: 0 }, { ...input, page: 100001 },
  { ...input, filters: { ...input.filters, to: "2026-11-18" } },
  { ...input, filters: { ...input.filters, method: "other" } },
  { ...input, filters: { ...input.filters, branch: "invalid" } },
])("rejects invalid finance detail requests before querying", async (invalid) => {
  expect(await financeDetailsAction(invalid)).toMatchObject({ ok: false, error: "Choose valid finance detail filters" });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
