import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { getInvoice, listInvoiceEligibleTreatments, listInvoiceTreatmentCatalog } from "@/data/invoices";
import { InvoiceEditor } from "@/components/invoices/invoice-editor";

export const metadata = { title: "Edit Invoice — Dr. Kishor's Dentistry CRM" };

export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getAuthContext();
  const invoice = await getInvoice(ctx, id);
  if (!invoice) notFound();
  if (!invoice.code_enforced) redirect(`/invoices/${invoice.id}`);
  const [eligible, treatmentOptions] = await Promise.all([
    listInvoiceEligibleTreatments(ctx, invoice.lead_id),
    listInvoiceTreatmentCatalog(ctx),
  ]);
  const currentCatalog = invoice.items
    .filter((item) => item.treatment_id && item.treatment_code)
    .map((item) => ({
      id: item.treatment_id!,
      code: item.treatment_code!,
      name: item.treatment_name ?? item.description,
      site_label: formatTreatmentSite(item),
      quantity: item.quantity,
      unit_price: item.unit_price,
    }));
  const catalog = [
    ...currentCatalog,
    ...eligible
      .filter((treatment) => !currentCatalog.some((current) => current.id === treatment.id))
      .map((treatment) => ({
        id: treatment.id,
        code: treatment.treatment_code,
        name: treatment.treatment_name,
        site_label: formatTreatmentSite(treatment),
        quantity: treatment.quantity,
        unit_price: treatment.cost ?? 0,
      })),
  ];

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
        initialVersion={invoice.version}
        primaryTreatmentId={invoice.treatment_id}
        leadId={invoice.lead_id}
        treatmentCatalog={catalog}
        treatmentOptions={treatmentOptions}
        initialItems={invoice.items.map((item) => ({
          treatment_id: item.treatment_id,
          treatment_type_id: item.treatment_type_id,
          treatment_code: item.treatment_code,
          description: item.treatment_name ?? item.description,
          site_label: item.treatment_id ? formatTreatmentSite(item) : item.treatment_category ?? "Additional invoice item",
          quantity: item.quantity,
          unit_price: item.unit_price,
        }))}
        initialTaxRate={invoice.tax_rate}
        initialNotes={invoice.notes ?? ""}
      />
    </div>
  );
}

function formatTreatmentSite(item: {
  site_scope: string | null;
  site_detail: string | null;
  tooth_number: string | null;
  tooth_numbers?: string[] | null;
  surfaces: string[] | null;
}): string {
  if (item.site_scope === "tooth") {
    return `IS 8815 tooth ${item.tooth_numbers?.length ? item.tooth_numbers.join(", ") : item.tooth_number}${
      item.surfaces?.length ? ` (${item.surfaces.join(", ")})` : ""
    }`;
  }
  if (item.site_scope === "multi_tooth") {
    return `IS 8815 teeth ${item.tooth_numbers?.join(", ") ?? item.tooth_number ?? ""}${
      item.surfaces?.length ? ` (${item.surfaces.join(", ")})` : ""
    }`;
  }
  if (item.site_scope === "full_mouth") return "Full mouth";
  if (item.site_scope === "arch") return `${(item.site_detail ?? "").replaceAll("_", " ")} arch`.trim();
  if (item.site_scope === "quadrant") return `${(item.site_detail ?? "").replaceAll("_", " ")} quadrant`.trim();
  return "General / not tooth-specific";
}
