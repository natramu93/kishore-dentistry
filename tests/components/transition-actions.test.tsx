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

  it("offers follow-up or drop after treatment without a close action", () => {
    render(
      <TransitionActions
        {...baseProps}
        lead={{
          id: "22222222-2222-4222-8222-222222222222",
          status: "visited_treated",
        }}
      />
    );

    expect(
      screen.getByRole("button", { name: "Schedule follow-up" })
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
      screen.getByRole("button", { name: "Book next appointment" })
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
});
