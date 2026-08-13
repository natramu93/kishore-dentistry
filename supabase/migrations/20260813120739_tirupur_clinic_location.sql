-- Establish the canonical Tirupur clinic contact details without replacing
-- the existing branch identity used by assignments and invoice counters.
insert into crm.branches (
  name,
  code,
  address,
  phone,
  timezone,
  is_active
)
values (
  'Tirupur',
  'TUP',
  E'No-541, 543/338-34, 1st floor, Aadhaar Hospital,\nOpp to KR Bakes, Puspha Theatre Bus stop,\nTirupur – 641602.',
  '+919361135459',
  'Asia/Kolkata',
  true
)
on conflict (code) do update
set name = excluded.name,
    address = excluded.address,
    phone = excluded.phone,
    timezone = excluded.timezone,
    is_active = excluded.is_active,
    updated_at = now();

-- Snapshot issuer contact details so later branch edits do not rewrite
-- previously issued or draft invoice documents.
alter table crm.invoices
  add column issuer_name text,
  add column issuer_address text,
  add column issuer_phone text;

-- Backfilling is a schema-maintenance operation, not a business edit. Avoid
-- changing invoice versions/timestamps and permit snapshots on soft-deleted
-- invoices, whose normal update guard intentionally rejects every mutation.
alter table crm.invoices disable trigger bump_invoice_version;
alter table crm.invoices disable trigger set_updated_at;
alter table crm.invoices disable trigger validate_invoice_update;

update crm.invoices i
set issuer_name = case
      when b.code = 'TUP' then 'DR. KISHOR''S DENTISTRY - TIRUPUR'
      else 'Dr. Kishor''s Dentistry - ' || b.name
    end,
    issuer_address = b.address,
    issuer_phone = b.phone
from crm.branches b
where b.id = i.branch_id;

alter table crm.invoices enable trigger bump_invoice_version;
alter table crm.invoices enable trigger set_updated_at;
alter table crm.invoices enable trigger validate_invoice_update;

alter table crm.invoices
  alter column issuer_name set not null,
  add constraint invoices_issuer_name_length_check
    check (char_length(issuer_name) between 1 and 200),
  add constraint invoices_issuer_address_length_check
    check (issuer_address is null or char_length(issuer_address) <= 1000),
  add constraint invoices_issuer_phone_length_check
    check (issuer_phone is null or char_length(issuer_phone) <= 40);

create function crm.snapshot_invoice_issuer() returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_branch crm.branches%rowtype;
begin
  select *
  into v_branch
  from crm.branches b
  where b.id = new.branch_id;

  if not found then
    raise exception 'branch % not found', new.branch_id
      using errcode = '23503';
  end if;

  new.issuer_name := case
    when v_branch.code = 'TUP' then 'DR. KISHOR''S DENTISTRY - TIRUPUR'
    else 'Dr. Kishor''s Dentistry - ' || v_branch.name
  end;
  new.issuer_address := v_branch.address;
  new.issuer_phone := v_branch.phone;

  return new;
end
$function$;

revoke all on function crm.snapshot_invoice_issuer() from public, anon, authenticated;

create trigger snapshot_invoice_issuer
  before insert on crm.invoices
  for each row execute function crm.snapshot_invoice_issuer();

create function crm.guard_invoice_issuer_snapshot() returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if row(new.issuer_name, new.issuer_address, new.issuer_phone)
     is distinct from
     row(old.issuer_name, old.issuer_address, old.issuer_phone) then
    raise exception 'invoice issuer details are immutable'
      using errcode = '55000';
  end if;

  return new;
end
$function$;

revoke all on function crm.guard_invoice_issuer_snapshot() from public, anon, authenticated;

create trigger guard_invoice_issuer_snapshot
  before update of issuer_name, issuer_address, issuer_phone on crm.invoices
  for each row execute function crm.guard_invoice_issuer_snapshot();
