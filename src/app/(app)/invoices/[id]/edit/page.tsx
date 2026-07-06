import { notFound } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { getInvoice } from "@/data/invoices";
import { listTreatmentTypes } from "@/data/catalogs";
import { InvoiceEditor } from "@/components/invoices/invoice-editor";

export const metadata = { title: "Edit Invoice — Dr. Kishor's Dentistry CRM" };

export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getAuthContext();
  const [invoice, catalog] = await Promise.all([
    getInvoice(ctx, id),
    listTreatmentTypes(ctx),
  ]);
  if (!invoice) notFound();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Edit invoice</h1>
        <p className="text-sm text-muted-foreground">
          {invoice.invoice_number} · {invoice.lead?.name}
        </p>
      </div>
      <InvoiceEditor
        mode="edit"
        invoiceId={invoice.id}
        leadId={invoice.lead_id}
        treatmentCatalog={catalog.map((c) => ({ id: c.id, name: c.name, default_cost: c.default_cost }))}
        initialItems={invoice.items.map((i) => ({
          description: i.description,
          quantity: i.quantity,
          unit_price: i.unit_price,
        }))}
        initialTaxRate={invoice.tax_rate}
        initialNotes={invoice.notes ?? ""}
      />
    </div>
  );
}
