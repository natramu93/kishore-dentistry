import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppointmentReschedule } from "@/components/leads/appointment-reschedule";
import { rescheduleAppointmentAction } from "@/actions/appointments";
vi.mock("@/actions/appointments", () => ({ rescheduleAppointmentAction: vi.fn() }));
vi.mock("sonner", () => ({ toast:{ success:vi.fn(),error:vi.fn() } }));
afterEach(() => { cleanup();vi.restoreAllMocks(); });
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(window,"open").mockReturnValue(null); vi.mocked(rescheduleAppointmentAction).mockResolvedValue({ ok:true }); });

const props={ appointmentId:"visit-1",leadId:"patient-1",doctors:[],defaultScheduledAt:"2017-01-01T19:30",defaultDoctorId:null,defaultDuration:15,defaultNotes:null };
describe("12-hour appointment rescheduling", () => {
  it("loads a stored evening appointment and keeps the original time if it is not changed", async () => {
    render(<AppointmentReschedule {...props} />);
    fireEvent.click(screen.getByRole("button",{ name:"Reschedule / reassign" }));
    expect(screen.getByLabelText("Hour")).toHaveValue("7");
    expect(screen.getByLabelText("Minute")).toHaveValue("30");
    expect(screen.getByLabelText("AM / PM")).toHaveValue("PM");
    fireEvent.click(screen.getByRole("button",{ name:"Save changes & open WhatsApp" }));
    await waitFor(() => expect(rescheduleAppointmentAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(rescheduleAppointmentAction).mock.calls[0]![2].get("scheduled_at")).toBe(props.defaultScheduledAt);
  });
  it("converts an explicit AM selection without changing the chosen appointment date", async () => {
    render(<AppointmentReschedule {...props} />);
    fireEvent.click(screen.getByRole("button",{ name:"Reschedule / reassign" }));
    fireEvent.change(screen.getByLabelText("Hour"),{ target:{ value:"9" } });
    fireEvent.change(screen.getByLabelText("Minute"),{ target:{ value:"45" } });
    fireEvent.change(screen.getByLabelText("AM / PM"),{ target:{ value:"AM" } });
    fireEvent.click(screen.getByRole("button",{ name:"Save changes & open WhatsApp" }));
    await waitFor(() => expect(rescheduleAppointmentAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(rescheduleAppointmentAction).mock.calls[0]![2].get("scheduled_at")).toBe("2017-01-01T09:45");
  });
});
