import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToothSelector } from "@/components/clinical/tooth-selector";
import { INDIAN_PERMANENT_TEETH, INDIAN_PRIMARY_TEETH } from "@/lib/clinical";

afterEach(cleanup);

function Harness({ multiple = true }: { multiple?: boolean }) {
  const [value, setValue] = useState<string[]>([]);
  return <ToothSelector value={value} onChange={setValue} multiple={multiple} />;
}

describe("ToothSelector", () => {
  it("selects all displayed teeth and allows individual deselection and clearing", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    for (const tooth of INDIAN_PERMANENT_TEETH) {
      expect(screen.getByRole("button", { name: new RegExp(`^${tooth},`) })).toHaveAttribute("aria-pressed", "true");
    }
    expect(screen.getByRole("button", { name: "Select all" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^11,/ }));
    expect(screen.getByRole("button", { name: "Select all" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Primary (milk) teeth" }));
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    for (const tooth of INDIAN_PRIMARY_TEETH) {
      expect(screen.getByRole("button", { name: new RegExp(`^${tooth},`) })).toHaveAttribute("aria-pressed", "true");
    }
    fireEvent.click(screen.getByRole("button", { name: "Permanent teeth" }));
    expect(screen.getByRole("button", { name: /^12,/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^11,/ })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByRole("status")).toHaveTextContent("No teeth selected");
  });

  it("selects only eligible plan teeth and preserves selections in the other dentition", () => {
    const onChange = vi.fn();
    render(<ToothSelector value={["51", "26"]} selectableTeeth={["26", "36"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(onChange).toHaveBeenCalledWith(["26", "36", "51"]);
    fireEvent.click(screen.getByRole("button", { name: "Primary (milk) teeth" }));
    expect(screen.getByRole("button", { name: "Select all" })).toBeDisabled();
  });

  it("does not select all in a disabled selector or single-only review", () => {
    const onChange = vi.fn();
    const view = render(<ToothSelector value={[]} onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(onChange).not.toHaveBeenCalled();
    view.rerender(<ToothSelector value={[]} onChange={onChange} multiple={false} />);
    expect(screen.queryByRole("button", { name: "Select all" })).not.toBeInTheDocument();
  });

  it("supports multiple teeth and retains selections across dentitions", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /^11,/ }));
    fireEvent.click(screen.getByRole("button", { name: /^12,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Primary (milk) teeth" }));
    fireEvent.click(screen.getByRole("button", { name: /^51,/ }));
    expect(screen.getByRole("status")).toHaveTextContent("Selected teeth: 11, 12, 51");
    fireEvent.click(screen.getByRole("button", { name: "Permanent teeth" }));
    expect(screen.getByRole("button", { name: /^11,/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /^11,/ }));
    expect(screen.getByRole("status")).toHaveTextContent("Selected teeth: 12, 51");
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByRole("status")).toHaveTextContent("No teeth selected");
  });

  it("supports single-tooth review without retaining another selection", () => {
    render(<Harness multiple={false} />);
    fireEvent.click(screen.getByRole("button", { name: /^11,/ }));
    fireEvent.click(screen.getByRole("button", { name: /^12,/ }));
    expect(screen.getByRole("status")).toHaveTextContent("Selected tooth: 12");
    expect(screen.getByRole("button", { name: /^11,/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("opens primary teeth for an existing primary selection and respects disabled", () => {
    const onChange = vi.fn();
    render(<ToothSelector value={["51"]} onChange={onChange} disabled />);
    expect(screen.getByRole("button", { name: /^51,/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^51,/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^51,/ }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
