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

async function chooseConsultation() {
  fireEvent.input(screen.getByRole("combobox", { name: "Treatment" }), { target: { value: "consult" }, inputType: "insertText" });
  fireEvent.click(await screen.findByRole("option", { name: "General consultation — Consultation" }));
}

function renderInvoiceEditor(existingBalanceDue?: number) {
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
      existingBalanceDue={existingBalanceDue}
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
  it("reuses one form and adds compact lines with independent catalog prices, including zero", async () => {
    render(<InvoiceEditor mode="create" leadId="lead-1" treatmentCatalog={[]} initialItems={[]}
      treatmentOptions={[
        { id: "filling", name: "Composite filling", category: "Restorative", default_cost: 500, is_general_consultation: false },
        { id: "scaling", name: "Scaling", category: "Preventive", default_cost: 0, is_general_consultation: false },
      ]} />);
    fireEvent.change(screen.getByLabelText("Consulting doctor"), { target: { value: "Dr. Consultant" } });
    fireEvent.click(screen.getByRole("button", { name: "No referring doctor" }));
    fireEvent.input(screen.getByRole("combobox", { name: "Treatment" }), { target: { value: "fill" }, inputType: "insertText" });
    fireEvent.click(await screen.findByRole("option", { name: "Composite filling — Restorative" }));
    fireEvent.click(screen.getByRole("button", { name: "Add treatment" }));
    const first = screen.getByRole("listitem", { name: "Treatment line 1: Composite filling" });
    expect(first).toHaveTextContent("₹500.00");
    expect(within(first).queryByRole("combobox")).not.toBeInTheDocument();
    const input = screen.getByRole("combobox", { name: "Treatment" });
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    fireEvent.input(input, { target: { value: "preventive" }, inputType: "insertText" });
    fireEvent.click(await screen.findByRole("option", { name: "Scaling — Preventive" }));
    expect(screen.getByRole("spinbutton", { name: "Unit price (₹)" })).toHaveValue(0);
    fireEvent.click(screen.getByRole("button", { name: "Add treatment" }));
    expect(screen.getAllByRole("combobox", { name: "Treatment" })).toHaveLength(1);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    await waitFor(() => expect(createInvoiceAction).toHaveBeenCalledWith(expect.objectContaining({ items: [
      { treatment_type_id: "filling", quantity: 1, unit_price: 500 },
      { treatment_type_id: "scaling", quantity: 1, unit_price: 0 },
    ] })));
  });

  it("does not bill a previously selected treatment after clearing its search", async () => {
    renderInvoiceEditor();
    await chooseConsultation();
    fireEvent.click(screen.getByRole("button", { name: "Clear treatment" }));
    expect(screen.getByRole("spinbutton", { name: "Unit price (₹)" })).toHaveValue(0);
    fireEvent.submit(screen.getByRole("button", { name: "Create invoice" }).closest("form")!);
    expect(createInvoiceAction).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Add at least one treatment line");
  });

  it("also searches saved case-sheet treatments by code when editing", async () => {
    render(<InvoiceEditor mode="edit" invoiceId="invoice-1" leadId="lead-1" initialVersion={2}
      treatmentOptions={[{ id: TREATMENT_TYPE_ID, name: "Consultation", category: null, default_cost: 200, is_general_consultation: true }]}
      initialItems={[{ treatment_type_id: TREATMENT_TYPE_ID, description: "Consultation", site_label: "General service", quantity: 1, unit_price: 200 }]}
      treatmentCatalog={[{ id: "saved-filling", code: "23.2", name: "Filling", site_label: "Teeth 18", quantity: 1, unit_price: 700 }]} />);
    fireEvent.input(screen.getByRole("combobox", { name: "Treatment" }), { target: { value: "23.2" }, inputType: "insertText" });
    fireEvent.click(await screen.findByRole("option", { name: "23.2 — Filling — Teeth 18" }));
    expect(screen.getByLabelText("Quantity")).toHaveAttribute("readonly");
    fireEvent.click(screen.getByRole("button", { name: "Add treatment" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateInvoiceAction).toHaveBeenCalledWith("invoice-1", expect.objectContaining({ items: [
      { treatment_type_id: TREATMENT_TYPE_ID, quantity: 1, unit_price: 200 },
      { treatment_id: "saved-filling", quantity: 1, unit_price: 700 },
    ] })));
  });

  it("creates a zero-priced invoice and leaves earlier patient dues unchanged", async () => {
    renderInvoiceEditor(500);
    await chooseConsultation();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Unit price (₹)" }), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Add treatment" }));
    expect(screen.getByText(/This is a ₹0 invoice/)).toBeInTheDocument();
    expect(screen.getByText("Overall patient due after this bill").parentElement).toHaveTextContent("₹500.00");
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    await waitFor(() => expect(createInvoiceAction).toHaveBeenCalledWith(expect.objectContaining({
      items: [{ treatment_type_id: TREATMENT_TYPE_ID, quantity: 1, unit_price: 0 }], discount_amount: 0,
    })));
  });

  it("allows a fully discounted invoice", async () => {
    renderInvoiceEditor();
    await chooseConsultation();
    fireEvent.click(screen.getByRole("button", { name: "Add treatment" }));
    fireEvent.change(screen.getByLabelText("Discount amount (₹)"), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    await waitFor(() => expect(createInvoiceAction).toHaveBeenCalledWith(expect.objectContaining({ discount_amount: 200 })));
  });

  it("edits an unpaid invoice down to zero", async () => {
    render(<InvoiceEditor mode="edit" invoiceId="invoice-1" initialVersion={2} leadId="lead-1" treatmentCatalog={[]}
      treatmentOptions={[{ id: TREATMENT_TYPE_ID, name: "Consultation", category: null, default_cost: 200, is_general_consultation: true }]}
      initialItems={[{ treatment_type_id: TREATMENT_TYPE_ID, description: "Consultation", site_label: "General / not tooth-specific", quantity: 1, unit_price: 200 }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit treatment line 1: Consultation" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Unit price (₹)" }), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Update line" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateInvoiceAction).toHaveBeenCalledWith("invoice-1", expect.objectContaining({
      items: [{ treatment_type_id: TREATMENT_TYPE_ID, quantity: 1, unit_price: 0 }],
    })));
  });

  it("still rejects negative prices on zero-value bills", async () => {
    renderInvoiceEditor();
    await chooseConsultation();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Unit price (₹)" }), { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add treatment" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Enter a valid unit price/);
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(createInvoiceAction).not.toHaveBeenCalled();
  });

  it("previews the collective due without adding past debt to new line items", async () => {
    renderInvoiceEditor(500);
    await chooseConsultation();
    fireEvent.click(screen.getByRole("button", { name: "Add treatment" }));
    const preview=screen.getByRole("region",{ name:"Patient due after this invoice" });
    expect(within(preview).getByText("₹700.00")).toBeInTheDocument();
    expect(within(preview).getByText(/not added to this invoice/)).toBeInTheDocument();
    expect(screen.getByText("Amount received on creation").parentElement).toHaveTextContent("₹0.00");
    expect(screen.getByText(/No payment is required to create this invoice/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{ name:"Create invoice" }));
    await waitFor(() => expect(createInvoiceAction).toHaveBeenCalledWith(expect.objectContaining({ items:[{ treatment_type_id:TREATMENT_TYPE_ID,quantity:1,unit_price:200 }] })));
  });
  it("requires both doctor details and provides an explicit walk-in choice", async () => {
    renderInvoiceEditor();
    await chooseConsultation();
    fireEvent.click(screen.getByRole("button", { name: "Add treatment" }));
    const referring = screen.getByLabelText("Referring doctor");
    fireEvent.change(referring, { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    expect(createInvoiceAction).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("both doctor details"));
    fireEvent.click(screen.getByRole("button", { name: "No referring doctor" }));
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    await waitFor(() => expect(createInvoiceAction).toHaveBeenCalledWith(expect.objectContaining({ referring_doctor_name: "No referring doctor" })));
  });
  it("requires a selected treatment and does not silently save an unadded line", async () => {
    renderInvoiceEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add treatment" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Choose a treatment/);
    await chooseConsultation();
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Click Add treatment/);
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
    expect(screen.getByText(/no active treatments are configured/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add treatment" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create invoice" })).toBeEnabled();
  });

  it("creates an invoice from the treatment catalog without a completed case-sheet treatment", async () => {
    renderInvoiceEditor();
    fireEvent.change(screen.getByLabelText("Invoice date"), { target: { value: "2026-09-25" } });
    fireEvent.change(screen.getByLabelText("Consulting doctor"), { target: { value: "Dr. Test Doctor" } });
    await chooseConsultation();
    fireEvent.click(screen.getByRole("button", { name: "Add treatment" }));
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
    await chooseConsultation();
    fireEvent.click(screen.getByText("Teeth & line note (optional)"));
    fireEvent.click(screen.getByRole("button", { name: /^11,/ }));
    fireEvent.click(screen.getByRole("button", { name: /^12,/ }));
    fireEvent.change(screen.getByLabelText("Line note"), { target: { value: "Review restoration" } });
    fireEvent.click(screen.getByRole("button", { name: "Add treatment" }));
    expect(screen.getByRole("listitem")).toHaveTextContent("Teeth 11, 12");
    expect(screen.getByLabelText("Line note")).toHaveValue("");
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
    fireEvent.click(screen.getByRole("button", { name: "Edit treatment line 1: Restoration" }));
    expect(screen.getByLabelText("Line note")).toHaveValue("Existing note");
    fireEvent.click(screen.getByRole("button", { name: /^12,/ }));
    fireEvent.click(screen.getByRole("button", { name: /^13,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Update line" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateInvoiceAction).toHaveBeenCalledWith("invoice-1", expect.objectContaining({
      discount_amount: 50, discount_given_by: "Center head", mention: "Review", expected_version: 2,
      items: [{ treatment_type_id: TREATMENT_TYPE_ID, quantity: 1, unit_price: 200, tooth_numbers: ["11", "13"], line_note: "Existing note" }],
    })));
  });

  it("retains entries and gives feedback when an unexpected save failure occurs", async () => {
    vi.mocked(createInvoiceAction).mockRejectedValueOnce(new Error("Connection interrupted"));
    renderInvoiceEditor();
    await chooseConsultation();
    fireEvent.click(screen.getByRole("button", { name: "Add treatment" }));
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Your entries are still here")));
    expect(screen.getByRole("listitem")).toHaveTextContent("General consultation");
    await waitFor(() => expect(screen.getByRole("button", { name: "Create invoice" })).toBeEnabled());
  });

  it("blocks implicit Enter submission from invoice inputs but preserves note line breaks", async () => {
    renderInvoiceEditor();
    await chooseConsultation();
    for (const label of ["Invoice date", "Consulting doctor", "Referring doctor", "Quantity", "Unit price (₹)", "Discount amount (₹)", "Discount given by"]) {
      for (const key of ["Enter", "NumpadEnter"]) {
        expect(fireEvent.keyDown(screen.getByLabelText(label), { key })).toBe(false);
      }
    }
    const notes = screen.getByLabelText("Line note");
    expect(fireEvent.keyDown(notes, { key: "Enter" })).toBe(true);
    fireEvent.change(notes, { target: { value: "First line\nSecond line" } });
    expect(notes).toHaveValue("First line\nSecond line");
    expect(createInvoiceAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Add treatment" }));
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    await waitFor(() => expect(createInvoiceAction).toHaveBeenCalledOnce());
  });

  it("still selects treatments with Enter without creating the invoice", async () => {
    renderInvoiceEditor();
    const input = screen.getByRole("combobox", { name: "Treatment" });
    fireEvent.input(input, { target: { value: "consult" }, inputType: "insertText" });
    await screen.findByRole("option", { name: "General consultation — Consultation" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(input).toHaveValue("General consultation — Consultation"));
    expect(screen.getByLabelText("Unit price (₹)")).toHaveValue(200);
    expect(createInvoiceAction).not.toHaveBeenCalled();
  });

  it("preserves the original clinical link when editing a primary line", async () => {
    render(<InvoiceEditor mode="edit" invoiceId="invoice-1" leadId="lead-1" initialVersion={2} primaryTreatmentId="saved-filling"
      treatmentOptions={[]} treatmentCatalog={[]}
      initialItems={[{ invoice_item_id: "original-line", treatment_id: "saved-filling", treatment_code: "23.2", description: "Filling", site_label: "Teeth 18", quantity: 1, unit_price: 700 }]} />);
    expect(screen.getByRole("button", { name: "The primary treatment cannot be removed" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Edit treatment line 1: Filling" }));
    expect(screen.queryByRole("combobox", { name: "Treatment" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Quantity")).toHaveAttribute("readonly");
    fireEvent.change(screen.getByLabelText("Unit price (₹)"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Update line" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateInvoiceAction).toHaveBeenCalledWith("invoice-1", expect.objectContaining({
      items: [{ invoice_item_id: "original-line", treatment_id: "saved-filling", quantity: 1, unit_price: 500 }],
    })));
  });

  it("supports repeated catalog entries and removes a line without disturbing the others", async () => {
    renderInvoiceEditor();
    for (let i = 0; i < 2; i++) {
      await chooseConsultation();
      fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: String(i + 1) } });
      fireEvent.click(screen.getByRole("button", { name: "Add treatment" }));
    }
    fireEvent.click(screen.getByRole("button", { name: /^Remove treatment line 1:/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("listitem")).toHaveTextContent("2 × ₹200.00");
    expect(screen.getByLabelText("Quantity")).toHaveValue(1);
  });
});
