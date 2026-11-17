import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/auth/context";
import { getReportsData } from "@/data/reports";
import { clinicDayRange } from "@/lib/tz";

vi.mock("server-only", () => ({}));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/data/db", () => ({ db: { rpc } }));

describe("report revenue", () => {
  it("counts only receipts in the selected clinic date range, separately from invoiced value", async () => {
    const actor = "c3300000-0000-4000-8000-000000000001";
    const branch = "c3300000-0000-4000-8000-000000000002";
    const ctx = { role: "admin", userId: actor } as AuthContext;
    const receiptDay = "2026-11-15";
    const { start, end } = clinicDayRange(receiptDay);
    rpc.mockImplementation((name: string) => {
      const data = name === "get_report_aggregates"
        ? [{ by_doctor: [], by_center: [], by_day: [], by_treatment: [], totals: { leads: 2, appointments: 1, followUps: 0, revenue: 900 } }]
        : name === "get_report_payment_collections"
          ? [{ day: receiptDay, amount: 40, method: "cash" }, { day: receiptDay, amount: 60, method: "upi" }]
          : { rows: ["doctor", "center", "day", "month", "category", "treatment"].map((dimension) => ({
            dimension, key: dimension, label: dimension, invoices: 1, value: 500,
          })), subtotal: 500, discounts: 50, tax: 0, net: 450, invoices: 1 };
      return Promise.resolve({ data, error: null });
    });

    const report = await getReportsData(ctx, { from: start, to: end, branchId: branch });
    expect(rpc).toHaveBeenCalledWith("get_report_payment_collections", {
      p_actor: actor, p_from: "2026-11-14T18:30:00.000Z", p_to: "2026-11-15T18:30:00.000Z", p_branch_id: branch,
    });
    expect(report.totals.revenue).toBe(100);
    expect(report.collections.byDay).toEqual([expect.objectContaining({ key: receiptDay, amount: 100, cash: 40, upi: 60 })]);
    expect(report.collections.byMonth).toEqual([expect.objectContaining({ key: "2026-11", amount: 100 })]);
    expect(report.invoiceValues).toMatchObject({ subtotal: 500, net: 450 });
  });
});
