import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { CaseSheetEditor } from "@/components/clinical/case-sheet-editor";
import { InvoiceEditor } from "@/components/invoices/invoice-editor";
import { RecordPaymentForm } from "@/components/invoices/record-payment-form";
import { PatientSectionNav } from "@/components/patients/patient-section-nav";
import { TreatmentProgressSummary } from "@/components/clinical/treatment-progress-summary";
import { VisitHistory } from "@/components/clinical/visit-history";
import { PatientIdentityFields } from "@/components/leads/patient-identity-fields";
import { RowEditDialog } from "@/components/admin/row-edit-dialog";
import type { TreatmentProgressRecord } from "@/lib/treatment-progress";
import "@/app/globals.css";

const pendingPlan: TreatmentProgressRecord = {
  id: "00000000-0000-4000-8000-000000000006",
  case_sheet_id: "00000000-0000-4000-8000-000000000007",
  treatment_code: "K02.9", treatment_name: "Dental caries, unspecified",
  clinical_status: "planned", site_scope: "multi_tooth", site_detail: null,
  tooth_number: null, tooth_numbers: ["16", "26", "36"], remaining_tooth_numbers: ["26", "36"],
  surfaces: [], notes: "Synthetic earlier plan: review the remaining teeth at the next visit.",
  treated_at: "2026-09-01T04:30:00.000Z", performed_at: null, doctor: { full_name: "Preview doctor" },
};
const completedVisit: TreatmentProgressRecord = {
  ...pendingPlan,
  id: "00000000-0000-4000-8000-000000000008",
  clinical_status: "completed",
  treatment_name: "Restoration",
  treated_at: "2026-09-10T04:30:00.000Z",
  performed_at: "2026-09-10T04:30:00.000Z",
};

function Preview() {
  const [view, setView] = useState("case-sheet");
  const [payload, setPayload] = useState<unknown>(null);
  useEffect(() => {
    const capture = (event: Event) => setPayload((event as CustomEvent).detail);
    window.addEventListener("preview-submit", capture);
    return () => window.removeEventListener("preview-submit", capture);
  }, []);
  return <main className="mx-auto min-w-0 max-w-5xl space-y-5 p-3 sm:p-6">
    <header className="space-y-3 rounded-lg border bg-muted p-3">
      <h1 className="font-bold">Dental workflow preview</h1>
      <p className="text-sm">Synthetic examples only. No database connection; Save only previews the submitted values in memory.</p>
      <nav aria-label="Preview workflow" className="flex flex-wrap gap-3">
        <button className="min-h-11 rounded border bg-background px-3" aria-pressed={view === "case-sheet"} onClick={() => setView("case-sheet")}>Case sheet</button>
        <button className="min-h-11 rounded border bg-background px-3" aria-pressed={view === "invoice"} onClick={() => setView("invoice")}>Invoice</button>
        <button className="min-h-11 rounded border bg-background px-3" aria-pressed={view === "payment"} onClick={() => setView("payment")}>Payment</button>
        <RowEditDialog title="Edit patient details" triggerLabel="Edit patient" contentClassName="sm:max-w-2xl"
          action={async (form) => { setPayload(Object.fromEntries(form)); return { ok: true }; }}>
          <PatientIdentityFields />
          <label className="block">Age (years)<input name="age" type="number" min="0" max="120" step="any" inputMode="decimal" className="block h-11 w-full rounded-md border p-2" /></label>
        </RowEditDialog>
      </nav>
    </header>
    <PatientSectionNav sections={[{ id: "preview-entry", label: "Visit entry" }, { id: "preview-progress", label: "Treatment progress" }, { id: "preview-output", label: "Submitted values" }]} />
    <section id="preview-entry" className="scroll-mt-20">
    {view === "case-sheet" ? <CaseSheetEditor
      leadId="00000000-0000-4000-8000-000000000001"
      appointmentId="00000000-0000-4000-8000-000000000002"
      doctors={[{ id: "00000000-0000-4000-8000-000000000003", label: "Preview doctor" }]}
      doctorLocked
      treatmentCodes={[{ code: "K02.9", name: "Dental caries, unspecified", code_system: "ICD10_IN", code_level: "detail", billable: true }]}
      pendingPlans={{ records: [pendingPlan], total: 1 }}
    /> : view === "payment" ? <RecordPaymentForm invoiceId="00000000-0000-4000-8000-000000000009" balanceDue={800} /> : <InvoiceEditor
      mode="create"
      leadId="00000000-0000-4000-8000-000000000001"
      treatmentCatalog={[]}
      treatmentOptions={[
        { id: "00000000-0000-4000-8000-000000000004", name: "Consultation", category: "General", default_cost: 200, is_general_consultation: true },
        { id: "00000000-0000-4000-8000-000000000005", name: "Restoration", category: "Restorative", default_cost: 1000, is_general_consultation: false },
      ]}
      initialItems={[]}
      existingBalanceDue={200}
    />}
    </section>
    <section id="preview-progress" className="grid scroll-mt-20 items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(17rem,1fr)]">
      <TreatmentProgressSummary leadId="00000000-0000-4000-8000-000000000001" planned={{ records: [pendingPlan], total: 1 }} />
      <aside className="min-w-0 space-y-4" aria-label="Visit history and activity">
        <VisitHistory leadId="00000000-0000-4000-8000-000000000001" completed={{ records: [completedVisit], total: 1 }} />
        <div className="rounded-lg border p-3"><h2 className="font-medium">Activity</h2><p className="text-sm">Synthetic activity item.</p></div>
      </aside>
    </section>
    <section id="preview-output" className="scroll-mt-20">
    {payload !== null && <section aria-label="Preview submitted values" className="rounded border p-3">
      <h2 className="font-semibold">Preview only — nothing saved to a database</h2>
      <pre className="overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(payload, null, 2)}</pre>
    </section>}
    </section>
    <Toaster />
  </main>;
}

createRoot(document.getElementById("root")!).render(<Preview />);
