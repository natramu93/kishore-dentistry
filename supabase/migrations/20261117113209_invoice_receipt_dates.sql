-- The effective receipt day is derived from received_at (clinic time). Keep
-- created_at and the date originally sent with a split request for audit/retry.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table crm.invoice_payments add column initial_receipt_date date;
comment on column crm.invoice_payments.initial_receipt_date is
  'The date supplied when a split receipt was created; retained for idempotent retries after a date correction.';
grant update(received_at) on crm.invoice_payments to service_role;

create or replace function crm.guard_invoice_receipt_update() returns trigger
language plpgsql set search_path='' as $function$
begin
  if current_setting('crm.updating_invoice_payment',true) is distinct from old.id::text then
    raise exception 'use the audited receipt correction workflow' using errcode='55000';
  end if;
  if (to_jsonb(new)-array['amount','payment_method','reference','version','received_at'])
      is distinct from (to_jsonb(old)-array['amount','payment_method','reference','version','received_at'])
    or new.version<>old.version+1 then
    raise exception 'receipt identity and history are immutable' using errcode='55000';
  end if;
  if new.received_at is distinct from old.received_at and not exists (
    select 1 from crm.profiles
    where id=nullif(current_setting('crm.receipt_date_editor',true),'')::uuid and role='admin' and is_active
  ) then
    raise exception 'only an admin can correct the receipt date' using errcode='42501';
  end if;
  return new;
end
$function$;

-- Extend the established locked, audited workflows instead of duplicating
-- payment, balance, and split-retry logic across two public signatures.
do $migration$
declare
  v_body text;
  v_anchor text;
  v_valid_date constant text := $validation$
  if p_receipt_date is not null and
     (p_receipt_date < date '0001-01-01' or p_receipt_date > (now() at time zone 'Asia/Kolkata')::date) then
    raise exception 'receipt date must be a valid date on or before today' using errcode='22023';
  end if;
