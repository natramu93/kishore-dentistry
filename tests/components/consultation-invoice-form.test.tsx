import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConsultationInvoiceForm } from "@/components/invoices/consultation-invoice-form";
import { createConsultationInvoiceAndRedirect } from "@/actions/invoices";

vi.mock("@/actions/invoices", () => ({
  createConsultationInvoiceAndRedirect: vi.fn().mockResolvedValue({ ok: true }),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("consultation invoice doctor details", () => {
  it("does not create a bill when Enter is pressed in a consultation field", () => {
    render(<ConsultationInvoiceForm leadId="lead-1" />);
    for (const label of ["Consulting doctor", "Amount (₹)"]) {
      expect(fireEvent.keyDown(screen.getByLabelText(label), { key: "Enter" })).toBe(false);
    }
    expect(fireEvent.keyDown(screen.getByLabelText("Notes (optional)"), { key: "Enter" })).toBe(true);
    expect(createConsultationInvoiceAndRedirect).not.toHaveBeenCalled();
  });
  it("allows an explicit zero consultation fee", async () => {
    render(<ConsultationInvoiceForm leadId="lead-1" />);
    fireEvent.change(screen.getByLabelText("Consulting doctor"), { target: { value: "Dr. Consultant" } });
    fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: "0" } });
    expect(screen.getByLabelText("Amount (₹)")).toBeValid();
    fireEvent.click(screen.getByRole("button", { name: "Create consultation invoice" }));
    await waitFor(() => expect(createConsultationInvoiceAndRedirect).toHaveBeenCalledWith(expect.objectContaining({ amount: "0" })));
  });

  it("requires only the consulting doctor and omits the referring field", async () => {
    render(<ConsultationInvoiceForm leadId="lead-1" />);
    expect(screen.getByLabelText("Consulting doctor")).toBeRequired();
    expect(screen.queryByLabelText("Referring doctor")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create consultation invoice" }));
    expect(createConsultationInvoiceAndRedirect).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Consulting doctor"), { target: { value: "Dr. Consultant" } });
    fireEvent.click(screen.getByRole("button", { name: "Create consultation invoice" }));
    await waitFor(() => expect(createConsultationInvoiceAndRedirect).toHaveBeenCalledWith(expect.objectContaining({
      consulting_doctor_name: "Dr. Consultant",
    })));
  });
});
