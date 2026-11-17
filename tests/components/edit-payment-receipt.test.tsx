import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditPaymentReceipt } from "@/components/invoices/edit-payment-receipt";
import { updateInvoicePaymentAction } from "@/actions/invoices";
import type { InvoicePayment } from "@/lib/database.types";

vi.mock("@/actions/invoices", () => ({ updateInvoicePaymentAction: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("receipt correction", () => {
  it("submits the amount, method, reference, reason and original receipt version", async () => {
    render(<EditPaymentReceipt maximumAmount={200} payment={{ id: "receipt-1", invoice_id: "invoice-1", amount: 150,
      payment_method: "cash", reference: null, version: 3 } as InvoicePayment} />);
    fireEvent.click(screen.getByText("Edit receipt"));
    expect(screen.queryByLabelText("Receipt date")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Received amount (₹)"), { target: { value: "125" } });
    fireEvent.change(screen.getByLabelText("Payment method"), { target: { value: "neft" } });
    fireEvent.change(screen.getByLabelText("Transaction / receipt reference"), { target: { value: "BANK-REF" } });
    fireEvent.change(screen.getByLabelText("Reason for correction"), { target: { value: "Confirmed bank receipt" } });
    fireEvent.click(screen.getByRole("button", { name: "Update receipt" }));
    await waitFor(() => expect(updateInvoicePaymentAction).toHaveBeenCalledWith("invoice-1", "receipt-1", {
      amount: "125", method: "neft", reference: "BANK-REF", reason: "Confirmed bank receipt", expected_version: 3,
    }));
  });

  it("shows the clinic-local date to a super admin and submits a date-only correction", async () => {
    render(<EditPaymentReceipt canEditDate maximumAmount={200} payment={{ id: "receipt-1", invoice_id: "invoice-1", amount: 150,
      payment_method: "cash", reference: null, version: 3, received_at: "2026-01-10T20:00:00Z" } as InvoicePayment} />);
    fireEvent.click(screen.getByText("Edit receipt"));
    expect(screen.getByLabelText("Receipt date")).toHaveValue("2026-01-11");
    fireEvent.change(screen.getByLabelText("Receipt date"), { target: { value: "2026-01-09" } });
    fireEvent.change(screen.getByLabelText("Reason for correction"), { target: { value: "Receipt entered two days late" } });
    fireEvent.click(screen.getByRole("button", { name: "Update receipt" }));
    await waitFor(() => expect(updateInvoicePaymentAction).toHaveBeenCalledWith("invoice-1", "receipt-1", {
      amount: "150", method: "cash", reference: "", reason: "Receipt entered two days late", expected_version: 3,
      receipt_date: "2026-01-09",
    }));
  });
});
