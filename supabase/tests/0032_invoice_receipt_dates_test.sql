begin;
select '1..1';

do $test$
declare
  v_admin uuid := 'c3200000-0000-4000-8000-000000000001';
  v_ops uuid := 'c3200000-0000-4000-8000-000000000002';
  v_branch uuid;
  v_lead uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_billing_date date := v_today-8;
  v_posted date := v_today-3;
  v_corrected date := v_today-2;
  v_batch uuid := gen_random_uuid();
  v_receipts jsonb := '[{"amount":40,"method":"upi"},{"amount":60,"method":"cash"}]';
  v_invoice crm.invoices%rowtype;
  v_receipt crm.invoice_payments%rowtype;
  v_changed crm.invoice_payments%rowtype;
  v_report jsonb;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (v_admin,'receipt-date-admin@example.test','{"full_name":"Receipt Date Admin"}'),
    (v_ops,'receipt-date-ops@example.test','{"full_name":"Receipt Date Operations"}');
  update crm.profiles set role='admin',is_active=true where id=v_admin;
  update crm.profiles set role='operations',is_active=true where id=v_ops;
  insert into crm.branches(name,code) values('Receipt Date Center','I32') returning id into v_branch;
  insert into crm.user_branches(user_id,branch_id) values(v_ops,v_branch);
  insert into crm.leads(branch_id,name,mobile,status,created_by)
    values(v_branch,'Receipt Date Patient','9000000032','open',v_admin) returning id into v_lead;

  execute 'set local role service_role';
  select * into v_invoice from crm.create_consultation_invoice(v_lead,100,null,v_admin,'Dr. Test','Self');
  select * into v_invoice from crm.update_invoice_with_date(v_invoice.id,0,null,
    '[{"description":"Consultation","quantity":1,"unit_price":100}]',v_admin,v_invoice.version,null,null,null,v_billing_date);
  begin
    perform crm.record_invoice_payment_batch_with_date(v_invoice.id,v_receipts,v_batch,v_ops,v_today+1);
    raise exception 'future receipt was accepted';
  exception when invalid_parameter_value then null;
  end;
  perform crm.record_invoice_payment_batch_with_date(v_invoice.id,v_receipts,v_batch,v_ops,v_posted);
  perform crm.record_invoice_payment_batch_with_date(v_invoice.id,v_receipts,v_batch,v_ops,v_posted);
  begin
    perform crm.record_invoice_payment_batch_with_date(v_invoice.id,v_receipts,v_batch,v_ops,v_corrected);
    raise exception 'split request key replayed with a different date';
  exception when invalid_parameter_value then null;
  end;
  if (select count(*) from crm.invoice_payments where invoice_id=v_invoice.id)<>2
     or exists(select 1 from crm.invoice_payments where invoice_id=v_invoice.id and
        ((received_at at time zone 'Asia/Kolkata')::date is distinct from v_posted
         or initial_receipt_date is distinct from v_posted
         or (created_at at time zone 'Asia/Kolkata')::date is distinct from v_today))
     or (select (billing_date,status) from crm.invoices where id=v_invoice.id)
        is distinct from row(v_billing_date,'paid'::crm.invoice_status) then
    raise exception 'backdating was not applied atomically or changed the invoice';
  end if;
  select * into strict v_receipt from crm.invoice_payments where invoice_id=v_invoice.id and payment_method='upi';
  begin
    perform crm.update_invoice_payment_with_date(v_invoice.id,v_receipt.id,40,'upi',null,'Backdate',v_receipt.version,v_ops,v_corrected);
    raise exception 'operations changed a saved receipt date';
  exception when insufficient_privilege then null;
  end;
  begin
    perform crm.update_invoice_payment_with_date(v_invoice.id,v_receipt.id,40,'upi',null,'Future',v_receipt.version,v_admin,v_today+1);
    raise exception 'admin recorded a future date';
  exception when invalid_parameter_value then null;
  end;
  begin
    update crm.invoice_payments set received_at=now() where id=v_receipt.id;
    raise exception 'unaudited date correction accepted';
  exception when object_not_in_prerequisite_state then null;
  end;

  select * into v_changed from crm.update_invoice_payment_with_date(
    v_invoice.id,v_receipt.id,40,'upi',null,'Correct bank settlement date',v_receipt.version,v_admin,v_corrected);
  if (v_changed.received_at at time zone 'Asia/Kolkata')::date is distinct from v_corrected
    or v_changed.initial_receipt_date is distinct from v_posted
    or (v_changed.amount,v_changed.created_at,v_changed.created_by,v_changed.version)
       is distinct from (v_receipt.amount,v_receipt.created_at,v_receipt.created_by,v_receipt.version+1)
    or not exists(select 1 from crm.audit_log where entity_id=v_changed.id and actor_id=v_admin and action='corrected'
      and (old_data->>'received_at')::timestamptz=v_receipt.received_at
      and (new_data->>'received_at')::timestamptz=v_changed.received_at
      and new_data->>'correction_reason'='Correct bank settlement date') then
    raise exception 'administrator date correction did not preserve receipt identity and audit';
  end if;
  perform crm.record_invoice_payment_batch_with_date(v_invoice.id,v_receipts,v_batch,v_ops,v_posted);
  if (select count(*) from crm.invoice_payments where invoice_id=v_invoice.id)<>2
     or (select received_at from crm.invoice_payments where id=v_receipt.id) is distinct from v_changed.received_at then
    raise exception 'a split retry duplicated or reverted a corrected payment';
  end if;
  begin
    perform crm.update_invoice_payment_with_date(v_invoice.id,v_receipt.id,40,'upi',null,'Stale',v_receipt.version,v_admin,v_today);
    raise exception 'stale date correction accepted';
  exception when serialization_failure then null;
  end;
  v_report:=crm.get_report_payment_collections(v_admin,
    v_posted::timestamp at time zone 'Asia/Kolkata',
    (v_corrected+1)::timestamp at time zone 'Asia/Kolkata',v_branch);
  if jsonb_array_length(v_report)<>2
     or not v_report @> jsonb_build_array(
       jsonb_build_object('day',v_posted,'method','cash','amount',60),
       jsonb_build_object('day',v_corrected,'method','upi','amount',40))
     or (select amount_paid from crm.get_invoice_patient_balance(v_invoice.id,v_admin))<>100
     or (select billing_date from crm.invoices where id=v_invoice.id) is distinct from v_billing_date then
    raise exception 'corrected receipt did not move collection dates cleanly';
  end if;

  -- Normal staff corrections remain possible but cannot alter the posted day.
  select * into v_changed from crm.update_invoice_payment(v_invoice.id,v_changed.id,40,'upi','REF','Bank reference',v_changed.version,v_ops);
  if (v_changed.received_at at time zone 'Asia/Kolkata')::date is distinct from v_corrected then
    raise exception 'an ordinary correction reset the saved date';
  end if;
  if has_function_privilege('authenticated','crm.record_invoice_payment_batch_with_date(uuid,jsonb,uuid,uuid,date)','execute')
     or has_function_privilege('anon','crm.update_invoice_payment_with_date(uuid,uuid,numeric,crm.invoice_payment_method,text,text,bigint,uuid,date)','execute')
     or has_column_privilege('service_role','crm.invoice_payments','initial_receipt_date','update') then
    raise exception 'receipt date privileges are too broad';
  end if;
end
$test$;

select 'ok 1 - clinic-local receipt dates, administrative corrections, collection-day attribution, and idempotency';
rollback;
