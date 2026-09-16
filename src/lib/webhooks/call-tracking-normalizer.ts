import type { Json } from "@/lib/database.types";

export type NormalizedCallEvent = {
  externalCallId: string;
  externalTenantId: string | null;
  eventType: string | null;
  phone: string | null;
  normalizedMobile: string | null;
  callerName: string | null;
  direction: "inbound" | "outbound" | "unknown";
  status: "ringing" | "in_progress" | "completed" | "failed" | "missed" | "no_answer" | "unknown";
  startedAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  recordingUrl: string | null;
  transcript: Json | null;
  summary: string | null;
  disposition: string | null;
  hangupCause: string | null;
};

export type NormalizedAppointmentEvent = {
  externalAppointmentId: string;
  eventType: string | null;
  callId: string | null;
  branchHint: string | null;
  patientName: string | null;
  phone: string | null;
  normalizedMobile: string | null;
  scheduledAt: string | null;
  durationMinutes: number | null;
  doctorName: string | null;
  status: "confirmed" | "scheduled" | "cancelled" | "completed" | "no_show" | "unknown";
  concern: string | null;
};

export type NormalizedWebhookEvent = {
  eventType: string | null;
  externalEventId: string | null;
  idempotencyKey: string | null;
  occurredAt: string | null;
  call: NormalizedCallEvent | null;
  appointment: NormalizedAppointmentEvent | null;
};

const CALL_ID_KEYS = [
  "callId", "call_id", "callUuid", "call_uuid", "plivoCallUuid", "plivo_call_uuid",
  "conversationId", "conversation_id", "sessionId", "session_id",
];
const APPOINTMENT_ID_KEYS = ["appointmentId", "appointment_id", "bookingId", "booking_id"];
const PHONE_KEYS = ["contactPhone", "contact_phone", "phone", "mobile", "from", "caller", "callerPhone", "caller_phone"];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function primitive(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 1_000);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function findValue(root: unknown, keys: string[], depth = 0): unknown {
  if (depth > 5) return undefined;
  const current = record(root);
  for (const key of keys) {
    if (current[key] !== undefined && current[key] !== null) return current[key];
  }
  for (const value of Object.values(current)) {
    if (value && typeof value === "object") {
      const found = findValue(value, keys, depth + 1);
      if (found !== undefined && found !== null) return found;
    }
  }
  return undefined;
}

function text(root: unknown, keys: string[]): string | null {
  return primitive(findValue(root, keys));
}

function parseDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value < 10_000_000_000 ? value * 1_000 : value;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value.trim());
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function date(root: unknown, keys: string[]): string | null {
  return parseDate(findValue(root, keys));
}

function integer(root: unknown, keys: string[], max: number): number | null {
  const value = findValue(root, keys);
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(max, Math.round(parsed)));
}

function normaliseMobile(value: string | null): string | null {
  if (!value) return null;
  const compact = value.normalize("NFKC").replace(/[\s().-]/gu, "");
  let local: string | null = null;
  if (/^[6-9]\d{9}$/.test(compact)) local = compact;
  else if (/^0[6-9]\d{9}$/.test(compact)) local = compact.slice(1);
  else if (/^\+91[6-9]\d{9}$/.test(compact)) local = compact.slice(3);
  else if (/^91[6-9]\d{9}$/.test(compact)) local = compact.slice(2);
  else if (/^0091[6-9]\d{9}$/.test(compact)) local = compact.slice(4);
  return local;
}

