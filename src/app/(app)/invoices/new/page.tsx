import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { getLeadRelated } from "@/data/leads";
import { listInvoiceTreatmentCatalog } from "@/data/invoices";
import { InvoiceEditor } from "@/components/invoices/invoice-editor";
import { ConsultationInvoiceForm } from "@/components/invoices/consultation-invoice-form";

export const metadata = { title: "New Invoice — Dr. Kishor's Dentistry CRM" };

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string }>;
}) {
  const params = await searchParams;
  if (!params.lead) redirect("/leads");

  const ctx = await getAuthContext();
  const related = await getLeadRelated(ctx, params.lead);
  if (!related) notFound();
  const { lead } = related;
  const treatmentOptions = await listInvoiceTreatmentCatalog(ctx, lead.branch_id);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New invoice</h1>
        <p className="text-sm text-muted-foreground">
          For {lead.name} · {lead.branch?.name}
        </p>
      </div>
      <ConsultationInvoiceForm leadId={lead.id} />
      <InvoiceEditor
        mode="create"
        leadId={lead.id}
        treatmentCatalog={[]}
        treatmentOptions={treatmentOptions}
        initialItems={[]}
      />
    </div>
  );
}
