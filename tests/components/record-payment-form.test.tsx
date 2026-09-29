import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RecordPaymentForm } from "@/components/invoices/record-payment-form";
import { recordInvoicePaymentAction } from "@/actions/invoices";
import { toast } from "sonner";

vi.mock("@/actions/invoices", () => ({ recordInvoicePaymentAction: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

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

  it("keeps the payment action available and explains an amount above the displayed balance", () => {
    render(<RecordPaymentForm invoiceId="invoice-1" balanceDue={80} />);
    const amount = screen.getByRole("spinbutton", { name: "Payment amount (₹)" });
    fireEvent.change(amount, { target: { value: "81" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Payment method" }), { target: { value: "cash" } });
    const button = screen.getByRole("button", { name: "Record payment" });
    expect(button).toBeEnabled();
    fireEvent.submit(button.closest("form")!);
    expect(toast.error).toHaveBeenCalledWith("Payment cannot exceed the outstanding balance");
    expect(recordInvoicePaymentAction).not.toHaveBeenCalled();
  });

  it("keeps the payment action available and asks for a method", () => {
    render(<RecordPaymentForm invoiceId="invoice-1" balanceDue={80} />);
    const button = screen.getByRole("button", { name: "Record payment" });
    expect(button).toBeEnabled();
    fireEvent.submit(button.closest("form")!);
    expect(toast.error).toHaveBeenCalledWith("Choose a payment method to record this payment");
    expect(recordInvoicePaymentAction).not.toHaveBeenCalled();
  });
});
