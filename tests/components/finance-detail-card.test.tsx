import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FinanceDetailCard } from "@/components/invoices/finance-detail-card";
import { financeDetailsAction } from "@/actions/finance-details";
vi.mock("@/actions/finance-details", () => ({ financeDetailsAction: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const filters = { from: "2026-11-19", to: "2026-11-19" };
const row = { id: "r", invoice_id: "i", patient_id: "p", invoice_number: "OLD-1", patient_name: "Example Patient",
  center: "Tirupur", date: "2026-11-19", invoice_date: "2026-10-01", description: "Payment receipt", method: "upi", reference: "UPI-REF", amount: 50 };
it("opens an accessible drilldown with old invoice and current receipt dates and full-result pagination", async () => {
  vi.mocked(financeDetailsAction).mockResolvedValue({ ok: true, details: { rows: [row], total: 101, amount: 50 } });
  render(<FinanceDetailCard label="UPI" amount={50} filters={filters} source="reports" />);
  expect(financeDetailsAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /UPI/ }));
  expect(await screen.findByRole("dialog", { name: /UPI — line items/ })).toBeInTheDocument();
  expect(await screen.findByText("UPI-REF")).toBeInTheDocument();
  expect(screen.getByText("1 Oct 2026")).toBeInTheDocument();
  expect(screen.getByText("19 Nov 2026")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "OLD-1" })).toHaveAttribute("href", "/invoices/i");
  await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(financeDetailsAction).toHaveBeenLastCalledWith({ filters, source: "reports", metric: "receipts", page: 2 }));
});
it("shows failures without pretending the total is zero and permits retry", async () => {
  vi.mocked(financeDetailsAction).mockResolvedValueOnce({ ok: false, error: "Not authorized" })
    .mockResolvedValueOnce({ ok: true, details: { rows: [], total: 0, amount: 0 } });
  render(<FinanceDetailCard label="Cash" amount={20} filters={filters} source="invoices" />);
  fireEvent.click(screen.getByRole("button", { name: /Cash/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Not authorized");
  await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("No line items match these filters.")).toBeInTheDocument();
  expect(screen.getByText(/records have changed/)).toBeInTheDocument();
});
