import { describe, expect, it } from "vitest";
import type { AuthContext } from "@/lib/auth/context";
import type { UserRole } from "@/lib/database.types";
import {
  assertBranchAccess,
  assertInvoiceAccess,
  assertInvoiceWriteAccess,
  assertLeadWriteAccess,
  canAccessBranch,
  canDelete,
  canReadInvoice,
  canReadCallLogs,
  canReadLead,
  canViewReports,
  requireAdmin,
  requireAnyRole,
  requireClinicalCatalogAccess,
  requireManagerOf,
  requireReportAccess,
} from "@/lib/auth/guards";
import { AuthorizationError } from "@/lib/errors";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const OWN_BRANCH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_BRANCH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function context(
  role: UserRole,
  overrides: Partial<Omit<AuthContext, "role">> = {}
): AuthContext {
  return {
    userId: USER_ID,
    role,
    branchIds: [OWN_BRANCH],
    fullName: "Test User",
    email: "test@example.test",
    doctorId:
      role === "doctor"
        ? "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
        : null,
    ...overrides,
  } as unknown as AuthContext;
}

describe("authorization policy matrix", () => {
  it.each([
    ["admin", OWN_BRANCH, true],
    ["admin", OTHER_BRANCH, true],
    ["operations", OWN_BRANCH, true],
    ["operations", OTHER_BRANCH, false],
    ["clinical_head", OWN_BRANCH, true],
    ["clinical_head", OTHER_BRANCH, false],
    ["front_office", OWN_BRANCH, true],
    ["front_office", OTHER_BRANCH, false],
    ["doctor", OWN_BRANCH, true],
    ["doctor", OTHER_BRANCH, false],
  ] satisfies Array<[UserRole, string, boolean]>)(
    "applies branch scope for %s",
    (role, branchId, allowed) => {
      const ctx = context(role);
      expect(canAccessBranch(ctx, branchId)).toBe(allowed);
      if (allowed) {
        expect(() => assertBranchAccess(ctx, branchId)).not.toThrow();
      } else {
        expect(() => assertBranchAccess(ctx, branchId)).toThrow(
          AuthorizationError
        );
      }
    }
  );

  it("keeps admin-only and role-allowlist checks fail-closed", () => {
    expect(() => requireAdmin(context("admin"))).not.toThrow();
    for (const role of [
      "operations",
      "front_office",
      "clinical_head",
      "doctor",
    ] satisfies UserRole[]) {
      expect(() => requireAdmin(context(role))).toThrow("Admin access required");
    }

    expect(() =>
      requireAnyRole(context("operations"), ["admin", "operations"])
    ).not.toThrow();
    expect(() =>
      requireAnyRole(context("doctor"), ["admin", "operations"], "Business role required")
    ).toThrow("Business role required");
  });

  it("separates global catalog administration from branch clinical management", () => {
    expect(() => requireClinicalCatalogAccess(context("admin"))).not.toThrow();
    expect(() =>
      requireClinicalCatalogAccess(context("clinical_head"))
    ).not.toThrow();
    expect(() =>
      requireClinicalCatalogAccess(context("operations"))
    ).toThrow();

    for (const role of [
      "admin",
      "operations",
      "clinical_head",
    ] satisfies UserRole[]) {
      expect(() => requireManagerOf(context(role), OWN_BRANCH)).not.toThrow();
    }
    expect(() =>
      requireManagerOf(context("operations"), OTHER_BRANCH)
    ).toThrow();
    expect(() =>
      requireManagerOf(context("front_office"), OWN_BRANCH)
    ).toThrow();
    expect(() => requireManagerOf(context("doctor"), OWN_BRANCH)).toThrow();
  });

  it.each([
    ["admin", OTHER_BRANCH, OTHER_USER_ID, true],
    ["operations", OWN_BRANCH, OTHER_USER_ID, true],
    ["clinical_head", OWN_BRANCH, OTHER_USER_ID, true],
    ["front_office", OWN_BRANCH, USER_ID, true],
    ["front_office", OWN_BRANCH, null, true],
    ["front_office", OWN_BRANCH, OTHER_USER_ID, false],
    ["front_office", OTHER_BRANCH, USER_ID, false],
    ["doctor", OWN_BRANCH, USER_ID, false],
  ] satisfies Array<[UserRole, string, string | null, boolean]>)(
    "evaluates lead read scope for %s",
    (role, branchId, assigneeId, readable) => {
      expect(
        canReadLead(context(role), {
          branch_id: branchId,
          assignee_id: assigneeId,
        })
      ).toBe(readable);
    }
  );

  it("allows lead writes for branch-wide roles and only owned Front Office leads", () => {
    const ownLead = { branch_id: OWN_BRANCH, assignee_id: USER_ID };
    const unassignedLead = { branch_id: OWN_BRANCH, assignee_id: null };
    const otherLead = {
      branch_id: OWN_BRANCH,
      assignee_id: OTHER_USER_ID,
    };

    expect(() => assertLeadWriteAccess(context("admin"), otherLead)).not.toThrow();
    expect(() =>
      assertLeadWriteAccess(context("operations"), otherLead)
    ).not.toThrow();
    expect(() =>
      assertLeadWriteAccess(context("clinical_head"), otherLead)
    ).not.toThrow();
    expect(() =>
      assertLeadWriteAccess(context("front_office"), ownLead)
    ).not.toThrow();
    expect(() =>
      assertLeadWriteAccess(context("front_office"), unassignedLead)
    ).toThrow("This lead is not assigned to you");
    expect(() =>
      assertLeadWriteAccess(context("front_office"), otherLead)
    ).toThrow("This lead is not assigned to you");
    expect(() => assertLeadWriteAccess(context("doctor"), ownLead)).toThrow(
      "Doctors work through appointments"
    );
    expect(() =>
      assertLeadWriteAccess(context("operations"), {
        branch_id: OTHER_BRANCH,
        assignee_id: null,
      })
    ).toThrow("No access to this branch");
  });

  it("explicitly denies every doctor invoice read and write path", () => {
    const invoice = { branch_id: OWN_BRANCH, assignee_id: USER_ID };
    const doctor = context("doctor");

    expect(canReadInvoice(doctor, invoice)).toBe(false);
    expect(() => assertInvoiceAccess(doctor, invoice)).toThrow(
      "No access to this invoice"
    );
    expect(() => assertInvoiceWriteAccess(doctor, invoice)).toThrow(
      "No access to this invoice"
    );
  });

  it("mirrors lead ownership for Front Office invoice reads and tightens writes", () => {
    const frontOffice = context("front_office");
    const own = { branch_id: OWN_BRANCH, assignee_id: USER_ID };
    const unassigned = { branch_id: OWN_BRANCH, assignee_id: null };
    const other = { branch_id: OWN_BRANCH, assignee_id: OTHER_USER_ID };

    expect(canReadInvoice(frontOffice, own)).toBe(true);
    expect(canReadInvoice(frontOffice, unassigned)).toBe(true);
    expect(canReadInvoice(frontOffice, other)).toBe(false);
    expect(() => assertInvoiceWriteAccess(frontOffice, own)).not.toThrow();
    expect(() => assertInvoiceWriteAccess(frontOffice, unassigned)).toThrow(
      "This lead must be assigned to you before invoicing"
    );
    expect(() => assertInvoiceWriteAccess(frontOffice, other)).toThrow(
      "No access to this invoice"
    );
  });

  it.each([
    ["admin", true],
    ["operations", true],
    ["front_office", true],
    ["clinical_head", false],
    ["doctor", false],
  ] satisfies Array<[UserRole, boolean]>) (
    "limits call logs to Admin, Ops Head, and Front Office for %s",
    (role, allowed) => {
      expect(canReadCallLogs(context(role))).toBe(allowed);
    }
  );

  it.each([
    ["admin", true, true],
    ["operations", true, true],
    ["clinical_head", true, false],
    ["front_office", false, false],
    ["doctor", false, false],
  ] satisfies Array<[UserRole, boolean, boolean]>)(
    "applies reports/delete capabilities for %s",
    (role, reports, deletion) => {
      expect(canViewReports(role)).toBe(reports);
      expect(canDelete(role)).toBe(deletion);
      if (reports) {
        expect(() => requireReportAccess(context(role))).not.toThrow();
      } else {
        expect(() => requireReportAccess(context(role))).toThrow(
          "Reports access required"
        );
      }
    }
  );
});
