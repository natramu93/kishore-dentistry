import "server-only";

import { db } from "./db";
import { requireTreatmentForLead, throwMappedDatabaseError } from "./helpers";
import type { AuthContext } from "@/lib/auth/context";
import {
  assertBranchAccess,
  assertInvoiceWriteAccess,
  canReadInvoice,
  canDelete,
  requireAnyRole,
} from "@/lib/auth/guards";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import {
  EMPTY_UUID,
  assertInvoiceStatus,
  assertUuid,
  normalizePagination,
} from "@/lib/validation";
import type {
  Invoice,
  InvoiceItem,
  InvoiceStatus,
  Json,
} from "@/lib/database.types";

const INVOICE_ROLES = ["admin", "operations", "front_office", "clinical_head"] as const;
const MAX_UNIT_PRICE = 99_999_999.99;
const MAX_INVOICE_TOTAL = 9_999_999_999.99;

export type InvoiceWithRefs = Invoice & {
  lead: { id: string; name: string; mobile: string; email: string | null } | null;
  branch: {
    name: string;
    code: string;
    address: string | null;
    phone: string | null;
  } | null;
};

type InvoiceScopeRow = Invoice & {
  lead: {
    id: string;
    name: string;
    mobile: string;
    email: string | null;
    assignee_id: string | null;
  } | null;
  branch: InvoiceWithRefs["branch"];
};

export type InvoiceItemInput = {
  description: string;
  quantity: number;
  unit_price: number;
};

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function hasAtMostTwoDecimals(value: number): boolean {
  const scaled = value * 100;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

export function computeInvoiceTotals(items: InvoiceItemInput[], taxRate: number) {
  const subtotal = roundCurrency(
    items.reduce(
      (sum, item) => sum + roundCurrency(item.quantity * item.unit_price),
      0
    )
  );
  const tax_amount = roundCurrency((subtotal * taxRate) / 100);
  return { subtotal, tax_amount, total: roundCurrency(subtotal + tax_amount) };
}

function validateInvoiceInput(items: InvoiceItemInput[], taxRate: number): void {
  if (
    !Number.isFinite(taxRate) ||
    taxRate < 0 ||
    taxRate > 100 ||
    !hasAtMostTwoDecimals(taxRate)
  ) {
    throw new ValidationError(
      "Tax rate must be between 0 and 100 with at most two decimals"
    );
  }
  if (!items.length || items.length > 100) {
    throw new ValidationError("Invoice must contain between 1 and 100 line items");
  }
  for (const item of items) {
    if (!item.description.trim() || item.description.length > 500) {
      throw new ValidationError("Invoice item description is invalid");
    }
    if (!Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > 100_000) {
      throw new ValidationError("Invoice item quantity is invalid");
    }
    if (!hasAtMostTwoDecimals(item.quantity)) {
      throw new ValidationError("Invoice item quantity supports at most two decimals");
    }
    if (
      !Number.isFinite(item.unit_price) ||
      item.unit_price < 0 ||
      item.unit_price > MAX_UNIT_PRICE
    ) {
      throw new ValidationError("Invoice item price is invalid");
    }
    if (!hasAtMostTwoDecimals(item.unit_price)) {
      throw new ValidationError("Invoice item price supports at most two decimals");
    }
  }
  const totals = computeInvoiceTotals(items, taxRate);
  if (
    totals.subtotal > MAX_INVOICE_TOTAL ||
    totals.total > MAX_INVOICE_TOTAL
  ) {
    throw new ValidationError("Invoice total is too large");
  }
}

function validateExpectedVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ValidationError("Invoice version is invalid");
  }
  return value;
}

function toInvoiceDto(row: InvoiceScopeRow): InvoiceWithRefs {
  return {
    ...row,
    lead: row.lead
      ? {
          id: row.lead.id,
          name: row.lead.name,
          mobile: row.lead.mobile,
          email: row.lead.email,
        }
      : null,
  };
}

