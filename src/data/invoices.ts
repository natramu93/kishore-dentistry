import "server-only";

import { db } from "./db";
import { throwMappedDatabaseError } from "./helpers";
import { invoiceLineDetailsSchema } from "@/lib/invoice-lines";
import { paymentDiscountSchema, paymentReceiptSchema, receiptDateSchema, type PaymentDiscount } from "@/lib/invoice-receipts";
import { clinicToday } from "@/lib/tz";
import { patientDisplayName, type PatientTitle } from "@/lib/patient-demographics";
import type { PatientInvoiceBalance } from "@/lib/patient-invoice-balance";
import { invoiceFinanceFilters, invoiceSort, type FinanceFilters } from "@/lib/finance-activity";
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
  assertDateOnly,
  assertInvoiceStatus,
  assertUuid,
  normalizePagination,
} from "@/lib/validation";
import type {
  Invoice,
  InvoiceItem,
  InvoicePayment,
  InvoicePaymentMethod,
  InvoiceStatus,
  Json,
  TreatmentType,
} from "@/lib/database.types";

const INVOICE_ROLES = ["admin", "operations", "front_office", "clinical_head"] as const;
const MAX_UNIT_PRICE = 99_999_999.99;
const MAX_INVOICE_TOTAL = 9_999_999_999.99;

export type InvoiceWithRefs = Invoice & {
  amount_paid: number;
  balance_due: number;
  lead: { id: string; name: string; mobile: string | null; email: string | null } | null;
  branch: {
    name: string;
    code: string;
    address: string | null;
    phone: string | null;
    company_name: string | null;
    invoice_email: string | null;
    gst_number: string | null;
  } | null;
};

type InvoiceScopeRow = Invoice & {
  lead: {
    id: string;
    name: string;
    title: PatientTitle | null;
    mobile: string | null;
    email: string | null;
    assignee_id: string | null;
  } | null;
  branch: InvoiceWithRefs["branch"];
};

export type InvoiceItemInput = {
  invoice_item_id?: string;
  treatment_id?: string | null;
  treatment_type_id?: string | null;
  quantity: number;
  unit_price: number;
  tooth_numbers?: string[];
  line_note?: string;
};

export type InvoiceCatalogTreatment = Pick<TreatmentType, "id" | "name" | "category" | "default_cost" | "is_general_consultation">;

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

