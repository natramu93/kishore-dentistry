import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ getAuthContext: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("redirect"); }) }));
import { getAuthContext } from "@/lib/auth/context";
import { redirect } from "next/navigation";
import InvoicePrintPage from "@/app/(print)/invoices/[id]/print/page";

beforeEach(() => vi.clearAllMocks());
describe("invoice print route", () => {
  it("uses the authenticated inline A4 PDF instead of a different browser pagination layout", async () => {
    const id = "4e7f8ca5-dced-4944-af53-c65ca5cd8b9d";
    await expect(InvoicePrintPage({ params: Promise.resolve({ id }) })).rejects.toThrow("redirect");
    expect(getAuthContext).toHaveBeenCalledOnce();
    expect(redirect).toHaveBeenCalledWith(`/api/invoices/${id}/pdf?inline=1`);
  });
  it("does not bypass authentication", async () => {
    vi.mocked(getAuthContext).mockRejectedValueOnce(new Error("Sign in required"));
    await expect(InvoicePrintPage({ params: Promise.resolve({ id: "invoice" }) })).rejects.toThrow("Sign in required");
    expect(redirect).not.toHaveBeenCalled();
  });
});