$validation$;
begin
  select prosrc into strict v_body from pg_catalog.pg_proc
    where oid='crm.record_invoice_payment_batch(uuid,jsonb,uuid,uuid)'::regprocedure;
  v_anchor := '  select * into v_invoice';
  if array_length(string_to_array(v_body,v_anchor),1) is distinct from 2 then
    raise exception 'unexpected receipt batch validation anchor';
  end if;
  v_body := replace(v_body,v_anchor,v_valid_date || v_anchor);

  v_anchor := 'if v_existing is distinct from v_clean then';
  if array_length(string_to_array(v_body,v_anchor),1) is distinct from 2 then
    raise exception 'unexpected receipt retry anchor';
  end if;
  v_body := replace(v_body,v_anchor,$retry$if v_existing is distinct from v_clean or exists(
      select 1 from crm.invoice_payments where batch_key=p_request_key and invoice_id=p_invoice_id
        and initial_receipt_date is distinct from p_receipt_date
    ) then$retry$);

  v_anchor := 'created_by,batch_key,batch_line)';
  if array_length(string_to_array(v_body,v_anchor),1) is distinct from 2 then
    raise exception 'unexpected receipt batch insert columns';
  end if;
  v_body := replace(v_body,v_anchor,'created_by,batch_key,batch_line,received_at,initial_receipt_date)');
  v_anchor := 'p_actor,p_request_key,v_line) returning';
  if array_length(string_to_array(v_body,v_anchor),1) is distinct from 2 then
    raise exception 'unexpected receipt batch insert values';
  end if;
  v_body := replace(v_body,v_anchor,$create_date$p_actor,p_request_key,v_line,
        case when p_receipt_date < (now() at time zone 'Asia/Kolkata')::date
          then p_receipt_date::timestamp at time zone 'Asia/Kolkata' else now() end,
        p_receipt_date) returning$create_date$);

  execute format($new$create function crm.record_invoice_payment_batch_with_date(
    p_invoice_id uuid,p_receipts jsonb,p_request_key uuid,p_actor uuid,p_receipt_date date
  ) returns setof crm.invoice_payments language plpgsql security invoker set search_path='' as %L$new$,v_body);

  select prosrc into strict v_body from pg_catalog.pg_proc
    where oid='crm.update_invoice_payment(uuid,uuid,numeric,crm.invoice_payment_method,text,text,bigint,uuid)'::regprocedure;
  v_anchor := '  select * into v_invoice';
  if array_length(string_to_array(v_body,v_anchor),1) is distinct from 2 then
    raise exception 'unexpected receipt edit validation anchor';
  end if;
  v_body := replace(v_body,v_anchor,$authorize$
  if p_receipt_date is not null and not exists (
    select 1 from crm.profiles where id=p_actor and role='admin' and is_active
  ) then
    raise exception 'only an admin can correct the receipt date' using errcode='42501';
  end if;
$authorize$ || v_valid_date || v_anchor);

  v_anchor := '  update crm.invoice_payments set amount=p_amount,payment_method=p_method,reference=nullif(btrim(p_reference),''''),version=version+1';
  if array_length(string_to_array(v_body,v_anchor),1) is distinct from 2 then
    raise exception 'unexpected receipt correction update anchor';
  end if;
  v_body := replace(v_body,v_anchor,$edit_date$  perform set_config('crm.receipt_date_editor',case when p_receipt_date is not null then p_actor::text else '' end,true);
  update crm.invoice_payments set amount=p_amount,payment_method=p_method,reference=nullif(btrim(p_reference),''),version=version+1,
    received_at=case when p_receipt_date is null or p_receipt_date=(v_old.received_at at time zone 'Asia/Kolkata')::date
      then v_old.received_at
      else (p_receipt_date+(v_old.received_at at time zone 'Asia/Kolkata')::time) at time zone 'Asia/Kolkata' end$edit_date$);

  v_anchor := '  perform set_config(''crm.updating_invoice_payment'','''',true);';
  if array_length(string_to_array(v_body,v_anchor),1) is distinct from 2 then
    raise exception 'unexpected receipt correction reset anchor';
  end if;
  v_body := replace(v_body,v_anchor,
    v_anchor || E'\n  perform set_config(''crm.receipt_date_editor'','''',true);');

  v_anchor := '''reason'',btrim(p_reason),''outstanding'',v_invoice.total-v_paid';
  if array_length(string_to_array(v_body,v_anchor),1) is distinct from 2 then
    raise exception 'unexpected receipt correction history anchor';
  end if;
  v_body := replace(v_body,v_anchor,$history$
      'old_receipt_date',(v_old.received_at at time zone 'Asia/Kolkata')::date,
      'receipt_date',(v_new.received_at at time zone 'Asia/Kolkata')::date,
      $history$ || v_anchor);
  execute format($new$create function crm.update_invoice_payment_with_date(
    p_invoice_id uuid,p_payment_id uuid,p_amount numeric,p_method crm.invoice_payment_method,
    p_reference text,p_reason text,p_expected_version bigint,p_actor uuid,p_receipt_date date
  ) returns crm.invoice_payments language plpgsql security invoker set search_path='' as %L$new$,v_body);
end
$migration$;

revoke all on function crm.record_invoice_payment_batch_with_date(uuid,jsonb,uuid,uuid,date),
  crm.update_invoice_payment_with_date(uuid,uuid,numeric,crm.invoice_payment_method,text,text,bigint,uuid,date)
  from public,anon,authenticated;
grant execute on function crm.record_invoice_payment_batch_with_date(uuid,jsonb,uuid,uuid,date),
  crm.update_invoice_payment_with_date(uuid,uuid,numeric,crm.invoice_payment_method,text,text,bigint,uuid,date)
  to service_role;

create or replace function crm.record_invoice_payment_batch(
  p_invoice_id uuid,p_receipts jsonb,p_request_key uuid,p_actor uuid
) returns setof crm.invoice_payments language sql security invoker set search_path='' as $function$
  select * from crm.record_invoice_payment_batch_with_date(p_invoice_id,p_receipts,p_request_key,p_actor,null::date);
$function$;

create or replace function crm.update_invoice_payment(
  p_invoice_id uuid,p_payment_id uuid,p_amount numeric,p_method crm.invoice_payment_method,
  p_reference text,p_reason text,p_expected_version bigint,p_actor uuid
) returns crm.invoice_payments language sql security invoker set search_path='' as $function$
  select * from crm.update_invoice_payment_with_date(
    p_invoice_id,p_payment_id,p_amount,p_method,p_reference,p_reason,p_expected_version,p_actor,null::date);
$function$;

notify pgrst,'reload schema';