export function computeInvoiceTotalWithDiscount(items: InvoiceItemInput[], taxRate: number, discountAmount: number) {
  const base = computeInvoiceTotals(items, taxRate);
  if (!Number.isFinite(discountAmount) || discountAmount < 0 || discountAmount > base.subtotal || !hasAtMostTwoDecimals(discountAmount)) {
    throw new ValidationError("Discount must be between zero and the invoice subtotal");
  }
  const tax_amount = roundCurrency(((base.subtotal - discountAmount) * taxRate) / 100);
  return { subtotal: base.subtotal, tax_amount, total: roundCurrency(base.subtotal - discountAmount + tax_amount) };
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
  const treatmentIds = new Set<string>();
  for (const item of items) {
    if (item.invoice_item_id) assertUuid(item.invoice_item_id, "Invoice line");
    const details = invoiceLineDetailsSchema.safeParse(item);
    if (!details.success) throw new ValidationError(details.error.issues[0]?.message ?? "Invoice line details are invalid");
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

async function validateCatalogTreatmentsForBranch(items: InvoiceItemInput[], branchId: string) {
  const ids = [...new Set(items.flatMap((item) => item.treatment_type_id ? [assertUuid(item.treatment_type_id, "Treatment type")] : []))];
  if (!ids.length) return;
  const { data, error } = await db.from("treatment_types").select("id")
    .eq("branch_id", branchId).eq("is_active", true).in("id", ids);
  if (error) throw error;
  if ((data ?? []).length !== ids.length) throw new ValidationError("Choose active treatments from this patient’s center");
}

export async function listInvoiceTreatmentCatalog(ctx: AuthContext, branchIdValue: string): Promise<InvoiceCatalogTreatment[]> {
  requireAnyRole(ctx, INVOICE_ROLES, "Invoices access required");
  const branchId = assertUuid(branchIdValue, "Branch");
  assertBranchAccess(ctx, branchId);
  const { data, error } = await db
    .from("treatment_types")
    .select("id, name, category, default_cost, is_general_consultation")
    .eq("branch_id", branchId)
    .eq("is_active", true)
    .order("is_general_consultation", { ascending: false })
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

function toInvoiceDto(row: InvoiceScopeRow): Omit<InvoiceWithRefs, "amount_paid" | "balance_due"> {
  return {
    ...row,
    lead: row.lead
      ? {
          id: row.lead.id,
          name: patientDisplayName(row.lead),
          mobile: row.lead.mobile,
          email: row.lead.email,
        }
      : null,
  };
}

export async function listInvoices(
  ctx: AuthContext,
  opts: {
    leadId?: string;
    search?: string;
    branchId?: string;
    status?: InvoiceStatus;
    dueOnly?: boolean;
    paymentMethod?: InvoicePaymentMethod;
    fromDate?: string;
    toDate?: string;
    sort?: string;
    descending?: boolean;
    page?: number;
    pageSize?: number;
  } = {}
): Promise<{
  invoices: (InvoiceWithRefs & { received_in_range: number })[];
  total: number;
  page: number;
  pageSize: number;
  collections: { upi: number; cash: number; card: number; neft: number; amount: number };
}> {
  requireAnyRole(ctx, INVOICE_ROLES, "Invoices access required");
  const { page, pageSize } = normalizePagination(opts.page, opts.pageSize);
  if (opts.branchId) {
    const branchId = assertUuid(opts.branchId, "Branch");
    assertBranchAccess(ctx, branchId);
  }
  const fromDate = opts.fromDate ? assertDateOnly(opts.fromDate, "From date") : undefined;
  const toDate = opts.toDate ? assertDateOnly(opts.toDate, "To date") : undefined;
  if (fromDate && toDate && fromDate > toDate) throw new ValidationError("From date must be on or before To date");
  const filters: FinanceFilters = invoiceFinanceFilters({ ...opts, fromDate, toDate });
  const { data, error } = await db.rpc("get_invoice_activity", {
    p_actor: ctx.userId, p_filters: filters as Json, p_page: page, p_page_size: pageSize,
    p_sort: invoiceSort(opts.sort), p_desc: opts.descending ?? true,
  });
  if (error) throwMappedDatabaseError(error, "Invoice list");
  const result = data as unknown as {
    invoices: (InvoiceScopeRow & { amount_paid: number; balance_due: number; received_in_range: number })[];
    total: number; collections: { upi: number; cash: number; card: number; neft: number; amount: number };
  };
  const invoices = result.invoices
    .filter((invoice) =>
      canReadInvoice(ctx, {
        branch_id: invoice.branch_id,
        assignee_id: invoice.lead?.assignee_id ?? null,
      })
    )
    .map((invoice) => ({ ...toInvoiceDto(invoice), amount_paid: Number(invoice.amount_paid),
      balance_due: Number(invoice.balance_due), received_in_range: Number(invoice.received_in_range) }));
  return { invoices, total: Number(result.total), page, pageSize, collections: result.collections };
}

async function loadInvoiceScope(id: string): Promise<InvoiceScopeRow | null> {
  const invoiceId = assertUuid(id, "Invoice");
  const { data, error } = await db
    .from("invoices")
    .select(
      "*, lead:leads(id, name, title, mobile, email, assignee_id), branch:branches(name, code, address, phone, company_name, invoice_email, gst_number)"
    )
    .eq("id", invoiceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data as InvoiceScopeRow | null;
}

async function readInvoicePatientBalance(ctx: AuthContext, invoiceId: string): Promise<PatientInvoiceBalance> {
  const result = await db.rpc("get_invoice_patient_balance", { p_invoice_id: invoiceId, p_actor: ctx.userId }).single();
  if (result.error) throwMappedDatabaseError(result.error, "Patient balance");
  return Object.fromEntries(Object.entries(result.data).map(([key, value]) => [key, Number(value)])) as PatientInvoiceBalance;
}

export async function getInvoice(
  ctx: AuthContext,
  id: string,
  { allPayments = false }: { allPayments?: boolean } = {},
): Promise<(InvoiceWithRefs & { items: InvoiceItem[]; payments: InvoicePayment[]; patient_balance: PatientInvoiceBalance }) | null> {
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
  const receiptPageSize = 500;
  const receiptQuery = (count?: "exact") => db
    .from("invoice_payments")
    .select("*", { count })
    .eq("invoice_id", invoice.id)
    .order("received_at", { ascending: false })
    .order("id", { ascending: false });
  const paymentsResult = await receiptQuery(allPayments ? "exact" : undefined).limit(receiptPageSize);
  if (paymentsResult.error) throw paymentsResult.error;
  if (allPayments && paymentsResult.count == null) throw new Error("Could not verify the complete invoice payment history");
  const payments = [...(paymentsResult.data ?? [])];
  // The regular page only previews recent receipts; generated invoices include
  // the whole ledger for this invoice, including receipts past the first batch.
  while (allPayments && payments.length < (paymentsResult.count ?? 0)) {
    const start = payments.length;
    const next = await receiptQuery().range(start, start + receiptPageSize - 1);
    if (next.error) throw next.error;
    if (!next.data?.length) throw new Error("Could not read the complete invoice payment history");
    payments.push(...next.data);
  }
  const patient_balance = await readInvoicePatientBalance(ctx, invoice.id);
  return { ...toInvoiceDto(invoice), amount_paid: patient_balance.amount_paid, balance_due: patient_balance.invoice_due,
    items: itemsResult.data, payments, patient_balance };
}

export async function getPatientInvoiceSummary(ctx: AuthContext, leadId: string) {
  requireAnyRole(ctx, INVOICE_ROLES, "Invoices access required");
  const result = await db.rpc("get_patient_invoice_summary", { p_lead_id: assertUuid(leadId, "Patient"), p_actor: ctx.userId }).single();
  if (result.error) throwMappedDatabaseError(result.error, "Patient balance");
  return result.data;
}

export async function recordInvoicePayment(
  ctx: AuthContext,
  id: string,
  input: { amount: number; method: InvoicePaymentMethod; reference?: string | null; notes?: string | null },
): Promise<InvoicePayment> {
  requireAnyRole(ctx, INVOICE_ROLES, "Invoices access required");
  const invoice = await loadInvoiceScope(id);
  if (!invoice) throw new NotFoundError("Invoice");
  assertInvoiceWriteAccess(ctx, { branch_id: invoice.branch_id, assignee_id: invoice.lead?.assignee_id ?? null });
  if (invoice.status === "paid") throw new ConflictError("This invoice is already paid");
  if (invoice.status === "cancelled") throw new ConflictError("Cancelled invoices cannot accept payments");
  if (!invoice.code_enforced && invoice.invoice_kind !== "consultation" && invoice.invoice_kind !== "opening_balance") {
    throw new ConflictError("Legacy uncoded invoices cannot accept payments");
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > MAX_INVOICE_TOTAL || !hasAtMostTwoDecimals(input.amount)) {
    throw new ValidationError("Payment amount must be positive with at most two decimals");
  }
  const result = await db.rpc("record_invoice_payment", {
    p_invoice_id: invoice.id,
    p_amount: roundCurrency(input.amount),
    p_method: input.method,
    p_reference: input.reference?.trim() || null,
    p_notes: input.notes?.trim() || null,
    p_actor: ctx.userId,
  });
  if (result.error) throwMappedDatabaseError(result.error, "Payment");
  return result.data;
}

async function writablePaymentInvoice(ctx: AuthContext, id: string) {
  requireAnyRole(ctx, INVOICE_ROLES, "Invoices access required");
  const invoice = await loadInvoiceScope(id);
  if (!invoice) throw new NotFoundError("Invoice");
  assertInvoiceWriteAccess(ctx, { branch_id: invoice.branch_id, assignee_id: invoice.lead?.assignee_id ?? null });
  if (invoice.status === "cancelled") throw new ConflictError("Cancelled invoices cannot accept receipt changes");
  if (!invoice.code_enforced && invoice.invoice_kind !== "consultation" && invoice.invoice_kind !== "opening_balance") {
    throw new ConflictError("Legacy uncoded invoices cannot accept receipt changes");
  }
  return invoice;
}

function validatedReceiptDate(date?: string): string | null {
  if (date === undefined) return null;
  const parsed = receiptDateSchema.safeParse(date);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Enter a valid receipt date");
  return parsed.data;
}

/** No receipt or new charge is needed: the existing ledger already carries unpaid dues forward. */
export async function confirmInvoiceCarryForward(ctx: AuthContext, id: string): Promise<PatientInvoiceBalance> {
  const invoice = await writablePaymentInvoice(ctx, id);
  if (invoice.status === "paid") throw new ConflictError("This invoice is already paid");
  return readInvoicePatientBalance(ctx, invoice.id);
}

export async function recordInvoicePayments(ctx: AuthContext, id: string,
  receipts: { amount: number; method: InvoicePaymentMethod; reference?: string; notes?: string }[], requestKey: string, receiptDate?: string, discount?: PaymentDiscount) {
  const invoice = await writablePaymentInvoice(ctx, id);
  assertUuid(requestKey, "Payment request");
  if ((!receipts.length && !discount) || receipts.length > 10) throw new ValidationError("Add a payment or a discount (up to ten payment methods)");
  const clean = receipts.map((receipt) => {
    const parsed = paymentReceiptSchema.safeParse(receipt);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid payment");
    return parsed.data;
  });
  // The RPC locks the invoice, validates the combined amount, and handles retries.
  if (discount) {
    const parsed = paymentDiscountSchema.safeParse(discount);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid payment discount");
    const result = await db.rpc("record_invoice_payment_with_discount", {
      p_invoice_id: invoice.id, p_receipts: clean as Json, p_request_key: requestKey, p_actor: ctx.userId,
      p_receipt_date: validatedReceiptDate(receiptDate ?? clinicToday())!,
      p_discount: parsed.data.amount, p_given_by: parsed.data.given_by, p_reason: parsed.data.reason,
      p_expected_version: parsed.data.expected_version,
    });
    if (result.error) throwMappedDatabaseError(result.error, "Payment discount");
    return result.data;
  }
  const result = await db.rpc("record_invoice_payment_batch_with_date", {
    p_invoice_id: invoice.id, p_receipts: clean as Json, p_request_key: requestKey, p_actor: ctx.userId,
    p_receipt_date: validatedReceiptDate(receiptDate),
  });
  if (result.error) throwMappedDatabaseError(result.error, "Payment");
  return result.data;
}

export async function updateInvoicePayment(ctx: AuthContext, id: string, paymentId: string,
  input: { amount: number; method: InvoicePaymentMethod; reference?: string; expected_version: number; reason: string; receipt_date?: string }) {
  if (input.receipt_date !== undefined && ctx.role !== "admin") {
    throw new AuthorizationError("Only a super admin can correct a receipt date");
  }
  const invoice = await writablePaymentInvoice(ctx, id);
  const receipt = paymentReceiptSchema.safeParse(input);
  if (!receipt.success) throw new ValidationError(receipt.error.issues[0]?.message ?? "Invalid payment");
  const reason = input.reason.trim();
  if (!reason || reason.length > 1000) throw new ValidationError("Enter a correction reason of up to 1,000 characters");
  const result = await db.rpc("update_invoice_payment_with_date", {
    p_invoice_id: invoice.id, p_payment_id: assertUuid(paymentId, "Receipt"),
    p_amount: receipt.data.amount, p_method: receipt.data.method, p_reference: receipt.data.reference || null,
    p_expected_version: validateExpectedVersion(input.expected_version), p_reason: reason, p_actor: ctx.userId,
    p_receipt_date: validatedReceiptDate(input.receipt_date),
  });
  if (result.error) throwMappedDatabaseError(result.error, "Receipt");
  return result.data;
}

function validateInvoiceDoctor(value: string, label: string): string {
  const name = value?.trim();
  if (!name || name.length > 200) throw new ValidationError(`${label} doctor is required and must be at most 200 characters`);
  return name;
}

export async function createInvoice(
  ctx: AuthContext,
  input: {
    lead_id: string;
    invoice_date?: string;
    consulting_doctor_name: string;
    referring_doctor_name: string;
    tax_rate: number;
    notes?: string | null;
    discount_amount?: number;
    discount_given_by?: string | null;
    mention?: string | null;
    items: InvoiceItemInput[];
  }
): Promise<Invoice> {
  requireAnyRole(ctx, INVOICE_ROLES, "Invoices access required");
  const leadId = assertUuid(input.lead_id, "Patient");
  const invoiceDate = assertDateOnly(input.invoice_date ?? clinicToday(), "Invoice date");
  const consultingDoctorName = validateInvoiceDoctor(input.consulting_doctor_name, "Consulting");
  const referringDoctorName = validateInvoiceDoctor(input.referring_doctor_name, "Referring");
  if (input.items.some((item) => !item.treatment_type_id || item.treatment_id)) {
    throw new ValidationError("New invoices must use treatments from this center’s treatment list");
  }
  validateInvoiceInput(input.items, input.tax_rate);
  if (input.notes && input.notes.length > 4_000) {
    throw new ValidationError("Invoice notes are too long");
  }
  const discountAmount = input.discount_amount ?? 0;
  computeInvoiceTotalWithDiscount(input.items, input.tax_rate, discountAmount);
  if (input.discount_given_by && input.discount_given_by.length > 200) throw new ValidationError("Discount giver name is too long");
  if (input.mention && input.mention.length > 1_000) throw new ValidationError("Invoice mention is too long");

  const leadResult = await db
    .from("leads")
    .select("branch_id, assignee_id")
    .eq("id", leadId)
    .maybeSingle();
  if (leadResult.error) throw leadResult.error;
  if (!leadResult.data) throw new NotFoundError("Patient");
  assertInvoiceWriteAccess(ctx, leadResult.data);
  await validateCatalogTreatmentsForBranch(input.items, leadResult.data.branch_id);
  const invoiceResult = await db.rpc("create_patient_invoice", {
    p_lead_id: leadId,
    p_invoice_date: invoiceDate,
    p_consulting_doctor_name: consultingDoctorName,
    p_referring_doctor_name: referringDoctorName,
    p_tax_rate: input.tax_rate,
    p_discount_amount: discountAmount,
    p_discount_given_by: input.discount_given_by?.trim() || null,
    p_mention: input.mention?.trim() || null,
    p_notes: input.notes?.trim() || null,
    p_items: input.items.map((item) => ({
      ...(item.invoice_item_id ? { invoice_item_id: item.invoice_item_id } : {}),
      ...(item.treatment_id ? { treatment_id: item.treatment_id } : { treatment_type_id: item.treatment_type_id }),
      quantity: item.quantity,
      unit_price: item.unit_price,
      tooth_numbers: item.tooth_numbers ?? [],
      line_note: item.line_note?.trim() || null,
    })) as Json,
    p_actor: ctx.userId,
  });
  if (invoiceResult.error) throwMappedDatabaseError(invoiceResult.error, "Invoice");
  return invoiceResult.data;
}

export async function cancelInvoice(ctx: AuthContext, id: string, reason: string, expectedVersion: number, archive = false) {
  if (ctx.role !== "admin") throw new AuthorizationError("Only an admin can cancel invoices");
  const invoiceId = assertUuid(id, "Invoice");
  if (!reason.trim() || reason.length > 1000) throw new ValidationError("A cancellation reason is required");
  const result = await db.rpc("void_invoice", { p_invoice_id: invoiceId, p_actor: ctx.userId, p_reason: reason.trim(),
    p_expected_version: validateExpectedVersion(expectedVersion), p_archive: archive });
  if (result.error) throwMappedDatabaseError(result.error, "Invoice");
}

export async function createConsultationInvoice(
  ctx: AuthContext,
  input: { lead_id: string; amount: number; notes?: string | null; consulting_doctor_name: string; referring_doctor_name: string }
): Promise<Invoice> {
  requireAnyRole(ctx, INVOICE_ROLES, "Invoices access required");
  const leadId = assertUuid(input.lead_id, "Patient");
  if (!Number.isFinite(input.amount) || input.amount < 0 || input.amount > MAX_UNIT_PRICE) {
    throw new ValidationError("Consultation amount must be zero or greater and within the allowed limit");
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
  if (!leadResult.data) throw new NotFoundError("Patient");
  assertInvoiceWriteAccess(ctx, leadResult.data);
  const consultingDoctorName = validateInvoiceDoctor(input.consulting_doctor_name, "Consulting");
  const referringDoctorName = validateInvoiceDoctor(input.referring_doctor_name, "Referring");
  const result = await db.rpc("create_consultation_invoice", {
    p_consulting_doctor_name: consultingDoctorName,
    p_referring_doctor_name: referringDoctorName,
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
  cancelled: [],
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
    invoice_date?: string;
    tax_rate: number;
    notes?: string | null;
    discount_amount?: number;
    discount_given_by?: string | null;
    mention?: string | null;
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
  if (invoice.status === "cancelled") {
    throw new ConflictError("A voided invoice cannot be edited");
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
  const discountAmount = input.discount_amount ?? invoice.discount_amount;
  computeInvoiceTotalWithDiscount(input.items, input.tax_rate, discountAmount);
  if (input.discount_given_by && input.discount_given_by.length > 200) throw new ValidationError("Discount giver name is too long");
  if (input.mention && input.mention.length > 1000) throw new ValidationError("Invoice mention is too long");
  await validateCatalogTreatmentsForBranch(input.items, invoice.branch_id);
  if (input.notes && input.notes.length > 4_000) {
    throw new ValidationError("Invoice notes are too long");
  }

  const updateResult = await db.rpc("update_invoice_with_date", {
    p_invoice_id: invoice.id,
    p_invoice_date: input.invoice_date === undefined ? null : assertDateOnly(input.invoice_date, "Invoice date"),
    p_tax_rate: input.tax_rate,
    p_notes: input.notes?.trim() || null,
    p_discount_amount: discountAmount,
    p_discount_given_by: input.discount_given_by?.trim() || null,
    p_mention: input.mention?.trim() || null,
    p_items: input.items.map((item) => ({
      ...(item.invoice_item_id ? { invoice_item_id: item.invoice_item_id } : {}),
      ...(item.treatment_id ? { treatment_id: item.treatment_id } : { treatment_type_id: item.treatment_type_id }),
      quantity: item.quantity,
      unit_price: item.unit_price,
      tooth_numbers: item.tooth_numbers ?? [],
      line_note: item.line_note?.trim() || null,
    })) as Json,
    p_actor: ctx.userId,
    p_expected_version: expectedVersion,
  });
  if (updateResult.error) throwMappedDatabaseError(updateResult.error, "Invoice");
}

export async function updateConsultationInvoice(ctx: AuthContext, id: string, input: { amount: number; notes?: string; invoice_date?: string; expected_version: number }) {
  const invoice = await loadInvoiceScope(id);
  if (!invoice) throw new NotFoundError("Invoice");
  assertInvoiceWriteAccess(ctx, { branch_id: invoice.branch_id, assignee_id: invoice.lead?.assignee_id ?? null });
  if (invoice.invoice_kind !== "consultation" || invoice.status === "cancelled") throw new ConflictError("This invoice cannot be edited");
  if (!Number.isFinite(input.amount) || input.amount < invoice.discount_amount || input.amount > MAX_UNIT_PRICE || !hasAtMostTwoDecimals(input.amount)) throw new ValidationError("Enter a valid amount at least equal to the discount");
  if (input.notes && input.notes.length > 4000) throw new ValidationError("Invoice notes are too long");
  const result = await db.rpc("update_invoice_with_date", { p_invoice_id: invoice.id, p_tax_rate: invoice.tax_rate,
    p_invoice_date: input.invoice_date === undefined ? null : assertDateOnly(input.invoice_date, "Invoice date"),
    p_discount_amount: null, p_discount_given_by: null, p_mention: null,
    p_notes: input.notes?.trim() || null, p_actor: ctx.userId, p_expected_version: validateExpectedVersion(input.expected_version),
    p_items: [{ description: "Consultation", quantity: 1, unit_price: input.amount }] });
  if (result.error) throwMappedDatabaseError(result.error, "Invoice");
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
  if (invoice.status === "paid" || invoice.status === "cancelled") {
    throw new ConflictError("Use the admin void workflow to archive a paid or voided invoice");
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
