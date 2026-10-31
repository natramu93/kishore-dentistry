import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { preventImplicitInvoiceSubmit } from "@/components/invoices/invoice-form-keyboard";

afterEach(cleanup);
const form = () => render(<form onKeyDown={preventImplicitInvoiceSubmit}>
  <label>Value<input /></label><label>Notes<textarea /></label>
  <button type="submit">Create invoice</button>
</form>);

describe("invoice form keyboard guard", () => {
  it("blocks Enter and numeric keypad Enter only in input fields", () => {
    form();
    const input = screen.getByLabelText("Value");
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(input, { key: "NumpadEnter" })).toBe(false);
    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(input, { key: "ArrowDown" })).toBe(true);
  });
  it("keeps explicit keyboard button activation, multiline notes and IME text composition available", () => {
    form();
    expect(fireEvent.keyDown(screen.getByRole("button", { name: "Create invoice" }), { key: "Enter" })).toBe(true);
    expect(fireEvent.keyDown(screen.getByLabelText("Notes"), { key: "Enter" })).toBe(true);
    expect(fireEvent.keyDown(screen.getByLabelText("Value"), { key: "Enter", isComposing: true })).toBe(true);
  });
});
