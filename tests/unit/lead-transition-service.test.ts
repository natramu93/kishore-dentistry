import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/auth/context";
import type { UserRole } from "@/lib/database.types";
import {
  AuthorizationError,
  ConflictError,
  ValidationError,
} from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  recordLeadActivity: vi.fn(),
  requireActiveDoctorForBranch: vi.fn(),
  requireActiveLeadSource: vi.fn(),
  requireActiveTreatmentType: vi.fn(),
  requireAppointmentForLead: vi.fn(),
  requireAssignableUser: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/data/db", () => ({
  db: {
    from: mocks.from,
    rpc: mocks.rpc,
  },
}));
vi.mock("@/data/helpers", () => ({
  recordLeadActivity: mocks.recordLeadActivity,
  requireActiveDoctorForBranch: mocks.requireActiveDoctorForBranch,
  requireActiveLeadSource: mocks.requireActiveLeadSource,
  requireActiveTreatmentType: mocks.requireActiveTreatmentType,
  requireAppointmentForLead: mocks.requireAppointmentForLead,
  requireAssignableUser: mocks.requireAssignableUser,
}));

import { transitionLead } from "@/data/leads";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ASSIGNEE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ASSIGNEE_ID = "33333333-3333-4333-8333-333333333333";
const LEAD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BRANCH_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const APPOINTMENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DOCTOR_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function context(role: UserRole, userId = USER_ID): AuthContext {
  return {
    userId,
    role,
    branchIds: [BRANCH_ID],
    fullName: "Test User",
    email: "test@example.test",
    doctorId: role === "doctor" ? DOCTOR_ID : null,
  } as unknown as AuthContext;
}

function mockLeadLookup(row: {
  id: string;
  branch_id: string;
  assignee_id: string | null;
  status:
    | "open"
    | "assigned"
    | "appointment_booked"
    | "visited_treated"
    | "follow_up"
    | "closed"
    | "dropped"
    | "missed";
}) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.is.mockReturnValue(chain);
  mocks.from.mockReturnValue(chain);
  return chain;
}

