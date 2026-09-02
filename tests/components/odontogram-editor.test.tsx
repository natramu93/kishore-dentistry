import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OdontogramEditor } from "@/components/clinical/odontogram-editor";
import type { ToothAssessmentInput } from "@/lib/clinical";

afterEach(cleanup);

function Harness({ onAddTreatment = () => undefined }: { onAddTreatment?: (tooth: string) => void }) {
  const [assessments, setAssessments] = useState<ToothAssessmentInput[]>([]);
  return (
    <OdontogramEditor
      value={assessments}
      errors={{}}
      onChange={setAssessments}
      onAddTreatment={onAddTreatment}
    />
  );
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
    fireEvent.click(screen.getByRole("button", { name: "Add coded treatment for this tooth" }));

    expect(onAddTreatment).toHaveBeenCalledWith("51");
  });
});
