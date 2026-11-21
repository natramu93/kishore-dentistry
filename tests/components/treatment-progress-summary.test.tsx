import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TreatmentProgressSummary } from "@/components/clinical/treatment-progress-summary";
import { VisitHistory } from "@/components/clinical/visit-history";
import type { TreatmentProgressRecord } from "@/lib/treatment-progress";
import type { ReactNode } from "react";

afterEach(cleanup);
vi.mock("@/actions/treatment-details", () => ({ loadTreatmentDetailsAction: vi.fn() }));
vi.mock("@/components/clinical/treatment-details-dialog", () => ({
  TreatmentDetailsDialog: ({ name, triggerLabel, children }: { name: string; triggerLabel?: string; children: ReactNode }) =>
    <button aria-label={triggerLabel ?? `View treatment details: ${name}`}>{children}</button>,
}));

function record(id: string, status: "planned" | "completed"): TreatmentProgressRecord {
  return {
    id, case_sheet_id: "sheet", treatment_code: "K02.9", treatment_name: "Dental care",
    clinical_status: status, site_scope: "multi_tooth", site_detail: null,
    tooth_number: "16", tooth_numbers: ["16", "26"], surfaces: [],
    notes: status === "planned" ? "Discuss restoration at next visit" : "Restoration recorded",
    visit_remarks: status === "completed" ? "Doctor comment for this visit" : null,
    treated_at: "2026-09-25T04:30:00Z", performed_at: status === "completed" ? "2026-09-29T04:30:00Z" : null,
    doctor: { full_name: "Dr Test" },
  };
}

describe("TreatmentProgressSummary", () => {
  it("retains a planned record even when completed work exists on the same teeth", () => {
    render(<>
      <TreatmentProgressSummary leadId="patient" planned={{ records: [record("plan", "planned")], total: 1 }} />
      <VisitHistory leadId="patient" completed={{ records: [record("done", "completed")], total: 1 }} />
    </>);
    expect(screen.getByText("Discuss restoration at next visit")).toBeInTheDocument();
    const history = within(screen.getByRole("region", { name: "Visit History" }));
    expect(history.getByText("Dr Test")).toBeInTheDocument();
    expect(history.getByText("25 Sep 2026, 10:00 AM")).toBeInTheDocument();
    expect(history.getByText("Restoration recorded")).toBeInTheDocument();
    expect(history.getByText("Doctor comment for this visit")).toBeInTheDocument();
    expect(screen.queryByText(/Across all recorded visits/)).toBeNull();
    expect(screen.getAllByRole("button", { name: /^View treatment details: Dental care/ })).toHaveLength(2);
  });

  it("explicitly discloses more pending records instead of showing a complete-looking subset", () => {
    render(<TreatmentProgressSummary leadId="patient" planned={{ records: [record("plan", "planned")], total: 105 }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 105 pending treatments.");
  });

  it("clearly distinguishes partial completion from the original multi-tooth plan", () => {
    render(<TreatmentProgressSummary leadId="patient" planned={{
      records: [{ ...record("plan", "planned"), remaining_tooth_numbers: ["26"] }], total: 1,
    }} />);
    expect(screen.getByText("Partly treated · Still to treat: 26")).toBeInTheDocument();
  });
});
