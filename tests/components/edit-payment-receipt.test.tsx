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
    fireEvent.change(screen.getByLabelText("Received amount (₹)"), { target: { value: "125" } });
    fireEvent.change(screen.getByLabelText("Payment method"), { target: { value: "neft" } });
    fireEvent.change(screen.getByLabelText("Transaction / receipt reference"), { target: { value: "BANK-REF" } });
    fireEvent.change(screen.getByLabelText("Reason for correction"), { target: { value: "Confirmed bank receipt" } });
    fireEvent.click(screen.getByRole("button", { name: "Update receipt" }));
    await waitFor(() => expect(updateInvoicePaymentAction).toHaveBeenCalledWith("invoice-1", "receipt-1", {
      amount: "125", method: "neft", reference: "BANK-REF", reason: "Confirmed bank receipt", expected_version: 3,
    }));
  });
});
