import { describe, expect, it } from "vitest";
import {
  ALLOWED_TRANSITIONS,
  canTransition,
  transitionPayloadSchemas,
} from "@/lib/leads/transitions";

describe("lead state machine", () => {
  it("allows only the documented forward, retry, and terminal transitions", () => {
    expect(canTransition("open", "assigned")).toBe(true);
    expect(canTransition("appointment_booked", "assigned")).toBe(true);
    expect(canTransition("follow_up", "appointment_booked")).toBe(true);
    expect(canTransition("visited_treated", "appointment_booked")).toBe(true);
    for (const status of Object.keys(ALLOWED_TRANSITIONS)) {
      expect(canTransition(status as keyof typeof ALLOWED_TRANSITIONS, "follow_up")).toBe(false);
    }
    expect(canTransition("visited_treated", "closed")).toBe(false);
    expect(canTransition("follow_up", "closed")).toBe(false);
    expect(canTransition("closed", "open")).toBe(false);
    expect(canTransition("dropped", "assigned")).toBe(false);
  });

  it("permits same-state booking only when adding another appointment", () => {
    for (const [from, targets] of Object.entries(ALLOWED_TRANSITIONS)) {
      if (from === "appointment_booked") {
        expect(targets.filter((target) => target === from)).toHaveLength(1);
      } else {
        expect(targets).not.toContain(from);
      }
    }
  });

  it("supports cancellation without replacing the current assignee", () => {
    const result = transitionPayloadSchemas.assigned.safeParse({
      cancelled_appointment_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.assignee_id).toBeUndefined();
  });

  it("still requires an assignee for a normal assignment command", () => {
    expect(
      transitionPayloadSchemas.assigned.safeParse({
        assignee_id: "11111111-1111-4111-8111-111111111111",
      }).success
    ).toBe(true);
    expect(transitionPayloadSchemas.assigned.safeParse({}).success).toBe(false);
  });

  it("uses only the appointment start time while still bounding treatment amounts", () => {
    expect(
      transitionPayloadSchemas.appointment_booked.safeParse({
        scheduled_at: "2026-08-01T10:00:00.000Z",
        duration_minutes: 0,
      }).success
    ).toBe(true);
    expect(
      transitionPayloadSchemas.visited_treated.safeParse({
        cost: -1,
      }).success
    ).toBe(false);
  });

  it("uses appointment booking for visits years in the future, with no follow-up payload", () => {
    expect(transitionPayloadSchemas).not.toHaveProperty("follow_up");
    expect(
      transitionPayloadSchemas.appointment_booked.safeParse({
        scheduled_at: "2046-09-03T09:30",
        notes: "Long-term implant review",
      }).success
    ).toBe(true);
  });
});
