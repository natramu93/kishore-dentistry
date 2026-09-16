import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import type { AuthContext } from "@/lib/auth/context";
import {
  assertBranchAccess,
  canReadCallLogs,
  requireAdmin,
  requireCallLogAccess,
} from "@/lib/auth/guards";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { EMPTY_UUID, normalizePagination, normalizeSearch } from "@/lib/validation";
import type {
  CallLog,
  ExternalAppointment,
  Json,
  WebhookEndpoint,
  WebhookEvent,
} from "@/lib/database.types";
import {
  normalizeCallTrackingEvent,
  type NormalizedAppointmentEvent,
  type NormalizedCallEvent,
} from "@/lib/webhooks/call-tracking-normalizer";

const MAX_SECRET_LENGTH = 256;
const CALL_STATUS_RANK: Record<CallLog["status"], number> = {
  unknown: 0,
  ringing: 1,
  in_progress: 2,
  missed: 3,
  no_answer: 3,
  failed: 4,
  completed: 5,
};

export class WebhookProcessingError extends Error {
  readonly eventId: string;

  constructor(eventId: string, message: string) {
    super(message);
    this.name = "WebhookProcessingError";
    this.eventId = eventId;
  }
}

export type WebhookEndpointSummary = Pick<
  WebhookEndpoint,
  | "id"
  | "name"
  | "endpoint_key_prefix"
  | "secret_prefix"
  | "source_system"
  | "branch_id"
  | "is_active"
  | "last_received_at"
  | "last_event_at"
  | "created_at"
>;

export type CreatedWebhookEndpoint = WebhookEndpointSummary & {
  endpointPath: string;
  secret: string;
};

export type CallLogWithRefs = CallLog & {
  lead: { id: string; name: string; mobile: string; status: string; assignee_id: string | null } | null;
  branch: { id: string; name: string; code: string } | null;
};

