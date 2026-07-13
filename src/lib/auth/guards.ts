import { AuthorizationError, type AuthContext } from "./context";

/** Roles with full read/write over every lead at their allocated branches
 *  (not limited to leads assigned to them) — the business/clinical leadership. */
const BRANCH_WIDE_LEAD_ROLES = ["admin", "operations", "clinical_head"] as const;

/** Roles that manage the doctor roster and treatment catalog for a branch. */
const CLINICAL_ADMIN_ROLES = ["admin", "operations", "clinical_head"] as const;

export function requireAdmin(ctx: AuthContext): void {
  if (ctx.role !== "admin") throw new AuthorizationError("Admin access required");
}

/** The Clinical Head owns the treatment catalog (pricing/categories) alongside admin. */
export function requireClinicalCatalogAccess(ctx: AuthContext): void {
  if (ctx.role !== "admin" && ctx.role !== "clinical_head") {
    throw new AuthorizationError("Clinical Head or Admin access required");
  }
}

/** Admin passes always; others must be allocated to the branch. */
export function assertBranchAccess(ctx: AuthContext, branchId: string): void {
  if (ctx.role === "admin") return;
  if (!ctx.branchIds.includes(branchId)) {
    throw new AuthorizationError("No access to this branch");
  }
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
  lead: { branch_id: string; assignee_id: string | null }
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
  lead: { branch_id: string; assignee_id: string | null }
): boolean {
  if (ctx.role === "admin") return true;
  if (ctx.role === "doctor") return false; // doctors don't use the Leads module
  if (!ctx.branchIds.includes(lead.branch_id)) return false;
  if ((BRANCH_WIDE_LEAD_ROLES as readonly string[]).includes(ctx.role)) return true;
  return lead.assignee_id === ctx.userId || lead.assignee_id === null;
}

/** Whether this role can see reports (revenue/clinical performance). */
export function canViewReports(role: AuthContext["role"]): boolean {
  return role === "admin" || role === "operations" || role === "clinical_head";
}

/** Whether this role can delete records (leads, invoices). */
export function canDelete(role: AuthContext["role"]): boolean {
  return role === "admin" || role === "operations";
}
