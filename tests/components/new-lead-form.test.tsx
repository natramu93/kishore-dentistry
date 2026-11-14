import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NewLeadForm } from "@/app/(app)/leads/new/new-lead-form";

vi.mock("@/actions/leads", () => ({
  checkDuplicateMobile: vi.fn().mockResolvedValue([]),
  createLeadAndRedirect: vi.fn(),
}));

afterEach(cleanup);

describe("new lead form", () => {
  it("presents patient email as optional with mobile-friendly input hints", () => {
    render(
      <NewLeadForm
        branches={[
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "Tirupur",
            code: "TIR",
            address: null,
            phone: null,
            company_name: null,
            invoice_email: null,
            gst_number: null,
            appointment_whatsapp_enabled: true,
            timezone: "Asia/Kolkata",
            is_active: true,
            created_at: "2026-09-03T00:00:00.000Z",
            updated_at: "2026-09-03T00:00:00.000Z",
          },
        ]}
        sources={[]}
        treatmentOptions={[]}
      />
    );

    const email = screen.getByRole("textbox", { name: "Email (optional)" });
    expect(email).not.toBeRequired();
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("inputmode", "email");
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(email).toHaveAttribute("autocapitalize", "none");
    expect(email).toHaveAttribute("autocorrect", "off");
    expect(email).toHaveAttribute("enterkeyhint", "next");
    expect(email).toHaveAttribute("spellcheck", "false");
  });

  it("accepts decimal ages with a decimal keyboard and no native integer-step restriction", () => {
    render(<NewLeadForm branches={[]} sources={[]} treatmentOptions={[]} />);
    const age = screen.getByRole("spinbutton", { name: "Age (years)" });
    expect(age).toHaveAttribute("step", "any");
    expect(age).toHaveAttribute("inputmode", "decimal");
    expect(age).toHaveAccessibleDescription(/Enter years, including decimals/);
    for (const value of ["0.2", "2.5", "4.3", "25.5", "119.99"]) {
      fireEvent.change(age, { target: { value } });
      expect(age).toHaveValue(Number(value));
      expect((age as HTMLInputElement).checkValidity()).toBe(true);
    }
  });
});
