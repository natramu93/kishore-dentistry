import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TreatmentProgressSummary } from "@/components/clinical/treatment-progress-summary";
import type { TreatmentProgressRecord } from "@/lib/treatment-progress";

afterEach(cleanup);

function record(id: string, status: "planned" | "completed"): TreatmentProgressRecord {
  return {
    id, case_sheet_id: "sheet", treatment_code: "K02.9", treatment_name: "Dental care",
    clinical_status: status, site_scope: "multi_tooth", site_detail: null,
    tooth_number: "16", tooth_numbers: ["16", "26"], surfaces: [],
    notes: status === "planned" ? "Discuss restoration at next visit" : "Restoration recorded",
    treated_at: "2026-09-25T04:30:00Z", performed_at: status === "completed" ? "2026-09-29T04:30:00Z" : null,
    doctor: { full_name: "Dr Test" },
  };
}

describe("TreatmentProgressSummary", () => {
  it("retains a planned record even when completed work exists on the same teeth", () => {
    render(<TreatmentProgressSummary progress={{
      planned: { records: [record("plan", "planned")], total: 1 },
      completed: { records: [record("done", "completed")], total: 1 },
    }} />);
    expect(within(screen.getByRole("region", { name: "Yet to treat" })).getByText("Discuss restoration at next visit")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Treated" })).getByText("Restoration recorded")).toBeInTheDocument();
    expect(screen.getByText(/Tooth findings remain/)).toBeInTheDocument();
  });

  it("explicitly discloses more pending records instead of showing a complete-looking subset", () => {
    render(<TreatmentProgressSummary progress={{
      planned: { records: [record("plan", "planned")], total: 105 },
      completed: { records: [], total: 0 },
    }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 105. 104 more planned treatments");
  });

  it("clearly distinguishes partial completion from the original multi-tooth plan", () => {
    render(<TreatmentProgressSummary progress={{
      planned: { records: [{ ...record("plan", "planned"), remaining_tooth_numbers: ["26"] }], total: 1 },
      completed: { records: [{ ...record("done", "completed"), planned_treatment_id: "plan", tooth_numbers: ["16"] }], total: 1 },
    }} />);
    expect(screen.getByText("Partly treated · Still to treat: 26")).toBeInTheDocument();
    expect(screen.getByText("Completed from an earlier treatment plan")).toBeInTheDocument();
  });
});
