import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InvoiceActions } from "@/app/(app)/invoices/[id]/status-buttons";
import { cancelInvoiceAction } from "@/actions/invoices";
vi.mock("@/actions/invoices", () => ({ cancelInvoiceAction: vi.fn().mockResolvedValue({ ok: true }), updateInvoiceStatusAction: vi.fn(), deleteInvoiceAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const defaults = { invoiceId: "invoice-1", status: "sent" as const, role: "admin" as const, version: 2, codeEnforced: true, consultation: false, hasPrimaryTreatment: false };
describe("invoice actions", () => {
  it("offers editing and admin voiding for unpaid treatment invoices", () => {
    render(<InvoiceActions {...defaults} />);
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/invoices/invoice-1/edit");
    expect(screen.getByRole("button", { name: "Void invoice" })).toBeEnabled();
  });
  it("allows editing an unpaid consultation", () => {
    render(<InvoiceActions {...defaults} codeEnforced={false} consultation />);
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/invoices/invoice-1/edit");
  });
  it("offers editing and admin voiding for partially paid invoices", () => {
    render(<InvoiceActions {...defaults} hasPayments />);
    expect(screen.getByRole("link", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Void invoice" })).toBeEnabled();
  });
  it("requires a void reason and sends the current invoice version", async () => {
    render(<InvoiceActions {...defaults} />);
    fireEvent.click(screen.getByRole("button", { name: "Void invoice" }));
    expect(screen.getByRole("button", { name: "Confirm void" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for voiding"), { target: { value: "Wrong bill" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm void" }));
    await waitFor(() => expect(cancelInvoiceAction).toHaveBeenCalledWith("invoice-1", "Wrong bill", 2, false));
  });
  it("can void and archive a paid invoice without promising a refund", async () => {
    render(<InvoiceActions {...defaults} status="paid" hasPayments />);
    expect(screen.getByRole("link", { name: "Edit" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Void invoice" }));
    expect(screen.getByText(/does not refund the patient/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Void & archive" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for voiding"), { target: { value: "Duplicate paid bill" } });
    fireEvent.click(screen.getByRole("button", { name: "Void & archive" }));
    await waitFor(() => expect(cancelInvoiceAction).toHaveBeenCalledWith("invoice-1", "Duplicate paid bill", 2, true));
  });
  it("allows an admin to archive an already voided invoice", async () => {
    render(<InvoiceActions {...defaults} status="cancelled" hasPayments />);
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.change(screen.getByLabelText("Reason for archiving"), { target: { value: "Remove from active list" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm archive" }));
    await waitFor(() => expect(cancelInvoiceAction).toHaveBeenCalledWith("invoice-1", "Remove from active list", 2, true));
  });
  it.each(["front_office", "operations", "clinical_head"] as const)("does not allow %s to void or archive paid bills", (role) => {
    render(<InvoiceActions {...defaults} role={role} status="paid" hasPayments />);
    expect(screen.queryByRole("button", { name: "Void invoice" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });
});
