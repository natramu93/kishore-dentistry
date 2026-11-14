import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import InvoicesPage from "@/app/(app)/invoices/page";
import { listInvoices } from "@/data/invoices";

vi.mock("@/lib/auth/context", () => ({ getAuthContext: vi.fn().mockResolvedValue({ role: "admin" }) }));
vi.mock("@/data/branches", () => ({ listMyBranches: vi.fn().mockResolvedValue([]) }));
vi.mock("@/data/leads", () => ({ getLead: vi.fn() }));
vi.mock("@/data/invoices", () => ({
  listInvoices: vi.fn().mockResolvedValue({ invoices: [], total: 30, page: 1, pageSize: 25 }),
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