export async function listInvoices(
  ctx: AuthContext,
  opts: {
    branchId?: string;
    status?: InvoiceStatus;
    page?: number;
    pageSize?: number;
  } = {}
): Promise<{
  invoices: InvoiceWithRefs[];
  total: number;
  page: number;
  pageSize: number;
}> {
  requireAnyRole(ctx, INVOICE_ROLES, "Invoices access required");
  const { page, pageSize } = normalizePagination(opts.page, opts.pageSize);
  let query = db
    .from("invoices")
    .select(
      "*, lead:leads!inner(id, name, mobile, email, assignee_id), branch:branches(name, code, address, phone)",
      { count: "exact" }
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (ctx.role !== "admin") {
    query = query.in(
      "branch_id",
      ctx.branchIds.length ? [...ctx.branchIds] : [EMPTY_UUID]
    );
  }
  if (opts.branchId) {
    const branchId = assertUuid(opts.branchId, "Branch");
    assertBranchAccess(ctx, branchId);
    query = query.eq("branch_id", branchId);
  }
  if (opts.status) query = query.eq("status", assertInvoiceStatus(opts.status));
  if (ctx.role === "front_office") {
    query = query.or(`assignee_id.eq.${ctx.userId},assignee_id.is.null`, {
      referencedTable: "lead",
    });
  }

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query.range(
    from,
    from + pageSize - 1
  );
  if (error) throw error;
  const invoices = (data as InvoiceScopeRow[])
    .filter((invoice) =>
      canReadInvoice(ctx, {
        branch_id: invoice.branch_id,
        assignee_id: invoice.lead?.assignee_id ?? null,
      })
    )
    .map(toInvoiceDto);
  return { invoices, total: count ?? 0, page, pageSize };
}

async function loadInvoiceScope(id: string): Promise<InvoiceScopeRow | null> {
  const invoiceId = assertUuid(id, "Invoice");
  const { data, error } = await db
    .from("invoices")
    .select(
      "*, lead:leads(id, name, mobile, email, assignee_id), branch:branches(name, code, address, phone)"
    )
    .eq("id", invoiceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data as InvoiceScopeRow | null;
}

export async function getInvoice(
  ctx: AuthContext,
  id: string
): Promise<(InvoiceWithRefs & { items: InvoiceItem[] }) | null> {
  const invoice = await loadInvoiceScope(id);
  if (!invoice) return null;
  if (
    !canReadInvoice(ctx, {
      branch_id: invoice.branch_id,
      assignee_id: invoice.lead?.assignee_id ?? null,
    })
  ) {
    return null;
  }

  const itemsResult = await db
    .from("invoice_items")
    .select("*")
    .eq("invoice_id", invoice.id)
    .order("created_at")
    .limit(100);
  if (itemsResult.error) throw itemsResult.error;
  return { ...toInvoiceDto(invoice), items: itemsResult.data };
}

export async function createInvoice(
  ctx: AuthContext,
  input: {
    lead_id: string;
    treatment_id?: string | null;
    tax_rate: number;
    notes?: string | null;
    items: InvoiceItemInput[];
  }
): Promise<Invoice> {
  requireAnyRole(ctx, INVOICE_ROLES, "Invoices access required");
  const leadId = assertUuid(input.lead_id, "Lead");
  validateInvoiceInput(input.items, input.tax_rate);
  if (input.notes && input.notes.length > 4_000) {
    throw new ValidationError("Invoice notes are too long");
  }

  const leadResult = await db
    .from("leads")
    .select("branch_id, assignee_id")
    .eq("id", leadId)
    .maybeSingle();
  if (leadResult.error) throw leadResult.error;
  if (!leadResult.data) throw new NotFoundError("Lead");
  assertInvoiceWriteAccess(ctx, leadResult.data);
  if (input.treatment_id) {
    await requireTreatmentForLead(
      input.treatment_id,
      leadId,
      leadResult.data.branch_id
    );
  }

  const invoiceResult = await db.rpc("create_invoice", {
    p_lead_id: leadId,
    p_treatment_id: input.treatment_id ?? null,
    p_tax_rate: input.tax_rate,
    p_notes: input.notes?.trim() || null,
    p_items: input.items.map((item) => ({
      description: item.description.trim(),
      quantity: item.quantity,
      unit_price: item.unit_price,
    })) as Json,
    p_actor: ctx.userId,
  });
  if (invoiceResult.error) throwMappedDatabaseError(invoiceResult.error, "Invoice");
  return invoiceResult.data;
}

const ALLOWED_INVOICE_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  draft: ["sent", "paid"],
  sent: ["paid"],
  paid: [],
};

export async function updateInvoiceStatus(
  ctx: AuthContext,
  id: string,
  statusValue: InvoiceStatus,
  expectedVersionValue: number
) {
  const status = assertInvoiceStatus(statusValue);
  const expectedVersion = validateExpectedVersion(expectedVersionValue);
  const invoice = await loadInvoiceScope(id);
  if (!invoice) throw new NotFoundError("Invoice");
  assertInvoiceWriteAccess(ctx, {
    branch_id: invoice.branch_id,
    assignee_id: invoice.lead?.assignee_id ?? null,
  });
  if (invoice.status === status) return;
  if (invoice.version !== expectedVersion) {
    throw new ConflictError(
      "This invoice changed since the page was loaded. Refresh and try again."
    );
  }
  if (!ALLOWED_INVOICE_TRANSITIONS[invoice.status].includes(status)) {
    throw new ConflictError(`Invoice cannot move from ${invoice.status} to ${status}`);
  }

  const updateResult = await db.rpc("transition_invoice_status", {
    p_invoice_id: invoice.id,
    p_to: status,
    p_actor: ctx.userId,
    p_expected_version: expectedVersion,
  });
  if (updateResult.error) throwMappedDatabaseError(updateResult.error, "Invoice");
}

export async function updateInvoice(
  ctx: AuthContext,
  id: string,
  input: {
    tax_rate: number;
    notes?: string | null;
    items: InvoiceItemInput[];
    expected_version: number;
  }
) {
  const expectedVersion = validateExpectedVersion(input.expected_version);
  const invoice = await loadInvoiceScope(id);
  if (!invoice) throw new NotFoundError("Invoice");
  assertInvoiceWriteAccess(ctx, {
    branch_id: invoice.branch_id,
    assignee_id: invoice.lead?.assignee_id ?? null,
  });
  if (invoice.status === "paid") {
    throw new ConflictError("A paid invoice cannot be edited");
  }
  if (invoice.version !== expectedVersion) {
    throw new ConflictError(
      "This invoice changed since the editor was opened. Refresh before saving."
    );
  }
  validateInvoiceInput(input.items, input.tax_rate);
  if (input.notes && input.notes.length > 4_000) {
    throw new ValidationError("Invoice notes are too long");
  }

  const updateResult = await db.rpc("update_invoice", {
    p_invoice_id: invoice.id,
    p_tax_rate: input.tax_rate,
    p_notes: input.notes?.trim() || null,
    p_items: input.items.map((item) => ({
      description: item.description.trim(),
      quantity: item.quantity,
      unit_price: item.unit_price,
    })) as Json,
    p_actor: ctx.userId,
    p_expected_version: expectedVersion,
  });
  if (updateResult.error) throwMappedDatabaseError(updateResult.error, "Invoice");
}

export async function deleteInvoice(
  ctx: AuthContext,
  id: string,
  expectedVersionValue: number
) {
  const expectedVersion = validateExpectedVersion(expectedVersionValue);
  const invoice = await loadInvoiceScope(id);
  if (!invoice) return;
  if (!canDelete(ctx.role)) {
    throw new AuthorizationError("Only Operations or Admin can delete invoices");
  }
  assertBranchAccess(ctx, invoice.branch_id);
  if (invoice.status === "paid") {
    throw new ConflictError("Paid invoices cannot be deleted");
  }
  if (invoice.version !== expectedVersion) {
    throw new ConflictError(
      "This invoice changed since the page was loaded. Refresh and try again."
    );
  }
  const { error } = await db.rpc("delete_invoice", {
    p_invoice_id: invoice.id,
    p_actor: ctx.userId,
    p_reason: "Deleted by user",
    p_expected_version: expectedVersion,
  });
  if (error) throwMappedDatabaseError(error, "Invoice");
}
