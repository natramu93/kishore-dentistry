import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { TreatmentSearch } from "@/components/invoices/treatment-search";

const options = [
  { value: "filling", label: "Composite filling — Restorative", searchText: "composite filling restorative" },
  { value: "scaling", label: "Scaling — Preventive", searchText: "scaling preventive" },
  { value: "free", label: "Free review — Consultation", searchText: "free review consultation" },
];
function Picker({ onChange = vi.fn(), disabled = false }: { onChange?: (value: string) => void; disabled?: boolean }) {
  const [value, setValue] = useState("");
  return <form><label htmlFor="treatment">Treatment</label><TreatmentSearch id="treatment" value={value} options={options}
    onChange={(next) => { setValue(next); onChange(next); }} required disabled={disabled} /></form>;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("invoice treatment type-ahead", () => {
  it("filters case-insensitively by category and selects an actual treatment", async () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Treatment" });
    fireEvent.input(input, { target: { value: "RESTOR fill" }, inputType: "insertText" });
    fireEvent.click(await screen.findByRole("option", { name: options[0].label }));
    expect(screen.queryByRole("option", { name: options[1].label })).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith("filling");
    expect(input).toHaveValue(options[0].label);
  });
  it("supports keyboard selection without submitting the form", async () => {
    const onChange = vi.fn();
    const { container } = render(<Picker onChange={onChange} />);
    const submit = vi.fn((event: Event) => event.preventDefault());
    container.querySelector("form")!.addEventListener("submit", submit);
    const input = screen.getByRole("combobox", { name: "Treatment" });
    fireEvent.input(input, { target: { value: "scal" }, inputType: "insertText" });
    await screen.findByRole("option", { name: options[1].label });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("scaling"));
    expect(submit).not.toHaveBeenCalled();
  });
  it("shows an empty result without accepting a free-text treatment", async () => {
    const onChange = vi.fn();
    const { container } = render(<Picker onChange={onChange} />);
    fireEvent.input(screen.getByRole("combobox", { name: "Treatment" }), { target: { value: "unknown treatment" }, inputType: "insertText" });
    expect(await screen.findByText(/No matching treatments/)).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(container.querySelector("form")!.checkValidity()).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });
  it("clears the selection instead of retaining a hidden old treatment", async () => {
    const onChange = vi.fn();
    const { container } = render(<Picker onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Treatment" });
    fireEvent.input(input, { target: { value: "free" }, inputType: "insertText" });
    fireEvent.click(await screen.findByRole("option", { name: options[2].label }));
    fireEvent.click(screen.getByRole("button", { name: "Clear treatment" }));
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(input).toHaveValue("");
    expect(container.querySelector("form")!.checkValidity()).toBe(false);
  });
  it("disables both searching and opening while the invoice saves", () => {
    render(<Picker disabled />);
    expect(screen.getByRole("combobox", { name: "Treatment" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Show treatments" })).toBeDisabled();
  });
  it("keeps the open picker accessible", async () => {
    render(<Picker />);
    const rules = { "color-contrast": { enabled: false }, region: { enabled: false } };
    expect((await axe.run(document.body, { rules })).violations).toEqual([]);
    const input = screen.getByRole("combobox", { name: "Treatment" });
    act(() => input.focus());
    fireEvent.input(input, { target: { value: "fill" }, inputType: "insertText" });
    await screen.findByRole("option", { name: options[0].label });
    expect(screen.getByText("Treatment")).toBeVisible();
    // Base UI hides surrounding controls from assistive tech while open.
    // Check the visible label separately and the popup's WCAG semantics here.
    const results = await axe.run(document.body, { rules, runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    expect(results.violations).toEqual([]);
  });
});
