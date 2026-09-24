import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RecordPaymentForm } from "@/components/invoices/record-payment-form";
import { recordInvoicePaymentAction } from "@/actions/invoices";

vi.mock("@/actions/invoices", () => ({ recordInvoicePaymentAction: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("record payment form", () => {
  it("offers the supported methods and submits a partial payment with its reference", async () => {
    render(<RecordPaymentForm invoiceId="invoice-1" balanceDue={150} />);

    const amount = screen.getByRole("spinbutton", { name: "Payment amount (₹)" });
    const method = screen.getByRole("combobox", { name: "Payment method" });
    expect(screen.getByRole("option", { name: "UPI" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Cash" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Card" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "NEFT" })).toBeInTheDocument();

    fireEvent.change(amount, { target: { value: "50" } });
    fireEvent.change(method, { target: { value: "upi" } });
    fireEvent.change(screen.getByRole("textbox", { name: /transaction \/ receipt reference/i }), {
      target: { value: "UPI-REF-001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));

    await waitFor(() => expect(recordInvoicePaymentAction).toHaveBeenCalledWith("invoice-1", {
      amount: "50",
      method: "upi",
      reference: "UPI-REF-001",
    }));
  });

  it("does not allow an installment above the displayed balance", () => {
    render(<RecordPaymentForm invoiceId="invoice-1" balanceDue={80} />);
    const amount = screen.getByRole("spinbutton", { name: "Payment amount (₹)" });
    fireEvent.change(amount, { target: { value: "81" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Payment method" }), { target: { value: "cash" } });
    expect(screen.getByRole("button", { name: "Record payment" })).toBeDisabled();
  });
});
