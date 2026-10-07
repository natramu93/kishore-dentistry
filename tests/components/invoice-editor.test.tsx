import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { InvoiceEditor } from "@/components/invoices/invoice-editor";
import { createInvoiceAction, updateInvoiceAction } from "@/actions/invoices";
import { toast } from "sonner";

vi.mock("@/actions/invoices", () => ({
  createInvoiceAction: vi.fn().mockResolvedValue({ ok: true, id: "invoice-created" }),
  updateInvoiceAction: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const TREATMENT_TYPE_ID = "treatment-type-1";

function renderInvoiceEditor() {
  const result = render(
    <InvoiceEditor
      mode="create"
      leadId="lead-1"
      treatmentCatalog={[]}
      treatmentOptions={[
        {
          id: TREATMENT_TYPE_ID,
          name: "General consultation",
          category: "Consultation",
          default_cost: 200,
          is_general_consultation: true,
        },
      ]}
      initialItems={[]}
    />
  );
  fireEvent.change(screen.getByLabelText("Consulting doctor"), { target: { value: "Dr. Test Doctor" } });
  fireEvent.change(screen.getByLabelText("Referring doctor"), { target: { value: "Dr. Referrer" } });
  return result;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("independent invoice editor", () => {
  it("requires both doctor details and provides an explicit walk-in choice", async () => {
    renderInvoiceEditor();
    fireEvent.change(screen.getByRole("combobox", { name: "Treatment" }), { target: { value: TREATMENT_TYPE_ID } });
    const referring = screen.getByLabelText("Referring doctor");
    fireEvent.change(referring, { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    expect(createInvoiceAction).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("both doctor details"));
    fireEvent.click(screen.getByRole("button", { name: "No referring doctor" }));
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    await waitFor(() => expect(createInvoiceAction).toHaveBeenCalledWith(expect.objectContaining({ referring_doctor_name: "No referring doctor" })));
  });
  it("keeps site summaries in their own full-width row, outside treatment controls", () => {
    renderInvoiceEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add treatment line" }));

    for (const line of screen.getAllByRole("group", { name: /^Treatment line \d+$/ })) {
      const fields = within(line);
      const summary = fields.getByText("General / not tooth-specific");
      const treatment = fields.getByRole("combobox", { name: "Treatment" });
      expect(summary.parentElement).toBe(line);
      expect(summary).toHaveClass("col-span-full");
      expect(treatment.parentElement).not.toContainElement(summary);
      expect(fields.getByRole("spinbutton", { name: "Quantity" })).toBeEnabled();
      expect(fields.getByRole("spinbutton", { name: "Unit price (₹)" })).toBeEnabled();
      expect(fields.getByRole("button", { name: /^Remove treatment line/ })).toBeEnabled();
    }
  });

  it("starts with a treatment selector and marks it invalid when treatment is missing", () => {
    renderInvoiceEditor();
    const createButton = screen.getByRole("button", { name: "Create invoice" });
    expect(createButton).toBeEnabled();
    fireEvent.click(createButton);
    expect(screen.getByRole("combobox", { name: "Treatment" })).toBeInvalid();
    expect(createInvoiceAction).not.toHaveBeenCalled();
  });

  it("explains when the center has no active treatment catalog", () => {
    render(
      <InvoiceEditor
        mode="create"
        leadId="lead-1"
        treatmentCatalog={[]}
        treatmentOptions={[]}
        initialItems={[]}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent(/no active treatments are configured/i);
    fireEvent.click(screen.getByRole("button", { name: "Add treatment line" }));
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("No active treatments are available"));
    expect(screen.getByRole("button", { name: "Create invoice" })).toBeEnabled();
  });

  it("creates an invoice from the treatment catalog without a completed case-sheet treatment", async () => {
    renderInvoiceEditor();
    fireEvent.change(screen.getByLabelText("Invoice date"), { target: { value: "2026-09-25" } });
    fireEvent.change(screen.getByLabelText("Consulting doctor"), { target: { value: "Dr. Test Doctor" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Treatment" }), {
      target: { value: TREATMENT_TYPE_ID },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));

    await waitFor(() => {
      expect(createInvoiceAction).toHaveBeenCalledWith(expect.objectContaining({
        lead_id: "lead-1",
        invoice_date: "2026-09-25",
        consulting_doctor_name: "Dr. Test Doctor",
        referring_doctor_name: "Dr. Referrer",
        items: [{ treatment_type_id: TREATMENT_TYPE_ID, quantity: 1, unit_price: 200 }],
      }));
    });
  });

  it("saves multiple teeth and an invoice note without altering billing quantity", async () => {
    renderInvoiceEditor();
    fireEvent.change(screen.getByRole("combobox", { name: "Treatment" }), { target: { value: TREATMENT_TYPE_ID } });
    fireEvent.click(screen.getByText("Teeth & line note (optional)"));
    fireEvent.click(screen.getByRole("button", { name: /^11,/ }));
    fireEvent.click(screen.getByRole("button", { name: /^12,/ }));
    fireEvent.change(screen.getByLabelText("Line note"), { target: { value: "Review restoration" } });
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    await waitFor(() => expect(createInvoiceAction).toHaveBeenCalledWith(expect.objectContaining({
      items: [{ treatment_type_id: TREATMENT_TYPE_ID, quantity: 1, unit_price: 200, tooth_numbers: ["11", "12"], line_note: "Review restoration" }],
    })));
  });

  it("edits standalone invoice teeth and preserves its discount", async () => {
    render(<InvoiceEditor mode="edit" invoiceId="invoice-1" initialVersion={2} leadId="lead-1" treatmentCatalog={[]}
      treatmentOptions={[{ id: TREATMENT_TYPE_ID, name: "Restoration", category: null, default_cost: 200, is_general_consultation: false }]}
      initialItems={[{ treatment_type_id: TREATMENT_TYPE_ID, description: "Restoration", site_label: "Teeth 11, 12", tooth_numbers: ["11", "12"], line_note: "Existing note", quantity: 1, unit_price: 200 }]}
      initialDiscount={50} initialDiscountGivenBy="Center head" initialMention="Review" />);
    expect(screen.getByRole("button", { name: "Remove treatment line 1: Restoration" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateInvoiceAction).toHaveBeenCalledWith("invoice-1", expect.objectContaining({
      discount_amount: 50, discount_given_by: "Center head", mention: "Review", expected_version: 2,
      items: [{ treatment_type_id: TREATMENT_TYPE_ID, quantity: 1, unit_price: 200, tooth_numbers: ["11", "12"], line_note: "Existing note" }],
    })));
  });

  it("retains entries and gives feedback when an unexpected save failure occurs", async () => {
    vi.mocked(createInvoiceAction).mockRejectedValueOnce(new Error("Connection interrupted"));
    renderInvoiceEditor();
    fireEvent.change(screen.getByRole("combobox", { name: "Treatment" }), { target: { value: TREATMENT_TYPE_ID } });
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Your entries are still here")));
    expect(screen.getByRole("combobox", { name: "Treatment" })).toHaveValue(TREATMENT_TYPE_ID);
    await waitFor(() => expect(screen.getByRole("button", { name: "Create invoice" })).toBeEnabled());
  });
});
