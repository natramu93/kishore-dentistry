-- Record each receipt separately so invoices support accurate split payments.
alter table crm.branches
  add column company_name text,
  add column invoice_email text,
  add column gst_number text,
  add constraint branches_company_name_length_check
    check (company_name is null or char_length(company_name) between 1 and 200),
  add constraint branches_invoice_email_length_check
    check (invoice_email is null or char_length(invoice_email) <= 254),
  add constraint branches_gst_number_length_check
    check (gst_number is null or char_length(gst_number) <= 32);

update crm.branches
set company_name = 'Dr. KISHOR''S DENTISTRY PVT LTD.,',
    address = 'No. 541, 543/338-34, Tirupur Aadhar Hospital 1st Floor, Opp to KR Bakes, Avinashi Road, Tirupur - 641 602.',
    phone = '+91 93611 35459',
    invoice_email = 'drkishorsdentistry@gmail.com',
    gst_number = '33AAKCD3028Q1ZD',
    updated_at = now()
where code = 'TUP';

alter table crm.invoices
  add column issuer_email text,
  add column issuer_gst_number text,
  add constraint invoices_issuer_email_length_check
    check (issuer_email is null or char_length(issuer_email) <= 254),
  add constraint invoices_issuer_gst_number_length_check
    check (issuer_gst_number is null or char_length(issuer_gst_number) <= 32);

create or replace function crm.snapshot_invoice_issuer() returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_branch crm.branches%rowtype;
begin
  select * into v_branch
  from crm.branches b
  where b.id = new.branch_id;

  if not found then
    raise exception 'branch % not found', new.branch_id
      using errcode = '23503';
  end if;

  new.issuer_name := coalesce(
    nullif(btrim(v_branch.company_name), ''),
    case when v_branch.code = 'TUP'
      then 'DR. KISHOR''S DENTISTRY - TIRUPUR'
      else 'Dr. Kishor''s Dentistry - ' || v_branch.name end
  );
  new.issuer_address := v_branch.address;
  new.issuer_phone := v_branch.phone;
  new.issuer_email := v_branch.invoice_email;
  new.issuer_gst_number := v_branch.gst_number;
  return new;
end
$function$;

create or replace function crm.guard_invoice_issuer_snapshot() returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if row(new.issuer_name, new.issuer_address, new.issuer_phone, new.issuer_email, new.issuer_gst_number)
     is distinct from
     row(old.issuer_name, old.issuer_address, old.issuer_phone, old.issuer_email, old.issuer_gst_number) then
    raise exception 'invoice issuer details are immutable'
      using errcode = '55000';
  end if;
  return new;
end
$function$;

create type crm.invoice_payment_method as enum ('upi', 'cash', 'card', 'neft');

create table crm.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references crm.invoices(id),
  amount numeric(12,2) not null check (amount > 0),
  payment_method crm.invoice_payment_method not null,
  reference text check (reference is null or char_length(reference) <= 120),
  notes text check (notes is null or char_length(notes) <= 1000),
  received_at timestamptz not null default now(),
  created_by uuid references crm.profiles(id),
  created_at timestamptz not null default now()
);
create index invoice_payments_invoice_received_idx
  on crm.invoice_payments (invoice_id, received_at desc);
create index if not exists invoice_payments_created_by_idx
  on crm.invoice_payments (created_by);
alter table crm.invoice_payments enable row level security;
revoke all on table crm.invoice_payments from public, anon, authenticated;
grant select, insert on table crm.invoice_payments to service_role;
revoke update, delete on table crm.invoice_payments from service_role;

create function crm.record_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_method crm.invoice_payment_method,
  p_reference text,
  p_notes text,
  p_actor uuid
) returns crm.invoice_payments
language plpgsql
set search_path = ''
as $function$
declare
  v_invoice crm.invoices%rowtype;
  v_payment crm.invoice_payments%rowtype;
  v_paid numeric(12,2);
