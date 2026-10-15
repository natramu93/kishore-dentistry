import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConsultationInvoiceForm } from "@/components/invoices/consultation-invoice-form";
import { createConsultationInvoiceAndRedirect } from "@/actions/invoices";

vi.mock("@/actions/invoices", () => ({
  createConsultationInvoiceAndRedirect: vi.fn().mockResolvedValue({ ok: true }),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("consultation invoice doctor details", () => {
  it("allows an explicit zero consultation fee", async () => {
    render(<ConsultationInvoiceForm leadId="lead-1" />);
    fireEvent.change(screen.getByLabelText("Consulting doctor"), { target: { value: "Dr. Consultant" } });
    fireEvent.click(screen.getByRole("button", { name: "No referring doctor" }));
    fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: "0" } });
    expect(screen.getByLabelText("Amount (₹)")).toBeValid();
    fireEvent.click(screen.getByRole("button", { name: "Create consultation invoice" }));
    await waitFor(() => expect(createConsultationInvoiceAndRedirect).toHaveBeenCalledWith(expect.objectContaining({ amount: "0" })));
  });

  it("requires both names and saves the explicit walk-in choice", async () => {
    render(<ConsultationInvoiceForm leadId="lead-1" />);
    expect(screen.getByLabelText("Consulting doctor")).toBeRequired();
    expect(screen.getByLabelText("Referring doctor")).toBeRequired();
    fireEvent.click(screen.getByRole("button", { name: "Create consultation invoice" }));
    expect(createConsultationInvoiceAndRedirect).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Consulting doctor"), { target: { value: "Dr. Consultant" } });
    fireEvent.click(screen.getByRole("button", { name: "No referring doctor" }));
    fireEvent.click(screen.getByRole("button", { name: "Create consultation invoice" }));
    await waitFor(() => expect(createConsultationInvoiceAndRedirect).toHaveBeenCalledWith(expect.objectContaining({
      consulting_doctor_name: "Dr. Consultant", referring_doctor_name: "No referring doctor",
    })));
  });
});
