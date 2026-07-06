import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { getLeadRelated } from "@/data/leads";
import { InvoiceEditor } from "./invoice-editor";

export const metadata = { title: "New Invoice — Kishore Dentistry CRM" };

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string; treatment?: string }>;
}) {
  const params = await searchParams;
  if (!params.lead) redirect("/leads");

  const ctx = await getAuthContext();
  const related = await getLeadRelated(ctx, params.lead);
  if (!related) notFound();
  const { lead, treatments } = related;

  const treatment = treatments.find((t) => t.id === params.treatment) ?? null;
  const initialItems = treatment
    ? [
        {
          description:
            (treatment.treatment_type as { name: string } | null)?.name ?? "Treatment",
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
        leadId={lead.id}
        treatmentId={treatment?.id ?? null}
        initialItems={initialItems}
      />
    </div>
  );
}
