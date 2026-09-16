import { describe, expect, it } from "vitest";
import { externalHttpUrl, normalizeCallTrackingEvent } from "@/lib/webhooks/call-tracking-normalizer";

describe("call tracking webhook normalizer", () => {
  it("normalizes the dental-receptionist call shape and Indian mobile", () => {
    const result = normalizeCallTrackingEvent({
      call: {
        plivoCallUuid: "call-123",
        from: "+91 93611 35459",
        status: "in-progress",
        startedAt: "2026-09-15T09:00:00+05:30",
        durationSeconds: 42,
        patientName: "Asha",
      },
    }, new Headers({ "x-event-id": "evt-1" }));

    expect(result.call).toMatchObject({
      externalCallId: "call-123",
      normalizedMobile: "9361135459",
      status: "in_progress",
      durationSeconds: 42,
      callerName: "Asha",
    });
  });

  it("keeps appointment updates independent from calls", () => {
    const result = normalizeCallTrackingEvent({
      appointmentId: "appointment-1",
      status: "cancelled",
      contact_phone: "9361135459",
      startsAt: "2026-09-20T10:00:00+05:30",
    }, new Headers());

    expect(result.call).toBeNull();
    expect(result.appointment).toMatchObject({
      externalAppointmentId: "appointment-1",
      normalizedMobile: "9361135459",
      status: "cancelled",
    });
  });

  it("only treats http(s) provider recording URLs as links", () => {
    expect(externalHttpUrl("https://recordings.example.test/call-123.mp3")).toBe(
      "https://recordings.example.test/call-123.mp3"
    );
    expect(externalHttpUrl("javascript:alert(document.cookie)")).toBeNull();
    expect(externalHttpUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(externalHttpUrl("recordings/call-123.mp3")).toBeNull();
    expect(externalHttpUrl(null)).toBeNull();
  });

  it("accepts malformed or unrecognized payloads without inventing a call", () => {
    const result = normalizeCallTrackingEvent({ hello: "world" }, new Headers());
    expect(result.call).toBeNull();
    expect(result.appointment).toBeNull();
    expect(result.eventType).toBeNull();
  });
});

