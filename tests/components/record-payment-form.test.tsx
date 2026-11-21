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
  it("saves a payment-time discount with the adjusted receipt in a single request", async () => {
    render(<RecordPaymentForm invoiceId="invoice-1" balanceDue={1180} invoiceVersion={4} taxRate={18} availableDiscount={1000} />);
    fireEvent.click(screen.getByText("Discount at payment (optional)"));
    fireEvent.change(screen.getByLabelText("Additional discount before tax (₹)"), { target: { value: "100" } });
    expect(screen.getByLabelText("Payment amount (₹)")).toHaveValue(1062);
    fireEvent.change(screen.getByLabelText("Discount approved by"), { target: { value: "Center head" } });
    fireEvent.change(screen.getByLabelText("Discount reason"), { target: { value: "Approved concession" } });
    fireEvent.change(screen.getByLabelText("Payment method"), { target: { value: "upi" } });
    fireEvent.click(screen.getByRole("button", { name: "Save discount and payment" }));
    await waitFor(() => expect(recordInvoicePaymentsAction).toHaveBeenCalledWith("invoice-1", expect.objectContaining({
      receipts: [{ amount: "1062.00", method: "upi", reference: "" }],
      discount: { amount: 100, given_by: "Center head", reason: "Approved concession", expected_version: 4 },
    })));
  });
  it("fully waives an outstanding balance without fabricating a receipt", async () => {
    render(<RecordPaymentForm invoiceId="invoice-1" balanceDue={100} invoiceVersion={2} availableDiscount={100} />);
    fireEvent.click(screen.getByText("Discount at payment (optional)"));
    fireEvent.change(screen.getByLabelText("Additional discount before tax (₹)"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Discount approved by"), { target: { value: "Head" } });
    fireEvent.change(screen.getByLabelText("Discount reason"), { target: { value: "Complimentary" } });
    expect(screen.getByLabelText("Payment amount (₹)")).toHaveValue(0);
    expect(screen.getByLabelText("Payment method")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save discount and payment" }));
    await waitFor(() => expect(recordInvoicePaymentsAction).toHaveBeenCalledWith("invoice-1", expect.objectContaining({ receipts: [], discount: expect.objectContaining({ amount: 100 }) })));
    expect(confirmInvoiceCarryForwardAction).not.toHaveBeenCalled();
  });
  it("does not change a manually entered partial receipt when applying a discount", () => {
    render(<RecordPaymentForm invoiceId="invoice-1" balanceDue={150} invoiceVersion={2} availableDiscount={150} />);
    fireEvent.change(screen.getByLabelText("Payment amount (₹)"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("Additional discount before tax (₹)"), { target: { value: "10" } });
    expect(screen.getByLabelText("Payment amount (₹)")).toHaveValue(50);
  });
  it("saves independent remarks on each split receipt", async () => {
    render(<RecordPaymentForm invoiceId="invoice-1" balanceDue={150} />);
    fireEvent.change(screen.getByLabelText("Payment amount (₹)"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("Payment method"), { target: { value: "upi" } });
    fireEvent.change(screen.getByLabelText("Remarks (optional)"), { target: { value: "  First installment  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add payment method" }));
    fireEvent.change(screen.getAllByLabelText("Payment method")[1], { target: { value: "cash" } });
    fireEvent.change(screen.getAllByLabelText("Remarks (optional)")[1], { target: { value: "Balance received at desk" } });
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    await waitFor(() => expect(recordInvoicePaymentsAction).toHaveBeenCalledWith("invoice-1", expect.objectContaining({
      receipts: [
        { amount: "50", method: "upi", reference: "", notes: "First installment" },
        { amount: "100.00", method: "cash", reference: "", notes: "Balance received at desk" },
      ],
    })));
  });
  it("does not discard remarks when an entered receipt is changed to zero", () => {
    render(<RecordPaymentForm invoiceId="invoice-1" balanceDue={150} />);
    fireEvent.change(screen.getByLabelText("Remarks (optional)"), { target: { value: "Important receipt note" } });
    fireEvent.change(screen.getByLabelText("Payment amount (₹)"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm ₹0 received / carry forward" }));
    expect(confirmInvoiceCarryForwardAction).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Clear the receipt remarks"));
    expect(screen.getByLabelText("Remarks (optional)")).toHaveValue("Important receipt note");
  });
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
