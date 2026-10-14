import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import LeadsPage from "@/app/(app)/leads/page";
vi.mock("@/lib/auth/context", () => ({ getAuthContext:vi.fn().mockResolvedValue({ role:"admin",userId:"test-admin" }) }));
vi.mock("@/data/branches", () => ({ listMyBranches:vi.fn().mockResolvedValue([]) }));
vi.mock("@/data/catalogs", () => ({ listLeadSources:vi.fn().mockResolvedValue([]) }));
vi.mock("@/data/leads", () => ({ listLeads:vi.fn().mockResolvedValue({ total:7,page:1,pageSize:25,leads:[
  ...["Mr","Ms","Mrs","Baby","Master",null].map((title,index) => ({ id:`lead-${index}`,name:`Test Patient ${index}`,title,mobile:"9000000000",status:"open",branch:null,source:null,assignee:null,interest:null,created_at:"2026-10-14T00:00:00Z" })),
  { id:"legacy",name:"Mrs.TEST PATIENT",title:"Mrs",mobile:"9000000000",status:"open",branch:null,source:null,assignee:null,interest:null,created_at:"2026-10-14T00:00:00Z" },
] }) }));
afterEach(cleanup);
describe("CRM leads titles", () => {
  it("shows stored titles on lead names without duplicates or invented titles", async () => {
    render(await LeadsPage({ searchParams:Promise.resolve({}) }));
    for (const [index,label] of ["Mr.","Ms.","Mrs.","Baby","Master"].entries()) {
      expect(screen.getByRole("link",{ name:`${label} Test Patient ${index}` })).toHaveAttribute("href",`/leads/lead-${index}`);
    }
    expect(screen.getByRole("link",{ name:"Test Patient 5" })).toHaveAttribute("href","/leads/lead-5");
    expect(screen.getByRole("link",{ name:"Mrs. Test Patient" })).toHaveAttribute("href","/leads/legacy");
  });
});
