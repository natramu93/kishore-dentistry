begin;
select '1..1';
do $test$
declare
  v_admin uuid := 'c2100000-0000-4000-8000-000000000001';
  v_other uuid := 'c2100000-0000-4000-8000-000000000002';
  v_branch uuid; v_other_branch uuid; v_lead uuid; v_type uuid;
  v_invoice crm.invoices%rowtype; v_second crm.invoices%rowtype;
  v_payment crm.invoice_payments%rowtype; v_changed crm.invoice_payments%rowtype;
  v_items jsonb; v_receipts jsonb; v_request uuid := gen_random_uuid(); v_count bigint; v_rejected boolean;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (v_admin,'invoice-21@example.test','{"full_name":"Receipt Test Admin"}'),
    (v_other,'receipt-other-21@example.test','{"full_name":"Other Center Ops"}');
  update crm.profiles set role='admin',is_active=true where id=v_admin;
  update crm.profiles set role='operations',is_active=true where id=v_other;
  insert into crm.branches(name,code) values('Receipt Test Center','I21') returning id into v_branch;
  insert into crm.branches(name,code) values('Other Receipt Center','I21B') returning id into v_other_branch;
  insert into crm.user_branches(user_id,branch_id) values(v_other,v_other_branch);
  insert into crm.leads(branch_id,name,mobile,status,created_by)
    values(v_branch,'Receipt Test Patient','9000000021','open',v_admin) returning id into v_lead;
  insert into crm.treatment_types(branch_id,name,default_cost) values(v_branch,'Filling',1000) returning id into v_type;
  v_items := jsonb_build_array(jsonb_build_object('treatment_type_id',v_type,'quantity',1,'unit_price',1000,'tooth_numbers',jsonb_build_array('18','17','16')));
  execute 'set local role service_role';
  select * into v_invoice from crm.create_patient_invoice(v_lead,0,0,null,null,null,v_items,v_admin,'2026-08-01','Dr. Receipt Doctor');
  select * into v_second from crm.create_patient_invoice(v_lead,0,0,null,null,null,v_items,v_admin);
  execute 'reset role';
  if v_invoice.invoice_date <> date '2026-08-01' or v_invoice.consulting_doctor_name <> 'Dr. Receipt Doctor'
    or v_second.invoice_date <> (now() at time zone 'Asia/Kolkata')::date
    or not exists(select 1 from crm.invoice_items where invoice_id=v_invoice.id and tooth_numbers=array['18','17','16']) then
    raise exception 'invoice business date, doctor or teeth not preserved'; end if;
  v_receipts := '[{"amount":100,"method":"cash"},{"amount":200,"method":"upi","reference":"UTR"},{"amount":300,"method":"card"},{"amount":400,"method":"neft"}]';
  execute 'set local role service_role';
  perform crm.record_invoice_payment_batch(v_invoice.id,v_receipts,v_request,v_admin);
  perform crm.record_invoice_payment_batch(v_invoice.id,v_receipts,v_request,v_admin);
  execute 'reset role';
  select count(*) into v_count from crm.invoice_payments where invoice_id=v_invoice.id;
  if v_count <> 4 or (select sum(amount) from crm.invoice_payments where invoice_id=v_invoice.id) <> 1000
    or (select status from crm.invoices where id=v_invoice.id) <> 'paid' then
    raise exception 'split receipt or replay incorrectly calculated / duplicated payment'; end if;
  select * into v_payment from crm.invoice_payments where invoice_id=v_invoice.id and payment_method='neft';
  execute 'set local role service_role';
  v_rejected := false;
  begin update crm.invoice_payments set amount=350 where id=v_payment.id;
  exception when object_not_in_prerequisite_state then v_rejected := true; end;
  if not v_rejected then raise exception 'receipt changed without audited correction'; end if;
  select * into v_changed from crm.update_invoice_payment(v_invoice.id,v_payment.id,350,'card','SLIP','Incorrect amount and method',1,v_admin);
  execute 'reset role';
  if v_changed.version <> 2 or v_changed.received_at <> v_payment.received_at or v_changed.created_by <> v_payment.created_by
    or (select status from crm.invoices where id=v_invoice.id) <> 'sent'
    or (select paid_at from crm.invoices where id=v_invoice.id) is not null
    or (select total from crm.invoices where id=v_invoice.id) <> 1000
    or (select amount_paid from crm.get_patient_invoice_summary(v_lead,v_admin)) <> 950
    or not exists(select 1 from crm.audit_log where entity_id=v_payment.id and action='corrected'
      and old_data->>'payment_method'='neft' and new_data->>'payment_method'='card' and new_data->>'correction_reason'='Incorrect amount and method') then
    raise exception 'receipt correction lost identity/audit or failed to update invoice / patient balance'; end if;
  execute 'set local role service_role';
  v_rejected := false;
  begin perform crm.update_invoice_payment(v_invoice.id,v_payment.id,350,'cash',null,'Stale',1,v_admin);
  exception when serialization_failure then v_rejected := true; end;
  if not v_rejected then raise exception 'stale receipt edit accepted'; end if;
  v_rejected := false;
  begin perform crm.update_invoice_payment(v_invoice.id,v_payment.id,401,'card',null,'Overpayment',2,v_admin);
  exception when invalid_parameter_value then v_rejected := true; end;
  if not v_rejected then raise exception 'receipt overpayment accepted'; end if;
  v_rejected := false;
  begin perform crm.update_invoice_payment(v_invoice.id,v_payment.id,350,'card',null,'Other center',2,v_other);
  exception when insufficient_privilege then v_rejected := true; end;
  if not v_rejected then raise exception 'cross-center receipt edit accepted'; end if;
  v_rejected := false;
  begin perform crm.update_invoice_payment(v_second.id,v_payment.id,350,'card',null,'Wrong invoice',2,v_admin);
  exception when no_data_found then v_rejected := true; end;
  if not v_rejected then raise exception 'receipt from another invoice edited'; end if;
  v_rejected := false;
  begin perform crm.record_invoice_payment_batch(v_second.id,'[{"amount":500,"method":"cash"},{"amount":501,"method":"upi"}]',gen_random_uuid(),v_admin);
  exception when invalid_parameter_value then v_rejected := true; end;
  if not v_rejected or exists(select 1 from crm.invoice_payments where invoice_id=v_second.id) then raise exception 'split overpayment was not atomic'; end if;
  v_rejected := false;
  begin perform crm.record_invoice_payment_batch(v_second.id,'[{"amount":100,"method":"cash"},{"amount":100,"method":"other"}]',gen_random_uuid(),v_admin);
  exception when invalid_parameter_value then v_rejected := true; end;
  if not v_rejected or exists(select 1 from crm.invoice_payments where invoice_id=v_second.id) then raise exception 'invalid split partially saved'; end if;
  select * into v_changed from crm.update_invoice_payment(v_invoice.id,v_payment.id,400,'neft',null,'Correct bank receipt',2,v_admin);
  v_rejected := false;
  begin update crm.invoices set status='sent' where id=v_invoice.id;
  exception when check_violation then v_rejected := true; end;
  if not v_rejected then raise exception 'paid invoice reopened without a receipt correction'; end if;
  execute 'reset role';
  if (select status from crm.invoices where id=v_invoice.id) <> 'paid' or v_changed.version <> 3 then raise exception 'corrected full receipt did not mark invoice paid'; end if;
  if has_function_privilege('anon','crm.record_invoice_payment_batch(uuid,jsonb,uuid,uuid)','execute')
    or has_function_privilege('authenticated','crm.update_invoice_payment(uuid,uuid,numeric,crm.invoice_payment_method,text,text,bigint,uuid)','execute')
    or has_column_privilege('service_role','crm.invoice_payments','invoice_id','update') then
    raise exception 'receipt access or identity permissions broadened'; end if;
end
$test$;
select 'ok 1 - dated named invoices and split/corrected receipts preserve audit, balances and access';
rollback;
