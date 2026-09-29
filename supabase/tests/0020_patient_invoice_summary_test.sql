-- All fixtures and writes are isolated inside this rollback-only regression.
begin;
select '1..1';
do $test$
declare
  v_admin uuid := 'c2000000-0000-4000-8000-000000000001';
  v_front uuid := 'c2000000-0000-4000-8000-000000000002';
  v_doctor uuid := 'c2000000-0000-4000-8000-000000000003';
  v_other uuid := 'c2000000-0000-4000-8000-000000000004';
  v_branch uuid; v_other_branch uuid; v_lead uuid; v_empty uuid; v_type uuid;
  v_invoice crm.invoices%rowtype; v_items jsonb; v_summary record; v_rejected boolean;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (v_admin,'summary-admin@example.test','{"full_name":"Summary Admin"}'),
    (v_front,'summary-front@example.test','{"full_name":"Summary Front"}'),
    (v_doctor,'summary-doctor@example.test','{"full_name":"Summary Doctor"}'),
    (v_other,'summary-other@example.test','{"full_name":"Summary Other"}');
  update crm.profiles set role='admin',is_active=true where id=v_admin;
  update crm.profiles set role='front_office',is_active=true where id=v_front;
  update crm.profiles set role='doctor',is_active=true where id=v_doctor;
  update crm.profiles set role='operations',is_active=true where id=v_other;
  insert into crm.branches(name,code) values('Summary Center','S20') returning id into v_branch;
  insert into crm.branches(name,code) values('Other Summary Center','S20B') returning id into v_other_branch;
  insert into crm.user_branches(user_id,branch_id) values(v_front,v_branch),(v_doctor,v_branch),(v_other,v_other_branch);
  insert into crm.leads(branch_id,name,mobile,status,assignee_id,created_by)
    values(v_branch,'Summary Patient','9000000020','open',v_front,v_admin) returning id into v_lead;
  insert into crm.leads(branch_id,name,mobile,status,created_by)
    values(v_branch,'Empty Summary Patient','9000000021','open',v_admin) returning id into v_empty;
  insert into crm.treatment_types(branch_id,name,default_cost) values(v_branch,'Summary consultation',200) returning id into v_type;
  v_items := jsonb_build_array(jsonb_build_object('treatment_type_id',v_type,'quantity',1,'unit_price',200));
  select * into v_invoice from crm.create_patient_invoice(v_lead,0,0,null,null,null,v_items,v_admin);
  perform crm.record_invoice_payment(v_invoice.id,40,'cash',null,null,v_admin);
  perform crm.record_invoice_payment(v_invoice.id,60,'upi',null,null,v_admin);
  -- Exceed the patient page's 200-row preview; none of these may be omitted from totals.
  for n in 1..201 loop
    perform crm.create_patient_invoice(v_lead,0,0,null,null,null,
      jsonb_build_array(jsonb_build_object('treatment_type_id',v_type,'quantity',1,'unit_price',1)),v_admin);
  end loop;
  select * into v_invoice from crm.create_patient_invoice(v_lead,0,0,null,null,null,v_items,v_admin);
  perform crm.cancel_invoice(v_invoice.id,v_admin,'Cancelled test invoice');
  select * into v_invoice from crm.create_patient_invoice(v_lead,0,0,null,null,null,v_items,v_admin);
  perform crm.delete_invoice(v_invoice.id,v_admin,'Archived test invoice');
  execute 'set local role service_role';
  select * into v_summary from crm.get_patient_invoice_summary(v_lead,v_front);
  if v_summary.invoice_count<>202 or v_summary.total_invoiced<>401
     or v_summary.amount_paid<>100 or v_summary.balance_due<>301 then
    raise exception 'wrong patient totals: %',row_to_json(v_summary);
  end if;
  select * into v_summary from crm.get_patient_invoice_summary(v_empty,v_front);
  if v_summary.invoice_count<>0 or v_summary.total_invoiced<>0 or v_summary.amount_paid<>0 or v_summary.balance_due<>0 then
    raise exception 'empty patient summary is not zero';
  end if;
  v_rejected := false;
  begin perform crm.get_patient_invoice_summary(v_lead,v_doctor);
  exception when insufficient_privilege then v_rejected:=true; end;
  if not v_rejected then raise exception 'doctor accessed patient financial summary'; end if;
  v_rejected := false;
  begin perform crm.get_patient_invoice_summary(v_lead,v_other);
  exception when insufficient_privilege then v_rejected:=true; end;
  if not v_rejected then raise exception 'other center accessed patient financial summary'; end if;
  execute 'reset role';
  update crm.leads set assignee_id=v_admin where id=v_lead;
  v_rejected := false;
  begin perform crm.get_patient_invoice_summary(v_lead,v_front);
  exception when insufficient_privilege then v_rejected:=true; end;
  if not v_rejected then raise exception 'front desk accessed another assignee financial summary'; end if;
  if has_function_privilege('authenticated','crm.get_patient_invoice_summary(uuid,uuid)','execute')
     or has_function_privilege('anon','crm.get_patient_invoice_summary(uuid,uuid)','execute') then
    raise exception 'patient summary exposed to browser roles';
  end if;
end
$test$;
select 'ok 1 - exact patient balances preserve cancellation, paging and access boundaries';
rollback;
