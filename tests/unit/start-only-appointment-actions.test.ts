import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath:vi.fn() }));
vi.mock("next/navigation", () => ({ redirect:vi.fn() }));
vi.mock("@/lib/auth/context", () => ({ getAuthContext:vi.fn().mockResolvedValue({ userId:"staff-1",role:"operations" }) }));
vi.mock("@/lib/rate-limit", () => ({ assertActionRateLimit:vi.fn() }));
vi.mock("@/data/leads", () => ({ getLead:vi.fn(),transitionLead:vi.fn() }));
vi.mock("@/data/appointments", () => ({ updateAppointment:vi.fn(),createAdditionalAppointment:vi.fn(),appointmentWhatsAppUrl:vi.fn() }));
vi.mock("@/data/comments", () => ({}));
import * as appointments from "@/data/appointments";
import * as leads from "@/data/leads";
import { rescheduleAppointmentAction } from "@/actions/appointments";
import { transitionLeadAction } from "@/actions/leads";
const leadId="c2600000-0000-4000-8000-000000000003";
const appointmentId="c2600000-0000-4000-8000-000000000004";
function input() {
  const form=new FormData();form.set("scheduled_at","2026-10-15T09:30");return form;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(appointments.updateAppointment).mockResolvedValue({ lead_id:leadId });
  vi.mocked(appointments.appointmentWhatsAppUrl).mockResolvedValue("https://wa.me/?text=test");
});
describe("start-only booking and rescheduling actions", () => {
  it("reschedules with no duration field while retaining the WhatsApp handoff", async () => {
    const form=input();form.set("duration_minutes","invalid stale value");
    expect(await rescheduleAppointmentAction(appointmentId,leadId,form)).toEqual({ ok:true,whatsappUrl:"https://wa.me/?text=test" });
    expect(appointments.updateAppointment).toHaveBeenCalledWith(expect.anything(),appointmentId,{ scheduled_at:"2026-10-15T04:00:00.000Z",doctor_id:null,notes:null },leadId);
  });
  it.each(["assigned","appointment_booked"] as const)("books from %s with a start time only", async (status) => {
    vi.mocked(leads.getLead).mockResolvedValue({ id:leadId,status } as Awaited<ReturnType<typeof leads.getLead>>);
    const form=input();form.set("duration_minutes","0");
    expect(await transitionLeadAction(leadId,"appointment_booked",form)).toMatchObject({ ok:true });
    if(status==="assigned") {
      expect(leads.transitionLead).toHaveBeenCalledWith(expect.anything(),leadId,"appointment_booked",{ scheduled_at:"2026-10-15T04:00:00.000Z" });
    } else {
      expect(appointments.createAdditionalAppointment).toHaveBeenCalledWith(expect.anything(),leadId,{ scheduled_at:"2026-10-15T04:00:00.000Z",doctor_id:null,notes:null });
    }
  });
});