export type CallLogFilters = {
  search?: string;
  status?: CallLog["status"];
  branchId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

export type CallLogDetail = CallLogWithRefs & {
  statusEvents: Array<{
    id: string;
    status: CallLog["status"];
    occurred_at: string | null;
    created_at: string;
    payload: Json;
  }>;
  lastWebhookEvent: Pick<
    WebhookEvent,
    "id" | "event_type" | "received_at" | "processing_status" | "body" | "body_text" | "headers"
  > | null;
};

export type ExternalAppointmentWithRefs = ExternalAppointment & {
  branch: { name: string; code: string } | null;
  lead: { id: string; name: string; mobile: string } | null;
};

export type WebhookEventSummary = Pick<
  WebhookEvent,
  | "id"
  | "webhook_id"
  | "event_type"
  | "external_call_id"
  | "external_appointment_id"
  | "processing_status"
  | "processing_error"
  | "received_at"
>;

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function secretsEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function generatedToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function textOrNull(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

function normalizeSource(value: string): string {
  const source = value.trim().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  if (!source) throw new ValidationError("Source system is required");
  return source;
}

function publicEndpoint(endpoint: WebhookEndpoint): WebhookEndpointSummary {
  return {
    id: endpoint.id,
    name: endpoint.name,
    endpoint_key_prefix: endpoint.endpoint_key_prefix,
    secret_prefix: endpoint.secret_prefix,
    source_system: endpoint.source_system,
    branch_id: endpoint.branch_id,
    is_active: endpoint.is_active,
    last_received_at: endpoint.last_received_at,
    last_event_at: endpoint.last_event_at,
    created_at: endpoint.created_at,
  };
}

export async function authenticateWebhookEndpoint(
  endpointKey: string,
  secret: string | null
): Promise<WebhookEndpoint | null> {
  if (!/^[A-Za-z0-9_-]{24,128}$/.test(endpointKey)) return null;
  if (!secret || secret.length > MAX_SECRET_LENGTH) return null;
  const lookup = await db
    .from("webhook_endpoints")
    .select("*")
    .eq("endpoint_key_hash", digest(endpointKey))
    .eq("is_active", true)
    .maybeSingle();
  if (lookup.error) throw lookup.error;
  if (!lookup.data || !secretsEqual(lookup.data.secret_hash, digest(secret))) return null;
  return lookup.data as WebhookEndpoint;
}

export async function listWebhookEndpoints(ctx: AuthContext): Promise<WebhookEndpointSummary[]> {
  requireAdmin(ctx);
  const result = await db
    .from("webhook_endpoints")
    .select("*")
    .order("created_at", { ascending: false });
  if (result.error) throw result.error;
  return (result.data as WebhookEndpoint[]).map(publicEndpoint);
}

export async function createWebhookEndpoint(
  ctx: AuthContext,
  input: { name: string; sourceSystem: string; branchId?: string | null }
): Promise<CreatedWebhookEndpoint> {
  requireAdmin(ctx);
  const name = textOrNull(input.name, 120);
  if (!name) throw new ValidationError("Webhook name is required");
  const sourceSystem = normalizeSource(input.sourceSystem);
  const branchId = input.branchId ? input.branchId : null;
  if (branchId) assertBranchAccess(ctx, branchId);

  const endpointKey = generatedToken(24);
  const secret = generatedToken(32);
  const insert = await db
    .from("webhook_endpoints")
    .insert({
      name,
      endpoint_key_hash: digest(endpointKey),
      endpoint_key_prefix: endpointKey.slice(0, 8),
      secret_hash: digest(secret),
      secret_prefix: secret.slice(0, 8),
      source_system: sourceSystem,
      branch_id: branchId,
      created_by: ctx.userId,
    })
    .select("*")
    .single();
  if (insert.error) throw insert.error;
  const endpoint = insert.data as WebhookEndpoint;
  return {
    ...publicEndpoint(endpoint),
    endpointPath: `/api/webhooks/call-tracking/${endpointKey}`,
    secret,
  };
}

export async function revokeWebhookEndpoint(ctx: AuthContext, id: string): Promise<void> {
  requireAdmin(ctx);
  const result = await db
    .from("webhook_endpoints")
    .update({ is_active: false })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new NotFoundError("Webhook endpoint");
}

export async function listWebhookEvents(ctx: AuthContext): Promise<WebhookEventSummary[]> {
  requireAdmin(ctx);
  const result = await db
    .from("webhook_events")
    .select("id, webhook_id, event_type, external_call_id, external_appointment_id, processing_status, processing_error, received_at")
    .order("received_at", { ascending: false })
    .limit(100);
  if (result.error) throw result.error;
  return result.data as WebhookEventSummary[];
}

export async function getWebhookEvent(ctx: AuthContext, id: string): Promise<Pick<WebhookEvent, "id" | "webhook_id" | "event_type" | "external_event_id" | "external_call_id" | "external_appointment_id" | "processing_status" | "processing_error" | "received_at" | "headers" | "body" | "body_text"> | null> {
  requireAdmin(ctx);
  const result = await db
    .from("webhook_events")
    .select("id, webhook_id, event_type, external_event_id, external_call_id, external_appointment_id, processing_status, processing_error, received_at, headers, body, body_text")
    .eq("id", id)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

async function resolveLead(
  branchHint: string | null,
  normalizedMobile: string | null
): Promise<{ branchId: string | null; leadId: string | null }> {
  if (!normalizedMobile) return { branchId: branchHint, leadId: null };
  let query = db
    .from("leads")
    .select("id, branch_id")
    .in("mobile", [normalizedMobile, `+91${normalizedMobile}`, `91${normalizedMobile}`, `0${normalizedMobile}`])
    .is("deleted_at", null)
    .limit(10);
  if (branchHint) query = query.eq("branch_id", branchHint);
  const result = await query;
  if (result.error) throw result.error;
  const rows = result.data ?? [];
  if (rows.length !== 1) return { branchId: branchHint, leadId: null };
  return { branchId: rows[0].branch_id, leadId: rows[0].id };
}

function callPatch(call: NormalizedCallEvent, existing: CallLog | null, endpoint: WebhookEndpoint, eventId: string, link: { branchId: string | null; leadId: string | null }) {
  const keep = <T>(next: T | null, previous: T | null | undefined): T | null => next ?? previous ?? null;
  const direction = call.direction === "unknown" ? existing?.direction ?? "unknown" : call.direction;
  const existingMetadata = existing?.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
    ? existing.metadata as Record<string, Json | undefined>
    : {};
  const nextStatus = existing && CALL_STATUS_RANK[existing.status] > CALL_STATUS_RANK[call.status]
    ? existing.status
    : call.status;
  return {
    source_system: endpoint.source_system,
    external_call_id: call.externalCallId,
    external_tenant_id: keep(call.externalTenantId, existing?.external_tenant_id),
    webhook_id: endpoint.id,
    last_event_id: eventId,
    branch_id: link.branchId ?? existing?.branch_id ?? null,
    lead_id: link.leadId ?? existing?.lead_id ?? null,
    phone: keep(call.phone, existing?.phone),
    normalized_mobile: keep(call.normalizedMobile, existing?.normalized_mobile),
    caller_name: keep(call.callerName, existing?.caller_name),
    direction,
    status: nextStatus,
    started_at: keep(call.startedAt, existing?.started_at),
    answered_at: keep(call.answeredAt, existing?.answered_at),
    ended_at: keep(call.endedAt, existing?.ended_at),
    duration_seconds: keep(call.durationSeconds, existing?.duration_seconds),
    recording_url: keep(call.recordingUrl, existing?.recording_url),
    transcript: keep(call.transcript, existing?.transcript),
    summary: keep(call.summary, existing?.summary),
    disposition: keep(call.disposition, existing?.disposition),
    hangup_cause: keep(call.hangupCause, existing?.hangup_cause),
    metadata: { ...existingMetadata, ...(call.eventType ? { event_type: call.eventType } : {}) },
  };
}

async function saveCall(
  endpoint: WebhookEndpoint,
  eventId: string,
  call: NormalizedCallEvent
): Promise<{ callLog: CallLog; branchId: string | null; leadId: string | null }> {
  const link = await resolveLead(endpoint.branch_id, call.normalizedMobile);
  const findExisting = async (): Promise<CallLog | null> => {
    const existingResult = await db
      .from("call_logs")
      .select("*")
      .eq("source_system", endpoint.source_system)
      .eq("external_call_id", call.externalCallId)
      .maybeSingle();
    if (existingResult.error) throw existingResult.error;
    return existingResult.data as CallLog | null;
  };
  const update = async (existing: CallLog): Promise<CallLog> => {
    const result = await db
      .from("call_logs")
      .update(callPatch(call, existing, endpoint, eventId, link))
      .eq("id", existing.id)
      .select("*")
      .single();
    if (result.error) throw result.error;
    return result.data as CallLog;
  };
  const existing = await findExisting();
  let saved: CallLog;
  if (existing) {
    saved = await update(existing);
  } else {
    const result = await db.from("call_logs").insert(callPatch(call, null, endpoint, eventId, link)).select("*").single();
    if (result.error?.code === "23505") {
      // Providers often send ringing/answered events for one call at the same
      // moment; merge into the row a concurrent event just created.
      const concurrent = await findExisting();
      if (!concurrent) throw result.error;
      saved = await update(concurrent);
    } else if (result.error) {
      throw result.error;
    } else {
      saved = result.data as CallLog;
    }
  }

  const history = await db.from("call_log_status_events").insert({
    call_log_id: saved.id,
    webhook_event_id: eventId,
    status: call.status,
    occurred_at: call.startedAt ?? null,
    payload: {
      event_type: call.eventType,
      status: call.status,
      phone: call.phone,
      disposition: call.disposition,
    } as Json,
  });
  if (history.error && history.error.code !== "23505") throw history.error;
  return { callLog: saved, branchId: link.branchId, leadId: link.leadId };
}

function nativeAppointmentStatus(status: NormalizedAppointmentEvent["status"]): "scheduled" | "completed" | "cancelled" | "no_show" | null {
  if (status === "confirmed" || status === "scheduled") return "scheduled";
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  if (status === "no_show") return "no_show";
  return null;
}

async function saveAppointment(
  endpoint: WebhookEndpoint,
  eventId: string,
  appointment: NormalizedAppointmentEvent,
  callLogId: string | null
): Promise<{ branchId: string | null; leadId: string | null }> {
  const link = await resolveLead(endpoint.branch_id, appointment.normalizedMobile);
  let linkedCallLogId = callLogId;
  if (!linkedCallLogId && appointment.callId) {
    const callLookup = await db
      .from("call_logs")
      .select("id")
      .eq("source_system", endpoint.source_system)
      .eq("external_call_id", appointment.callId)
      .maybeSingle();
    if (callLookup.error) throw callLookup.error;
    linkedCallLogId = callLookup.data?.id ?? null;
  }
  let resolvedBranchId = link.branchId;
  let resolvedLeadId = link.leadId;
  if (linkedCallLogId && (!resolvedBranchId || !resolvedLeadId)) {
    const callLink = await db.from("call_logs").select("branch_id, lead_id").eq("id", linkedCallLogId).maybeSingle();
    if (callLink.error) throw callLink.error;
    resolvedBranchId ??= callLink.data?.branch_id ?? null;
    resolvedLeadId ??= callLink.data?.lead_id ?? null;
  }
  const existing = await db
    .from("external_appointments")
    .select("*")
    .eq("source_system", endpoint.source_system)
    .eq("external_appointment_id", appointment.externalAppointmentId)
    .maybeSingle();
  if (existing.error) throw existing.error;

  const previous = existing.data as ExternalAppointment | null;
  const keep = <T>(next: T | null, prior: T | null | undefined): T | null => next ?? prior ?? null;
  const existingMetadata = previous?.metadata && typeof previous.metadata === "object" && !Array.isArray(previous.metadata)
    ? previous.metadata as Record<string, Json | undefined>
    : {};
  let nativeAppointmentId: string | null = previous?.native_appointment_id ?? null;
  const nativeLookup = await db
    .from("appointments")
    .select("id, status, lead_id, branch_id")
    .eq("external_source", endpoint.source_system)
    .eq("external_appointment_id", appointment.externalAppointmentId)
    .maybeSingle();
  if (nativeLookup.error) throw nativeLookup.error;
  if (nativeLookup.data) {
    nativeAppointmentId = nativeLookup.data.id;
    const status = nativeAppointmentStatus(appointment.status);
    // A late confirmation must not move a completed/cancelled/no-show visit
    // back to scheduled; terminal provider states are allowed to update the
    // native appointment from its scheduled state.
    if (status && nativeLookup.data.status !== status && (nativeLookup.data.status === "scheduled" || status !== "scheduled")) {
      const update = await db.from("appointments").update({ status }).eq("id", nativeLookup.data.id);
      if (update.error) throw update.error;
    }
  }

  const patch = {
    source_system: endpoint.source_system,
    external_appointment_id: appointment.externalAppointmentId,
    webhook_id: endpoint.id,
    last_event_id: eventId,
    branch_id: resolvedBranchId ?? previous?.branch_id ?? null,
    lead_id: resolvedLeadId ?? previous?.lead_id ?? null,
    native_appointment_id: nativeAppointmentId,
    call_log_id: linkedCallLogId ?? previous?.call_log_id ?? null,
    patient_name: keep(appointment.patientName, previous?.patient_name),
    mobile: keep(appointment.phone, previous?.mobile),
    normalized_mobile: keep(appointment.normalizedMobile, previous?.normalized_mobile),
    scheduled_at: keep(appointment.scheduledAt, previous?.scheduled_at),
    duration_minutes: keep(appointment.durationMinutes, previous?.duration_minutes),
    doctor_name: keep(appointment.doctorName, previous?.doctor_name),
    status: appointment.status === "unknown" ? previous?.status ?? "unknown" : appointment.status,
    concern: keep(appointment.concern, previous?.concern),
    metadata: { ...existingMetadata, ...(appointment.eventType ? { event_type: appointment.eventType } : {}), ...(appointment.branchHint ? { branch_hint: appointment.branchHint } : {}) },
  };
  let saved = existing.data
    ? await db.from("external_appointments").update(patch).eq("id", existing.data.id)
    : await db.from("external_appointments").insert(patch);
  if (!existing.data && saved.error?.code === "23505") {
    // A concurrent event created this appointment first; apply this update to it.
    saved = await db
      .from("external_appointments")
      .update(patch)
      .eq("source_system", endpoint.source_system)
      .eq("external_appointment_id", appointment.externalAppointmentId);
  }
  if (saved.error) throw saved.error;
  return { branchId: resolvedBranchId, leadId: resolvedLeadId };
}

export async function ingestCallTrackingWebhook(input: {
  endpoint: WebhookEndpoint;
  headers: Headers;
  contentType: string | null;
  sanitizedHeaders: Record<string, string>;
  body: Json | null;
  bodyText: string | null;
  bodySha256: string;
}): Promise<{ eventId: string; duplicate: boolean; processingStatus: "processed" | "partial" }> {
  const normalized = normalizeCallTrackingEvent(input.body ?? input.bodyText ?? {}, input.headers);
  const eventInsert = await db
    .from("webhook_events")
    .insert({
      webhook_id: input.endpoint.id,
      external_event_id: normalized.externalEventId,
      idempotency_key: normalized.idempotencyKey,
      http_method: "POST",
      content_type: input.contentType,
      headers: input.sanitizedHeaders as Json,
      body: input.body,
      body_text: input.bodyText,
      body_sha256: input.bodySha256,
      event_type: normalized.eventType,
      external_call_id: normalized.call?.externalCallId ?? null,
      external_appointment_id: normalized.appointment?.externalAppointmentId ?? null,
      occurred_at: normalized.occurredAt,
    })
    .select("*")
    .single();

  if (eventInsert.error) {
    if (eventInsert.error.code === "23505" && normalized.idempotencyKey) {
      const duplicate = await db
        .from("webhook_events")
        .select("id")
        .eq("webhook_id", input.endpoint.id)
        .eq("idempotency_key", normalized.idempotencyKey)
        .maybeSingle();
      if (duplicate.error) throw duplicate.error;
      if (duplicate.data) return { eventId: duplicate.data.id, duplicate: true, processingStatus: "processed" };
    }
    throw eventInsert.error;
  }

  const event = eventInsert.data as WebhookEvent;
  let callResult: { callLog: CallLog; branchId: string | null; leadId: string | null } | null = null;
  try {
    if (normalized.call) callResult = await saveCall(input.endpoint, event.id, normalized.call);
    const appointmentResult = normalized.appointment
      ? await saveAppointment(input.endpoint, event.id, normalized.appointment, callResult?.callLog.id ?? null)
      : null;
    const branchId = callResult?.branchId ?? appointmentResult?.branchId ?? input.endpoint.branch_id;
    const leadId = callResult?.leadId ?? appointmentResult?.leadId ?? null;
    const hasNormalizedRecord = Boolean(callResult || appointmentResult);
    const status = hasNormalizedRecord ? "processed" : "partial";
    const update = await db
      .from("webhook_events")
      .update({
        external_call_id: normalized.call?.externalCallId ?? null,
        external_appointment_id: normalized.appointment?.externalAppointmentId ?? null,
        branch_id: branchId,
        lead_id: leadId,
        processing_status: status,
        processed_at: new Date().toISOString(),
      })
      .eq("id", event.id);
    if (update.error) throw update.error;
    await db.from("webhook_endpoints").update({
      last_received_at: new Date().toISOString(),
      last_event_at: normalized.occurredAt ?? input.endpoint.last_event_at,
    }).eq("id", input.endpoint.id);
    return { eventId: event.id, duplicate: false, processingStatus: status };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Event processing failed";
    await db.from("webhook_events").update({
      processing_status: "failed",
      processing_error: message,
      processed_at: new Date().toISOString(),
    }).eq("id", event.id);
    throw new WebhookProcessingError(event.id, message);
  }
}

export async function listCallLogs(ctx: AuthContext, filters: CallLogFilters = {}) {
  requireCallLogAccess(ctx);
  const { page, pageSize } = normalizePagination(filters.page, filters.pageSize, 25);
  let query = db
    .from("call_logs")
    .select("*, lead:leads(id, name, mobile, status, assignee_id), branch:branches(id, name, code)", { count: "exact" })
    .order("started_at", { ascending: false, nullsFirst: false });
  if (ctx.role !== "admin") {
    query = query.in("branch_id", ctx.branchIds.length ? [...ctx.branchIds] : [EMPTY_UUID]);
  }
  if (filters.branchId) {
    assertBranchAccess(ctx, filters.branchId);
    query = query.eq("branch_id", filters.branchId);
  }
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.from) query = query.gte("started_at", filters.from);
  if (filters.to) query = query.lt("started_at", filters.to);
  const search = normalizeSearch(filters.search);
  if (search) query = query.or(`external_call_id.ilike.%${search}%,phone.ilike.%${search}%,caller_name.ilike.%${search}%`);
  const from = (page - 1) * pageSize;
  const result = await query.range(from, from + pageSize - 1);
  if (result.error) throw result.error;
  const logs = (result.data as unknown as CallLogWithRefs[]).filter((log) => {
    if (ctx.role !== "front_office") return true;
    return !log.lead || log.lead.assignee_id === ctx.userId || log.lead.assignee_id === null;
  });
  // Front Office rows are filtered after the join so unmatched calls remain
  // visible. Do not expose the branch-wide count for rows they cannot see.
  return { callLogs: logs, total: ctx.role === "front_office" ? logs.length : result.count ?? logs.length, page, pageSize };
}

export async function getCallLog(ctx: AuthContext, id: string): Promise<CallLogDetail | null> {
  requireCallLogAccess(ctx);
  const result = await db
    .from("call_logs")
    .select("*, lead:leads(id, name, mobile, status, assignee_id), branch:branches(id, name, code)")
    .eq("id", id)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return null;
  const log = result.data as unknown as CallLogWithRefs;
  if (ctx.role !== "admin" && (!log.branch_id || !ctx.branchIds.includes(log.branch_id))) return null;
  if (ctx.role === "front_office" && log.lead && log.lead.assignee_id !== null && log.lead.assignee_id !== ctx.userId) return null;
  const [events, latest] = await Promise.all([
    db.from("call_log_status_events").select("id, status, occurred_at, created_at, payload").eq("call_log_id", id).order("created_at", { ascending: false }),
    log.last_event_id
      ? db.from("webhook_events").select("id, event_type, received_at, processing_status, body, body_text, headers").eq("id", log.last_event_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (events.error) throw events.error;
  if (latest.error) throw latest.error;
  return {
    ...log,
    statusEvents: events.data ?? [],
    lastWebhookEvent: latest.data,
  } as CallLogDetail;
}

export async function listExternalAppointments(ctx: AuthContext): Promise<ExternalAppointmentWithRefs[]> {
  requireCallLogAccess(ctx);
  let query = db.from("external_appointments").select("*, branch:branches(name, code), lead:leads(id, name, mobile)").order("scheduled_at", { ascending: false, nullsFirst: false }).limit(100);
  if (ctx.role !== "admin") query = query.in("branch_id", ctx.branchIds.length ? [...ctx.branchIds] : [EMPTY_UUID]);
  const result = await query;
  if (result.error) throw result.error;
  return result.data as unknown as ExternalAppointmentWithRefs[];
}

export { canReadCallLogs };