/** Provider values such as recording URLs are untrusted: only link http(s). */
export function externalHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function status(root: unknown): NormalizedCallEvent["status"] {
  const raw = (text(root, ["status", "callStatus", "call_status", "disposition"]) ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (["ringing", "queued", "initiated", "started"].includes(raw)) return "ringing";
  if (["in_progress", "inprogress", "answered", "active", "connected"].includes(raw)) return "in_progress";
  if (["completed", "complete", "ended", "finished", "hangup"].includes(raw)) return "completed";
  if (["failed", "error"].includes(raw)) return "failed";
  if (["missed", "busy"].includes(raw)) return "missed";
  if (["no_answer", "noanswer", "unanswered"].includes(raw)) return "no_answer";
  return "unknown";
}

function appointmentStatus(root: unknown): NormalizedAppointmentEvent["status"] {
  const raw = (text(root, ["status", "appointmentStatus", "appointment_status", "bookingStatus", "booking_status"]) ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (["confirmed", "booked", "accepted"].includes(raw)) return "confirmed";
  if (["scheduled", "pending", "rescheduled"].includes(raw)) return "scheduled";
  if (["cancelled", "canceled"].includes(raw)) return "cancelled";
  if (["completed", "complete", "attended"].includes(raw)) return "completed";
  if (["no_show", "noshow", "missed"].includes(raw)) return "no_show";
  return "unknown";
}

function direction(root: unknown): NormalizedCallEvent["direction"] {
  const raw = (text(root, ["direction", "callDirection", "call_direction"]) ?? "").toLowerCase();
  if (raw.includes("in")) return "inbound";
  if (raw.includes("out")) return "outbound";
  return "unknown";
}

function firstDate(root: unknown, keys: string[]): string | null {
  return date(root, keys);
}

export function normalizeCallTrackingEvent(body: unknown, headers: Headers): NormalizedWebhookEvent {
  const eventType = text(body, ["eventType", "event_type", "type", "event", "name"]) ?? headers.get("x-event-type");
  const externalEventId = text(body, ["eventId", "event_id", "requestId", "request_id", "id"]) ?? headers.get("x-event-id");
  const idempotencyKey = headers.get("idempotency-key") ?? text(body, ["idempotencyKey", "idempotency_key"]);
  const occurredAt = firstDate(body, ["occurredAt", "occurred_at", "timestamp", "at", "createdAt", "created_at"]);
  const callId = text(body, CALL_ID_KEYS);
  const appointmentId = text(body, APPOINTMENT_ID_KEYS);
  const phone = text(body, PHONE_KEYS);

  const call = callId
    ? {
        externalCallId: callId,
        externalTenantId: text(body, ["tenantId", "tenant_id"]),
        eventType,
        phone,
        normalizedMobile: normaliseMobile(phone),
        callerName: text(body, ["patientName", "patient_name", "callerName", "caller_name", "name"]),
        direction: direction(body),
        status: status(body),
        startedAt: firstDate(body, ["startedAt", "started_at", "startTime", "start_time"]),
        answeredAt: firstDate(body, ["answeredAt", "answered_at"]),
        endedAt: firstDate(body, ["endedAt", "ended_at", "finishedAt", "finished_at"]),
        durationSeconds: integer(body, ["durationSeconds", "duration_seconds", "duration"], 86_400),
        recordingUrl: text(body, ["recordingUrl", "recording_url", "recordingPath", "recording_path", "storagePath", "storage_path"]),
        transcript: (findValue(body, ["transcript", "liveTranscript", "live_transcript"]) as Json | undefined) ?? null,
        summary: text(body, ["summary", "callSummary", "call_summary"]),
        disposition: text(body, ["disposition", "outcome"]),
        hangupCause: text(body, ["hangupCause", "hangup_cause", "hangupReason", "hangup_reason"]),
      } satisfies NormalizedCallEvent
    : null;

  const appointment = appointmentId
    ? {
        externalAppointmentId: appointmentId,
        eventType,
        callId,
        branchHint: text(body, ["branchId", "branch_id", "branch", "city"]),
        patientName: text(body, ["patientName", "patient_name", "name"]),
        phone,
        normalizedMobile: normaliseMobile(phone),
        scheduledAt: firstDate(body, ["scheduledAt", "scheduled_at", "startsAt", "starts_at", "appointmentAt", "appointment_at"]),
        durationMinutes: integer(body, ["durationMinutes", "duration_minutes"], 1_440),
        doctorName: text(body, ["doctorName", "doctor_name"]),
        status: appointmentStatus(body),
        concern: text(body, ["concern", "reason", "notes"]),
      } satisfies NormalizedAppointmentEvent
    : null;

  return { eventType, externalEventId, idempotencyKey, occurredAt, call, appointment };
}

