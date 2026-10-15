import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConsultationInvoiceEditor } from "@/components/invoices/consultation-invoice-editor";
import { InvoiceDateFilters } from "@/components/invoices/invoice-date-filters";
import { updateConsultationInvoiceAction } from "@/actions/invoices";
import { toast } from "sonner";
vi.mock("@/actions/invoices", () => ({ updateConsultationInvoiceAction: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("invoice date controls", () => {
  it("shows range inputs only when a range is selected", () => {
    render(<InvoiceDateFilters mode="today" from="2026-10-07" to="2026-10-07" />);
    expect(screen.queryByLabelText("From date")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Invoice dates"), { target: { value: "range" } });
    expect(screen.getByLabelText("From date")).toHaveValue("2026-10-07");
    expect(screen.getByLabelText("To date")).toHaveValue("2026-10-07");
    fireEvent.change(screen.getByLabelText("Invoice dates"), { target: { value: "all" } });
    expect(screen.queryByLabelText("From date")).not.toBeInTheDocument();
  });
});

describe("consultation invoice edits", () => {
  it("allows correcting an unpaid consultation fee to zero", async () => {
    render(<ConsultationInvoiceEditor invoiceId="invoice-1" version={3} initialAmount={200} initialNotes="" />);
    fireEvent.change(screen.getByLabelText("Consultation amount (₹)"), { target: { value: "0" } });
    expect(screen.getByLabelText("Consultation amount (₹)")).toBeValid();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateConsultationInvoiceAction).toHaveBeenCalledWith("invoice-1", { amount: "0", notes: "", expected_version: 3 }));
  });

  it("saves corrected amounts and notes with the invoice version", async () => {
    render(<ConsultationInvoiceEditor invoiceId="invoice-1" version={3} initialAmount={200} initialNotes="" />);
    fireEvent.change(screen.getByLabelText("Consultation amount (₹)"), { target: { value: "250" } });
    fireEvent.change(screen.getByLabelText("Invoice remarks (optional)"), { target: { value: "Corrected fee" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateConsultationInvoiceAction).toHaveBeenCalledWith("invoice-1", { amount: "250", notes: "Corrected fee", expected_version: 3 }));
  });
  it("retains entries when the edit window expires during editing", async () => {
    vi.mocked(updateConsultationInvoiceAction).mockResolvedValueOnce({ ok: false, error: "Invoices can only be edited within 24 hours of creation" });
    render(<ConsultationInvoiceEditor invoiceId="invoice-1" version={3} initialAmount={200} initialNotes="Keep this note" />);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("24 hours")));
    expect(screen.getByLabelText("Invoice remarks (optional)")).toHaveValue("Keep this note");
  });
});
