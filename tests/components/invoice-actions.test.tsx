import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InvoiceActions } from "@/app/(app)/invoices/[id]/status-buttons";
import { cancelInvoiceAction } from "@/actions/invoices";
vi.mock("@/actions/invoices", () => ({ cancelInvoiceAction: vi.fn().mockResolvedValue({ ok: true }), updateInvoiceStatusAction: vi.fn(), deleteInvoiceAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const defaults = { invoiceId: "invoice-1", status: "sent" as const, role: "admin" as const, version: 2, codeEnforced: true, consultation: false, hasPrimaryTreatment: false, editWindowOpen: true };
describe("invoice actions", () => {
  it("hides edit after 24 hours but keeps unpaid admin void available", () => {
    render(<InvoiceActions {...defaults} editWindowOpen={false} />);
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Void invoice" })).toBeEnabled();
  });
  it("allows editing an unpaid consultation within 24 hours", () => {
    render(<InvoiceActions {...defaults} codeEnforced={false} consultation />);
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/invoices/invoice-1/edit");
  });
  it("keeps paid and partially paid invoices locked", () => {
    render(<InvoiceActions {...defaults} hasPayments />);
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Void invoice" })).not.toBeInTheDocument();
  });
  it("requires a void reason and sends the current invoice version", async () => {
    render(<InvoiceActions {...defaults} />);
    fireEvent.click(screen.getByRole("button", { name: "Void invoice" }));
    expect(screen.getByRole("button", { name: "Confirm void" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for voiding"), { target: { value: "Wrong bill" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm void" }));
    await waitFor(() => expect(cancelInvoiceAction).toHaveBeenCalledWith("invoice-1", "Wrong bill", 2));
  });
  it("preserves admin-only void permissions", () => {
    render(<InvoiceActions {...defaults} role="front_office" />);
    expect(screen.queryByRole("button", { name: "Void invoice" })).not.toBeInTheDocument();
  });
});
