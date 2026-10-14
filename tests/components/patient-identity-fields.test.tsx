import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PatientIdentityFields } from "@/components/leads/patient-identity-fields";
afterEach(cleanup);

describe("patient title and gender inputs", () => {
  it("offers all requested titles, auto-fills gender, and allows corrections", () => {
    render(<PatientIdentityFields />);
    const title = screen.getByRole("combobox", { name: "Title" });
    const gender = screen.getByRole("combobox", { name: "Gender" });
    for (const value of ["Mr.", "Ms.", "Mrs.", "Baby", "Master"]) expect(screen.getByRole("option", { name: value })).toBeInTheDocument();
    fireEvent.change(title, { target: { value: "Mr" } });
    expect(gender).toHaveValue("male");
    fireEvent.change(title, { target: { value: "Mrs" } });
    expect(gender).toHaveValue("female");
    fireEvent.change(title, { target: { value: "Baby" } });
    expect(gender).toHaveValue("");
    fireEvent.change(gender, { target: { value: "female" } });
    expect(gender).toHaveValue("female");
    expect(gender).toBeEnabled();
  });
  it("formats names on blur while preserving spaces during typing", () => {
    render(<PatientIdentityFields />);
    const name = screen.getByRole("textbox", { name: "Name *" });
    fireEvent.change(name, { target: { value: "raVI  KUMAR " } });
    expect(name).toHaveValue("raVI  KUMAR ");
    fireEvent.blur(name);
    expect(name).toHaveValue("Ravi Kumar");
  });
  it("loads existing values without overwriting an explicitly corrected gender", () => {
    render(<PatientIdentityFields initialTitle="Master" initialName="TEST PATIENT" initialGender="other" />);
    expect(screen.getByRole("combobox", { name: "Gender" })).toHaveValue("other");
    expect(screen.getByRole("textbox", { name: "Name *" })).toHaveValue("Test Patient");
    expect(screen.getByRole("combobox", { name: "Title" })).toHaveValue("Master");
  });
});
