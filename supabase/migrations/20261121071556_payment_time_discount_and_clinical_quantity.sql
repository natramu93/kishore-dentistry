-- Discounts and receipts are one transaction. Discounts never become revenue.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table crm.invoice_payment_discounts (
  request_key uuid primary key,
  invoice_id uuid not null references crm.invoices(id) on delete restrict,
  actor_id uuid not null references crm.profiles(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  given_by text not null check (char_length(given_by) between 1 and 200),
  reason text not null check (char_length(reason) between 1 and 1000),
  request_payload jsonb not null,
  created_at timestamptz not null default now()
);
create index invoice_payment_discounts_invoice_idx on crm.invoice_payment_discounts(invoice_id);
alter table crm.invoice_payment_discounts enable row level security;
revoke all on crm.invoice_payment_discounts from public, anon, authenticated;
grant select, insert on crm.invoice_payment_discounts to service_role;
create trigger protect_payment_discount_log before update or delete on crm.invoice_payment_discounts
  for each row execute function crm.protect_audit_log();

alter table crm.invoices drop constraint invoices_opening_balance_identity_check,
  add constraint invoices_opening_balance_identity_check check (
    (invoice_kind <> 'opening_balance' and legacy_patient_ref is null) or
    (invoice_kind = 'opening_balance' and legacy_patient_ref is not null and not code_enforced
     and invoice_date is not null and treatment_id is null and total = subtotal-discount_amount
     and discount_amount between 0 and subtotal and tax_rate = 0 and tax_amount = 0));

create or replace function crm.guard_opening_balance_identity() returns trigger
language plpgsql set search_path = '' as $function$
begin
  if tg_op = 'INSERT' then
    if new.invoice_kind = 'opening_balance'
       and current_setting('crm.importing_opening_balance', true) is distinct from 'on' then
      raise exception 'use the opening balance import' using errcode = '55000';
    end if;
  elsif (new.invoice_kind,new.legacy_patient_ref) is distinct from (old.invoice_kind,old.legacy_patient_ref)
     or (old.invoice_kind = 'opening_balance' and (
       (new.invoice_date,new.subtotal) is distinct from (old.invoice_date,old.subtotal)
       or ((new.total,new.discount_amount) is distinct from (old.total,old.discount_amount)
           and current_setting('crm.applying_payment_discount',true) is distinct from old.id::text))) then
    raise exception 'opening balance identity and amount are immutable' using errcode = '55000';
  end if;
  return new;
end
$function$;

create function crm.record_invoice_payment_with_discount(
  p_invoice_id uuid, p_receipts jsonb, p_request_key uuid, p_actor uuid,
  p_receipt_date date, p_discount numeric, p_given_by text, p_reason text, p_expected_version bigint
) returns jsonb language plpgsql security invoker set search_path='' as $function$
declare
  v_old crm.invoices%rowtype;
  v_new crm.invoices%rowtype;
  v_previous crm.invoice_payment_discounts%rowtype;
  v_payload jsonb;
  v_paid numeric;
  v_discount numeric;
  v_tax numeric;
  v_total numeric;
  v_edit_flag text := current_setting('crm.editing_invoice_charges',true);
  v_discount_flag text := current_setting('crm.applying_payment_discount',true);
begin
  if p_request_key is null or p_discount is null or p_discount <= 0 or p_discount > 9999999999.99
     or p_discount <> round(p_discount,2) or nullif(btrim(p_given_by),'') is null
     or char_length(btrim(p_given_by))>200 or nullif(btrim(p_reason),'') is null
     or char_length(btrim(p_reason))>1000 or jsonb_typeof(p_receipts) is distinct from 'array'
     or jsonb_array_length(p_receipts)>10 or p_expected_version is null then
    raise exception 'invalid payment discount details' using errcode='22023';
  end if;
  if p_receipt_date is null or not isfinite(p_receipt_date)
     or p_receipt_date < date '0001-01-01' or p_receipt_date>(now() at time zone 'Asia/Kolkata')::date then
    raise exception 'receipt date must be on or before today' using errcode='22023';
  end if;
  -- Same key across invoices cannot race. The invoice lock serializes other receipts/edits.
  perform pg_advisory_xact_lock(hashtextextended(p_request_key::text,0));
  select * into v_old from crm.invoices where id=p_invoice_id for update;
  if not found or v_old.deleted_at is not null then raise exception 'invoice not found' using errcode='P0002'; end if;
  perform crm.assert_invoice_write_access(p_actor,v_old.lead_id,false);
  v_payload := jsonb_build_object('receipts',p_receipts,'receipt_date',p_receipt_date,
    'discount',p_discount,'given_by',btrim(p_given_by),'reason',btrim(p_reason),'version',p_expected_version);
  select * into v_previous from crm.invoice_payment_discounts where request_key=p_request_key;
  if found then
    if v_previous.invoice_id<>p_invoice_id or v_previous.actor_id<>p_actor
       or v_previous.request_payload is distinct from v_payload then
      raise exception 'payment request was already used with different details' using errcode='22023';
    end if;
    return jsonb_build_object('invoice_id',p_invoice_id,'already_saved',true);
  end if;
  if exists(select 1 from crm.invoice_payments where batch_key=p_request_key) then
    raise exception 'payment request was already used' using errcode='22023';
  end if;
  if v_old.status in ('paid','cancelled') or (not v_old.code_enforced and v_old.invoice_kind not in ('consultation','opening_balance')) then
    raise exception 'this invoice cannot accept a payment discount' using errcode='55000';
  end if;
  if v_old.version<>p_expected_version then raise exception 'invoice was changed; refresh and try again' using errcode='40001'; end if;
  v_discount := v_old.discount_amount+p_discount;
  if v_discount>v_old.subtotal then raise exception 'discount cannot exceed the invoice subtotal' using errcode='22023'; end if;
  v_tax := round((v_old.subtotal-v_discount)*v_old.tax_rate/100,2);
  v_total := v_old.subtotal-v_discount+v_tax;
  select coalesce(sum(amount),0) into v_paid from crm.invoice_payments where invoice_id=p_invoice_id;
  if v_total<v_paid then raise exception 'discount cannot reduce the total below payments already received' using errcode='22023'; end if;
  perform set_config('crm.editing_invoice_charges',p_invoice_id::text,true);
  perform set_config('crm.applying_payment_discount',p_invoice_id::text,true);
  update crm.invoices set discount_amount=v_discount, tax_amount=v_tax, total=v_total,
    discount_given_by=case when nullif(btrim(discount_given_by),'') is null then btrim(p_given_by)
      when discount_given_by=btrim(p_given_by) then discount_given_by else left(discount_given_by || '; ' || btrim(p_given_by),200) end,
    status=case when v_total=v_paid then 'paid'::crm.invoice_status else status end
    where id=p_invoice_id returning * into v_new;
  if jsonb_array_length(p_receipts)>0 then
    -- Any invalid receipt rolls back the header change as well.
    perform * from crm.record_invoice_payment_batch_with_date(p_invoice_id,p_receipts,p_request_key,p_actor,p_receipt_date);
  end if;
  select * into strict v_new from crm.invoices where id=p_invoice_id;
  insert into crm.invoice_payment_discounts(request_key,invoice_id,actor_id,amount,given_by,reason,request_payload)
    values(p_request_key,p_invoice_id,p_actor,p_discount,btrim(p_given_by),btrim(p_reason),v_payload);
  insert into crm.audit_log(entity_type,entity_id,action,actor_id,old_data,new_data)
    values('invoice',p_invoice_id,'payment_discount',p_actor,to_jsonb(v_old),
      to_jsonb(v_new)||jsonb_build_object('discount_reason',btrim(p_reason),'request_key',p_request_key));
  perform set_config('crm.editing_invoice_charges',coalesce(v_edit_flag,''),true);
  perform set_config('crm.applying_payment_discount',coalesce(v_discount_flag,''),true);
  return jsonb_build_object('invoice_id',p_invoice_id,'already_saved',false);
end
$function$;
revoke all on function crm.record_invoice_payment_with_discount(uuid,jsonb,uuid,uuid,date,numeric,text,text,bigint)
  from public,anon,authenticated;
grant execute on function crm.record_invoice_payment_with_discount(uuid,jsonb,uuid,uuid,date,numeric,text,text,bigint) to service_role;

-- Preserve each submitted treatment as ONE record. Quantity counts its selected teeth;
-- general care is one unit. Never rewrite already invoiced historical treatments.
do $migration$
declare v_def text; v_anchor text;
begin
  v_def := pg_get_functiondef('crm.finalize_case_sheet(uuid,uuid,uuid,timestamptz,text,text,text,text,text,jsonb,uuid)'::regprocedure);
  v_anchor := 'v_quantity := (v_item->>''quantity'')::numeric;';
  if array_length(string_to_array(v_def,v_anchor),1) is distinct from 2 then raise exception 'unexpected clinical quantity anchor'; end if;
  execute replace(v_def,v_anchor,'v_quantity := greatest(1,jsonb_array_length(coalesce(v_item->''tooth_numbers'',''[]''::jsonb)));');
  v_def := pg_get_functiondef('crm.amend_clinical_visit(uuid,integer,text,text,text,text,text,text,boolean,text[],text,jsonb,jsonb,jsonb,uuid)'::regprocedure);
  v_anchor := 'v_sheet.diagnosis, 1, 0, nullif(btrim(v_item->>''notes''), ''''),';
  if array_length(string_to_array(v_def,v_anchor),1) is distinct from 2 then raise exception 'unexpected amended insert quantity'; end if;
  v_def := replace(v_def,v_anchor,'v_sheet.diagnosis, greatest(1,cardinality(v_tooth_numbers)), 0, nullif(btrim(v_item->>''notes''), ''''),');
  v_anchor := 'tooth_numbers = v_tooth_numbers,';
  if array_length(string_to_array(v_def,v_anchor),1) is distinct from 2 then raise exception 'unexpected amended update quantity'; end if;
  execute replace(v_def,v_anchor,v_anchor || ' quantity = greatest(1,cardinality(v_tooth_numbers)),');
end
$migration$;

notify pgrst,'reload schema';
