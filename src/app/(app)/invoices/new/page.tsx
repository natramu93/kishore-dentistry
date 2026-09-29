import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { getLeadRelated, listLeads } from "@/data/leads";
import { listInvoiceTreatmentCatalog } from "@/data/invoices";
import { InvoiceEditor } from "@/components/invoices/invoice-editor";
import { ConsultationInvoiceForm } from "@/components/invoices/consultation-invoice-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtDate } from "@/lib/tz";

export const metadata = { title: "New Invoice — Dr. Kishor's Dentistry CRM" };

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string; q?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getAuthContext();
  if (!params.lead) {
    const { leads, total } = await listLeads(ctx, {
      search: params.q,
      pageSize: 20,
    });

    return (
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Create invoice</h1>
          <p className="text-sm text-muted-foreground">
            Choose a patient to create an invoice from the center’s treatment list. No completed treatment or case sheet is required.
          </p>
        </div>
        <form action="/invoices/new" method="get" className="flex flex-wrap items-end gap-3">
          <div className="min-w-60 flex-1 space-y-1">
            <Label htmlFor="invoice-patient-search">Find patient</Label>
            <Input
              id="invoice-patient-search"
              name="q"
              type="search"
              placeholder="Name, mobile, or email"
              defaultValue={params.q}
            />
          </div>
          <Button type="submit" variant="secondary">Search</Button>
        </form>
        <div className="divide-y rounded-md border">
          {leads.map((lead) => (
            <div key={lead.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate font-medium">{lead.name}</p>
                <p className="text-sm text-muted-foreground">
                  {lead.mobile} · {lead.branch?.name ?? "Center not set"} · Added {fmtDate(lead.created_at)}
                </p>
              </div>
              <Button asChild size="sm">
                <Link href={`/invoices/new?lead=${encodeURIComponent(lead.id)}`}>Create invoice</Link>
              </Button>
            </div>
          ))}
          {leads.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {params.q ? "No patients match that search." : "No patients are available for invoicing."}
            </p>
          )}
        </div>
        {total > leads.length && (
          <p className="text-xs text-muted-foreground">Showing the 20 most recent matching patients. Search to find another patient.</p>
        )}
        <Button asChild variant="outline"><Link href="/invoices">Back to invoices</Link></Button>
      </div>
    );
  }

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
