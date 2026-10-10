-- Synthetic fixtures only; every change is rolled back.
begin;
-- Transaction timestamps are otherwise equal for all fixture invoices.
-- This temporary default is rolled back with the test, never persisted.
alter table crm.invoices alter column created_at set default clock_timestamp();
do $test$
declare
  v_admin uuid := 'c2400000-0000-4000-8000-000000000001';
  v_front uuid := 'c2400000-0000-4000-8000-000000000002';
  v_other uuid := 'c2400000-0000-4000-8000-000000000003';
  v_doctor uuid := 'c2400000-0000-4000-8000-000000000004';
  v_branch uuid; v_lead crm.leads%rowtype; v_legacy crm.leads%rowtype; v_type uuid;
  v_previous crm.invoices%rowtype; v_current crm.invoices%rowtype; v_later crm.invoices%rowtype;
  v_void crm.invoices%rowtype; v_paid crm.invoices%rowtype; v_archive crm.invoices%rowtype;
  v_balance record; v_items jsonb; v_rejected boolean; v_teeth text[];
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (v_admin,'title-admin@example.test','{"full_name":"Title Admin"}'),
    (v_front,'title-front@example.test','{"full_name":"Title Front"}'),
    (v_other,'title-other@example.test','{"full_name":"Title Other"}'),
    (v_doctor,'title-doctor@example.test','{"full_name":"Title Doctor"}');
  update crm.profiles set role='admin',is_active=true where id=v_admin;
  update crm.profiles set role='front_office',is_active=true where id in(v_front,v_other);
  update crm.profiles set role='doctor',is_active=true where id=v_doctor;
  insert into crm.branches(name,code) values('Patient Title Center','I24') returning id into v_branch;
  insert into crm.user_branches(user_id,branch_id) values(v_front,v_branch),(v_other,v_branch),(v_doctor,v_branch);
  insert into crm.treatment_types(branch_id,name,default_cost) values(v_branch,'Filling',500) returning id into v_type;
  execute 'set local role service_role';
  select * into v_lead from crm.create_lead(v_branch,'  TEST   PATIENT ','9000000024',null,null,null,null,null,null,v_front,'Mr',null);
  if v_lead.name<>'Test Patient' or v_lead.title<>'Mr' or v_lead.gender<>'male' or v_lead.assignee_id<>v_front then
    raise exception 'patient identity or intake assignment not saved'; end if;
  update crm.leads set title='Baby',gender='female',name='bABY pATIENT' where id=v_lead.id returning * into v_lead;
  if v_lead.name<>'Baby Patient' or v_lead.gender<>'female' then raise exception 'editable gender/name not preserved'; end if;
  update crm.leads set title='Baby',gender=null where id=v_lead.id returning * into v_lead;
  if v_lead.gender is not null then raise exception 'Baby gender guessed'; end if;
  update crm.leads set title='Master' where id=v_lead.id returning * into v_lead;
  if v_lead.gender<>'male' then raise exception 'Master gender missing'; end if;
  v_rejected:=false;
  begin update crm.leads set title='Invalid' where id=v_lead.id;
  exception when check_violation then v_rejected:=true; end;
  if not v_rejected then raise exception 'invalid title accepted'; end if;
  v_rejected:=false;
  begin update crm.leads set gender='Invalid' where id=v_lead.id;
  exception when check_violation then v_rejected:=true; end;
  if not v_rejected then raise exception 'invalid gender accepted'; end if;
  select * into v_legacy from crm.create_lead(v_branch,'LEGACY CLIENT','9000000025',null,null,null,null,null,null,v_admin);
  if v_legacy.title is not null or v_legacy.name<>'Legacy Client' then raise exception 'legacy RPC broken'; end if;

  select * into v_previous from crm.create_consultation_invoice(v_lead.id,500,null,v_front,'Dr Test','No referring doctor');
  perform crm.record_invoice_payment(v_previous.id,200,'cash',null,null,v_front);
  v_items:=jsonb_build_array(jsonb_build_object('treatment_type_id',v_type,'quantity',1,'unit_price',500,'tooth_numbers',jsonb_build_array('18','17','16')));
  select * into v_current from crm.create_patient_invoice(v_lead.id,0,0,null,null,null,v_items,v_front,'2026-10-10','Dr Test','No referring doctor');
  select tooth_numbers into v_teeth from crm.invoice_items where invoice_id=v_current.id;
  if v_teeth<>array['18','17','16'] or exists(select 1 from crm.case_sheets where lead_id=v_lead.id) then
    raise exception 'direct invoice teeth depend on clinical entry'; end if;
  -- Distinct created_at values give deterministic earlier/later chronology.
  select * into v_later from crm.create_consultation_invoice(v_lead.id,100,null,v_front,'Dr Test','No referring doctor');
  select * into v_balance from crm.get_invoice_patient_balance(v_later.id,v_front);
  if v_balance.earlier_due<>800 or v_balance.invoice_due<>100 or v_balance.overall_due<>900 or v_balance.earlier_invoice_count<>2 then
    raise exception 'new bill does not carry earlier dues'; end if;
  if v_later.total<>100 then raise exception 'earlier debt billed twice'; end if;
  select * into v_void from crm.create_consultation_invoice(v_lead.id,900,null,v_admin,'Dr Test','No referring doctor');
  perform crm.cancel_invoice(v_void.id,v_admin,'Synthetic wrong invoice');
  select * into v_paid from crm.create_consultation_invoice(v_lead.id,200,null,v_admin,'Dr Test','No referring doctor');
  perform crm.record_invoice_payment(v_paid.id,200,'upi',null,null,v_admin);
  select * into v_archive from crm.create_consultation_invoice(v_lead.id,400,null,v_admin,'Dr Test','No referring doctor');
  perform crm.delete_invoice(v_archive.id,v_admin,'Synthetic archive',v_archive.version);
  select * into v_balance from crm.get_invoice_patient_balance(v_current.id,v_front);
  if v_balance.earlier_due<>300 or v_balance.invoice_due<>500 or v_balance.later_due<>100 or v_balance.overall_due<>900 then
    raise exception 'ledger includes voided, archived or settled debt'; end if;
  perform crm.record_invoice_payment(v_previous.id,300,'neft',null,null,v_front);
  select * into v_balance from crm.get_invoice_patient_balance(v_later.id,v_front);
  if v_balance.earlier_due<>500 or v_balance.overall_due<>600 then raise exception 'carried balances stale after payment'; end if;
  v_rejected:=false;
  begin perform crm.get_invoice_patient_balance(v_current.id,v_other);
  exception when insufficient_privilege then v_rejected:=true; end;
  if not v_rejected then raise exception 'other assignee can read financials'; end if;
  v_rejected:=false;
  begin perform crm.get_invoice_patient_balance(v_current.id,v_doctor);
  exception when insufficient_privilege then v_rejected:=true; end;
  if not v_rejected then raise exception 'doctor can read financials'; end if;
  if has_function_privilege('authenticated','crm.get_invoice_patient_balance(uuid,uuid)','execute') then
    raise exception 'balance RPC exposed to untrusted clients'; end if;
end
$test$;
select 'ok - patient demographics, direct invoice teeth and nonduplicating carried dues';
rollback;
