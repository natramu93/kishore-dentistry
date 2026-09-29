import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaseSheetEditor, type CaseSheetEditorInitialValues } from "@/components/clinical/case-sheet-editor";
import type { MedicalHistoryDraft } from "@/lib/medical-history";

const mocks = vi.hoisted(() => ({
  finalize: vi.fn(),
  amend: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/actions/case-sheets", () => ({
  finalizeCaseSheetAction: mocks.finalize,
  amendCaseSheetAction: mocks.amend,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/clinical/odontogram-editor", () => ({
  OdontogramEditor: ({ onAddTreatment }: { onAddTreatment: (teeth: string[]) => void }) => (
    <button type="button" onClick={() => onAddTreatment(["16", "26"])}>Plan for selected teeth</button>
  ),
}));
vi.mock("@/components/patients/medical-history-fields", () => ({
  MedicalHistoryFields: ({ onChange }: { onChange: (value: MedicalHistoryDraft) => void }) => (
    <button type="button" onClick={() => onChange({
      reviewStatus: "reviewed_none", reviewedToday: true, conditions: [], description: "",
    })}>Confirm medical history</button>
  ),
}));

const props = {
  leadId: "00000000-0000-4000-8000-000000000001",
  doctors: [{ id: "00000000-0000-4000-8000-000000000003", label: "Treating doctor" }],
  treatmentCodes: [{ code: "K02.9", name: "Dental caries", code_system: "ICD10_IN" as const, code_level: "detail" as const, billable: true }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.finalize.mockResolvedValue({ ok: true });
  mocks.amend.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

function fillVisit() {
  fireEvent.change(screen.getByLabelText("Chief complaint"), { target: { value: "Review of sensitivity" } });
  fireEvent.change(screen.getByLabelText("Clinical remarks"), { target: { value: "Examined teeth; discussed observation and restoration options." } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm medical history" }));
}

describe("simplified CaseSheetEditor", () => {
  it("requires explicit completion of a carried plan and preserves only selected remaining teeth", async () => {
    const planId = "00000000-0000-4000-8000-000000000019";
    render(<CaseSheetEditor {...props} pendingPlans={{ records: [{
      id: planId, case_sheet_id: "old-sheet", treatment_code: "K02.9", treatment_name: "Dental caries",
      clinical_status: "planned", site_scope: "multi_tooth", site_detail: null, tooth_number: "16",
      tooth_numbers: ["16", "26", "36"], remaining_tooth_numbers: ["26", "36"], surfaces: [],
      notes: "Original reviewed plan note", treated_at: "2026-01-01T00:00:00Z", performed_at: null, doctor: null,
    }], total: 1 }} />);
    fillVisit();
    fireEvent.change(screen.getByLabelText("Continue an earlier treatment plan"), { target: { value: planId } });
    fireEvent.click(screen.getByRole("button", { name: "Add to this visit" }));
    expect(screen.getByText("Original reviewed plan note", { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save case sheet" }));
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Confirm this planned work was completed");
    const treatment = screen.getByRole("group", { name: "Treatment 1" });
    expect(within(treatment).getByRole("combobox", { name: "Approved dental code" })).toBeDisabled();
    fireEvent.change(within(treatment).getByRole("combobox", { name: "Treatment status" }), { target: { value: "completed" } });
    fireEvent.click(within(treatment).getByText("Selected teeth: 26, 36 · change"));
    expect(within(treatment).getByRole("button", { name: /^16,/ })).toBeDisabled();
    fireEvent.click(within(treatment).getByRole("button", { name: /^36,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save case sheet" }));
    await waitFor(() => expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({
      treatments: [expect.objectContaining({ planned_treatment_id: planId, status: "completed", tooth_numbers: ["26"], site_scope: "tooth" })],
    })));
  });
  it("saves a single clinical remark without requiring diagnosis or treatment entry", async () => {
    render(<CaseSheetEditor {...props} />);
    expect(screen.queryByLabelText("Diagnosis")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Treatment plan")).not.toBeInTheDocument();
    fillVisit();
    fireEvent.click(screen.getByRole("button", { name: "Save case sheet" }));
    await waitFor(() => expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({
      findings: "Examined teeth; discussed observation and restoration options.",
      diagnosis: "", plan: "", treatments: [],
    })));
  });

  it("keeps the original plan link and note when amending a completion", async () => {
    const planId = "00000000-0000-4000-8000-000000000019";
    render(<CaseSheetEditor {...props} caseSheetId="00000000-0000-4000-8000-000000000020" expectedVersion={1} initialValues={{
      doctorId: props.doctors[0].id, visitAt: "2026-09-29T04:30:00Z", chiefComplaint: "Review",
      findings: "Review completed", diagnosis: "", plan: "",
      medicalHistory: { reviewStatus: "reviewed_none", reviewedToday: true, conditions: [], description: "" },
      prescriptions: [], toothAssessments: [], treatments: [{
        treatment_id: "00000000-0000-4000-8000-000000000021", planned_treatment_id: planId,
        treatment_code: "K02.9", treatment_name: "Dental caries", status: "completed", site_scope: "tooth",
        site_detail: null, tooth_number: "16", tooth_numbers: ["16"], surfaces: [], notes: "Treated today",
        locked: false, hasAttachments: false, sourcePlanNotes: "Original plan from January", availablePlanTeeth: ["16", "26"],
      }],
    }} />);
    fireEvent.change(screen.getByLabelText("Treatment notes"), { target: { value: "Clarified outcome" } });
    expect(screen.queryByRole("button", { name: "Remove treatment 1" })).not.toBeInTheDocument();
    expect(screen.getByText("Saved treatments remain in history; edit details within the 24-hour window.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reason for amendment"), { target: { value: "Clarify treatment outcome" } });
    fireEvent.click(screen.getByRole("button", { name: "Save case sheet" }));
    await waitFor(() => expect(mocks.amend).toHaveBeenCalledWith(expect.objectContaining({
      treatments: [expect.objectContaining({ planned_treatment_id: planId, notes: "Clarified outcome" })],
    })));
    expect(screen.getByText(/Original plan from January/)).toBeInTheDocument();
  });

  it("allows an unsaved treatment draft to be removed", () => {
    render(<CaseSheetEditor {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Add treatment" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove treatment 1" }));
    expect(screen.queryByRole("group", { name: "Treatment 1" })).not.toBeInTheDocument();
    expect(screen.getByText("No treatment added. You can save the examination on its own.")).toBeInTheDocument();
  });

  it("keeps historical diagnosis and plan intact when amending the new remarks field", async () => {
    const initialValues: CaseSheetEditorInitialValues = {
      doctorId: props.doctors[0].id,
      visitAt: "2026-09-29T04:30:00Z",
      chiefComplaint: "Sensitivity",
      findings: "Original findings",
      diagnosis: "Original diagnosis",
      plan: "Original plan",
      medicalHistory: { reviewStatus: "reviewed_none", reviewedToday: true, conditions: [], description: "" },
      prescriptions: [], toothAssessments: [], treatments: [],
    };
    render(<CaseSheetEditor {...props} initialValues={initialValues} caseSheetId="00000000-0000-4000-8000-000000000004" expectedVersion={2} />);
    expect(screen.getByText("Original diagnosis")).toBeInTheDocument();
    expect(screen.getByText("Original plan")).toBeInTheDocument();
    fillVisit();
    fireEvent.change(screen.getByLabelText("Reason for amendment"), { target: { value: "Update the clinical review" } });
    fireEvent.click(screen.getByRole("button", { name: "Save case sheet" }));
    await waitFor(() => expect(mocks.amend).toHaveBeenCalledWith(expect.objectContaining({
      diagnosis: "Original diagnosis", plan: "Original plan", expected_version: 2,
      findings: "Examined teeth; discussed observation and restoration options.",
    })));
  });

  it("prefills multiple teeth from an examination and persists them as one treatment", async () => {
    render(<CaseSheetEditor {...props} />);
    fillVisit();
    fireEvent.click(screen.getByRole("button", { name: "Plan for selected teeth" }));
    const treatment = screen.getByRole("group", { name: "Treatment 1" });
    fireEvent.focus(within(treatment).getByRole("combobox", { name: "Approved dental code" }));
    fireEvent.click(within(treatment).getByRole("option", { name: /K02.9/ }));
    expect(within(treatment).getByText("Selected teeth: 16, 26 · change")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save case sheet" }));
    await waitFor(() => expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({
      treatments: [expect.objectContaining({ treatment_code: "K02.9", site_scope: "multi_tooth", tooth_number: "16", tooth_numbers: ["16", "26"] })],
    })));
  });

  it("highlights the single remark when the visit has no clinical narrative", async () => {
    render(<CaseSheetEditor {...props} />);
    fireEvent.change(screen.getByLabelText("Chief complaint"), { target: { value: "Routine review" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm medical history" }));
    fireEvent.click(screen.getByRole("button", { name: "Save case sheet" }));
    expect(screen.getByLabelText("Clinical remarks")).toHaveAttribute("aria-invalid", "true");
    expect(mocks.finalize).not.toHaveBeenCalled();
  });

  it("keeps the entries and makes save available after a network failure", async () => {
    mocks.finalize.mockRejectedValueOnce(new Error("Connection lost"));
    render(<CaseSheetEditor {...props} />);
    fillVisit();
    fireEvent.click(screen.getByRole("button", { name: "Save case sheet" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Your entries are still here"));
    expect(screen.getByLabelText("Clinical remarks")).toHaveValue("Examined teeth; discussed observation and restoration options.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Save case sheet" })).toBeEnabled());
  });
});
