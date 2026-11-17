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
  it("does not save an invoice implicitly when Enter is pressed in its amount", () => {
    render(<ConsultationInvoiceEditor invoiceId="invoice-1" version={3} initialAmount={200} initialNotes="" initialInvoiceDate="2026-10-07" />);
    expect(fireEvent.keyDown(screen.getByLabelText("Consultation amount (₹)"), { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(screen.getByLabelText("Invoice remarks (optional)"), { key: "Enter" })).toBe(true);
    expect(updateConsultationInvoiceAction).not.toHaveBeenCalled();
  });
  it("allows correcting an unpaid consultation fee to zero", async () => {
    render(<ConsultationInvoiceEditor invoiceId="invoice-1" version={3} initialAmount={200} initialNotes="" initialInvoiceDate="2026-10-07" />);
    fireEvent.change(screen.getByLabelText("Consultation amount (₹)"), { target: { value: "0" } });
    expect(screen.getByLabelText("Consultation amount (₹)")).toBeValid();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateConsultationInvoiceAction).toHaveBeenCalledWith("invoice-1", { amount: "0", notes: "", invoice_date: "2026-10-07", expected_version: 3 }));
  });

  it("prefills and saves the date alongside other consultation edits", async () => {
    render(<ConsultationInvoiceEditor invoiceId="invoice-1" version={3} initialAmount={200} initialNotes="" initialInvoiceDate="2026-10-07" />);
    expect(screen.getByLabelText("Invoice date")).toHaveValue("2026-10-07");
    fireEvent.change(screen.getByLabelText("Invoice date"), { target: { value: "2026-10-06" } });
    fireEvent.change(screen.getByLabelText("Consultation amount (₹)"), { target: { value: "250" } });
    fireEvent.change(screen.getByLabelText("Invoice remarks (optional)"), { target: { value: "Corrected fee" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateConsultationInvoiceAction).toHaveBeenCalledWith("invoice-1", { amount: "250", notes: "Corrected fee", invoice_date: "2026-10-06", expected_version: 3 }));
  });
  it("retains entries when a payment was recorded in another request", async () => {
    vi.mocked(updateConsultationInvoiceAction).mockResolvedValueOnce({ ok: false, error: "Invoice changed in another request. Refresh and try again." });
    render(<ConsultationInvoiceEditor invoiceId="invoice-1" version={3} initialAmount={200} initialNotes="Keep this note" initialInvoiceDate="2026-10-07" />);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("another request")));
    expect(screen.getByLabelText("Invoice remarks (optional)")).toHaveValue("Keep this note");
  });
  it("previews a new balance and prevents reducing a paid consultation below receipts", async () => {
    render(<ConsultationInvoiceEditor invoiceId="invoice-1" version={3} initialAmount={200} initialNotes=""
      initialInvoiceDate="2026-10-07" amountReceived={200} />);
    fireEvent.change(screen.getByLabelText("Consultation amount (₹)"), { target: { value: "150" } });
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByText(/cannot be less than the amount already received/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Consultation amount (₹)"), { target: { value: "250" } });
    expect(screen.getByText(/Balance after edit: ₹50/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateConsultationInvoiceAction).toHaveBeenCalledWith("invoice-1", expect.objectContaining({ amount: "250" })));
  });
});
