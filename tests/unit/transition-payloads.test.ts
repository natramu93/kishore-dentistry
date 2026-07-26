import { describe, expect, it } from "vitest";
import { transitionPayloadSchemas } from "@/lib/leads/transitions";

const UUID = "11111111-1111-4111-8111-111111111111";
const OTHER_UUID = "22222222-2222-4222-8222-222222222222";

describe("lead transition payload contracts", () => {
  it("distinguishes normal assignment from appointment cancellation", () => {
    expect(
      transitionPayloadSchemas.assigned.parse({ assignee_id: UUID })
    ).toEqual({ assignee_id: UUID });
    expect(
      transitionPayloadSchemas.assigned.parse({
        cancelled_appointment_id: OTHER_UUID,
      })
    ).toEqual({ cancelled_appointment_id: OTHER_UUID });
    expect(
      transitionPayloadSchemas.assigned.safeParse({
        assignee_id: "not-a-uuid",
      }).success
    ).toBe(false);
    expect(transitionPayloadSchemas.assigned.safeParse({}).success).toBe(false);
  });

  it("allows a cancellation command to carry the current assignee for RPC compatibility", () => {
    expect(
      transitionPayloadSchemas.assigned.parse({
        assignee_id: UUID,
        cancelled_appointment_id: OTHER_UUID,
      })
    ).toEqual({
      assignee_id: UUID,
      cancelled_appointment_id: OTHER_UUID,
    });
  });

  it.each([
    [5, true],
    ["30", true],
    [480, true],
    [4, false],
    [481, false],
    [30.5, false],
    [Number.POSITIVE_INFINITY, false],
  ])("validates appointment duration %j", (duration, valid) => {
    const parsed = transitionPayloadSchemas.appointment_booked.safeParse({
      scheduled_at: "2026-07-26T10:00",
      duration_minutes: duration,
    });
    expect(parsed.success).toBe(valid);
  });

  it("bounds appointment notes, identifiers, and required wall time", () => {
    expect(
      transitionPayloadSchemas.appointment_booked.safeParse({
        scheduled_at: "",
      }).success
    ).toBe(false);
    expect(
      transitionPayloadSchemas.appointment_booked.safeParse({
        scheduled_at: "x".repeat(65),
      }).success
    ).toBe(false);
    expect(
      transitionPayloadSchemas.appointment_booked.safeParse({
        scheduled_at: "2026-07-26T10:00",
        doctor_id: "not-a-uuid",
      }).success
    ).toBe(false);
    expect(
      transitionPayloadSchemas.appointment_booked.safeParse({
        scheduled_at: "2026-07-26T10:00",
        notes: "x".repeat(4_001),
      }).success
    ).toBe(false);
  });

  it.each([
    [0, true],
    ["1250.50", true],
    [100_000_000, true],
    [-0.01, false],
    [100_000_001, false],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
  ])("validates treatment cost %j", (cost, valid) => {
    expect(
      transitionPayloadSchemas.visited_treated.safeParse({ cost }).success
    ).toBe(valid);
  });

  it("rejects malformed treatment and appointment references", () => {
    expect(
      transitionPayloadSchemas.visited_treated.safeParse({
        appointment_id: "bad",
      }).success
    ).toBe(false);
    expect(
      transitionPayloadSchemas.visited_treated.safeParse({
        treatment_type_id: "bad",
      }).success
    ).toBe(false);
    expect(
      transitionPayloadSchemas.missed.safeParse({
        appointment_id: "bad",
      }).success
    ).toBe(false);
  });

  it("bounds follow-up and dropped reasons", () => {
    expect(
      transitionPayloadSchemas.follow_up.safeParse({
        due_at: "2026-07-27T10:00",
        reason: "x".repeat(1_000),
      }).success
    ).toBe(true);
    expect(
      transitionPayloadSchemas.follow_up.safeParse({
        due_at: "2026-07-27T10:00",
        reason: "x".repeat(1_001),
      }).success
    ).toBe(false);
    expect(
      transitionPayloadSchemas.dropped.safeParse({
        reason: "x".repeat(1_001),
      }).success
    ).toBe(false);
  });

  it("strips untrusted fields before payloads reach the data layer", () => {
    expect(
      transitionPayloadSchemas.appointment_booked.parse({
        scheduled_at: "2026-07-26T10:00",
        duration_minutes: 30,
        branch_id: OTHER_UUID,
        created_by: OTHER_UUID,
        status: "completed",
      })
    ).toEqual({
      scheduled_at: "2026-07-26T10:00",
      duration_minutes: 30,
    });
    expect(
      transitionPayloadSchemas.closed.parse({
        actor_id: OTHER_UUID,
        status: "open",
      })
    ).toEqual({});
  });
});
