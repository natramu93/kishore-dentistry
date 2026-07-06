-- ============================================================
-- 0001_schema.sql — crm schema, grants lockdown, enums, tables
-- ============================================================

create schema if not exists crm;

-- Lockdown: the app server (service_role) is the only API consumer.
-- Browser clients hold only the anon key and must reach nothing.
revoke all on schema crm from anon, authenticated;
grant usage on schema crm to service_role;

alter default privileges in schema crm grant all on tables to service_role;
alter default privileges in schema crm grant all on sequences to service_role;
alter default privileges in schema crm grant all on functions to service_role;
alter default privileges in schema crm revoke all on tables from anon, authenticated;
alter default privileges in schema crm revoke all on sequences from anon, authenticated;
alter default privileges in schema crm revoke all on functions from anon, authenticated;

-- ------------------------------------------------------------
-- Enums (workflow states baked into code — not admin-editable)
-- ------------------------------------------------------------
create type crm.user_role as enum ('admin','manager','agent');
create type crm.lead_status as enum ('open','assigned','appointment_booked','visited_treated','follow_up','closed','dropped','missed');
create type crm.appointment_status as enum ('scheduled','completed','cancelled','no_show');
create type crm.invoice_status as enum ('draft','sent','paid');
create type crm.follow_up_status as enum ('pending','done','cancelled');
create type crm.comment_entity as enum ('lead','appointment','treatment','follow_up','invoice');

-- ------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------

create table crm.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,           -- short code used in invoice numbers, e.g. 'ANN'
  address text,
  phone text,
  timezone text not null default 'Asia/Kolkata',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table crm.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  phone text,
  role crm.user_role not null default 'agent',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table crm.user_branches (
  user_id uuid not null references crm.profiles(id) on delete cascade,
  branch_id uuid not null references crm.branches(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, branch_id)
);

create table crm.lead_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table crm.doctors (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references crm.branches(id),
  full_name text not null,
  specialization text,
  phone text,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table crm.treatment_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  default_cost numeric(10,2),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table crm.leads (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references crm.branches(id),
  source_id uuid references crm.lead_sources(id),
  name text not null,
  email text,
  mobile text not null,
  age smallint,
  dob date,
  status crm.lead_status not null default 'open',
  assignee_id uuid references crm.profiles(id),
  notes text,
  created_by uuid references crm.profiles(id),
  status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_branch_status_idx on crm.leads (branch_id, status);
create index leads_assignee_idx on crm.leads (assignee_id);
create index leads_mobile_idx on crm.leads (mobile);
create index leads_created_at_idx on crm.leads (created_at desc);

create table crm.appointments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references crm.leads(id) on delete cascade,
  branch_id uuid not null references crm.branches(id),   -- denormalized from lead via trigger
  doctor_id uuid references crm.doctors(id),
  scheduled_at timestamptz not null,
  duration_minutes int not null default 30,
  status crm.appointment_status not null default 'scheduled',
  notes text,
  created_by uuid references crm.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index appointments_branch_time_idx on crm.appointments (branch_id, scheduled_at);
create index appointments_lead_idx on crm.appointments (lead_id);

create table crm.treatments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references crm.leads(id) on delete cascade,
  branch_id uuid not null references crm.branches(id),   -- denormalized
  appointment_id uuid references crm.appointments(id),
  treatment_type_id uuid references crm.treatment_types(id),
  doctor_id uuid references crm.doctors(id),
  cost numeric(10,2),
  notes text,
  treated_at timestamptz not null default now(),
  created_by uuid references crm.profiles(id),
  created_at timestamptz not null default now()
);
create index treatments_lead_idx on crm.treatments (lead_id);
create index treatments_branch_idx on crm.treatments (branch_id);

create table crm.follow_ups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references crm.leads(id) on delete cascade,
  branch_id uuid not null references crm.branches(id),   -- denormalized
  due_at timestamptz not null,
  reason text,
  status crm.follow_up_status not null default 'pending',
  outcome_notes text,
  completed_at timestamptz,
  created_by uuid references crm.profiles(id),
  created_at timestamptz not null default now()
);
create index follow_ups_worklist_idx on crm.follow_ups (branch_id, status, due_at);
create index follow_ups_lead_idx on crm.follow_ups (lead_id);

create table crm.invoice_counters (
  branch_id uuid not null references crm.branches(id),
  year int not null,
  last_no int not null default 0,
  primary key (branch_id, year)
);

create table crm.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  lead_id uuid not null references crm.leads(id),
  branch_id uuid not null references crm.branches(id),   -- denormalized
  treatment_id uuid references crm.treatments(id),
  status crm.invoice_status not null default 'draft',
  subtotal numeric(12,2) not null default 0,
  tax_rate numeric(5,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  issued_at timestamptz,
  notes text,
  created_by uuid references crm.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invoices_lead_idx on crm.invoices (lead_id);
create index invoices_branch_idx on crm.invoices (branch_id, status);

create table crm.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references crm.invoices(id) on delete cascade,
  description text not null,
  quantity numeric(8,2) not null default 1,
  unit_price numeric(10,2) not null default 0,
  amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
create index invoice_items_invoice_idx on crm.invoice_items (invoice_id);

create table crm.lead_activity (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references crm.leads(id) on delete cascade,
  branch_id uuid not null references crm.branches(id),   -- denormalized
  actor_id uuid references crm.profiles(id),
  type text not null,                                    -- status_change | note | assignment | appointment | follow_up | invoice | comment
  from_status crm.lead_status,
  to_status crm.lead_status,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index lead_activity_lead_idx on crm.lead_activity (lead_id, created_at desc);

create table crm.comments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references crm.leads(id) on delete cascade,
  branch_id uuid not null references crm.branches(id),   -- denormalized
  entity_type crm.comment_entity not null default 'lead',
  entity_id uuid,                                        -- null = general comment on the lead
  body text not null,
  author_id uuid not null references crm.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index comments_lead_idx on crm.comments (lead_id, created_at);
create index comments_entity_idx on crm.comments (entity_type, entity_id);
