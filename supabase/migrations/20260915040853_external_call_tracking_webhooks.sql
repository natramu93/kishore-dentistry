-- External call/appointment intake for AI and cloud telephony providers.
-- The tables are intentionally service-role only: the public webhook route
-- authenticates with a per-endpoint secret before writing any payload.

alter table if exists crm.appointments
  add column if not exists external_source text,
  add column if not exists external_appointment_id text;

create index if not exists appointments_external_lookup_idx
  on crm.appointments (external_source, external_appointment_id)
  where external_source is not null and external_appointment_id is not null;

create unique index if not exists appointments_external_unique_idx
  on crm.appointments (external_source, external_appointment_id)
  where external_source is not null and external_appointment_id is not null;

create table if not exists crm.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  endpoint_key_hash text not null unique,
  endpoint_key_prefix text not null,
  secret_hash text not null,
  secret_prefix text not null,
  source_system text not null,
  branch_id uuid references crm.branches(id) on delete set null,
  is_active boolean not null default true,
  last_received_at timestamptz,
  last_event_at timestamptz,
  created_by uuid references crm.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint webhook_endpoints_name_length check (char_length(name) between 1 and 120),
  constraint webhook_endpoints_source_length check (char_length(source_system) between 1 and 80),
  constraint webhook_endpoints_prefix_length check (char_length(endpoint_key_prefix) between 4 and 24),
  constraint webhook_endpoints_secret_prefix_length check (char_length(secret_prefix) between 4 and 24)
);

create index if not exists webhook_endpoints_branch_idx
  on crm.webhook_endpoints (branch_id, is_active);

create table if not exists crm.webhook_events (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references crm.webhook_endpoints(id) on delete restrict,
  external_event_id text,
  idempotency_key text,
  http_method text not null default 'POST',
  content_type text,
  headers jsonb not null default '{}'::jsonb,
  body jsonb,
  body_text text,
  body_sha256 text not null,
  event_type text,
  external_call_id text,
  external_appointment_id text,
  branch_id uuid references crm.branches(id) on delete set null,
  lead_id uuid references crm.leads(id) on delete set null,
  received_at timestamptz not null default now(),
  occurred_at timestamptz,
  processed_at timestamptz,
  processing_status text not null default 'received',
  processing_error text,
  created_at timestamptz not null default now(),
  constraint webhook_events_status check (processing_status in ('received', 'processed', 'partial', 'failed')),
  constraint webhook_events_payload check (body is not null or body_text is not null),
  constraint webhook_events_body_size check (coalesce(octet_length(body_text), 0) <= 1048576)
);

