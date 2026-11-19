import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ToothAssessmentHistory, groupToothAssessmentHistory, type ToothAssessmentHistoryItem } from "@/components/clinical/tooth-assessment-history";

afterEach(cleanup);
const assessment = (tooth: string, changes: Partial<ToothAssessmentHistoryItem> = {}): ToothAssessmentHistoryItem => ({
  id: `tooth-${tooth}`, case_sheet_id: "visit-1", tooth_number: tooth, tooth_state: "present", conditions: ["caries"], surfaces: [],
  notes: "Shared remark", diagnosis: "Shared diagnosis", clinical_findings: null, future_plan: "Restore", prognosis: null,
  recommended_action: "restorative", assessed_at: "2026-11-19T04:30:00Z", signed_at: "2026-11-19T04:31:00Z", doctor_name: "Dr. Example", ...changes,
});
it("renders a multi-tooth diagnosis and remark once, with every affected tooth number", () => {
  const original = [assessment("11"), assessment("12"), assessment("13")];
  render(<ToothAssessmentHistory assessments={original} />);
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByRole("heading", { name: "IS 8815 teeth 11, 12, 13" })).toBeInTheDocument();
  expect(screen.getAllByText("Shared diagnosis")).toHaveLength(1);
  expect(screen.getAllByText("Shared remark")).toHaveLength(1);
  expect(original).toHaveLength(3);
  expect(original[1].tooth_number).toBe("12");
});
it("never combines different encounters, doctors, tooth states, surfaces or remarks", () => {
  const original = [assessment("11"), assessment("12", { case_sheet_id: "visit-2" }), assessment("13", { doctor_name: "Dr. Other" }),
    assessment("14", { tooth_state: "missing" }), assessment("15", { surfaces: ["mesial"] }), assessment("16", { notes: "Different note" })];
  expect(groupToothAssessmentHistory(original)).toHaveLength(6);
});
it("compares condition/surface sets without rewriting the stored assessments", () => {
  const first = assessment("11", { conditions: ["caries", "sensitivity"], surfaces: ["mesial", "distal"] });
  const second = assessment("12", { conditions: ["sensitivity", "caries"], surfaces: ["distal", "mesial"] });
  expect(groupToothAssessmentHistory([first, second])).toHaveLength(1);
  expect(first.conditions).toEqual(["caries", "sensitivity"]);
});
it("keeps unknown-visit records and repeated snapshots of the same tooth separate", () => {
  expect(groupToothAssessmentHistory([assessment("11", { case_sheet_id: null, assessed_at: null }), assessment("12", { case_sheet_id: null, assessed_at: null })])).toHaveLength(2);
  expect(groupToothAssessmentHistory([assessment("11"), assessment("11", { id: "second-snapshot" })])).toHaveLength(2);
});
