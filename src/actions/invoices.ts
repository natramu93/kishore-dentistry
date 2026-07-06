"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import * as invoices from "@/data/invoices";
import type { InvoiceStatus } from "@/lib/database.types";
import { runAction, type ActionResult } from "./util";

const invoiceSchema = z.object({
  lead_id: z.string().uuid(),
  treatment_id: z.string().uuid().optional().or(z.literal("")),
  tax_rate: z.coerce.number().min(0).max(100).default(0),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        description: z.string().min(1),
        quantity: z.coerce.number().positive(),
        unit_price: z.coerce.number().min(0),
      })
    )
    .min(1, "At least one line item is required"),
});

export async function createInvoiceAction(input: unknown): Promise<ActionResult & { id?: string }> {
  const ctx = await getAuthContext();
  const parsed = invoiceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid invoice" };
  }
  try {
    const invoice = await invoices.createInvoice(ctx, {
      lead_id: parsed.data.lead_id,
      treatment_id: parsed.data.treatment_id || null,
      tax_rate: parsed.data.tax_rate,
      notes: parsed.data.notes || null,
      items: parsed.data.items,
    });
    revalidatePath(`/leads/${parsed.data.lead_id}`);
    revalidatePath("/invoices");
    return { ok: true, id: invoice.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to create invoice" };
  }
}

export async function updateInvoiceStatusAction(
  id: string,
  status: InvoiceStatus
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  return runAction(async () => {
    await invoices.updateInvoiceStatus(ctx, id, status);
    revalidatePath(`/invoices/${id}`);
    revalidatePath("/invoices");
  });
}

const invoiceEditSchema = z.object({
  tax_rate: z.coerce.number().min(0).max(100).default(0),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        description: z.string().min(1),
        quantity: z.coerce.number().positive(),
        unit_price: z.coerce.number().min(0),
      })
    )
    .min(1, "At least one line item is required"),
});

export async function updateInvoiceAction(id: string, input: unknown): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsed = invoiceEditSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid invoice" };
  }
  return runAction(async () => {
    await invoices.updateInvoice(ctx, id, {
      tax_rate: parsed.data.tax_rate,
      notes: parsed.data.notes || null,
      items: parsed.data.items,
    });
    revalidatePath(`/invoices/${id}`);
    revalidatePath("/invoices");
  });
}

export async function deleteInvoiceAction(id: string): Promise<ActionResult> {
  const ctx = await getAuthContext();
  return runAction(async () => {
    await invoices.deleteInvoice(ctx, id);
    revalidatePath("/invoices");
  });
}

export async function createInvoiceAndRedirect(input: unknown) {
  const result = await createInvoiceAction(input);
  if (result.ok && result.id) redirect(`/invoices/${result.id}`);
  return result;
}
