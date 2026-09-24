import type { AuthContext } from "./context";
import { AuthorizationError } from "@/lib/errors";

const BUSINESS_ROLES = ["admin", "operations", "front_office", "clinical_head"] as const;

/** Roles with full read/write over every lead at their allocated branches
 *  (not limited to leads assigned to them) — the business/clinical leadership. */
const BRANCH_WIDE_LEAD_ROLES = ["admin", "operations", "clinical_head"] as const;

/** Roles that manage the doctor roster and treatment catalog for a branch. */
const CLINICAL_ADMIN_ROLES = ["admin", "operations", "clinical_head"] as const;

type ScopedLead = { branch_id: string; assignee_id: string | null };

function hasRole(
  role: AuthContext["role"],
  allowlist: readonly AuthContext["role"][]
): boolean {
  return allowlist.includes(role);
}

export function requireAnyRole(
  ctx: AuthContext,
  allowlist: readonly AuthContext["role"][],
  message = "Not authorized"
): void {
  if (!hasRole(ctx.role, allowlist)) throw new AuthorizationError(message);
}

export function requireAdmin(ctx: AuthContext): void {
  if (ctx.role !== "admin") throw new AuthorizationError("Admin access required");
}

/** Global admins manage all users; Operations manages ordinary users only in its assigned centers. */
export function requireUserManagementAccess(ctx: AuthContext): void {
  if (ctx.role !== "admin" && ctx.role !== "operations") {
    throw new AuthorizationError("User management access required");
  }
}

/** Admin passes always; others must be allocated to the branch. */
export function assertBranchAccess(ctx: AuthContext, branchId: string): void {
  if (ctx.role === "admin") return;
  if (!ctx.branchIds.includes(branchId)) {
    throw new AuthorizationError("No access to this branch");
  }
}

export function canAccessBranch(ctx: AuthContext, branchId: string): boolean {
  return ctx.role === "admin" || ctx.branchIds.includes(branchId);
}

/** Doctor roster / treatment catalog management for a specific branch. */
export function requireManagerOf(ctx: AuthContext, branchId: string): void {
  if (ctx.role === "admin") return;
  if (
    !(CLINICAL_ADMIN_ROLES as readonly string[]).includes(ctx.role) ||
    !ctx.branchIds.includes(branchId)
  ) {
    throw new AuthorizationError("Operations or Clinical Head access to this branch required");
  }
}

/**
 * Lead pipeline write access. Front Office may only act on leads assigned to
 * them (or the branch's open pool). Doctors don't manage the lead pipeline at
 * all — they work through their own appointments and treatment records instead.
 */
export function assertLeadWriteAccess(
  ctx: AuthContext,
  lead: ScopedLead
): void {
  if (ctx.role === "doctor") {
    throw new AuthorizationError("Doctors work through appointments, not the lead pipeline");
  }
  assertBranchAccess(ctx, lead.branch_id);
  if (ctx.role === "front_office" && lead.assignee_id !== ctx.userId) {
    throw new AuthorizationError("This lead is not assigned to you");
  }
}

/** Front Office reads own + the unassigned pool; branch-wide roles read everything in-branch. */
export function canReadLead(
  ctx: AuthContext,
  lead: ScopedLead
): boolean {
  if (ctx.role === "admin") return true;
  if (ctx.role === "doctor") return false; // doctors don't use the Leads module
  if (!ctx.branchIds.includes(lead.branch_id)) return false;
  if ((BRANCH_WIDE_LEAD_ROLES as readonly string[]).includes(ctx.role)) return true;
  return lead.assignee_id === ctx.userId || lead.assignee_id === null;
}

/** Invoice policy mirrors lead scope and explicitly excludes doctor accounts. */
export function canReadInvoice(ctx: AuthContext, invoice: ScopedLead): boolean {
  if (!hasRole(ctx.role, BUSINESS_ROLES)) return false;
  return canReadLead(ctx, invoice);
}

export function assertInvoiceAccess(ctx: AuthContext, invoice: ScopedLead): void {
  if (!canReadInvoice(ctx, invoice)) {
    throw new AuthorizationError("No access to this invoice");
  }
}

export function assertInvoiceWriteAccess(ctx: AuthContext, invoice: ScopedLead): void {
  assertInvoiceAccess(ctx, invoice);
  if (ctx.role === "front_office" && invoice.assignee_id !== ctx.userId) {
    throw new AuthorizationError("This lead must be assigned to you before invoicing");
  }
}

/** Whether this role can see reports (revenue/clinical performance). */
export function canViewReports(role: AuthContext["role"]): boolean {
  return role === "admin" || role === "operations" || role === "clinical_head";
}

export function requireReportAccess(ctx: AuthContext): void {
  if (!canViewReports(ctx.role)) throw new AuthorizationError("Reports access required");
}

/** Call recordings and external call metadata are available to reception,
 * the operations/ops-head role, and administrators. */
export function canReadCallLogs(ctx: AuthContext): boolean {
  return ctx.role === "admin" || ctx.role === "front_office" || ctx.role === "operations";
}

export function requireCallLogAccess(ctx: AuthContext): void {
  if (!canReadCallLogs(ctx)) throw new AuthorizationError("Call log access required");
}

/** Whether this role can delete records (leads, invoices). */
export function canDelete(role: AuthContext["role"]): boolean {
  return role === "admin" || role === "operations";
}
