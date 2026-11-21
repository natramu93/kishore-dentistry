import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToothChart } from "@/components/clinical/tooth-chart";
import { INDIAN_PERMANENT_TEETH, INDIAN_PRIMARY_TEETH } from "@/lib/clinical";

afterEach(cleanup);

describe("ToothChart", () => {
  it("keeps a compressed arch on a fixed line and supports arrow-key navigation past disabled teeth", () => {
    const onSelect = vi.fn();
    render(<ToothChart teeth={["18", "17", "16", "15"]} selected={[]} arch="upper" onSelect={onSelect}
      columns={16} selectableTeeth={["18", "16", "15"]} fit />);
    const first = screen.getByRole("button", { name: /^18,/ });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: /^16,/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(screen.getByRole("button", { name: /^15,/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(first).toHaveFocus();
    expect(first.parentElement).toHaveStyle({ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" });
    expect(onSelect).not.toHaveBeenCalled();
  });
  it("shows a selectable image and Indian Standard label for every permanent upper tooth", () => {
    const onSelect = vi.fn();
    const upperTeeth = INDIAN_PERMANENT_TEETH.slice(0, 16);

    const { container } = render(
      <ToothChart teeth={upperTeeth} selected="11" arch="upper" onSelect={onSelect} />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(16);
    expect(container.querySelectorAll("svg")).toHaveLength(16);
    expect(screen.getByRole("button", { name: "11, Upper right central incisor" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "26, Upper left first molar" }));
    expect(onSelect).toHaveBeenCalledWith("26");
  });

  it("renders the complete primary lower arch with touch-sized selection controls", () => {
    const lowerTeeth = INDIAN_PRIMARY_TEETH.slice(10);
    render(<ToothChart teeth={lowerTeeth} selected={null} arch="lower" onSelect={() => undefined} />);

    expect(screen.getAllByRole("button")).toHaveLength(10);
    expect(screen.getByRole("button", { name: "85, Lower right second molar" })).toHaveClass("min-w-11");
    expect(screen.getByRole("button", { name: "75, Lower left second molar" })).toHaveAttribute("type", "button");
  });
});
