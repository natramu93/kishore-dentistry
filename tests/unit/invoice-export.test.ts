import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "@/app/(app)/invoices/export/route";
import { listInvoices } from "@/data/invoices";
import { AuthorizationError } from "@/lib/errors";

vi.mock("@/lib/auth/context", () => ({ getAuthContext: vi.fn().mockResolvedValue({ userId: "staff" }) }));
vi.mock("@/data/invoices", () => ({ listInvoices: vi.fn() }));
vi.mock("@/data/leads", () => ({ getLead: vi.fn().mockResolvedValue({ id: "patient" }) }));
vi.mock("@/lib/rate-limit", () => ({ assertActionRateLimit: vi.fn() }));

const request = (query: string) => new Request(`https://example.test/invoices/export?${query}`);
const list = vi.mocked(listInvoices);
beforeEach(() => list.mockReset());

it("exports every page with the same filters and escapes spreadsheet labels", async () => {
  const first = { id: "one", invoice_number: "INV-1", billing_date: "2026-11-14",
    lead: { name: '=TEST("name")' }, status: "sent", subtotal: 200, tax_amount: 0,
    total: 200, amount_paid: 0, balance_due: 200, received_in_range: 0 };
  list.mockResolvedValueOnce({ invoices: [first], total: 101, page: 1, pageSize: 100 } as Awaited<ReturnType<typeof listInvoices>>)
    .mockResolvedValueOnce({ invoices: [{ ...first, id: "two", invoice_number: "INV-2" }], total: 101, page: 2, pageSize: 100 } as Awaited<ReturnType<typeof listInvoices>>);
  const response = await GET(request("dates=range&from=2026-11-01&to=2026-11-14&status=sent&balance=due&branch=center&lead=patient&method=upi&q=Test+Patient&page=9"));
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Disposition")).toMatch(/attachment;.*\.csv/);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  for (const page of [1, 2]) {
    expect(list).toHaveBeenNthCalledWith(page, { userId: "staff" }, {
      fromDate: "2026-11-01", toDate: "2026-11-14", branchId: "center", leadId: "patient",
      status: "sent", dueOnly: true, paymentMethod: "upi", search: "Test Patient", page, pageSize: 100,
      sort: "created", descending: true,
    });
  }
  const csv = await response.text();
  expect(csv).toContain('"INV-1"');
  expect(csv).toContain('"INV-2"');
  expect(csv).toContain(`"'=TEST(""name"")"`);
});

it("returns no CSV when the invoice query denies access", async () => {
  list.mockRejectedValueOnce(new AuthorizationError());
  expect((await GET(request("dates=all"))).status).toBe(403);
});

it("exports voided invoices as zero for charges, payments and balance", async () => {
  const voided = { id: "voided", invoice_number: "VOID-1", billing_date: "2026-11-14",
    status: "cancelled", subtotal: 210, discount_amount: 10, tax_amount: 5,
    total: 205, amount_paid: 205, balance_due: 0 };
  list.mockResolvedValueOnce({ invoices: [voided], total: 1, page: 1, pageSize: 100 } as Awaited<ReturnType<typeof listInvoices>>);
  const response = await GET(request("dates=all&status=cancelled"));
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('"VOID-1","2026-11-14","","","Voided","0","0","0","0","0","0"');
});

it("rejects invalid dates before querying", async () => {
  expect((await GET(request("dates=range&from=invalid"))).status).toBe(400);
  expect(list).not.toHaveBeenCalled();
});

it("asks for narrower filters instead of silently truncating a large export", async () => {
  list.mockResolvedValueOnce({ invoices: [], total: 10_001, page: 1, pageSize: 100, collections: { upi: 0, cash: 0, card: 0, neft: 0, amount: 0 } });
  expect((await GET(request("dates=all"))).status).toBe(400);
  expect(list).toHaveBeenCalledTimes(1);
});
