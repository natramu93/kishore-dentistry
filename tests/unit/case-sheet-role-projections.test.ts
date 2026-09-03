import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/data/db", () => ({
  db: {
    from: mocks.from,
    rpc: mocks.rpc,
  },
}));

import { listCaseSheetsForLead } from "@/data/case-sheets";
import type { AuthContext } from "@/lib/auth/context";

const LEAD_ID = "10000000-0000-4000-8000-000000000001";
const BRANCH_ID = "10000000-0000-4000-8000-000000000002";
const APPOINTMENT_ID = "10000000-0000-4000-8000-000000000003";
const DOCTOR_ID = "10000000-0000-4000-8000-000000000004";
const CASE_SHEET_ID = "10000000-0000-4000-8000-000000000005";

const businessCaseSheet = {
  id: CASE_SHEET_ID,
  lead_id: LEAD_ID,
  branch_id: BRANCH_ID,
  appointment_id: APPOINTMENT_ID,
  doctor_id: DOCTOR_ID,
  visit_at: "2026-09-03T05:00:00.000Z",
  finalized_at: "2026-09-03T05:30:00.000Z",
  created_at: "2026-09-03T05:30:00.000Z",
  doctor: { full_name: "Dr Test" },
  treatments: [],
};

function context(role: "operations" | "front_office"): AuthContext {
  return {
    userId: "10000000-0000-4000-8000-000000000009",
    role,
    branchIds: [BRANCH_ID],
    fullName: "Test User",
    email: "test@example.test",
    doctorId: null,
  } as unknown as AuthContext;
}

function leadLookupChain() {
  const result = {
    data: { branch_id: BRANCH_ID, deleted_at: null },
    error: null,
  };
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  return chain;
}

function caseSheetListChain() {
  const result = {
    data: [businessCaseSheet],
    error: null,
    count: 1,
  };
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    range: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  return chain;
}

describe("business-role case-sheet projections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["operations", "front_office"] as const)(
    "keeps %s case-sheet reads free of clinical records",
    async (role) => {
      const leadChain = leadLookupChain();
      const caseSheetChain = caseSheetListChain();
      mocks.from.mockImplementation((table: string) => {
        if (table === "leads") return leadChain;
        if (table === "case_sheets") return caseSheetChain;
        throw new Error(`Unexpected clinical table read: ${table}`);
      });

      const result = await listCaseSheetsForLead(context(role), LEAD_ID);

      expect(caseSheetChain.select).toHaveBeenCalledOnce();
      const projection = caseSheetChain.select.mock.calls[0]?.[0] as string;
      expect(projection).not.toMatch(
        /chief_complaint|findings|diagnosis|\bplan\b|medical_alerts|medical_history|patient_medical_history_versions|prescription_items|tooth_assessments|case_sheet_attachments/
      );
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.from.mock.calls.map(([table]) => table)).toEqual([
        "leads",
        "case_sheets",
      ]);

      expect(result.caseSheets).toEqual([businessCaseSheet]);
      expect(result.currentMedicalHistory).toBeNull();
      expect(result.currentToothAssessments).toEqual([]);
      for (const field of [
        "chief_complaint",
        "findings",
        "diagnosis",
        "plan",
        "medical_alerts",
        "medical_history",
        "prescription_items",
        "tooth_assessments",
        "case_sheet_attachments",
      ]) {
        expect(result.caseSheets[0]).not.toHaveProperty(field);
      }
    }
  );
});
