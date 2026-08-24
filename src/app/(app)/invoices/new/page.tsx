import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { getLeadRelated } from "@/data/leads";
import { listInvoiceEligibleTreatments } from "@/data/invoices";
import { InvoiceEditor } from "@/components/invoices/invoice-editor";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "New Invoice — Dr. Kishor's Dentistry CRM" };

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string; treatment?: string }>;
}) {
  const params = await searchParams;
  if (!params.lead) redirect("/leads");

  const ctx = await getAuthContext();
  const [related, eligibleTreatments] = await Promise.all([
    getLeadRelated(ctx, params.lead),
    listInvoiceEligibleTreatments(ctx, params.lead),
  ]);
  if (!related) notFound();
  const { lead } = related;
  const selectedTreatment =
    eligibleTreatments.find((treatment) => treatment.id === params.treatment) ?? null;
  const initialItems = selectedTreatment
    ? [
        {
          treatment_id: selectedTreatment.id,
          treatment_code: selectedTreatment.treatment_code,
          description: selectedTreatment.treatment_name,
          site_label: formatTreatmentSite(selectedTreatment),
          quantity: selectedTreatment.quantity,
          unit_price: selectedTreatment.cost ?? 0,
        },
      ]
    : [];

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New invoice</h1>
        <p className="text-sm text-muted-foreground">
          For {lead.name} · {lead.branch?.name}
        </p>
      </div>
      {eligibleTreatments.length === 0 && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="pt-6 text-sm">
            <p className="font-medium">Invoice generation is locked</p>
            <p className="mt-1 text-muted-foreground">
              This patient has no finalized, completed, coded treatment that remains uninvoiced.
              Record the treatment in a digital case sheet first.
            </p>
          </CardContent>
        </Card>
      )}
      <InvoiceEditor
        mode="create"
        leadId={lead.id}
        treatmentCatalog={eligibleTreatments.map((treatment) => ({
          id: treatment.id,
          code: treatment.treatment_code,
          name: treatment.treatment_name,
          site_label: formatTreatmentSite(treatment),
          quantity: treatment.quantity,
          unit_price: treatment.cost ?? 0,
        }))}
        initialItems={initialItems}
      />
    </div>
  );
}

function formatTreatmentSite(treatment: {
  site_scope: string;
  site_detail: string | null;
  tooth_number: string | null;
  surfaces: string[];
}): string {
  if (treatment.site_scope === "tooth") {
    return `FDI tooth ${treatment.tooth_number}${
      treatment.surfaces.length ? ` (${treatment.surfaces.join(", ")})` : ""
    }`;
  }
  if (treatment.site_scope === "full_mouth") return "Full mouth";
  if (treatment.site_scope === "arch") {
    return `${(treatment.site_detail ?? "").replaceAll("_", " ")} arch`.trim();
  }
  if (treatment.site_scope === "quadrant") {
    return `${(treatment.site_detail ?? "").replaceAll("_", " ")} quadrant`.trim();
  }
  return "General / not tooth-specific";
}
