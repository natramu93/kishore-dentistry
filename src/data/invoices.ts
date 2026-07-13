import "server-only";

import { db } from "./db";
import type { AuthContext } from "@/lib/auth/context";
import { assertBranchAccess, assertLeadWriteAccess, canDelete } from "@/lib/auth/guards";
import type { Invoice, InvoiceItem, InvoiceStatus } from "@/lib/database.types";

const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

export type InvoiceWithRefs = Invoice & {
  lead: { id: string; name: string; mobile: string; email: string | null } | null;
  branch: { name: string; code: string; address: string | null; phone: string | null } | null;
};

export type InvoiceItemInput = { description: string; quantity: number; unit_price: number };

function computeTotals(items: InvoiceItemInput[], taxRate: number) {
  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
  const tax_amount = Math.round(subtotal * taxRate) / 100;
  return { subtotal, tax_amount, total: subtotal + tax_amount };
}

export async function listInvoices(
  ctx: AuthContext,
  opts: { branchId?: string; status?: InvoiceStatus } = {}
): Promise<InvoiceWithRefs[]> {
  let q = db
    .from("invoices")
    .select("*, lead:leads(id, name, mobile, email), branch:branches(name, code, address, phone)")
    .order("created_at", { ascending: false });
  if (ctx.role !== "admin") {
    q = q.in("branch_id", ctx.branchIds.length ? ctx.branchIds : [EMPTY_UUID]);
  }
  if (opts.branchId) {
    assertBranchAccess(ctx, opts.branchId);
    q = q.eq("branch_id", opts.branchId);
  }
  if (opts.status) q = q.eq("status", opts.status);

  // Invoicing is a Front Office / Operations workflow — a doctor login only
  // ever sees invoices tied to treatments they personally performed.
  if (ctx.role === "doctor") {
    const { data: myTreatments } = await db
      .from("treatments")
      .select("id")
      .eq("doctor_id", ctx.doctorId ?? EMPTY_UUID);
    const ids = (myTreatments ?? []).map((t) => t.id);
    q = q.in("treatment_id", ids.length ? ids : [EMPTY_UUID]);
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as InvoiceWithRefs[];
}

export async function getInvoice(
  ctx: AuthContext,
  id: string
): Promise<(InvoiceWithRefs & { items: InvoiceItem[] }) | null> {
  const { data, error } = await db
    .from("invoices")
    .select("*, lead:leads(id, name, mobile, email), branch:branches(name, code, address, phone)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (ctx.role !== "admin" && !ctx.branchIds.includes(data.branch_id)) return null;

  const { data: items } = await db
    .from("invoice_items")
    .select("*")
    .eq("invoice_id", id)
    .order("created_at");
  return { ...(data as InvoiceWithRefs), items: items ?? [] };
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
  const { data: lead } = await db
    .from("leads")
    .select("branch_id, assignee_id")
    .eq("id", input.lead_id)
    .maybeSingle();
  if (!lead) throw new Error("Lead not found");
  assertLeadWriteAccess(ctx, lead);
  if (!input.items.length) throw new Error("Invoice needs at least one line item");

  const { data: invoiceNumber, error: numError } = await db.rpc("next_invoice_number", {
    p_branch_id: lead.branch_id,
  });
  if (numError) throw numError;

  const totals = computeTotals(input.items, input.tax_rate);
  const { data: invoice, error } = await db
    .from("invoices")
    .insert({
      invoice_number: invoiceNumber as string,
      lead_id: input.lead_id,
      treatment_id: input.treatment_id ?? null,
      tax_rate: input.tax_rate,
      notes: input.notes ?? null,
      ...totals,
      created_by: ctx.userId,
    })
    .select()
    .single();
  if (error) throw error;

  const { error: itemsError } = await db.from("invoice_items").insert(
    input.items.map((i) => ({
      invoice_id: invoice.id,
      description: i.description,
      quantity: i.quantity,
      unit_price: i.unit_price,
      amount: Math.round(i.quantity * i.unit_price * 100) / 100,
    }))
  );
  if (itemsError) throw itemsError;

  await db.from("lead_activity").insert({
    lead_id: input.lead_id,
    actor_id: ctx.userId,
    type: "invoice",
    detail: { invoice_id: invoice.id, invoice_number: invoice.invoice_number, total: totals.total },
  });

  return invoice;
}

export async function updateInvoiceStatus(ctx: AuthContext, id: string, status: InvoiceStatus) {
  const { data: invoice } = await db.from("invoices").select("branch_id, status").eq("id", id).maybeSingle();
  if (!invoice) throw new Error("Invoice not found");
  assertBranchAccess(ctx, invoice.branch_id);

  const { error } = await db
    .from("invoices")
    .update({
      status,
      ...(status !== "draft" && { issued_at: new Date().toISOString() }),
    })
    .eq("id", id);
  if (error) throw error;
}

/** Edit line items / tax / notes and recompute totals. Invoice number is preserved. */
export async function updateInvoice(
  ctx: AuthContext,
  id: string,
  input: { tax_rate: number; notes?: string | null; items: InvoiceItemInput[] }
) {
  const { data: invoice } = await db.from("invoices").select("branch_id, status").eq("id", id).maybeSingle();
  if (!invoice) throw new Error("Invoice not found");
  assertBranchAccess(ctx, invoice.branch_id);
  if (invoice.status === "paid") throw new Error("A paid invoice cannot be edited");
  if (!input.items.length) throw new Error("Invoice needs at least one line item");

  const totals = computeTotals(input.items, input.tax_rate);
  const { error } = await db
    .from("invoices")
    .update({ tax_rate: input.tax_rate, notes: input.notes ?? null, ...totals })
    .eq("id", id);
  if (error) throw error;

  // Replace line items
  await db.from("invoice_items").delete().eq("invoice_id", id);
  const { error: itemsError } = await db.from("invoice_items").insert(
    input.items.map((i) => ({
      invoice_id: id,
      description: i.description,
      quantity: i.quantity,
      unit_price: i.unit_price,
      amount: Math.round(i.quantity * i.unit_price * 100) / 100,
    }))
  );
  if (itemsError) throw itemsError;
}

/** Delete an invoice (and its items via cascade). Operations/admin only. */
export async function deleteInvoice(ctx: AuthContext, id: string) {
  const { data: invoice } = await db
    .from("invoices")
    .select("branch_id, lead_id, invoice_number")
    .eq("id", id)
    .maybeSingle();
  if (!invoice) return;
  if (!canDelete(ctx.role)) throw new Error("Only Operations or Admin can delete invoices");
  assertBranchAccess(ctx, invoice.branch_id);

  const { error } = await db.from("invoices").delete().eq("id", id);
  if (error) throw error;

  await db.from("lead_activity").insert({
    lead_id: invoice.lead_id,
    actor_id: ctx.userId,
    type: "invoice",
    detail: { event: "invoice_deleted", invoice_number: invoice.invoice_number },
  });
}
