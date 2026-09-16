import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { authenticateWebhookEndpoint, ingestCallTrackingWebhook, WebhookProcessingError } from "@/data/call-tracking";
import type { Json } from "@/lib/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_048_576;
const REDACTED_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-webhook-secret",
  "x-api-key",
  "x-signature",
  "signature",
]);

function headerSecret(request: NextRequest): string | null {
  const direct = request.headers.get("x-webhook-secret") ?? request.headers.get("x-api-key");
  if (direct?.trim()) return direct.trim();
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function safeHeaders(request: NextRequest): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of request.headers.entries()) {
    const lowerName = name.toLowerCase();
    const sensitive = REDACTED_HEADERS.has(lowerName) || /(authorization|cookie|secret|token|signature|api[-_]?key)/i.test(lowerName);
    result[lowerName] = sensitive ? "[REDACTED]" : value.slice(0, 2_000);
  }
  return result;
}

function isJsonContent(contentType: string | null, raw: string): boolean {
  return Boolean(contentType?.toLowerCase().includes("json")) || /^[\s]*[\[{]/.test(raw);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ endpointKey: string }> }
) {
  const { endpointKey } = await context.params;
  const endpointSecret = headerSecret(request);
  let endpoint;
  try {
    endpoint = await authenticateWebhookEndpoint(endpointKey, endpointSecret);
  } catch {
    return Response.json({ error: "Webhook unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!endpoint) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return Response.json({ error: "Payload too large" }, { status: 413, headers: { "Cache-Control": "no-store" } });
  }
  const contentType = request.headers.get("content-type");
  let body: Json | null = null;
  const bodyText: string | null = raw;
  if (isJsonContent(contentType, raw)) {
    try {
      const parsedBody = JSON.parse(raw) as Json;
      // Keep both representations: JSON makes analysis easy, while the raw
      // text preserves exactly what the provider sent for later replays.
      if (parsedBody !== null) {
        body = parsedBody;
      }
    } catch {
      // Preserve malformed JSON as text for analysis; the event is still
      // accepted because this first version intentionally does not enforce a
      // provider-specific schema.
    }
  }

  try {
    const result = await ingestCallTrackingWebhook({
      endpoint,
      headers: request.headers,
      contentType,
      sanitizedHeaders: safeHeaders(request),
      body,
      bodyText,
      bodySha256: createHash("sha256").update(raw, "utf8").digest("hex"),
    });
    return Response.json(
      { received: true, event_id: result.eventId, duplicate: result.duplicate, processing_status: result.processingStatus },
      { status: result.duplicate ? 200 : 202, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof WebhookProcessingError) {
      return Response.json({ received: true, event_id: error.eventId, processing_status: "failed" }, { status: 202, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "Unable to persist webhook event" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
