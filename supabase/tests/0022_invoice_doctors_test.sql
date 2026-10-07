begin;
select '1..1';
do $test$
declare
  v_admin uuid := 'c2200000-0000-4000-8000-000000000001';
  v_branch uuid; v_lead uuid; v_type uuid; v_items jsonb;
  v_invoice crm.invoices%rowtype; v_rejected boolean;
begin
  insert into auth.users(id,email,raw_user_meta_data)
    values(v_admin,'invoice-doctors@example.test','{"full_name":"Invoice Doctors Test"}');
  update crm.profiles set role='admin',is_active=true where id=v_admin;
  insert into crm.branches(name,code) values('Invoice Doctors Center','I22') returning id into v_branch;
  insert into crm.leads(branch_id,name,mobile,status,created_by)
    values(v_branch,'Invoice Doctors Patient','9000000022','open',v_admin) returning id into v_lead;
  insert into crm.treatment_types(branch_id,name,default_cost)
    values(v_branch,'Consultation',200) returning id into v_type;
  v_items := jsonb_build_array(jsonb_build_object('treatment_type_id',v_type,'quantity',1,'unit_price',200));
  execute 'set local role service_role';
  v_rejected := false;
  begin
    perform crm.create_patient_invoice(v_lead,0,0,null,null,null,v_items,v_admin,current_date,'Dr. Consulting',' ');
  exception when invalid_parameter_value then v_rejected := true; end;
  if not v_rejected then raise exception 'blank referring doctor accepted'; end if;
  v_rejected := false;
  begin
    perform crm.create_consultation_invoice(v_lead,200,null,v_admin,null,'Dr. Referring');
  exception when invalid_parameter_value then v_rejected := true; end;
  if not v_rejected then raise exception 'missing consulting doctor accepted'; end if;
  select * into v_invoice from crm.create_patient_invoice(
    v_lead,0,0,null,null,null,v_items,v_admin,current_date,' Dr. Consulting ',' Dr. Referring ');
  if v_invoice.consulting_doctor_name <> 'Dr. Consulting' or v_invoice.referring_doctor_name <> 'Dr. Referring' then
    raise exception 'doctor snapshots not preserved'; end if;
  v_rejected := false;
  begin update crm.invoices set referring_doctor_name='Different doctor' where id=v_invoice.id;
  exception when invalid_parameter_value then v_rejected := true; end;
  if not v_rejected then raise exception 'invoice doctor snapshot changed'; end if;
  select * into v_invoice from crm.create_consultation_invoice(v_lead,200,null,v_admin,'Dr. Consulting','No referring doctor');
  perform crm.record_invoice_payment(v_invoice.id,100,'cash',null,null,v_admin);
  if v_invoice.referring_doctor_name <> 'No referring doctor'
     or not exists(select 1 from crm.audit_log where entity_id=v_invoice.id and new_data->>'consulting_doctor_name'='Dr. Consulting'
       and new_data->>'referring_doctor_name'='No referring doctor') then
    raise exception 'consultation doctor details missing from invoice or audit'; end if;
  if has_function_privilege('authenticated','crm.create_consultation_invoice(uuid,numeric,text,uuid,text,text)','execute')
     or has_function_privilege('anon','crm.create_patient_invoice(uuid,numeric,numeric,text,text,text,jsonb,uuid,date,text,text)','execute') then
    raise exception 'invoice creation exposed to public roles'; end if;
end
$test$;
select 'ok 1 - invoices require and retain both doctor details across consultation, payment and audit';
rollback;
