-- Source snapshots, not issued CRM invoices, receipts, balances or clinical attestations.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table crm.leads add constraint leads_id_branch_legacy_key unique (id, branch_id);

create table crm.legacy_patient_bills (
  branch_id uuid not null,
  lead_id uuid not null,
  bill_number text not null check (char_length(bill_number) between 1 and 100),
  billed_at timestamptz not null check (isfinite(billed_at)),
  legacy_patient_ref text not null check (legacy_patient_ref ~ '^[A-Z]{6}-[0-9]+$'),
  source_export text not null check (source_export in ('B24','B25','B26')),
  gross_paise bigint not null,
  discount_paise bigint not null check (discount_paise >= 0),
  tax_paise bigint not null check (tax_paise >= 0),
  net_paise bigint not null,
  service_names text[] not null check (cardinality(service_names) between 1 and 300),
  service_lines jsonb not null check (jsonb_typeof(service_lines) = 'array' and jsonb_array_length(service_lines) between 1 and 300),
  imported_at timestamptz not null default now(),
  primary key (branch_id, bill_number),
  foreign key (lead_id, branch_id) references crm.leads(id, branch_id) on delete restrict,
  check (gross_paise - discount_paise + tax_paise = net_paise)
);
create index legacy_patient_bills_patient_date_idx on crm.legacy_patient_bills(lead_id, branch_id, billed_at desc, bill_number);

alter table crm.legacy_patient_bills enable row level security;
revoke all on crm.legacy_patient_bills from public, anon, authenticated, service_role;
grant select, insert on crm.legacy_patient_bills to service_role;
notify pgrst, 'reload schema';
