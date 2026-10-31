import type { KeyboardEvent } from "react";

/** Editing a field must not implicitly create or save a bill. Buttons retain
 * keyboard activation, textareas retain newlines, and combobox handlers run
 * before this form-level bubbling handler. */
export function preventImplicitInvoiceSubmit(event: KeyboardEvent<HTMLFormElement>) {
  if (event.key !== "Enter" && event.key !== "NumpadEnter") return;
  if (event.nativeEvent.isComposing) return;
  const target = event.target;
  if (target instanceof HTMLInputElement && !["submit", "button", "reset"].includes(target.type)) {
    event.preventDefault();
  }
}
