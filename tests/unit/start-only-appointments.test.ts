import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/auth/context";
vi.mock("server-only", () => ({}));
const mocks=vi.hoisted(() => ({ from:vi.fn(),recordLeadActivity:vi.fn(),requireActiveDoctorForBranch:vi.fn() }));
vi.mock("@/data/db", () => ({ db:{ from:mocks.from } }));
vi.mock("@/data/helpers", () => ({ recordLeadActivity:mocks.recordLeadActivity,requireActiveDoctorForBranch:mocks.requireActiveDoctorForBranch,throwMappedDatabaseError:vi.fn() }));
import { updateAppointment, createAdditionalAppointment } from "@/data/appointments";
const userId="c2600000-0000-4000-8000-000000000001";
const branchId="c2600000-0000-4000-8000-000000000002";
const leadId="c2600000-0000-4000-8000-000000000003";
const appointmentId="c2600000-0000-4000-8000-000000000004";
const ctx={ userId,role:"front_office",branchIds:[branchId] } as unknown as AuthContext;
function query(data:unknown) {
  const chain={ select:vi.fn(),eq:vi.fn(),is:vi.fn(),update:vi.fn(),insert:vi.fn(),
    maybeSingle:vi.fn().mockResolvedValue({ data,error:null }),single:vi.fn().mockResolvedValue({ data,error:null }) };
  for(const method of ["select","eq","is","update","insert"] as const) chain[method].mockReturnValue(chain);
  return chain;
}
beforeEach(() => vi.clearAllMocks());
describe("start-only appointment persistence", () => {
  it("reschedules by start time without resetting a historical duration", async () => {
    const saved=query({ branch_id:branchId,status:"scheduled",lead_id:leadId,lead:{ assignee_id:userId },duration_minutes:60 });
    const updated=query({ id:appointmentId });
    mocks.from.mockReturnValueOnce(saved).mockReturnValueOnce(updated);
    await updateAppointment(ctx,appointmentId,{ scheduled_at:"2026-10-15T04:00:00Z",notes:"Changed start time" },leadId);
    expect(updated.update).toHaveBeenCalledWith({ scheduled_at:"2026-10-15T04:00:00.000Z",notes:"Changed start time" });
    expect(updated.update.mock.calls[0]![0]).not.toHaveProperty("duration_minutes");
  });
  it("creates another appointment without supplying a duration or end time", async () => {
    const lead=query({ id:leadId,branch_id:branchId,assignee_id:userId,status:"appointment_booked" });
    const created=query({ id:appointmentId,scheduled_at:"2026-10-15T04:00:00Z" });
    mocks.from.mockReturnValueOnce(lead).mockReturnValueOnce(created);
    await createAdditionalAppointment(ctx,leadId,{ scheduled_at:"2026-10-15T04:00:00Z",notes:"Next visit" });
    expect(created.insert).toHaveBeenCalledWith({ lead_id:leadId,doctor_id:null,scheduled_at:"2026-10-15T04:00:00.000Z",notes:"Next visit",created_by:userId });
    expect(created.insert.mock.calls[0]![0]).not.toHaveProperty("duration_minutes");
  });
});
