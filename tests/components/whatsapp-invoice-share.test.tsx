import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WhatsAppInvoiceShare } from "@/components/invoices/whatsapp-invoice-share";
import { toast } from "sonner";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("WhatsApp invoice sharing", () => {
  it("downloads the bill and opens WhatsApp when browser file-sharing capability checks throw", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.stubGlobal("navigator", { share: vi.fn(), canShare: vi.fn(() => { throw new Error("Unsupported probe"); }) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Blob(["synthetic PDF"], { type: "application/pdf" }), { headers: { "content-type": "application/pdf" } })));
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn().mockReturnValue("blob:synthetic"), revokeObjectURL: vi.fn() }));
    render(<WhatsAppInvoiceShare invoiceId="invoice-id" invoiceNumber="SYN-001" patientName="Synthetic Patient" patientMobile="9000000000" />);
    fireEvent.click(screen.getByRole("button", { name: "Send on WhatsApp" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Invoice PDF downloaded")));
    expect(open).toHaveBeenCalledWith(expect.stringContaining("https://web.whatsapp.com/send?phone=919000000000"), "_blank", "noopener,noreferrer");
    expect(fetch).toHaveBeenCalledWith("/api/invoices/invoice-id/pdf", expect.objectContaining({ cache: "no-store", credentials: "same-origin" }));
  });
});
