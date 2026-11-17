-- Reverse the reporting effect of a paid bill without deleting receipts or
-- changing the original charges. No external payment refund is performed.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function crm.void_invoice(
  p_invoice_id uuid, p_actor uuid, p_reason text, p_expected_version bigint, p_archive boolean
) returns crm.invoices
language plpgsql security invoker set search_path = ''
as $function$
declare
  v_old crm.invoices%rowtype;
  v_new crm.invoices%rowtype;
  v_reason text := btrim(coalesce(p_reason,''));
  v_excluded numeric := 0;
begin
  if not exists (select 1 from crm.profiles where id=p_actor and role='admin' and is_active) then
    raise exception 'only an admin can void invoices' using errcode='42501';
  end if;
  if length(v_reason) not between 1 and 1000 or p_archive is null then
    raise exception 'a valid void or archive reason is required' using errcode='22023';
  end if;

  -- Receipts lock the same invoice row before writing. The version check
  -- prevents a concurrent receipt from being reversed based on stale UI.
  select * into v_old from crm.invoices where id=p_invoice_id and deleted_at is null for update;
  if not found then raise exception 'invoice not found' using errcode='P0002'; end if;
  if p_expected_version is distinct from v_old.version then
    raise exception 'invoice changed; refresh before voiding or archiving' using errcode='40001';
  end if;
  if v_old.status='cancelled' and not p_archive then
    raise exception 'invoice is already voided' using errcode='55000';
  end if;
  if v_old.status<>'cancelled' then
    select coalesce(sum(amount), case when v_old.status='paid' then v_old.total else 0 end)
      into v_excluded from crm.invoice_payments where invoice_id=v_old.id;
  end if;

  perform set_config('crm.cancelling_invoice',v_old.id::text,true);
  update crm.invoices set status='cancelled',
    void_reason=case when v_old.status='cancelled' then v_old.void_reason else v_reason end,
    voided_at=case when v_old.status='cancelled' then v_old.voided_at else clock_timestamp() end,
    voided_by=case when v_old.status='cancelled' then v_old.voided_by else p_actor end,
    deleted_at=case when p_archive then clock_timestamp() end,
    deleted_by=case when p_archive then p_actor end,
    delete_reason=case when p_archive then left(v_reason,500) end
    where id=v_old.id returning * into v_new;
  perform set_config('crm.cancelling_invoice','',true);

  insert into crm.audit_log(entity_type,entity_id,action,actor_id,old_data,new_data)
    values('invoice',v_new.id,case when v_old.status='cancelled' then 'archived' else 'cancelled' end,
      p_actor,to_jsonb(v_old),to_jsonb(v_new)||jsonb_build_object('payments_excluded',v_excluded));
  insert into crm.lead_activity(lead_id,actor_id,type,detail)
    values(v_new.lead_id,p_actor,'invoice',jsonb_build_object(
      'event',case when p_archive then 'invoice_archived' else 'invoice_cancelled' end,
      'invoice_id',v_new.id,'invoice_number',v_new.invoice_number,'reason',v_reason,
      'payments_excluded',v_excluded));
  return v_new;
end
$function$;
revoke all on function crm.void_invoice(uuid,uuid,text,bigint,boolean) from public,anon,authenticated;
grant execute on function crm.void_invoice(uuid,uuid,text,bigint,boolean) to service_role;

-- Existing clients keep the original endpoint. A version is required to void
-- an invoice with payments; the legacy no-version call remains unpaid-only.
create or replace function crm.cancel_invoice(
  p_invoice_id uuid,p_actor uuid,p_reason text,p_expected_version bigint default null
) returns crm.invoices
language plpgsql security invoker set search_path = ''
as $function$
declare v_version bigint := p_expected_version;
begin
  if v_version is null then
    if not exists (select 1 from crm.profiles where id=p_actor and role='admin' and is_active) then
      raise exception 'only an admin can void invoices' using errcode='42501';
    end if;
    select i.version into v_version from crm.invoices i
      where i.id=p_invoice_id and i.deleted_at is null and i.status not in ('paid','cancelled')
        and not exists(select 1 from crm.invoice_payments p where p.invoice_id=i.id);
    if v_version is null then
      raise exception 'refresh to void this invoice using its current version' using errcode='55000';
    end if;
  end if;
  return crm.void_invoice(p_invoice_id,p_actor,p_reason,v_version,false);
end
$function$;

create or replace function crm.prevent_paid_invoice_delete_with_receipts() returns trigger
language plpgsql set search_path = ''
as $function$
begin
  if new.deleted_at is distinct from old.deleted_at and new.deleted_at is not null
     and (old.status in ('paid','cancelled') or old.paid_at is not null
       or exists (select 1 from crm.invoice_payments p where p.invoice_id=old.id))
     and (new.status<>'cancelled' or current_setting('crm.cancelling_invoice',true) is distinct from old.id::text
       or not exists (select 1 from crm.profiles where id=new.deleted_by and role='admin' and is_active)) then
    raise exception 'use the admin void workflow to archive a paid or voided invoice' using errcode='55000';
  end if;
  return new;
end
$function$;

create or replace function crm.guard_invoice_item_mutation() returns trigger
language plpgsql set search_path = ''
as $function$
declare
  v_invoice_id uuid := case when tg_op='DELETE' then old.invoice_id else new.invoice_id end;
  v_status crm.invoice_status;
  v_deleted_at timestamptz;
