import { AuthorizationError, type AuthContext } from "./context";

export function requireAdmin(ctx: AuthContext): void {
  if (ctx.role !== "admin") throw new AuthorizationError("Admin access required");
}

export function requireManager(ctx: AuthContext): void {
  if (ctx.role === "agent") throw new AuthorizationError("Manager access required");
}

/** Admin passes always; others must be allocated to the branch. */
export function assertBranchAccess(ctx: AuthContext, branchId: string): void {
  if (ctx.role === "admin") return;
  if (!ctx.branchIds.includes(branchId)) {
    throw new AuthorizationError("No access to this branch");
  }
}

export function requireManagerOf(ctx: AuthContext, branchId: string): void {
  if (ctx.role === "admin") return;
  if (ctx.role !== "manager" || !ctx.branchIds.includes(branchId)) {
    throw new AuthorizationError("Manager access to this branch required");
  }
}

/** Agents may only act on leads assigned to them; managers/admins per branch. */
export function assertLeadWriteAccess(
  ctx: AuthContext,
  lead: { branch_id: string; assignee_id: string | null }
): void {
  assertBranchAccess(ctx, lead.branch_id);
  if (ctx.role === "agent" && lead.assignee_id !== ctx.userId) {
    throw new AuthorizationError("This lead is not assigned to you");
  }
}

/** Agents can read their own + the unassigned pool; managers/admins per branch. */
export function canReadLead(
  ctx: AuthContext,
  lead: { branch_id: string; assignee_id: string | null }
): boolean {
  if (ctx.role === "admin") return true;
  if (!ctx.branchIds.includes(lead.branch_id)) return false;
  if (ctx.role === "manager") return true;
  return lead.assignee_id === ctx.userId || lead.assignee_id === null;
}
