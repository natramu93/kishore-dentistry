import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TransitionActions } from "@/components/leads/transition-actions";
import { transitionLeadAction } from "@/actions/leads";

vi.mock("@/actions/leads", () => ({
  transitionLeadAction: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const baseProps = {
  activeAppointmentId: null,
  assignableUsers: [],
  doctors: [],
  role: "admin" as const,
  userId: "11111111-1111-4111-8111-111111111111",
};

describe("lead transition actions", () => {
  it("books with an explicit AM/PM clock while submitting the original clinic wall time", async () => {
    vi.mocked(transitionLeadAction).mockResolvedValueOnce({ ok:true });
    vi.spyOn(window,"open").mockReturnValueOnce(null);
    render(<TransitionActions {...baseProps} lead={{ id:"22222222-2222-4222-8222-222222222222",status:"assigned" }} />);
    fireEvent.click(screen.getByRole("button",{ name:"Book appointment" }));
    expect(screen.queryByLabelText(/duration/i)).toBeNull();
    fireEvent.change(screen.getByLabelText("Date"),{ target:{ value:"2026-10-13" } });
    fireEvent.change(screen.getByLabelText("Hour"),{ target:{ value:"7" } });
    fireEvent.change(screen.getByLabelText("Minute"),{ target:{ value:"30" } });
    fireEvent.change(screen.getByLabelText("AM / PM"),{ target:{ value:"PM" } });
    fireEvent.click(screen.getByRole("button",{ name:"Create appointment & open WhatsApp" }));
    await waitFor(() => expect(transitionLeadAction).toHaveBeenCalledTimes(1));
    const args=vi.mocked(transitionLeadAction).mock.calls[0]!;
    expect(args[1]).toBe("appointment_booked");
    expect(args[2].get("scheduled_at")).toBe("2026-10-13T19:30");
    expect(args[2].has("duration_minutes")).toBe(false);
  });
  it("uses Book Next Appointment after a visit without changing the follow-up scheduling payload", async () => {
    vi.mocked(transitionLeadAction).mockResolvedValueOnce({ ok:true });
    render(<TransitionActions {...baseProps} lead={{ id:"22222222-2222-4222-8222-222222222222",status:"visited_treated" }} />);
    fireEvent.click(screen.getByRole("button",{ name:"Book Next Appointment" }));
    const dialog = screen.getByRole("dialog", { name: "Book Next Appointment" });
    expect(screen.queryByText("Schedule follow-up")).toBeNull();
    fireEvent.change(screen.getByLabelText("Date"),{ target:{ value:"2030-10-13" } });
    fireEvent.change(screen.getByLabelText("Hour"),{ target:{ value:"9" } });
    fireEvent.change(screen.getByLabelText("AM / PM"),{ target:{ value:"AM" } });
    fireEvent.click(within(dialog).getByRole("button",{ name:"Book Next Appointment" }));
    await waitFor(() => expect(transitionLeadAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(transitionLeadAction).mock.calls[0]![1]).toBe("follow_up");
    expect(vi.mocked(transitionLeadAction).mock.calls[0]![2].get("due_at")).toBe("2030-10-13T09:00");
  });
  const bookedLead = { id: "22222222-2222-4222-8222-222222222222", status: "appointment_booked" as const };
  const appointmentOptions = [
    { id: "33333333-3333-4333-8333-333333333333", label: "29 Sep, 10:00 AM · Dr One" },
    { id: "44444444-4444-4444-8444-444444444444", label: "29 Sep, 4:00 PM · Dr Two" },
  ];

  it("requires an explicit date/time/doctor selection before marking one of multiple visits missed", async () => {
    vi.mocked(transitionLeadAction).mockResolvedValueOnce({ ok: true });
    render(<TransitionActions {...baseProps} lead={bookedLead} appointmentOptions={appointmentOptions} />);
    fireEvent.click(screen.getByRole("button", { name: "No-show → Missed" }));
    const dialog = screen.getByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Mark no-show" });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(transitionLeadAction).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("option", { name: appointmentOptions[1].label })).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Appointment to update"), { target: { value: appointmentOptions[1].id } });
    fireEvent.click(confirm);
    await waitFor(() => expect(transitionLeadAction).toHaveBeenCalledTimes(1));
    const args = vi.mocked(transitionLeadAction).mock.calls[0]!;
    expect(args[1]).toBe("missed");
    expect(args[2].get("appointment_id")).toBe(appointmentOptions[1].id);
  });

  it("cancels only the explicitly chosen appointment", async () => {
    vi.mocked(transitionLeadAction).mockResolvedValueOnce({ ok: true });
    render(<TransitionActions {...baseProps} lead={bookedLead} appointmentOptions={appointmentOptions} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel appointment" }));
    const dialog = screen.getByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Cancel appointment" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Appointment to update"), { target: { value: appointmentOptions[0].id } });
    fireEvent.click(confirm);
    await waitFor(() => expect(transitionLeadAction).toHaveBeenCalledTimes(1));
    const args = vi.mocked(transitionLeadAction).mock.calls[0]!;
    expect(args[1]).toBe("assigned");
    expect(args[2].get("cancelled_appointment_id")).toBe(appointmentOptions[0].id);
  });

  it("does not submit an undefined appointment when none is available", () => {
    render(<TransitionActions {...baseProps} lead={bookedLead} />);
    fireEvent.click(screen.getByRole("button", { name: "No-show → Missed" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/No scheduled appointment is available/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Mark no-show" })).toBeDisabled();
    expect(transitionLeadAction).not.toHaveBeenCalled();
  });

  it.each(["admin", "operations", "front_office"] as const)("offers Book Next Appointment or drop after treatment for %s without a close action", (role) => {
    render(
      <TransitionActions
        {...baseProps}
        role={role}
        lead={{
          id: "22222222-2222-4222-8222-222222222222",
          status: "visited_treated",
        }}
      />
    );

    expect(
      screen.getByRole("button", { name: "Book Next Appointment" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Drop lead" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close lead/i })).toBeNull();
  });

  it("keeps future booking and drop available during follow-up", () => {
    render(
      <TransitionActions
        {...baseProps}
        lead={{
          id: "22222222-2222-4222-8222-222222222222",
          status: "follow_up",
        }}
      />
    );

    expect(
      screen.getByRole("button", { name: "Book Next Appointment" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Drop lead" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close lead/i })).toBeNull();
  });

  it("renders legacy closed records without presenting new actions", () => {
    render(
      <TransitionActions
        {...baseProps}
        lead={{
          id: "22222222-2222-4222-8222-222222222222",
          status: "closed",
        }}
      />
    );

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it.each(["assigned", "appointment_booked"] as const)("keeps Book Next Appointment for a returning patient in %s", async (status) => {
    vi.mocked(transitionLeadAction).mockResolvedValueOnce({ ok: true });
    vi.spyOn(window, "open").mockReturnValueOnce(null);
    render(<TransitionActions {...baseProps} hasVisited lead={{ id: bookedLead.id, status }} />);
    fireEvent.click(screen.getByRole("button", { name: "Book Next Appointment" }));
    const dialog = screen.getByRole("dialog", { name: "Book Next Appointment" });
    fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: "2030-10-13" } });
    fireEvent.change(within(dialog).getByLabelText("Hour"), { target: { value: "9" } });
    fireEvent.change(within(dialog).getByLabelText("AM / PM"), { target: { value: "AM" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create appointment & open WhatsApp" }));
    await waitFor(() => expect(transitionLeadAction).toHaveBeenCalledWith(bookedLead.id, "appointment_booked", expect.any(FormData)));
    expect(vi.mocked(transitionLeadAction).mock.calls[0]![2].get("scheduled_at")).toBe("2030-10-13T09:00");
  });

  it("does not call a patient returning just because the first appointment is booked", () => {
    render(<TransitionActions {...baseProps} lead={bookedLead} />);
    expect(screen.getByRole("button", { name: "Book another appointment" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Book Next Appointment" })).toBeNull();
  });
});
