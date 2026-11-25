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

  it("accepts Baby as a standalone patient name, with or without the Baby title", async () => {
    const form = input(); form.set("name", " bABY "); form.set("title", "Baby"); form.set("gender", "");
    expect(await createLeadAction(form)).toMatchObject({ ok: true });
    expect(createLead).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: "Baby", title: "Baby", gender: null }));
    form.delete("branch_id"); form.set("title", "");
    expect(await updateLeadAction(leadId, form)).toMatchObject({ ok: true });
    expect(updateLeadDetails).toHaveBeenCalledWith(expect.anything(), leadId, expect.objectContaining({ name: "Baby", title: null }));
  });

  it.each(["0", "0.2", "2.5", "4.3", "4.99", "5", "5.1", "25.5", "119.99", "120"])("preserves age %s on creation and edit", async (age) => {
    const form = input(); form.set("age", age);
    expect(await createLeadAction(form)).toMatchObject({ ok: true });
    expect(createLead).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ age: Number(age) }));
    form.delete("branch_id");
    expect(await updateLeadAction(leadId, form)).toMatchObject({ ok: true });
    expect(updateLeadDetails).toHaveBeenCalledWith(expect.anything(), leadId, expect.objectContaining({ age: Number(age) }));
  });

  it.each(["-0.2", "120.1", "121", "NaN", "Infinity", "not an age"])("rejects invalid age %s without writing", async (age) => {
    const form = input(); form.set("age", age);
    expect(await createLeadAction(form)).toMatchObject({ ok: false });
    form.delete("branch_id");
    expect(await updateLeadAction(leadId, form)).toMatchObject({ ok: false });
    expect(createLead).not.toHaveBeenCalled();
    expect(updateLeadDetails).not.toHaveBeenCalled();
  });

  it.each(["", "   "])("keeps a blank age as null, not zero: %j", async (age) => {
    const form = input(); form.set("age", age);
    expect(await createLeadAction(form)).toMatchObject({ ok: true });
    expect(createLead).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ age: null }));
    form.delete("branch_id");
    expect(await updateLeadAction(leadId, form)).toMatchObject({ ok: true });
    expect(updateLeadDetails).toHaveBeenCalledWith(expect.anything(), leadId, expect.objectContaining({ age: null }));
  });

  it("does not overwrite an existing age when an edit omits the field", async () => {
    const form = new FormData(); form.set("name", "Test Patient");
    expect(await updateLeadAction(leadId, form)).toMatchObject({ ok: true });
    expect(updateLeadDetails).toHaveBeenCalledWith(expect.anything(), leadId, { name: "Test Patient" });
  });
  it("edits an imported record without overwriting the blank mobile field", async () => {
    const form = new FormData(); form.set("name", "Test Patient"); form.set("mobile", " ");
    expect(await updateLeadAction(leadId, form)).toMatchObject({ ok: true });
    expect(updateLeadDetails).toHaveBeenCalledWith(expect.anything(), leadId, { name: "Test Patient" });
    form.set("mobile", "9000000024");
    expect(await updateLeadAction(leadId, form)).toMatchObject({ ok: true });
    expect(updateLeadDetails).toHaveBeenLastCalledWith(expect.anything(), leadId, { name: "Test Patient", mobile: "9000000024" });
  });

  it("keeps the mobile requirement for regular patient intake", async () => {
    const form = input(); form.set("mobile", "");
    expect(await createLeadAction(form)).toMatchObject({ ok: false });
    expect(createLead).not.toHaveBeenCalled();
  });
});
