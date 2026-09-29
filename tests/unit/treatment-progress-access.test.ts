import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/auth/context";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/data/db", () => ({ db: { from: mocks.from } }));
import { getPatientTreatmentProgress, TREATMENT_PROGRESS_LIMIT } from "@/data/treatment-progress";

const leadId = "10000000-0000-4000-8000-000000000001";
const branchId = "10000000-0000-4000-8000-000000000002";
const userId = "10000000-0000-4000-8000-000000000003";
function context(role: AuthContext["role"]): AuthContext {
  return { role, userId, branchIds: [branchId], doctorId: role === "doctor" ? "doctor-id" : null } as unknown as AuthContext;
}

function chain(result: { data: unknown; error: unknown; count?: number }) {
  const query = {
    select: vi.fn(), eq: vi.fn(), is: vi.fn(), in: vi.fn(), limit: vi.fn(), order: vi.fn(),
    range: vi.fn().mockResolvedValue(result), maybeSingle: vi.fn().mockResolvedValue(result),
  };
  for (const key of ["select", "eq", "is", "in", "limit", "order"] as const) query[key].mockReturnValue(query);
  return query;
}

beforeEach(() => vi.clearAllMocks());

describe("patient treatment progress access", () => {
  it.each(["operations", "front_office", "clinical_head", "admin"] as const)("loads independently counted planned/completed history for %s", async (role) => {
    const lead = chain({ data: { branch_id: branchId, assignee_id: userId }, error: null });
    const planned = chain({ data: [], error: null, count: 130 });
    const completed = chain({ data: [], error: null, count: 15 });
    mocks.from.mockReturnValueOnce(lead).mockReturnValueOnce(planned).mockReturnValueOnce(completed);
    const result = await getPatientTreatmentProgress(context(role), leadId);
    expect(result.planned.total).toBe(130);
    expect(result.completed.total).toBe(15);
    expect(planned.select).toHaveBeenCalledWith(expect.not.stringMatching(/mobile|email|invoices/), { count: "exact" });
    expect(planned.eq).toHaveBeenCalledWith("lead_id", leadId);
    expect(planned.eq).toHaveBeenCalledWith("branch_id", branchId);
    expect(planned.eq).toHaveBeenCalledWith("is_pending", true);
    expect(mocks.from).toHaveBeenCalledWith("clinical_treatment_progress");
    expect(planned.range).toHaveBeenCalledWith(0, TREATMENT_PROGRESS_LIMIT - 1);
    expect(completed.eq).toHaveBeenCalledWith("clinical_status", "completed");
  });

  it("denies a front desk user's access to another assignee's records", async () => {
    mocks.from.mockReturnValue(chain({ data: { branch_id: branchId, assignee_id: "other-user" }, error: null }));
    await expect(getPatientTreatmentProgress(context("front_office"), leadId)).rejects.toThrow("Patient");
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("denies a doctor without a patient relationship before loading clinical narrative", async () => {
    mocks.from.mockReturnValueOnce(chain({ data: { branch_id: branchId, assignee_id: userId }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }));
    await expect(getPatientTreatmentProgress(context("doctor"), leadId)).rejects.toThrow("Patient history");
    expect(mocks.from).toHaveBeenCalledTimes(3);
  });

  it("checks the patient branch before doctor relationship queries", async () => {
    mocks.from.mockReturnValue(chain({ data: { branch_id: "another-branch", assignee_id: userId }, error: null }));
    await expect(getPatientTreatmentProgress(context("doctor"), leadId)).rejects.toThrow("No access to this branch");
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("loads whole patient history for a linked doctor without projecting contact details", async () => {
    const lead = chain({ data: { branch_id: branchId, assignee_id: userId }, error: null });
    const appointment = chain({ data: { id: "appointment" }, error: null });
    const relationship = chain({ data: null, error: null });
    const planned = chain({ data: [], error: null, count: 0 });
    const completed = chain({ data: [], error: null, count: 0 });
    mocks.from.mockReturnValueOnce(lead).mockReturnValueOnce(appointment).mockReturnValueOnce(relationship)
      .mockReturnValueOnce(planned).mockReturnValueOnce(completed);
    await getPatientTreatmentProgress(context("doctor"), leadId);
    expect(appointment.eq).toHaveBeenCalledWith("doctor_id", "doctor-id");
    expect(appointment.eq).toHaveBeenCalledWith("branch_id", branchId);
    expect(lead.select).toHaveBeenCalledWith("branch_id, assignee_id");
    expect(planned.select.mock.calls[0]?.[0]).not.toMatch(/mobile|email/);
  });
});
