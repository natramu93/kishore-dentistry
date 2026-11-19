import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { SuggestionInput, SuggestionField } from "@/components/ui/suggestion-input";
import { preventImplicitInvoiceSubmit } from "@/components/invoices/invoice-form-keyboard";

afterEach(cleanup);
const options = [{ value: "Dr. Alpha", label: "Dr. Alpha" }, { value: "Dr. Beta", label: "Dr. Beta" }];
function Harness({ submit = vi.fn() }: { submit?: () => void }) {
  const [value, setValue] = useState("");
  return <form onKeyDown={preventImplicitInvoiceSubmit} onSubmit={(event) => { event.preventDefault(); submit(); }}>
    <label htmlFor="doctor">Doctor</label><SuggestionInput id="doctor" name="doctor" value={value} options={options} onValueChange={setValue} />
    <button type="submit">Save</button>
  </form>;
}
it("selects using arrows and Enter without saving the surrounding invoice", () => {
  const submit = vi.fn();
  render(<Harness submit={submit} />);
  const input = screen.getByRole("combobox", { name: "Doctor" });
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(screen.getByRole("option", { name: "Dr. Beta" })).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input).toHaveValue("Dr. Beta");
  expect(input).toHaveAttribute("aria-expanded", "false");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(submit).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "ArrowUp" });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input).toHaveValue("Dr. Beta");
  expect(input).toHaveAttribute("aria-expanded", "false");
});
it("filters suggestions, selects the first match on Enter, and keeps unmatched free text", () => {
  render(<Harness />);
  const input = screen.getByRole("combobox", { name: "Doctor" });
  fireEvent.change(input, { target: { value: "alph" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input).toHaveValue("Dr. Alpha");
  fireEvent.change(input, { target: { value: "External doctor" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input).toHaveValue("External doctor");
  expect(new FormData(input.closest("form")!).get("doctor")).toBe("External doctor");
});
it("supports pointer selection and hides choices when the input is disabled", () => {
  const onValueChange = vi.fn();
  const view = render(<><label htmlFor="doctor">Doctor</label><SuggestionInput id="doctor" value="" options={options} onValueChange={onValueChange} /></>);
  fireEvent.focus(screen.getByRole("combobox"));
  fireEvent.click(screen.getByRole("option", { name: "Dr. Alpha" }));
  expect(onValueChange).toHaveBeenCalledWith("Dr. Alpha");
  fireEvent.focus(screen.getByRole("combobox"));
  view.rerender(<><label htmlFor="doctor">Doctor</label><SuggestionInput id="doctor" value="" options={options} onValueChange={onValueChange} disabled /></>);
  expect(screen.queryByRole("option")).not.toBeInTheDocument();
  expect(screen.getByRole("combobox")).toBeDisabled();
});
it("keeps open and closed suggestion fields accessible and includes selected values in server forms", async () => {
  const { container } = render(<form><label htmlFor="category">Category</label><SuggestionField id="category" name="category" options={options} /></form>);
  fireEvent.focus(screen.getByRole("combobox"));
  expect((await axe.run(container, { rules: { "color-contrast": { enabled: false } } })).violations).toEqual([]);
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  expect(new FormData(container.querySelector("form")!).get("category")).toBe("Dr. Alpha");
});