create unique index if not exists webhook_events_idempotency_idx
  on crm.webhook_events (webhook_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists webhook_events_received_idx
  on crm.webhook_events (received_at desc);
create index if not exists webhook_events_call_idx
  on crm.webhook_events (webhook_id, external_call_id, received_at desc);

create table if not exists crm.call_logs (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  external_call_id text not null,
  external_tenant_id text,
  webhook_id uuid references crm.webhook_endpoints(id) on delete set null,
  last_event_id uuid references crm.webhook_events(id) on delete set null,
  branch_id uuid references crm.branches(id) on delete set null,
  lead_id uuid references crm.leads(id) on delete set null,
  phone text,
  normalized_mobile text,
  caller_name text,
  direction text not null default 'unknown',
  status text not null default 'unknown',
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  recording_url text,
  transcript jsonb,
  summary text,
  disposition text,
  hangup_cause text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint call_logs_direction check (direction in ('inbound', 'outbound', 'unknown')),
  constraint call_logs_status check (status in ('ringing', 'in_progress', 'completed', 'failed', 'missed', 'no_answer', 'unknown')),
  constraint call_logs_duration check (duration_seconds is null or duration_seconds >= 0),
  constraint call_logs_source_length check (char_length(source_system) between 1 and 80),
  constraint call_logs_external_id_length check (char_length(external_call_id) between 1 and 255)
);

create unique index if not exists call_logs_external_unique_idx
  on crm.call_logs (source_system, external_call_id);
create index if not exists call_logs_branch_time_idx
  on crm.call_logs (branch_id, started_at desc);
create index if not exists call_logs_lead_time_idx
  on crm.call_logs (lead_id, started_at desc);
create index if not exists call_logs_mobile_idx
  on crm.call_logs (normalized_mobile, started_at desc);

create table if not exists crm.call_log_status_events (
  id uuid primary key default gen_random_uuid(),
  call_log_id uuid not null references crm.call_logs(id) on delete cascade,
  webhook_event_id uuid not null unique references crm.webhook_events(id) on delete restrict,
  status text not null,
  occurred_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint call_log_status_events_status check (status in ('ringing', 'in_progress', 'completed', 'failed', 'missed', 'no_answer', 'unknown'))
);

create index if not exists call_log_status_events_call_idx
  on crm.call_log_status_events (call_log_id, created_at desc);

create table if not exists crm.external_appointments (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  external_appointment_id text not null,
  webhook_id uuid references crm.webhook_endpoints(id) on delete set null,
  last_event_id uuid references crm.webhook_events(id) on delete set null,
  branch_id uuid references crm.branches(id) on delete set null,
  lead_id uuid references crm.leads(id) on delete set null,
  native_appointment_id uuid references crm.appointments(id) on delete set null,
  call_log_id uuid references crm.call_logs(id) on delete set null,
  patient_name text,
  mobile text,
  normalized_mobile text,
  scheduled_at timestamptz,
  duration_minutes integer,
  doctor_name text,
  status text not null default 'unknown',
  concern text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_appointments_status check (status in ('confirmed', 'scheduled', 'cancelled', 'completed', 'no_show', 'unknown')),
  constraint external_appointments_duration check (duration_minutes is null or duration_minutes between 1 and 1440)
);

create unique index if not exists external_appointments_unique_idx
  on crm.external_appointments (source_system, external_appointment_id);
create index if not exists external_appointments_branch_time_idx
  on crm.external_appointments (branch_id, scheduled_at desc);
create index if not exists external_appointments_mobile_idx
  on crm.external_appointments (normalized_mobile, scheduled_at desc);

create or replace function crm.set_external_tracking_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function crm.set_external_tracking_updated_at() from public, anon, authenticated;
grant execute on function crm.set_external_tracking_updated_at() to service_role;

drop trigger if exists webhook_endpoints_updated_at on crm.webhook_endpoints;
create trigger webhook_endpoints_updated_at
before update on crm.webhook_endpoints
for each row execute function crm.set_external_tracking_updated_at();

drop trigger if exists call_logs_updated_at on crm.call_logs;
create trigger call_logs_updated_at
before update on crm.call_logs
for each row execute function crm.set_external_tracking_updated_at();

drop trigger if exists external_appointments_updated_at on crm.external_appointments;
create trigger external_appointments_updated_at
before update on crm.external_appointments
for each row execute function crm.set_external_tracking_updated_at();

alter table crm.webhook_endpoints enable row level security;
alter table crm.webhook_events enable row level security;
alter table crm.call_logs enable row level security;
alter table crm.call_log_status_events enable row level security;
alter table crm.external_appointments enable row level security;

revoke all on crm.webhook_endpoints from anon, authenticated;
revoke all on crm.webhook_events from anon, authenticated;
revoke all on crm.call_logs from anon, authenticated;
revoke all on crm.call_log_status_events from anon, authenticated;
revoke all on crm.external_appointments from anon, authenticated;

grant all on crm.webhook_endpoints to service_role;
grant all on crm.webhook_events to service_role;
grant all on crm.call_logs to service_role;
grant all on crm.call_log_status_events to service_role;
grant all on crm.external_appointments to service_role;
