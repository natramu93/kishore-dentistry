import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RecordPaymentForm } from "@/components/invoices/record-payment-form";
import { confirmInvoiceCarryForwardAction, recordInvoicePaymentsAction } from "@/actions/invoices";
import { toast } from "sonner";
import { clinicToday } from "@/lib/tz";

vi.mock("@/actions/invoices", () => ({
  recordInvoicePaymentsAction: vi.fn().mockResolvedValue({ ok: true }),
  confirmInvoiceCarryForwardAction: vi.fn().mockResolvedValue({ ok: true, balance: {
    amount_paid: 0, invoice_due: 150, earlier_due: 200, later_due: 0, overall_due: 350, earlier_invoice_count: 1,
  } }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("record payment form", () => {
  it("accepts ₹0 received without a method and carries all dues forward without a receipt", async () => {
    render(<RecordPaymentForm invoiceId="invoice-1" balanceDue={150} />);
    const amount = screen.getByRole("spinbutton", { name: "Payment amount (₹)" });
    fireEvent.change(amount, { target: { value: "0" } });
    expect(amount).toHaveAttribute("min", "0");
    expect(screen.getByRole("combobox", { name: "Payment method" })).toBeDisabled();
    expect(screen.queryByLabelText("Receipt date")).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Confirm ₹0 received / carry forward" });
    expect(button.closest("form")!.checkValidity()).toBe(true);
    fireEvent.click(button);
    await waitFor(() => expect(confirmInvoiceCarryForwardAction).toHaveBeenCalledExactlyOnceWith("invoice-1"));
    expect(recordInvoicePaymentsAction).not.toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent("This invoice due: ₹150.00");
    expect(screen.getByRole("status")).toHaveTextContent("Overall patient due: ₹350.00");
    expect(await screen.findByRole("button", { name: "Balance carried forward" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Record a payment" }));
    expect(screen.getByRole("spinbutton", { name: "Payment amount (₹)" })).toHaveValue(150);
    expect(screen.getByRole("button", { name: "Record payment" })).toBeEnabled();
  });

  it("offers a no-payment shortcut even after entering split payment details", async () => {
    render(<RecordPaymentForm invoiceId="invoice-1" balanceDue={150} />);
    fireEvent.click(screen.getByRole("button", { name: "Add payment method" }));
    fireEvent.click(screen.getByRole("button", { name: "No payment — carry forward" }));
    expect(screen.getAllByRole("spinbutton", { name: "Payment amount (₹)" })).toHaveLength(1);
    expect(screen.getByRole("spinbutton", { name: "Payment amount (₹)" })).toHaveValue(0);
    expect(screen.getByText(/No receipt will be created/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm ₹0 received / carry forward" }));
    await waitFor(() => expect(confirmInvoiceCarryForwardAction).toHaveBeenCalledTimes(1));
    expect(recordInvoicePaymentsAction).not.toHaveBeenCalled();
  });

  it.each(["", "-1"])("does not treat invalid or blank amount %s as no payment", (value) => {
    render(<RecordPaymentForm invoiceId="invoice-1" balanceDue={150} />);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Payment amount (₹)" }), { target: { value } });
    fireEvent.submit(screen.getByRole("button", { name: "Record payment" }).closest("form")!);
    expect(toast.error).toHaveBeenCalledWith("Enter a payment amount of zero or greater");
    expect(confirmInvoiceCarryForwardAction).not.toHaveBeenCalled();
    expect(recordInvoicePaymentsAction).not.toHaveBeenCalled();
  });

  it("does not silently discard a transaction reference when an amount is changed to zero", () => {
    render(<RecordPaymentForm invoiceId="invoice-1" balanceDue={150} />);
    fireEvent.change(screen.getByRole("textbox", { name: /transaction \/ receipt reference/i }), { target: { value: "UPI-123" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Payment amount (₹)" }), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm ₹0 received / carry forward" }));
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Clear the transaction reference"));
    expect(confirmInvoiceCarryForwardAction).not.toHaveBeenCalled();
  });

  it("does not submit zero-value rows as part of a real split receipt", () => {
    render(<RecordPaymentForm invoiceId="invoice-1" balanceDue={150} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Payment method" }), { target: { value: "cash" } });
    fireEvent.click(screen.getByRole("button", { name: "Add payment method" }));
    fireEvent.submit(screen.getByRole("button", { name: "Record payment" }).closest("form")!);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Remove zero-value payment rows"));
    expect(recordInvoicePaymentsAction).not.toHaveBeenCalled();
    expect(confirmInvoiceCarryForwardAction).not.toHaveBeenCalled();
  });

  it("keeps zero entries available for retry if the latest balance cannot be confirmed", async () => {
    vi.mocked(confirmInvoiceCarryForwardAction).mockResolvedValueOnce({ ok: false, error: "No access to this patient" });
    render(<RecordPaymentForm invoiceId="invoice-1" balanceDue={150} />);
    fireEvent.click(screen.getByRole("button", { name: "No payment — carry forward" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm ₹0 received / carry forward" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("No access to this patient"));
    expect(screen.getByRole("button", { name: "Confirm ₹0 received / carry forward" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm ₹0 received / carry forward" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Overall patient due: ₹350.00");
    expect(recordInvoicePaymentsAction).not.toHaveBeenCalled();
  });

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

    await waitFor(() => expect(recordInvoicePaymentsAction).toHaveBeenCalledWith("invoice-1", {
      request_key: expect.any(String),
      receipt_date: clinicToday(),
      receipts: [{ amount: "50", method: "upi", reference: "UPI-REF-001" }],
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
    expect(recordInvoicePaymentsAction).not.toHaveBeenCalled();
  });

  it("keeps the payment action available and asks for a method", () => {
    render(<RecordPaymentForm invoiceId="invoice-1" balanceDue={80} />);
    const button = screen.getByRole("button", { name: "Record payment" });
    expect(button).toBeEnabled();
    fireEvent.submit(button.closest("form")!);
    expect(toast.error).toHaveBeenCalledWith("Choose a payment method to record this payment");
    expect(recordInvoicePaymentsAction).not.toHaveBeenCalled();
  });

  it("submits split methods together and retries an interrupted request with the same key", async () => {
    vi.mocked(recordInvoicePaymentsAction).mockRejectedValueOnce(new Error("Response interrupted"));
    render(<RecordPaymentForm invoiceId="invoice-1" balanceDue={150} />);
    expect(screen.getByLabelText("Receipt date")).toHaveValue(clinicToday());
    fireEvent.change(screen.getByLabelText("Receipt date"), { target: { value: "2026-01-15" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Payment amount (₹)" }), { target: { value: "50" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Payment method" }), { target: { value: "cash" } });
    fireEvent.click(screen.getByRole("button", { name: "Add payment method" }));
    fireEvent.change(screen.getAllByRole("combobox", { name: "Payment method" })[1], { target: { value: "card" } });
    fireEvent.click(await screen.findByRole("button", { name: "Record payment" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("retry")));
    const first = vi.mocked(recordInvoicePaymentsAction).mock.calls[0][1];
    fireEvent.click(await screen.findByRole("button", { name: "Record payment" }));
    await waitFor(() => expect(recordInvoicePaymentsAction).toHaveBeenCalledTimes(2));
    expect(vi.mocked(recordInvoicePaymentsAction).mock.calls[1][1]).toEqual(first);
    expect(first).toEqual({ request_key: expect.any(String), receipt_date: "2026-01-15", receipts: [
      { amount: "50", method: "cash", reference: "" }, { amount: "100.00", method: "card", reference: "" },
    ] });
  });
});