describe("trusted lead transition service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({
      data: { id: LEAD_ID },
      error: null,
    });
    mocks.requireAppointmentForLead.mockResolvedValue({
      id: APPOINTMENT_ID,
      doctor_id: null,
    });
    mocks.requireAssignableUser.mockResolvedValue(undefined);
    mocks.requireActiveDoctorForBranch.mockResolvedValue(undefined);
    mocks.requireActiveTreatmentType.mockResolvedValue(undefined);
  });

  it("preserves the database-trusted current assignee during cancellation", async () => {
    mockLeadLookup({
      id: LEAD_ID,
      branch_id: BRANCH_ID,
      assignee_id: ASSIGNEE_ID,
      status: "appointment_booked",
    });

    await transitionLead(context("operations"), LEAD_ID, "assigned", {
      assignee_id: OTHER_ASSIGNEE_ID,
      cancelled_appointment_id: APPOINTMENT_ID,
    });

    expect(mocks.requireAppointmentForLead).toHaveBeenCalledWith(
      APPOINTMENT_ID,
      LEAD_ID
    );
    expect(mocks.requireAssignableUser).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("transition_lead", {
      p_lead_id: LEAD_ID,
      p_to: "assigned",
      p_actor: USER_ID,
      p_payload: {
        assignee_id: ASSIGNEE_ID,
        cancelled_appointment_id: APPOINTMENT_ID,
      },
    });
  });

  it("rejects cancellation when the booked lead has no owner to preserve", async () => {
    mockLeadLookup({
      id: LEAD_ID,
      branch_id: BRANCH_ID,
      assignee_id: null,
      status: "appointment_booked",
    });

    await expect(
      transitionLead(context("operations"), LEAD_ID, "assigned", {
        cancelled_appointment_id: APPOINTMENT_ID,
      })
    ).rejects.toThrow(
      new ConflictError(
        "Lead must have an assignee before cancelling its appointment"
      )
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("allows Front Office to self-claim an open pool lead", async () => {
    mockLeadLookup({
      id: LEAD_ID,
      branch_id: BRANCH_ID,
      assignee_id: null,
      status: "open",
    });

    await transitionLead(context("front_office"), LEAD_ID, "assigned", {
      assignee_id: USER_ID,
    });

    expect(mocks.requireAssignableUser).toHaveBeenCalledWith(
      USER_ID,
      BRANCH_ID
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "transition_lead",
      expect.objectContaining({
        p_payload: { assignee_id: USER_ID },
      })
    );
  });

  it("prevents Front Office from assigning an open pool lead to someone else", async () => {
    mockLeadLookup({
      id: LEAD_ID,
      branch_id: BRANCH_ID,
      assignee_id: null,
      status: "open",
    });

    await expect(
      transitionLead(context("front_office"), LEAD_ID, "assigned", {
        assignee_id: OTHER_ASSIGNEE_ID,
      })
    ).rejects.toThrow(
      new AuthorizationError(
        "Front Office can only assign leads to themselves"
      )
    );
    expect(mocks.requireAssignableUser).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("derives treatment doctor attribution from the trusted appointment", async () => {
    mockLeadLookup({
      id: LEAD_ID,
      branch_id: BRANCH_ID,
      assignee_id: ASSIGNEE_ID,
      status: "appointment_booked",
    });
    mocks.requireAppointmentForLead.mockResolvedValue({
      id: APPOINTMENT_ID,
      doctor_id: DOCTOR_ID,
    });

    await transitionLead(
      context("operations"),
      LEAD_ID,
      "visited_treated",
      {
        appointment_id: APPOINTMENT_ID,
        cost: 500,
      }
    );

    expect(mocks.rpc).toHaveBeenCalledWith("transition_lead", {
      p_lead_id: LEAD_ID,
      p_to: "visited_treated",
      p_actor: USER_ID,
      p_payload: {
        appointment_id: APPOINTMENT_ID,
        cost: 500,
        doctor_id: DOCTOR_ID,
      },
    });
  });

  it("validates active branch doctor data before booking", async () => {
    mockLeadLookup({
      id: LEAD_ID,
      branch_id: BRANCH_ID,
      assignee_id: ASSIGNEE_ID,
      status: "assigned",
    });

    await transitionLead(
      context("operations"),
      LEAD_ID,
      "appointment_booked",
      {
        scheduled_at: "2026-07-26T04:30:00.000Z",
        doctor_id: DOCTOR_ID,
        duration_minutes: 45,
      }
    );

    expect(mocks.requireActiveDoctorForBranch).toHaveBeenCalledWith(
      DOCTOR_ID,
      BRANCH_ID
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "transition_lead",
      expect.objectContaining({
        p_payload: {
          scheduled_at: "2026-07-26T04:30:00.000Z",
          doctor_id: DOCTOR_ID,
          duration_minutes: 45,
        },
      })
    );
  });

  it("requires appointment references for completion and no-show transitions", async () => {
    mockLeadLookup({
      id: LEAD_ID,
      branch_id: BRANCH_ID,
      assignee_id: ASSIGNEE_ID,
      status: "appointment_booked",
    });

    await expect(
      transitionLead(
        context("operations"),
        LEAD_ID,
        "visited_treated",
        {}
      )
    ).rejects.toThrow(
      new ValidationError("Scheduled appointment is required")
    );
    await expect(
      transitionLead(context("operations"), LEAD_ID, "missed", {})
    ).rejects.toThrow(
      new ValidationError("Scheduled appointment is required")
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("sends same-state replays as an empty idempotency payload", async () => {
    mockLeadLookup({
      id: LEAD_ID,
      branch_id: BRANCH_ID,
      assignee_id: ASSIGNEE_ID,
      status: "closed",
    });

    await transitionLead(context("operations"), LEAD_ID, "closed", {
      injected: "ignored",
    });

    expect(mocks.rpc).toHaveBeenCalledWith("transition_lead", {
      p_lead_id: LEAD_ID,
      p_to: "closed",
      p_actor: USER_ID,
      p_payload: {},
    });
  });
});
