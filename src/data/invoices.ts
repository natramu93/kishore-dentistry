import "server-only";

import { db } from "./db";
import { throwMappedDatabaseError } from "./helpers";
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
  TreatmentType,
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
  treatment_id?: string | null;
  treatment_type_id?: string | null;
  quantity: number;
  unit_price: number;
};

export type InvoiceCatalogTreatment = Pick<TreatmentType, "id" | "name" | "category" | "default_cost">;

export type InvoiceEligibleTreatment = {
  id: string;
  treatment_code: string;
  treatment_name: string;
  treatment_category: string | null;
  site_scope: string;
  site_detail: string | null;
  tooth_number: string | null;
  tooth_numbers: string[];
  surfaces: string[];
  quantity: number;
  cost: number | null;
  performed_at: string;
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
  if (!items.some((item) => item.treatment_id)) {
    throw new ValidationError("Include at least one completed coded case-sheet treatment on the invoice");
  }
  const treatmentIds = new Set<string>();
  for (const item of items) {
    if (item.treatment_id && item.treatment_type_id) {
      throw new ValidationError("An invoice line must be either a case-sheet treatment or a catalog treatment");
    }
    if (!item.treatment_id && !item.treatment_type_id) {
      throw new ValidationError("Choose a treatment for every invoice line");
    }
    if (item.treatment_id) {
      const treatmentId = assertUuid(item.treatment_id, "Treatment");
      if (treatmentIds.has(treatmentId)) {
        throw new ValidationError("A case-sheet treatment can appear only once on an invoice");
      }
      treatmentIds.add(treatmentId);
    } else if (item.treatment_type_id) {
      assertUuid(item.treatment_type_id, "Treatment type");
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

export async function listInvoiceTreatmentCatalog(ctx: AuthContext): Promise<InvoiceCatalogTreatment[]> {
  requireAnyRole(ctx, INVOICE_ROLES, "Invoices access required");
  const { data, error } = await db
    .from("treatment_types")
    .select("id, name, category, default_cost")
    .eq("is_active", true)
    .order("name")
    .limit(500);
  if (error) throw error;
  return data ?? [];
}

export async function listInvoiceEligibleTreatments(
  ctx: AuthContext,
  leadIdValue: string
): Promise<InvoiceEligibleTreatment[]> {
  requireAnyRole(ctx, INVOICE_ROLES, "Invoices access required");
  const leadId = assertUuid(leadIdValue, "Patient");
  const leadResult = await db
    .from("leads")
    .select("branch_id, assignee_id")
    .eq("id", leadId)
    .is("deleted_at", null)
    .maybeSingle();
  if (leadResult.error) throw leadResult.error;
  if (!leadResult.data) throw new NotFoundError("Patient");
  assertInvoiceWriteAccess(ctx, leadResult.data);

  const { data, error } = await db
    .from("treatments")
    .select(
      "id, treatment_code, treatment_name, treatment_category, site_scope, site_detail, tooth_number, tooth_numbers, surfaces, quantity, cost, performed_at, clinical_status, case_sheet:case_sheets!inner(finalized_at), invoice_items(id, active_billing)"
    )
    .eq("lead_id", leadId)
    .eq("branch_id", leadResult.data.branch_id)
    .eq("clinical_status", "completed")
    .not("treatment_code", "is", null)
    .not("case_sheet_id", "is", null)
    .order("performed_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? [])
    .filter((row) => !row.invoice_items?.some((item) => item.active_billing))
    .map((row) => ({
      id: row.id,
      treatment_code: row.treatment_code!,
      treatment_name: row.treatment_name!,
      treatment_category: row.treatment_category,
      site_scope: row.site_scope!,
      site_detail: row.site_detail,
      tooth_number: row.tooth_number,
      tooth_numbers: row.tooth_numbers ?? [],
      surfaces: row.surfaces ?? [],
      quantity: row.quantity ?? 1,
      cost: row.cost,
      performed_at: row.performed_at!,
    }));
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
  const invoiceResult = await db.rpc("create_invoice", {
    p_lead_id: leadId,
    p_treatment_id: input.items.find((item) => item.treatment_id)?.treatment_id ?? null,
    p_tax_rate: input.tax_rate,
    p_notes: input.notes?.trim() || null,
    p_items: input.items.map((item) => ({
      ...(item.treatment_id ? { treatment_id: item.treatment_id } : { treatment_type_id: item.treatment_type_id }),
      quantity: item.quantity,
      unit_price: item.unit_price,
    })) as Json,
    p_actor: ctx.userId,
  });
  if (invoiceResult.error) throwMappedDatabaseError(invoiceResult.error, "Invoice");
  return invoiceResult.data;
}

export async function createConsultationInvoice(
  ctx: AuthContext,
  input: { lead_id: string; amount: number; notes?: string | null }
): Promise<Invoice> {
  requireAnyRole(ctx, INVOICE_ROLES, "Invoices access required");
  const leadId = assertUuid(input.lead_id, "Lead");
  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > MAX_UNIT_PRICE) {
    throw new ValidationError("Consultation amount must be greater than zero");
  }
  if (!hasAtMostTwoDecimals(input.amount)) {
    throw new ValidationError("Consultation amount supports at most two decimals");
  }
  if (input.notes && input.notes.length > 4_000) {
    throw new ValidationError("Invoice notes are too long");
  }
  const leadResult = await db
    .from("leads")
    .select("branch_id, assignee_id")
    .eq("id", leadId)
    .is("deleted_at", null)
    .maybeSingle();
  if (leadResult.error) throw leadResult.error;
  if (!leadResult.data) throw new NotFoundError("Lead");
  assertInvoiceWriteAccess(ctx, leadResult.data);
  const result = await db.rpc("create_consultation_invoice", {
    p_lead_id: leadId,
    p_amount: roundCurrency(input.amount),
    p_notes: input.notes?.trim() || null,
    p_actor: ctx.userId,
  });
  if (result.error) throwMappedDatabaseError(result.error, "Invoice");
  return result.data;
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
  if (!invoice.code_enforced && invoice.invoice_kind !== "consultation") {
    throw new ConflictError(
      "Legacy uncoded invoices cannot be issued or marked paid. Create a coded invoice from a finalized case sheet."
    );
  }
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
  if (!invoice.code_enforced && invoice.invoice_kind !== "consultation") {
    throw new ConflictError(
      "Legacy invoices cannot be edited. Create a new invoice from finalized coded treatments."
    );
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
      ...(item.treatment_id ? { treatment_id: item.treatment_id } : { treatment_type_id: item.treatment_type_id }),
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
