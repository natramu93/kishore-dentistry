import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/auth/context";
import { listLegacyPatientBills } from "@/data/legacy-patient-bills";

const mock = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/data/db", () => ({ db: mock }));
vi.mock("server-only", () => ({}));

const leadId = "ebfc9d87-2d53-41d6-8def-6588de8db882";
const home = "patient-center";
const issuer = "bill-center";
const scoped = { id: leadId, branch_id: home, assignee_id: "staff" };
const billQuery = {
  select: vi.fn<(fields: string, options: { count: string }) => unknown>().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(), range: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
};
const ctx = (role: AuthContext["role"], branchIds: string[]) =>
  ({ role, branchIds, userId: "staff", fullName: "Synthetic Staff", email: "staff@example.test", doctorId: "doctor" }) as unknown as AuthContext;

beforeEach(() => {
  vi.clearAllMocks();
  mock.from.mockImplementation((table: string) => {
    if (table === "legacy_patient_bills") return billQuery;
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: table === "leads" ? scoped : { id: "assigned-visit" }, error: null }) };
    return query;
  });
});

describe("cross-center historical bill scope", () => {
  it("queries the existing chart and limits scoped staff to allowed issuing centers", async () => {
    await listLegacyPatientBills(ctx("operations", [home, issuer]), leadId);
    expect(billQuery.eq).toHaveBeenCalledWith("lead_id", leadId);
    expect(billQuery.eq).toHaveBeenCalledWith("patient_branch_id", home);
    expect(billQuery.in).toHaveBeenCalledWith("branch_id", [home, issuer]);
    expect(billQuery.order).toHaveBeenLastCalledWith("branch_id");
  });

  it("does not let billing-center access override patient-chart access", async () => {
    await expect(listLegacyPatientBills(ctx("operations", [issuer]), leadId)).rejects.toThrow("No access to patient billing history");
    expect(mock.from).not.toHaveBeenCalledWith("legacy_patient_bills");
  });

  it("is global for admins and strips financial fields for doctors", async () => {
    await listLegacyPatientBills(ctx("admin", []), leadId);
    expect(billQuery.in).not.toHaveBeenCalled();
    expect(billQuery.select.mock.calls[0][0]).toContain("net_paise");
    billQuery.select.mockClear();
    await listLegacyPatientBills(ctx("doctor", [home]), leadId);
    expect(billQuery.in).toHaveBeenCalledWith("branch_id", [home]);
    expect(billQuery.select.mock.calls[0][0]).not.toMatch(/paise|service_lines/);
  });
});
