import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { CaseSheetEditor } from "@/components/clinical/case-sheet-editor";
import { InvoiceEditor } from "@/components/invoices/invoice-editor";
import { PatientSectionNav } from "@/components/patients/patient-section-nav";
import { TreatmentProgressSummary } from "@/components/clinical/treatment-progress-summary";
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
      <nav aria-label="Preview workflow" className="flex gap-3">
        <button className="min-h-11 rounded border bg-background px-3" aria-pressed={view === "case-sheet"} onClick={() => setView("case-sheet")}>Case sheet</button>
        <button className="min-h-11 rounded border bg-background px-3" aria-pressed={view === "invoice"} onClick={() => setView("invoice")}>Invoice</button>
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
      canPrescribe
      pendingPlans={{ records: [pendingPlan], total: 1 }}
    /> : <InvoiceEditor
      mode="create"
      leadId="00000000-0000-4000-8000-000000000001"
      treatmentCatalog={[]}
      treatmentOptions={[
        { id: "00000000-0000-4000-8000-000000000004", name: "Consultation", category: "General", default_cost: 200, is_general_consultation: true },
        { id: "00000000-0000-4000-8000-000000000005", name: "Restoration", category: "Restorative", default_cost: 1000, is_general_consultation: false },
      ]}
      initialItems={[]}
    />}
    </section>
    <section id="preview-progress" className="scroll-mt-20">
      <TreatmentProgressSummary progress={{ planned: { records: [pendingPlan], total: 1 }, completed: { records: [{ ...pendingPlan, id: "00000000-0000-4000-8000-000000000008", clinical_status: "completed", site_scope: "tooth", tooth_number: "16", tooth_numbers: ["16"], remaining_tooth_numbers: ["16"], planned_treatment_id: pendingPlan.id, performed_at: "2026-09-10T04:30:00.000Z", notes: "Synthetic completed work on one tooth." }], total: 1 } }} />
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
