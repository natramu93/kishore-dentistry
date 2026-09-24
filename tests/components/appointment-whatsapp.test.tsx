import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { transitionLeadAction } from "@/actions/leads";
import { rescheduleAppointmentAction } from "@/actions/appointments";
import { TransitionActions } from "@/components/leads/transition-actions";
import { AppointmentReschedule } from "@/components/leads/appointment-reschedule";

vi.mock("@/actions/leads", () => ({ transitionLeadAction: vi.fn() }));
vi.mock("@/actions/appointments", () => ({ rescheduleAppointmentAction: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockWhatsAppTab() {
  const tab = {
    opener: window,
    location: { href: "about:blank" },
    close: vi.fn(),
  } as unknown as Window;
  vi.spyOn(window, "open").mockReturnValue(tab);
  return tab;
}

describe("appointment WhatsApp handoff", () => {
  it("opens the prepared WhatsApp message after a new appointment is saved", async () => {
    const whatsappUrl = "https://wa.me/919361135459?text=appointment";
    const tab = mockWhatsAppTab();
    vi.mocked(transitionLeadAction).mockResolvedValueOnce({ ok: true, whatsappUrl });

    render(
      <TransitionActions
        lead={{ id: "22222222-2222-4222-8222-222222222222", status: "assigned" }}
        activeAppointmentId={null}
        assignableUsers={[]}
        doctors={[]}
        role="admin"
        userId="11111111-1111-4111-8111-111111111111"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Book appointment" }));
    fireEvent.change(screen.getByLabelText("Date & time (IST)"), {
      target: { value: "2026-09-24T15:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create appointment & open WhatsApp" }));

    await waitFor(() => expect(tab.location.href).toBe(whatsappUrl));
    expect(window.open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(transitionLeadAction).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      "appointment_booked",
      expect.any(FormData)
    );
  });

  it("opens the prepared WhatsApp message after a reschedule is saved", async () => {
    const whatsappUrl = "https://wa.me/919361135459?text=rescheduled";
    const tab = mockWhatsAppTab();
    vi.mocked(rescheduleAppointmentAction).mockResolvedValueOnce({ ok: true, whatsappUrl });

    render(
      <AppointmentReschedule
        appointmentId="33333333-3333-4333-8333-333333333333"
        leadId="22222222-2222-4222-8222-222222222222"
        doctors={[]}
        defaultScheduledAt="2026-09-24T15:30"
        defaultDoctorId={null}
        defaultDuration={15}
        defaultNotes={null}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Reschedule / reassign" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes & open WhatsApp" }));

    await waitFor(() => expect(tab.location.href).toBe(whatsappUrl));
    expect(rescheduleAppointmentAction).toHaveBeenCalledWith(
      "33333333-3333-4333-8333-333333333333",
      "22222222-2222-4222-8222-222222222222",
      expect.any(FormData)
    );
  });
});
