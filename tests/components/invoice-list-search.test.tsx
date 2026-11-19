import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import InvoicesPage from "@/app/(app)/invoices/page";
import { listInvoices } from "@/data/invoices";
import { financeDetailsAction } from "@/actions/finance-details";

vi.mock("@/lib/auth/context", () => ({ getAuthContext: vi.fn().mockResolvedValue({ role: "admin" }) }));
vi.mock("@/data/branches", () => ({ listMyBranches: vi.fn().mockResolvedValue([]) }));
vi.mock("@/data/leads", () => ({ getLead: vi.fn() }));
vi.mock("@/actions/finance-details", () => ({ financeDetailsAction: vi.fn() }));
vi.mock("@/data/invoices", () => ({
  listInvoices: vi.fn().mockResolvedValue({ invoices: [], total: 30, page: 1, pageSize: 25,
    collections: { amount: 0, upi: 0, cash: 0, card: 0, neft: 0 } }),
}));
afterEach(cleanup);

it("keeps the invoice patient search in the form, results, next page, and CSV", async () => {
  const q = "Test Patient";
  render(await InvoicesPage({ searchParams: Promise.resolve({ q, dates: "all", balance: "due" }) }));
  expect(screen.getByRole("searchbox", { name: "Patient name or mobile number" })).toHaveValue(q);
  expect(listInvoices).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ search: q, dueOnly: true }));
  const csv = screen.getByRole("link", { name: /download filtered invoices/i });
  const next = screen.getByRole("link", { name: /next/i });
  for (const link of [csv, next]) {
    const query = new URL(link.getAttribute("href")!, "https://example.test").searchParams;
    expect(query.get("q")).toBe(q);
    expect(query.get("dates")).toBe("all");
    expect(query.get("balance")).toBe("due");
  }
});

it("preserves the date range and other filters while sorting all matching invoices and shows receipt-mode cards", async () => {
  const params = { dates: "range", from: "2026-11-18", to: "2026-11-19", q: "Patient", sort: "total", order: "asc", page: "2" };
  render(await InvoicesPage({ searchParams: Promise.resolve(params) }));
  expect(screen.getByRole("columnheader", { name: /Sort all matching invoices by Total/ })).toHaveAttribute("aria-sort", "ascending");
  const link = screen.getByRole("link", { name: "Sort all matching invoices by Total" });
  const query = new URL(link.getAttribute("href")!, "https://example.test").searchParams;
  expect(Object.fromEntries(query)).toMatchObject({ from: params.from, to: params.to, sort: "total", order: "desc", q: "Patient" });
  expect(query.has("page")).toBe(false);
  expect(screen.getByText(/Showing invoices dated in the range or with payments received in it/)).toBeInTheDocument();
  vi.mocked(financeDetailsAction).mockResolvedValueOnce({ ok: true, details: { rows: [], total: 0, amount: 0 } });
  fireEvent.click(screen.getByRole("button", { name: /^UPI / }));
  await waitFor(() => expect(financeDetailsAction).toHaveBeenCalledWith(expect.objectContaining({
    source: "invoices", metric: "receipts", page: 1, filters: expect.objectContaining({ from: params.from, to: params.to, method: "upi", search: "Patient" }),
  })));
});
