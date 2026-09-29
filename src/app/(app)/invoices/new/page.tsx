import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { getLead, listLeads } from "@/data/leads";
import { listInvoiceTreatmentCatalog } from "@/data/invoices";
import { InvoiceEditor } from "@/components/invoices/invoice-editor";
import { consultationInvoicePreset } from "@/lib/invoice-lines";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtDate } from "@/lib/tz";

export const metadata = { title: "New Invoice — Dr. Kishor's Dentistry CRM" };

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string; q?: string; preset?: string }>;
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

  const lead = await getLead(ctx, params.lead);
  if (!lead) notFound();
  const treatmentOptions = await listInvoiceTreatmentCatalog(ctx, lead.branch_id);
  const preset = params.preset === "consultation" ? consultationInvoicePreset(treatmentOptions) : null;
  const needsAssignment = ctx.role === "front_office" && lead.assignee_id !== ctx.userId;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New invoice</h1>
        <p className="text-sm text-muted-foreground">
          For {lead.name} · {lead.branch?.name}
        </p>
      </div>
      <Button asChild variant="outline" size="sm"><Link href={`/leads/${lead.id}#patient-invoices`}>Back to patient invoices</Link></Button>
      {needsAssignment && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/20 dark:text-amber-100" role="status">
        This patient is not assigned to you yet. <Link href={`/leads/${lead.id}`} className="font-medium underline underline-offset-4">Return to the patient and claim the lead</Link> before creating an invoice.
      </p>}
      {params.preset === "consultation" && <p className="rounded-lg border bg-muted/40 p-3 text-sm" role="status">
        {preset ? "Consultation has been selected at this center’s default rate. Change the amount or add other treatments below."
          : "No active general consultation is configured for this center. Choose a treatment below, or ask the center admin to configure it."}
      </p>}
      {!needsAssignment && <InvoiceEditor
        key={`${lead.id}:${params.preset === "consultation" ? "consultation" : "standard"}`}
        mode="create"
        leadId={lead.id}
        treatmentCatalog={[]}
        treatmentOptions={treatmentOptions}
        initialItems={preset ? [preset] : []}
      />}
    </div>
  );
}
