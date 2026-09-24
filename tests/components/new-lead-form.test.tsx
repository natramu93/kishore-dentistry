import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
});
