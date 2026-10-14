import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/auth/context";
vi.mock("server-only", () => ({}));
const mocks=vi.hoisted(() => ({ from:vi.fn() }));
vi.mock("@/data/db", () => ({ db:mocks }));
import { appointmentWhatsAppUrl } from "@/data/appointments";
const userId="c2500000-0000-4000-8000-000000000001";
const branchId="c2500000-0000-4000-8000-000000000002";
const leadId="c2500000-0000-4000-8000-000000000003";
const ctx={ userId,role:"front_office",branchIds:[branchId] } as unknown as AuthContext;
function query(data:unknown) {
  const chain={ select:vi.fn(),eq:vi.fn(),is:vi.fn(),maybeSingle:vi.fn().mockResolvedValue({ data,error:null }) };
  chain.select.mockReturnValue(chain);chain.eq.mockReturnValue(chain);chain.is.mockReturnValue(chain);
  return chain;
}
beforeEach(() => vi.clearAllMocks());
describe("saved patient title reaches prepared appointment messages", () => {
  it("loads the saved title and uses it in the greeting without changing recipient or schedule", async () => {
    const lead=query({ id:leadId,branch_id:branchId,assignee_id:userId,name:"TEST PATIENT",title:"Mrs",mobile:"9000000000" });
    mocks.from.mockReturnValueOnce(lead).mockReturnValueOnce(query({ name:"Test Center",address:null,phone:null,company_name:null,appointment_whatsapp_enabled:true }));
    const result=await appointmentWhatsAppUrl(ctx,leadId,"2026-10-14T10:00:00Z");
    expect(lead.select).toHaveBeenCalledWith(expect.stringContaining("name, title, mobile"));
    const url=new URL(result!);
    expect(url.pathname).toBe("/919000000000");
    expect(url.searchParams.get("text")).toContain("Hello Mrs. Test Patient,");
    expect(url.searchParams.get("text")).toContain("3:30 PM (IST)");
  });
  it("keeps the branch-level WhatsApp opt-out", async () => {
    mocks.from.mockReturnValueOnce(query({ id:leadId,branch_id:branchId,assignee_id:userId,name:"Test",title:"Mr",mobile:"9000000000" }))
      .mockReturnValueOnce(query({ name:"Center",appointment_whatsapp_enabled:false }));
    expect(await appointmentWhatsAppUrl(ctx,leadId,"2026-10-14T10:00:00Z")).toBeUndefined();
  });
  it("retains patient access restrictions before reading branch/message details", async () => {
    mocks.from.mockReturnValueOnce(query({ id:leadId,branch_id:branchId,assignee_id:"another-user",name:"Test",title:"Mr",mobile:"9000000000" }));
    await expect(appointmentWhatsAppUrl(ctx,leadId,"2026-10-14T10:00:00Z")).rejects.toThrow();
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });
});
