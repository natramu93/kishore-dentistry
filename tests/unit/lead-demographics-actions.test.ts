import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ getAuthContext: vi.fn().mockResolvedValue({ userId: "staff-1" }) }));
vi.mock("@/lib/rate-limit", () => ({ assertActionRateLimit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/data/leads", () => ({ createLead: vi.fn(), updateLeadDetails: vi.fn() }));
vi.mock("@/data/appointments", () => ({}));
vi.mock("@/data/comments", () => ({}));
import { createLeadAction, updateLeadAction } from "@/actions/leads";
import { createLead, updateLeadDetails } from "@/data/leads";
const leadId="c2400000-0000-4000-8000-000000000011";
beforeEach(() => { vi.clearAllMocks(); vi.mocked(createLead).mockResolvedValue({ id: leadId } as Awaited<ReturnType<typeof createLead>>); });
const input = () => {
  const form = new FormData();
  for (const [key,value] of Object.entries({ branch_id:"c2400000-0000-4000-8000-000000000012",name:"rAVI KUMAR",title:"Mr",gender:"male",mobile:"9000000024" })) form.set(key,value);
  return form;
};
describe("validated patient identity actions", () => {
  it("stores normalized name, title and gender on intake", async () => {
    expect(await createLeadAction(input())).toMatchObject({ ok:true });
    expect(createLead).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({ name:"Ravi Kumar",title:"Mr",gender:"male" }));
  });
  it("allows a manually corrected gender on edit", async () => {
    const form=input(); form.set("gender","other"); form.delete("branch_id");
    expect(await updateLeadAction(leadId,form)).toMatchObject({ ok:true });
    expect(updateLeadDetails).toHaveBeenCalledWith(expect.anything(),leadId,expect.objectContaining({ name:"Ravi Kumar",gender:"other" }));
  });
  it.each(["title","gender"])("rejects invalid %s before writing", async (field) => {
    const form=input(); form.set(field,"Invalid");
    expect(await createLeadAction(form)).toMatchObject({ ok:false });
    expect(createLead).not.toHaveBeenCalled();
  });
});
