import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { getLeadRelated } from "@/data/leads";
import { listTreatmentTypes } from "@/data/catalogs";
import { InvoiceEditor } from "@/components/invoices/invoice-editor";

export const metadata = { title: "New Invoice — Dr. Kishor's Dentistry CRM" };

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string; treatment?: string }>;
}) {
  const params = await searchParams;
  if (!params.lead) redirect("/leads");

  const ctx = await getAuthContext();
  const [related, catalog] = await Promise.all([
    getLeadRelated(ctx, params.lead),
    listTreatmentTypes(ctx),
  ]);
  if (!related) notFound();
  const { lead, treatments } = related;

  const treatment = treatments.find((t) => t.id === params.treatment) ?? null;
  const initialItems = treatment
    ? [
        {
          description: (treatment.treatment_type as { name: string } | null)?.name ?? "Treatment",
          quantity: 1,
          unit_price: treatment.cost ?? 0,
        },
      ]
    : [{ description: "", quantity: 1, unit_price: 0 }];

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New invoice</h1>
        <p className="text-sm text-muted-foreground">
          For {lead.name} · {lead.branch?.name}
        </p>
      </div>
      <InvoiceEditor
        mode="create"
        leadId={lead.id}
        treatmentId={treatment?.id ?? null}
        treatmentCatalog={catalog.map((c) => ({ id: c.id, name: c.name, default_cost: c.default_cost }))}
        initialItems={initialItems}
      />
    </div>
  );
}
