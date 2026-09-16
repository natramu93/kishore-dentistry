# External call and appointment webhooks

Administrators can create one endpoint per provider at **Administration → Webhooks**. Each endpoint has a provider-specific URL path and a secret. The secret is shown only when the endpoint is created.

Send a `POST` request with the secret in either `x-webhook-secret` or `Authorization: Bearer <secret>`:

```http
POST https://<crm-host>/api/webhooks/call-tracking/<endpoint-key>
Content-Type: application/json
x-webhook-secret: <secret>
Idempotency-Key: <provider-event-id>
```

The first version accepts any JSON or plain-text body and retains the raw event for analysis. Sensitive authentication headers are redacted before storage. Payloads are limited to 1 MiB. `GET` and other methods are not enabled.

The normalizer understands the fields emitted by `dental-receptionist`, including:

- Calls: `plivoCallUuid`/`callId`, `from`/`contactPhone`, `status`, `startedAt`, `answeredAt`, `endedAt`, `durationSeconds`, `recordingUrl`/`storagePath`, `transcript`, `summary`, `disposition`, and `hangupCause`.
- Appointments: `appointmentId`, `status`, `patientName`, `contactPhone`, `startsAt`, `durationMinutes`, `doctorName`, and `concern`.

Indian mobile numbers are normalized to their ten-digit local form. A lead is linked only when the number matches exactly one non-deleted lead in the endpoint’s branch (or exactly one lead across all branches when no branch is assigned). Ambiguous or missing matches remain visible as unmatched so staff can correct them without silently attaching a call to the wrong patient.

The CRM stores the raw provider event, the current call record, and a status history. External appointment updates are stored separately and update a native appointment only when the provider’s source and external appointment ID already map to that appointment.

