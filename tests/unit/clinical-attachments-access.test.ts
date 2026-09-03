import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("@/data/db", () => ({
  db: { from: mocks.from },
  storageAdmin: { from: vi.fn() },
}));

import { listClinicalAttachmentsForCaseSheet } from "@/data/clinical-attachments";
import type { AuthContext } from "@/lib/auth/context";
import { AuthorizationError } from "@/lib/errors";

const caseSheetId = "10000000-0000-4000-8000-000000000001";
const branchId = "10000000-0000-4000-8000-000000000002";
const doctorId = "10000000-0000-4000-8000-000000000003";
const scope = {
  id: caseSheetId,
  lead_id: "10000000-0000-4000-8000-000000000004",
  branch_id: branchId,
  doctor_id: doctorId,
  finalized_at: "2026-09-03T05:00:00.000Z",
};

function context(
  role: "admin" | "operations" | "front_office" | "clinical_head" | "doctor",
  options: { branches?: string[]; linkedDoctorId?: string | null } = {}
): AuthContext {
  return {
    userId: "10000000-0000-4000-8000-000000000009",
    role,
    branchIds: options.branches ?? [],
    fullName: "Test User",
    email: "test@example.com",
    doctorId: options.linkedDoctorId ?? null,
  } as unknown as AuthContext;
}

function chain(result: { data: unknown; error: null }) {
  const value = {
    select: () => value,
    eq: () => value,
    order: () => value,
    maybeSingle: async () => result,
    then: (resolve: (resolved: typeof result) => unknown) =>
      Promise.resolve(result).then(resolve),
  };
  return value;
}

beforeEach(() => {
  mocks.from.mockReset().mockImplementation((table: string) => {
    if (table === "case_sheets") return chain({ data: scope, error: null });
    if (table === "case_sheet_attachments") return chain({ data: [], error: null });
    throw new Error(`Unexpected table ${table}`);
  });
});

describe("clinical attachment authorization", () => {
  it.each(["operations", "front_office"] as const)(
    "denies the %s role even when it can access the CRM",
    async (role) => {
      await expect(
        listClinicalAttachmentsForCaseSheet(
          context(role, { branches: [branchId] }),
          caseSheetId
        )
      ).rejects.toBeInstanceOf(AuthorizationError);
      expect(mocks.from).not.toHaveBeenCalledWith("case_sheet_attachments");
    }
  );

  it("requires the clinical head's allocated branch", async () => {
    await expect(
      listClinicalAttachmentsForCaseSheet(context("clinical_head"), caseSheetId)
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      listClinicalAttachmentsForCaseSheet(
        context("clinical_head", { branches: [branchId] }),
        caseSheetId
      )
    ).resolves.toEqual([]);
  });

  it("lets only the doctor who signed the sheet use the doctor path", async () => {
    await expect(
      listClinicalAttachmentsForCaseSheet(
        context("doctor", {
          linkedDoctorId: "20000000-0000-4000-8000-000000000003",
        }),
        caseSheetId
      )
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      listClinicalAttachmentsForCaseSheet(
        context("doctor", { linkedDoctorId: doctorId }),
        caseSheetId
      )
    ).resolves.toEqual([]);
  });

  it("allows administrators independent of branch allocation", async () => {
    await expect(
      listClinicalAttachmentsForCaseSheet(context("admin"), caseSheetId)
    ).resolves.toEqual([]);
  });
});
