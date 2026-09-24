"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import * as invoices from "@/data/invoices";
import { assertActionRateLimit } from "@/lib/rate-limit";
import {
  invoiceStatusSchema,
  uuidSchema,
} from "@/lib/validation";
import {
  runAction,
  runActionWithValue,
  type ActionResult,
} from "./util";

const MAX_UNIT_PRICE = 99_999_999.99;
const MAX_INVOICE_TOTAL = 9_999_999_999.99;

function hasAtMostTwoDecimals(value: number): boolean {
  const scaled = value * 100;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

const money = z.coerce
  .number()
  .finite()
  .min(0)
  .max(MAX_UNIT_PRICE)
  .refine(hasAtMostTwoDecimals, "Amounts support at most two decimals");
const invoiceItemSchema = z.object({
  treatment_id: uuidSchema.nullable().optional(),
  treatment_type_id: uuidSchema.nullable().optional(),
  quantity: z.coerce
    .number()
    .finite()
    .positive()
    .max(100_000)
    .refine(hasAtMostTwoDecimals, "Quantity supports at most two decimals"),
  unit_price: money,
}).refine(
  (item) => Boolean(item.treatment_id) !== Boolean(item.treatment_type_id),
  "Choose either a case-sheet treatment or a catalog treatment for each line"
);
const invoiceDetailsSchema = z.object({
  tax_rate: z.coerce
    .number()
    .finite()
    .min(0)
    .max(100)
    .refine(hasAtMostTwoDecimals, "Tax rate supports at most two decimals")
    .default(0),
  notes: z.string().trim().max(4_000).optional(),
  items: z
    .array(invoiceItemSchema)
    .min(1, "At least one line item is required")
    .max(100, "An invoice can contain at most 100 line items"),
});

function validateInvoiceTotal(
  invoice: z.infer<typeof invoiceDetailsSchema>,
  context: z.RefinementCtx
): void {
  const subtotal = invoice.items.reduce(
    (sum, item) => sum + item.quantity * item.unit_price,
    0
  );
  const total = subtotal + (subtotal * invoice.tax_rate) / 100;
  if (
    !Number.isFinite(subtotal) ||
    !Number.isFinite(total) ||
    subtotal > MAX_INVOICE_TOTAL ||
    total > MAX_INVOICE_TOTAL
  ) {
    context.addIssue({
      code: "custom",
      path: ["items"],
      message: "Invoice total is too large",
    });
  }
}

const invoiceSchema = invoiceDetailsSchema
  .extend({
    lead_id: uuidSchema,
  })
  .superRefine(validateInvoiceTotal);
const invoiceUpdateSchema = invoiceDetailsSchema
  .extend({
    expected_version: z.coerce.number().int().positive(),
  })
  .superRefine(validateInvoiceTotal);
const consultationInvoiceSchema = z.object({
  lead_id: uuidSchema,
  amount: z.coerce
    .number()
    .finite()
    .positive()
    .max(MAX_UNIT_PRICE)
    .refine(hasAtMostTwoDecimals, "Consultation amount supports at most two decimals")
    .default(200),
  notes: z.string().trim().max(4_000).optional(),
});

async function invoiceMutationLimit(userId: string): Promise<void> {
  await assertActionRateLimit(userId, "invoice:mutation", {
    limit: 30,
    windowMs: 5 * 60_000,
  });
}

export async function createInvoiceAction(
  input: unknown
): Promise<ActionResult & { id?: string }> {
  const ctx = await getAuthContext();
  const parsed = invoiceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid invoice" };
  }
  return runActionWithValue(async () => {
    await invoiceMutationLimit(ctx.userId);
    const invoice = await invoices.createInvoice(ctx, {
      lead_id: parsed.data.lead_id,
      tax_rate: parsed.data.tax_rate,
      notes: parsed.data.notes || null,
      items: parsed.data.items,
    });
    revalidatePath(`/leads/${parsed.data.lead_id}`);
    revalidatePath("/invoices");
    return { id: invoice.id };
  });
}

export async function createConsultationInvoiceAction(
  input: unknown
): Promise<ActionResult & { id?: string }> {
  const ctx = await getAuthContext();
  const parsed = consultationInvoiceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid consultation invoice" };
  }
  return runActionWithValue(async () => {
    await invoiceMutationLimit(ctx.userId);
    const invoice = await invoices.createConsultationInvoice(ctx, {
      lead_id: parsed.data.lead_id,
      amount: parsed.data.amount,
      notes: parsed.data.notes || null,
    });
    revalidatePath(`/leads/${parsed.data.lead_id}`);
    revalidatePath("/invoices");
    return { id: invoice.id };
  });
}

export async function updateInvoiceStatusAction(
  id: string,
  status: unknown,
  expectedVersion: unknown
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsed = z
    .object({
      id: uuidSchema,
      status: invoiceStatusSchema,
      expectedVersion: z.coerce.number().int().positive(),
    })
    .safeParse({ id, status, expectedVersion });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid invoice status" };
  }
  return runAction(async () => {
    await invoiceMutationLimit(ctx.userId);
    await invoices.updateInvoiceStatus(
      ctx,
      parsed.data.id,
      parsed.data.status,
      parsed.data.expectedVersion
    );
    revalidatePath(`/invoices/${parsed.data.id}`);
    revalidatePath("/invoices");
  });
}

export async function updateInvoiceAction(
  id: string,
  input: unknown
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const invoiceId = uuidSchema.safeParse(id);
  const parsed = invoiceUpdateSchema.safeParse(input);
  if (!invoiceId.success) return { ok: false, error: "Invoice is invalid" };
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid invoice" };
  }
  return runAction(async () => {
    await invoiceMutationLimit(ctx.userId);
    await invoices.updateInvoice(ctx, invoiceId.data, {
      tax_rate: parsed.data.tax_rate,
      notes: parsed.data.notes || null,
      items: parsed.data.items,
      expected_version: parsed.data.expected_version,
    });
    revalidatePath(`/invoices/${invoiceId.data}`);
    revalidatePath("/invoices");
  });
}

export async function deleteInvoiceAction(
  id: string,
  expectedVersion: unknown
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const invoice = z
    .object({
      id: uuidSchema,
      expectedVersion: z.coerce.number().int().positive(),
    })
    .safeParse({ id, expectedVersion });
  if (!invoice.success) return { ok: false, error: "Invoice is invalid" };
  return runAction(async () => {
    await invoiceMutationLimit(ctx.userId);
    await invoices.deleteInvoice(
      ctx,
      invoice.data.id,
      invoice.data.expectedVersion
    );
    revalidatePath("/invoices");
  });
}

export async function createInvoiceAndRedirect(input: unknown) {
  const result = await createInvoiceAction(input);
  if (result.ok && result.id) redirect(`/invoices/${result.id}`);
  return result;
}

export async function createConsultationInvoiceAndRedirect(input: unknown) {
  const result = await createConsultationInvoiceAction(input);
  if (result.ok && result.id) redirect(`/invoices/${result.id}`);
  return result;
}
