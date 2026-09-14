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
    data: { branch_id: BRANCH_ID, assignee_id: "10000000-0000-4000-8000-000000000009", deleted_at: null },
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
    "allows %s to read the signed clinical case-sheet details",
    async (role) => {
      const leadChain = leadLookupChain();
      const caseSheetChain = caseSheetListChain();
      const medicalHistoryChain = {
        select: vi.fn(),
        eq: vi.fn(),
        order: vi.fn(),
        limit: vi.fn(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      medicalHistoryChain.select.mockReturnValue(medicalHistoryChain);
      medicalHistoryChain.eq.mockReturnValue(medicalHistoryChain);
      medicalHistoryChain.order.mockReturnValue(medicalHistoryChain);
      medicalHistoryChain.limit.mockReturnValue(medicalHistoryChain);
      mocks.from.mockImplementation((table: string) => {
        if (table === "leads") return leadChain;
        if (table === "case_sheets") return caseSheetChain;
        if (table === "patient_medical_history_versions") return medicalHistoryChain;
        throw new Error(`Unexpected clinical table read: ${table}`);
      });
      mocks.rpc.mockResolvedValue({ data: [], error: null });

      const result = await listCaseSheetsForLead(context(role), LEAD_ID);

      expect(caseSheetChain.select).toHaveBeenCalledOnce();
      const projection = caseSheetChain.select.mock.calls[0]?.[0] as string;
      expect(projection).toMatch(
        /chief_complaint|findings|diagnosis|\bplan\b|medical_history|prescription_items|tooth_assessments|case_sheet_attachments/
      );
      expect(mocks.rpc).toHaveBeenCalledWith("current_tooth_assessments", { p_lead_id: LEAD_ID });
      expect(mocks.from.mock.calls.map(([table]) => table)).toEqual([
        "leads",
        "case_sheets",
        "patient_medical_history_versions",
      ]);

      expect(result.caseSheets).toEqual([businessCaseSheet]);
      expect(result.currentMedicalHistory).toBeNull();
      expect(result.currentToothAssessments).toEqual([]);
    }
  );

  it("keeps business-role case-sheet reads working before treatment attachments migrate", async () => {
    const leadChain = leadLookupChain();
    const caseSheetChain = caseSheetListChain();
    const legacySheet = {
      ...businessCaseSheet,
      case_sheet_attachments: [
        {
          id: "10000000-0000-4000-8000-000000000006",
          case_sheet_id: CASE_SHEET_ID,
          lead_id: LEAD_ID,
          branch_id: BRANCH_ID,
          category: "report",
          bucket_id: "clinical-attachments",
          original_name: "report.pdf",
          mime_type: "application/pdf",
          size_bytes: 100,
          status: "ready",
          uploaded_at: "2026-09-03T05:30:00.000Z",
          created_at: "2026-09-03T05:30:00.000Z",
        },
      ],
      treatments: [],
    };
    caseSheetChain.range
      .mockReset()
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: "PGRST200",
          message: "Could not find a relationship between 'treatments' and 'case_sheet_attachments'",
        },
        count: null,
      })
      .mockResolvedValueOnce({ data: [legacySheet], error: null, count: 1 });
    const medicalHistoryChain = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    medicalHistoryChain.select.mockReturnValue(medicalHistoryChain);
    medicalHistoryChain.eq.mockReturnValue(medicalHistoryChain);
    medicalHistoryChain.order.mockReturnValue(medicalHistoryChain);
    medicalHistoryChain.limit.mockReturnValue(medicalHistoryChain);
    mocks.from.mockImplementation((table: string) => {
      if (table === "leads") return leadChain;
      if (table === "case_sheets") return caseSheetChain;
      if (table === "patient_medical_history_versions") return medicalHistoryChain;
      throw new Error(`Unexpected clinical table read: ${table}`);
    });
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    const result = await listCaseSheetsForLead(context("front_office"), LEAD_ID);

    expect(caseSheetChain.select).toHaveBeenCalledTimes(2);
    expect(caseSheetChain.select.mock.calls[1]?.[0]).not.toMatch(/treatment_attachments/);
    expect(result.caseSheets[0]?.case_sheet_attachments).toEqual([
      expect.objectContaining({ treatment_id: null, original_name: "report.pdf" }),
    ]);
  });
});
