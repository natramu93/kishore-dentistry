import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TransitionActions } from "@/components/leads/transition-actions";

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

const baseProps = {
  activeAppointmentId: null,
  assignableUsers: [],
  doctors: [],
  role: "admin" as const,
  userId: "11111111-1111-4111-8111-111111111111",
};

describe("lead transition actions", () => {
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
