begin;
select '1..1';

do $test$
declare
  v_admin uuid := 'c3100000-0000-4000-8000-000000000001';
  v_ops uuid := 'c3100000-0000-4000-8000-000000000002';
  v_branch uuid;
  v_lead uuid;
  v_start timestamptz := date_trunc('day',now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  v_end timestamptz := v_start + interval '1 day';
  v_paid crm.invoices%rowtype;
  v_paid_direct crm.invoices%rowtype;
  v_partial crm.invoices%rowtype;
  v_unaffected crm.invoices%rowtype;
  v_legacy crm.invoices%rowtype;
  v_voided crm.invoices%rowtype;
  v_receipts jsonb;
  v_totals record;
  v_stale_version bigint;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (v_admin,'paid-void-admin@example.test','{"full_name":"Paid Void Admin"}'),
    (v_ops,'paid-void-ops@example.test','{"full_name":"Paid Void Operations"}');
  update crm.profiles set role='admin',is_active=true where id=v_admin;
  update crm.profiles set role='operations',is_active=true where id=v_ops;
  insert into crm.branches(name,code) values('Paid Void Center','I31') returning id into v_branch;
  insert into crm.user_branches(user_id,branch_id) values(v_ops,v_branch);
  insert into crm.leads(branch_id,name,mobile,status,created_by)
    values(v_branch,'Paid Void Patient','9000000031','open',v_admin) returning id into v_lead;

  execute 'set local role service_role';
  select * into v_paid from crm.create_consultation_invoice(v_lead,100,'Original notes',v_admin,'Dr. Test','Self');
  perform crm.record_invoice_payment(v_paid.id,60,'upi','split upi',null,v_admin);
  perform crm.record_invoice_payment(v_paid.id,40,'cash','split cash',null,v_admin);
  select * into v_paid from crm.invoices where id=v_paid.id;
  if v_paid.status<>'paid' then raise exception 'fixture must be fully paid'; end if;
  select jsonb_agg(to_jsonb(p) order by p.id) into v_receipts from crm.invoice_payments p where p.invoice_id=v_paid.id;

  select * into v_partial from crm.create_consultation_invoice(v_lead,200,null,v_admin,'Dr. Test','Self');
  perform crm.record_invoice_payment(v_partial.id,15,'card','partial card',null,v_admin);
  select version into v_stale_version from crm.invoices where id=v_partial.id;
  perform crm.record_invoice_payment(v_partial.id,10,'card','second partial receipt',null,v_admin);
  select * into v_partial from crm.invoices where id=v_partial.id;
  begin
    perform crm.void_invoice(v_partial.id,v_admin,'Stale partial balance',v_stale_version,false);
    raise exception 'a second partial receipt did not invalidate the void confirmation';
  exception when serialization_failure then null;
  end;
  select * into v_unaffected from crm.create_consultation_invoice(v_lead,50,null,v_admin,'Dr. Test','Self');
  perform crm.record_invoice_payment(v_unaffected.id,20,'neft','unrelated receipt',null,v_admin);

  if (select sum(amount) from crm.get_report_collections(v_admin,v_start,v_end,v_branch)) is distinct from 145::numeric
     or (crm.get_report_invoice_values(v_admin,v_start,v_end,v_branch,null)->>'subtotal')::numeric is distinct from 350::numeric then
    raise exception 'fixtures did not appear in collections and billings before void';
  end if;
  begin
    perform crm.void_invoice(v_paid.id,v_ops,'Wrong invoice',v_paid.version,true);
    raise exception 'operations archived a paid bill';
  exception when insufficient_privilege then null;
  end;
  begin
    perform crm.void_invoice(v_paid.id,v_admin,'Wrong invoice',v_paid.version-1,false);
    raise exception 'stale version accepted for paid void';
  exception when serialization_failure then null;
  end;
  begin
    update crm.invoices set status='cancelled' where id=v_paid.id;
    raise exception 'direct cancellation without the admin workflow accepted';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    perform crm.update_invoice_with_date(v_paid.id,0,null,'[{"description":"Consultation","quantity":1,"unit_price":10}]',
      v_admin,v_paid.version,null,null,null, date '2026-11-01');
    raise exception 'paid invoice edit accepted';
  exception when object_not_in_prerequisite_state then null;
  end;

  select * into v_voided from crm.void_invoice(v_paid.id,v_admin,'Wrong paid invoice',v_paid.version,false);
  if v_voided.status<>'cancelled' or v_voided.deleted_at is not null or v_voided.voided_by is distinct from v_admin
     or v_voided.paid_at is distinct from v_paid.paid_at or v_voided.total is distinct from v_paid.total
     or v_voided.notes is distinct from 'Original notes' or v_voided.void_reason is distinct from 'Wrong paid invoice' then
    raise exception 'paid void did not preserve original financial record';
  end if;
  if exists(select 1 from crm.invoice_items where invoice_id=v_paid.id and active_billing) then
    raise exception 'void did not release active billing links';
  end if;
  begin
    update crm.invoice_items set unit_price=1 where invoice_id=v_paid.id;
    raise exception 'voided invoice line could be edited';
  exception when object_not_in_prerequisite_state then null;
  end;
  select * into v_totals from crm.get_invoice_patient_balance(v_paid.id,v_admin);
  if (v_totals.amount_paid,v_totals.invoice_due,v_totals.overall_due) is distinct from (0::numeric,0::numeric,205::numeric) then
    raise exception 'voided invoice still affects the patient ledger';
  end if;
  if (select sum(amount) from crm.get_daily_payment_collections(v_admin,v_start,v_end) where payment_method in ('cash','upi')) is not null then
    raise exception 'dashboard still counts split receipts after void';
  end if;
  begin
    perform crm.record_invoice_payment(v_voided.id,1,'upi',null,null,v_admin);
    raise exception 'voided invoice accepted another receipt';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    perform crm.delete_invoice(v_voided.id,v_ops,'Archive',v_voided.version);
    raise exception 'operations archived a previously paid voided invoice';
  exception when object_not_in_prerequisite_state then null;
  end;
  select * into v_voided from crm.void_invoice(v_voided.id,v_admin,'Remove from list',v_voided.version,true);
  if v_voided.deleted_at is null or v_voided.delete_reason is distinct from 'Remove from list'
     or v_voided.void_reason is distinct from 'Wrong paid invoice' then
    raise exception 'archiving changed original void metadata';
  end if;
  if (select jsonb_agg(to_jsonb(p) order by p.id) from crm.invoice_payments p where p.invoice_id=v_paid.id)
    is distinct from v_receipts then raise exception 'receipt history was changed'; end if;
  if not exists(select 1 from crm.audit_log where entity_id=v_paid.id and action='cancelled' and (new_data->>'payments_excluded')::numeric=100)
     or not exists(select 1 from crm.audit_log where entity_id=v_paid.id and action='archived' and (new_data->>'payments_excluded')::numeric=0) then
    raise exception 'paid void audit missing or counted twice on archive';
  end if;

  select * into v_voided from crm.void_invoice(v_partial.id,v_admin,'Duplicate bill',v_partial.version,true);
  if v_voided.status<>'cancelled' or v_voided.deleted_at is null or
     (select sum(amount) from crm.invoice_payments where invoice_id=v_partial.id) is distinct from 25::numeric then
    raise exception 'partial payment was not atomically voided and archived';
  end if;

  select * into v_paid_direct from crm.create_consultation_invoice(v_lead,80,null,v_admin,'Dr. Test','Self');
  perform crm.record_invoice_payment(v_paid_direct.id,80,'card',null,null,v_admin);
  select * into v_paid_direct from crm.invoices where id=v_paid_direct.id;
  select * into v_voided from crm.void_invoice(v_paid_direct.id,v_admin,'Incorrect paid bill',v_paid_direct.version,true);
  if v_voided.status<>'cancelled' or v_voided.deleted_at is null
     or not exists(select 1 from crm.audit_log where entity_id=v_paid_direct.id and action='cancelled'
       and (new_data->>'payments_excluded')::numeric=80) then
    raise exception 'fully paid bill with receipts was not atomically voided and archived';
  end if;

  -- Historical invoices can be paid with no separate ledger entries.
  perform set_config('crm.allow_adhoc_invoice','on',true);
  insert into crm.invoices(invoice_number,lead_id,status,subtotal,tax_rate,tax_amount,total,created_by,
    code_enforced,invoice_kind,consulting_doctor_name,referring_doctor_name)
    values('I31/LEGACY/001',v_lead,'paid',75,0,0,75,v_admin,false,'consultation','Dr. Test','Self') returning * into v_legacy;
  perform set_config('crm.allow_adhoc_invoice','off',true);
  select * into v_voided from crm.void_invoice(v_legacy.id,v_admin,'Incorrect historic paid bill',v_legacy.version,true);
  if v_voided.status<>'cancelled' or v_voided.deleted_at is null
    or not exists(select 1 from crm.audit_log where entity_id=v_legacy.id and action='cancelled'
      and (new_data->>'payments_excluded')::numeric=75) then raise exception 'historic paid invoice not reversed'; end if;

  select * into v_totals from crm.get_patient_invoice_summary(v_lead,v_admin);
  if (v_totals.invoice_count,v_totals.total_invoiced,v_totals.amount_paid,v_totals.balance_due)
       is distinct from (1::bigint,50::numeric,20::numeric,30::numeric)
     or (select sum(amount) from crm.get_report_collections(v_admin,v_start,v_end,v_branch)) is distinct from 20::numeric
     or (select sum((d->>'amount')::numeric) from jsonb_array_elements(crm.get_report_payment_collections(v_admin,v_start,v_end,v_branch)) d) is distinct from 20::numeric
     or (crm.get_report_invoice_values(v_admin,v_start,v_end,v_branch,null)->>'subtotal')::numeric is distinct from 50::numeric then
    raise exception 'voided/archived charges or payments still affect report totals';
  end if;
  if has_function_privilege('authenticated','crm.void_invoice(uuid,uuid,text,bigint,boolean)','execute')
     or has_function_privilege('anon','crm.void_invoice(uuid,uuid,text,bigint,boolean)','execute') then
    raise exception 'paid void endpoint exposed to browsers';
  end if;
end
$test$;

select 'ok 1 - paid invoice void/archive preserves audit history, excludes totals, and enforces admin permissions';
rollback;