begin
  select i.status,i.deleted_at into v_status,v_deleted_at from crm.invoices i where i.id=v_invoice_id;
  if not found then
    if tg_op='DELETE' and current_setting('crm.allow_hard_delete',true)='on' then return old; end if;
    raise exception 'invoice % not found',v_invoice_id using errcode='23503';
  end if;
  -- A parent void/archival may only release the active billing link. Amounts,
  -- codes, notes and every other property of historical lines stay immutable.
  if tg_op='UPDATE' and pg_trigger_depth()>1
     and current_setting('crm.archiving_invoice',true)=v_invoice_id::text then
    if not new.active_billing and
       (to_jsonb(new)-'active_billing')=(to_jsonb(old)-'active_billing') then return new; end if;
    raise exception 'archiving may only clear active billing on invoice items' using errcode='55000';
  end if;
  if current_setting('crm.allow_hard_delete',true) is distinct from 'on'
     and (v_status in ('paid','cancelled') or v_deleted_at is not null) then
    raise exception 'items of a paid, voided or deleted invoice are immutable' using errcode='55000';
  end if;
  return case when tg_op='DELETE' then old else new end;
end
$function$;

do $migration$
declare
  v_rpc regprocedure;
  v_body text;
  v_anchor text;
  v_transition constant text := 'when ''paid'' then new.status=''sent''';
  v_reject constant text := 'if new.status=''cancelled'' and (current_setting(''crm.cancelling_invoice'',true) is distinct from old.id::text';
  v_receipt_test constant text := 'or exists(select 1 from crm.invoice_payments where invoice_id=old.id)) then';
begin
  v_body := pg_get_functiondef('crm.validate_invoice_update()'::regprocedure);
  if array_length(string_to_array(v_body,v_transition),1) is distinct from 2
     or array_length(string_to_array(v_body,v_reject),1) is distinct from 2
     or array_length(string_to_array(v_body,v_receipt_test),1) is distinct from 2
     or strpos(v_body,v_reject || E'\n      ' || v_receipt_test)=0 then
    raise exception 'unexpected invoice update guard definition';
  end if;
  v_body := replace(v_body,'use the admin cancellation workflow for an unpaid invoice','use the admin void workflow');
  execute replace(replace(v_body,v_transition,'when ''paid'' then new.status=''cancelled'' or new.status=''sent'''),
    v_reject || E'\n      ' || v_receipt_test,
    v_reject || E'\n      or new.voided_at is null or nullif(btrim(new.void_reason),'''') is null\n' ||
    '      or not exists(select 1 from crm.profiles where id=new.voided_by and role=''admin'' and is_active)) then');

  -- Readiness governs issuing/collecting, not revoking a bad invoice.
  v_body := pg_get_functiondef('crm.protect_invoice_code_enforcement()'::regprocedure);
  v_anchor := 'new.status is distinct from old.status and new.code_enforced then';
  if array_length(string_to_array(v_body,v_anchor),1) is distinct from 2 then
    raise exception 'unexpected code enforcement guard definition';
  end if;
  execute replace(v_body,v_anchor,'new.status is distinct from old.status and new.status<>''cancelled'' and new.code_enforced then');

  -- Reject voided invoices before considering their retained receipt amounts.
  v_body := pg_get_functiondef('crm.record_invoice_payment(uuid,numeric,crm.invoice_payment_method,text,text,uuid)'::regprocedure);
  v_anchor := '  if v_invoice.status = ''paid'' then';
  if array_length(string_to_array(v_body,v_anchor),1) is distinct from 2 then
    raise exception 'unexpected single receipt workflow definition';
  end if;
  v_body := replace(v_body,v_anchor,$guard$  if v_invoice.status = 'cancelled' then
    raise exception 'voided invoices cannot accept payments' using errcode='55000';
  end if;
$guard$ || v_anchor);
  v_anchor := '  if v_invoice.status = ''draft'' then';
  if array_length(string_to_array(v_body,v_anchor),1) is distinct from 2 then
    raise exception 'unexpected single receipt status transition';
  end if;
  -- A partial receipt on an already-sent invoice must also invalidate a
  -- concurrently opened void confirmation, even though the status is unchanged.
  execute replace(v_body,v_anchor,
    '  if v_invoice.status = ''draft'' or (v_invoice.status = ''sent'' and v_paid < v_invoice.total) then');

  foreach v_rpc in array array[
    'crm.get_daily_payment_collections(uuid,timestamptz,timestamptz)'::regprocedure,
    'crm.get_report_collections(uuid,timestamptz,timestamptz,uuid)'::regprocedure,
    'crm.get_report_payment_collections(uuid,timestamptz,timestamptz,uuid)'::regprocedure
  ] loop
    v_body := pg_get_functiondef(v_rpc);
    v_anchor := 'and i.deleted_at is null';
    if array_length(string_to_array(v_body,v_anchor),1) is distinct from 2 then
      raise exception 'unexpected collection query definition: %', v_rpc;
    end if;
    execute replace(v_body,v_anchor,v_anchor || ' and i.status<>''cancelled''');
  end loop;

  v_body := pg_get_functiondef('crm.get_invoice_patient_balance(uuid,uuid)'::regprocedure);
  v_anchor := 'case when i.status=''paid'' and receipts.receipt_count=0 then i.total else receipts.received end as received';
  if array_length(string_to_array(v_body,v_anchor),1) is distinct from 2 then
    raise exception 'unexpected invoice balance query definition';
  end if;
  execute replace(v_body,v_anchor,
    'case when i.status=''cancelled'' then 0 when i.status=''paid'' and receipts.receipt_count=0 then i.total else receipts.received end as received');
end
$migration$;

notify pgrst,'reload schema';
