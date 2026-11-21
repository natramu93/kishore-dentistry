import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToothSelector } from "@/components/clinical/tooth-selector";
import { INDIAN_PERMANENT_TEETH, INDIAN_PRIMARY_TEETH } from "@/lib/clinical";

afterEach(cleanup);

function Harness({ multiple = true }: { multiple?: boolean }) {
  const [value, setValue] = useState<string[]>([]);
  return <ToothSelector value={value} onChange={setValue} multiple={multiple} />;
}

describe("ToothSelector", () => {
  it("matches the reference's four-row structure and provides row selection", () => {
    const { container } = render(<Harness />);
    const chart = screen.getByRole("group", { name: /Indian Standard dental chart/ });
    const rows = within(chart).getAllByRole("group");
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual(["Upper primary teeth", "Upper permanent teeth", "Lower permanent teeth", "Lower primary teeth"]);
    // Each arch has ONE fixed 16-column grid, not responsive quadrant sub-grids.
    // CSS layout is additionally checked in the real browser at mobile widths.
    expect(rows.map((row) => {
      const buttons = within(row).getAllByRole("button", { name: /^\d+,/ });
      expect(new Set(buttons.map((button) => button.parentElement)).size).toBe(1);
      expect(buttons[0].parentElement).toHaveStyle({ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" });
      return buttons.length;
    })).toEqual([10, 16, 16, 10]);
    expect(within(rows[0]).getAllByRole("button", { name: /^\d+,/ })[0]).toHaveStyle({ gridColumnStart: "4" });
    expect(within(chart).getAllByRole("button", { name: /^\d+,/ })).toHaveLength(52);
    expect(container.querySelectorAll("svg[data-tooth-kind]")).toHaveLength(52);
    expect(within(rows[0]).getAllByRole("button", { name: /^\d+,/ }).map((button) => button.textContent)).toEqual(["55", "54", "53", "52", "51", "61", "62", "63", "64", "65"]);
    fireEvent.click(screen.getByRole("button", { name: "Select upper permanent teeth" }));
    expect(within(chart).getAllByRole("button", { pressed: true, name: /^\d+,/ })).toHaveLength(16);
    fireEvent.click(screen.getByRole("button", { name: "Deselect upper permanent teeth" }));
    expect(screen.getByRole("status")).toHaveTextContent("No teeth selected");
  });
  it("selects all displayed teeth and allows individual deselection and clearing", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Permanent teeth" }));
    const selectedTeeth = () => within(screen.getByRole("group", { name: /Indian Standard dental chart/ }))
      .getAllByRole("button", { pressed: true, name: /^\d+,/ });
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(selectedTeeth()).toHaveLength(INDIAN_PERMANENT_TEETH.length);
    expect(screen.getByRole("button", { name: "Select all" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^11,/ }));
    expect(screen.getByRole("button", { name: "Select all" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Primary (milk) teeth" }));
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(selectedTeeth()).toHaveLength(INDIAN_PRIMARY_TEETH.length);
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

  it("retains the four-row layout for an existing primary selection and respects disabled", () => {
    const onChange = vi.fn();
    render(<ToothSelector value={["51"]} onChange={onChange} disabled />);
    expect(screen.getAllByRole("button", { name: /^\d+,/ })).toHaveLength(52);
    expect(screen.getByRole("button", { name: /^51,/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^51,/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^51,/ }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
