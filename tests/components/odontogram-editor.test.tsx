import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OdontogramEditor } from "@/components/clinical/odontogram-editor";
import type { ToothAssessmentInput } from "@/lib/clinical";

afterEach(cleanup);

function Harness({ onAddTreatment = () => undefined, initial = [], onChange = () => undefined }: { onAddTreatment?: (teeth: string[]) => void; initial?: ToothAssessmentInput[]; onChange?: (assessments: ToothAssessmentInput[]) => void }) {
  const [assessments, setAssessments] = useState<ToothAssessmentInput[]>(initial);
  return (
    <OdontogramEditor
      value={assessments}
      errors={{}}
      onChange={(next) => { setAssessments(next); onChange(next); }}
      onAddTreatment={onAddTreatment}
    />
  );
}

function assessment(tooth: string, patch: Partial<ToothAssessmentInput> = {}): ToothAssessmentInput {
  return {
    tooth_number: tooth as ToothAssessmentInput["tooth_number"], tooth_state: "present", conditions: [], surfaces: [],
    clinical_findings: "", diagnosis: "", prognosis: null, recommended_action: null, future_plan: "", notes: "", ...patch,
  };
}

describe("OdontogramEditor", () => {
  it("records a general Indian Standard tooth assessment without a treatment", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "11, Upper right central incisor" }));
    expect(screen.getByText(/Tooth 11 · Upper right central incisor/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Tooth state"), { target: { value: "sound" } });

    expect(screen.getByText("1 tooth record documented")).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "11, Upper right central incisor, examination recorded",
    })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps primary teeth available and can prefill a coded treatment", () => {
    const onAddTreatment = vi.fn();
    render(<Harness onAddTreatment={onAddTreatment} />);

    fireEvent.click(screen.getByRole("button", { name: "Primary (milk) teeth" }));
    fireEvent.click(screen.getByRole("button", { name: "51, Upper right central incisor" }));
    fireEvent.click(screen.getByRole("button", { name: "Add treatment for this tooth" }));

    expect(onAddTreatment).toHaveBeenCalledWith(["51"]);
  });

  it("uses one remark while preserving earlier structured findings and plans", () => {
    const onChange = vi.fn();
    const original = assessment("11", { clinical_findings: "Old finding", diagnosis: "Old diagnosis", future_plan: "Review later", notes: "Existing remark" });
    render(<Harness initial={[original]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /^11,/ }));
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    fireEvent.click(screen.getByText("Earlier recorded details"));
    expect(screen.getByText("Old finding")).toBeInTheDocument();
    expect(screen.getByText("Old diagnosis")).toBeInTheDocument();
    expect(screen.getByText("Review later")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Remark"), { target: { value: "Updated review" } });
    expect(onChange).toHaveBeenLastCalledWith([{ ...original, notes: "Updated review" }]);
  });

  it("includes shared remarks immediately without replacing different existing tooth records", () => {
    const onChange = vi.fn();
    const first = assessment("11", { notes: "First note", clinical_findings: "Original finding", conditions: ["caries"], surfaces: ["mesial"], future_plan: "First plan" });
    const second = assessment("12", { notes: "Second note", diagnosis: "Second diagnosis", recommended_action: "monitor" });
    const untouched = assessment("21", { notes: "Untouched" });
    render(<Harness initial={[first, second, untouched]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to multiple teeth" }));
    fireEvent.click(screen.getByRole("button", { name: /^11,/ }));
    fireEvent.click(screen.getByRole("button", { name: /^12,/ }));
    fireEvent.change(screen.getByLabelText("Remark for selected teeth"), { target: { value: "Review together" } });
    expect(onChange).toHaveBeenLastCalledWith([
      { ...first, notes: "First note\n\nReview together" },
      { ...second, notes: "Second note\n\nReview together" },
      untouched,
    ]);
    fireEvent.change(screen.getByLabelText("Remark for selected teeth"), { target: { value: "Revised review" } });
    expect(onChange).toHaveBeenLastCalledWith([
      { ...first, notes: "First note\n\nRevised review" },
      { ...second, notes: "Second note\n\nRevised review" },
      untouched,
    ]);
  });

  it("adds shared conditions without deleting existing conditions, surfaces or remarks", () => {
    const onChange = vi.fn();
    const first = assessment("11", { conditions: ["caries"], surfaces: ["mesial"], notes: "Review" });
    const second = assessment("12", { tooth_state: "sound" });
    render(<Harness initial={[first, second]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to multiple teeth" }));
    fireEvent.click(screen.getByRole("button", { name: /^11,/ }));
    fireEvent.click(screen.getByRole("button", { name: /^12,/ }));
    fireEvent.click(screen.getByText(/Add clinical conditions/));
    fireEvent.click(screen.getByRole("button", { name: "Sensitivity" }));
    expect(onChange).toHaveBeenLastCalledWith([
      { ...first, conditions: ["caries", "sensitivity"] },
      { ...second, tooth_state: "present", conditions: ["sensitivity"] },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Sensitivity" }));
    expect(onChange).toHaveBeenLastCalledWith([first, second]);
  });

  it("prefills one multi-tooth treatment from the selected teeth without creating findings", () => {
    const onAddTreatment = vi.fn();
    const onChange = vi.fn();
    render(<Harness onAddTreatment={onAddTreatment} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to multiple teeth" }));
    fireEvent.click(screen.getByRole("button", { name: /^11,/ }));
    fireEvent.click(screen.getByRole("button", { name: /^12,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add treatment for selected teeth" }));
    expect(onAddTreatment).toHaveBeenCalledWith(["11", "12"]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rejects a shared remark that would overflow an existing record without truncating it", () => {
    const onChange = vi.fn();
    render(<Harness initial={[assessment("11", { notes: "x".repeat(1_999) })]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to multiple teeth" }));
    fireEvent.click(screen.getByRole("button", { name: /^11,/ }));
    fireEvent.change(screen.getByLabelText("Remark for selected teeth"), { target: { value: "More" } });
    expect(screen.getByRole("alert")).toHaveTextContent("combined remark is too long for 11");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("links errors on other teeth and opens the relevant optional clinical details", () => {
    render(<OdontogramEditor value={[assessment("11", { surfaces: ["mesial"] })]} errors={{ "tooth_assessments.0.surfaces.0": "Review this surface" }} onChange={() => undefined} onAddTreatment={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Review tooth 11" }));
    expect(screen.getByText("Review this surface").closest("details")).toHaveAttribute("open");
  });
});