begin
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'payment amount must be positive and have at most two decimals'
      using errcode = '22023';
  end if;
  if p_reference is not null and char_length(btrim(p_reference)) > 120 then
    raise exception 'payment reference is too long' using errcode = '22023';
  end if;
  if p_notes is not null and char_length(btrim(p_notes)) > 1000 then
    raise exception 'payment notes are too long' using errcode = '22023';
  end if;

  select * into v_invoice
  from crm.invoices i
  where i.id = p_invoice_id
  for update;
  if not found or v_invoice.deleted_at is not null then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;
  perform crm.assert_invoice_write_access(p_actor, v_invoice.lead_id, false);
  if not v_invoice.code_enforced and v_invoice.invoice_kind <> 'consultation' then
    raise exception 'legacy uncoded invoices cannot accept payments'
      using errcode = '55000';
  end if;
  if v_invoice.status = 'paid' then
    raise exception 'invoice is already paid' using errcode = '55000';
  end if;

  select coalesce(sum(ip.amount), 0) into v_paid
  from crm.invoice_payments ip
  where ip.invoice_id = v_invoice.id;
  if p_amount > v_invoice.total - v_paid then
    raise exception 'payment exceeds the outstanding invoice balance'
      using errcode = '22023';
  end if;

  insert into crm.invoice_payments(invoice_id, amount, payment_method, reference, notes, created_by)
  values (v_invoice.id, p_amount, p_method, nullif(btrim(p_reference), ''), nullif(btrim(p_notes), ''), p_actor)
  returning * into v_payment;

  v_paid := v_paid + p_amount;
  if v_invoice.status = 'draft' then
    update crm.invoices set status = 'sent' where id = v_invoice.id;
  end if;
  if v_paid >= v_invoice.total then
    update crm.invoices set status = 'paid' where id = v_invoice.id;
  end if;

  insert into crm.lead_activity (lead_id, actor_id, type, detail)
  values (
    v_invoice.lead_id,
    p_actor,
    'invoice',
    jsonb_build_object(
      'event', 'invoice_payment_recorded',
      'invoice_id', v_invoice.id,
      'invoice_number', v_invoice.invoice_number,
      'payment_id', v_payment.id,
      'amount', v_payment.amount,
      'method', v_payment.payment_method,
      'outstanding', v_invoice.total - v_paid
    )
  );
  insert into crm.audit_log(entity_type, entity_id, action, actor_id, new_data)
  values ('invoice_payment', v_payment.id, 'created', p_actor, to_jsonb(v_payment));
  return v_payment;
end
$function$;

revoke all on function crm.record_invoice_payment(uuid, numeric, crm.invoice_payment_method, text, text, uuid)
  from public, anon, authenticated;
grant execute on function crm.record_invoice_payment(uuid, numeric, crm.invoice_payment_method, text, text, uuid)
  to service_role;

create or replace function crm.transition_invoice_status(
  p_invoice_id uuid,
  p_to crm.invoice_status,
  p_actor uuid,
  p_expected_version bigint default null
) returns crm.invoices
language plpgsql
set search_path = ''
as $function$
declare
  v_old crm.invoices%rowtype;
  v_invoice crm.invoices%rowtype;
  v_paid numeric(12,2);
begin
  select * into v_old from crm.invoices i where i.id = p_invoice_id for update;
  if not found then
    raise exception 'invoice % not found', p_invoice_id using errcode = 'P0002';
  end if;
  if v_old.deleted_at is not null then
    raise exception 'invoice % is deleted', p_invoice_id using errcode = '55000';
  end if;
  perform crm.assert_invoice_write_access(p_actor, v_old.lead_id, false);
  if p_expected_version is not null and p_expected_version <> v_old.version then
    raise exception 'invoice % was modified by another request', p_invoice_id using errcode = '40001';
  end if;
  if v_old.status = p_to then return v_old; end if;
  if p_to = 'paid' then
    select coalesce(sum(ip.amount), 0) into v_paid
    from crm.invoice_payments ip where ip.invoice_id = v_old.id;
    if v_paid < v_old.total then
      raise exception 'record the full invoice payment before marking it paid' using errcode = '23514';
    end if;
  end if;
  update crm.invoices set status = p_to where id = p_invoice_id returning * into v_invoice;
  insert into crm.lead_activity (lead_id, actor_id, type, detail)
  values (v_invoice.lead_id, p_actor, 'invoice', jsonb_build_object(
    'event', 'invoice_status_changed', 'invoice_id', v_invoice.id,
    'invoice_number', v_invoice.invoice_number, 'from_status', v_old.status,
    'to_status', v_invoice.status
  ));
  insert into crm.audit_log(entity_type, entity_id, action, actor_id, old_data, new_data)
  values ('invoice', v_invoice.id, 'status_changed', p_actor, to_jsonb(v_old), to_jsonb(v_invoice));
  return v_invoice;
end
$function$;

create function crm.prevent_paid_invoice_delete_with_receipts() returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.deleted_at is distinct from old.deleted_at
     and new.deleted_at is not null
     and exists (select 1 from crm.invoice_payments p where p.invoice_id = old.id) then
    raise exception 'an invoice with recorded payments cannot be archived'
      using errcode = '55000';
  end if;
  return new;
end
$function$;
revoke all on function crm.prevent_paid_invoice_delete_with_receipts() from public, anon, authenticated;
create trigger prevent_paid_invoice_delete_with_receipts
  before update of deleted_at on crm.invoices
  for each row execute function crm.prevent_paid_invoice_delete_with_receipts();
