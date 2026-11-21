begin;
select '1..1';
do $test$
declare
  v_admin uuid:=gen_random_uuid(); v_other uuid:=gen_random_uuid(); v_branch uuid; v_patient uuid; v_type uuid;
  v_doctor uuid; v_appointment uuid; v_treatment uuid; v_sheet crm.case_sheets%rowtype;
  v_invoice crm.invoices%rowtype; v_second crm.invoices%rowtype; v_open crm.invoices%rowtype;
  v_items jsonb; v_receipts jsonb; v_key uuid:=gen_random_uuid(); v_bad_key uuid:=gen_random_uuid(); v_zero_key uuid:=gen_random_uuid();
  v_version bigint; v_result jsonb;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (v_admin,'discount-admin@example.test','{"full_name":"Discount Admin"}'),
    (v_other,'discount-other@example.test','{"full_name":"Other Ops"}');
  update crm.profiles set role='admin',is_active=true where id=v_admin;
  update crm.profiles set role='operations',is_active=true where id=v_other;
  insert into crm.branches(name,code) values('Discount Test Center','PD35') returning id into v_branch;
  insert into crm.leads(branch_id,name,mobile,status,created_by)
    values(v_branch,'Synthetic Discount Patient','9000000035','appointment_booked',v_admin) returning id into v_patient;
  insert into crm.treatment_types(branch_id,name,default_cost) values(v_branch,'Restoration',1000) returning id into v_type;
  insert into crm.doctors(branch_id,full_name) values(v_branch,'Synthetic Dentist') returning id into v_doctor;
  insert into crm.appointments(branch_id,lead_id,doctor_id,scheduled_at,status,created_by)
    values(v_branch,v_patient,v_doctor,now(),'scheduled',v_admin) returning id into v_appointment;
  execute 'set local role service_role';
  select * into v_sheet from crm.finalize_clinical_visit(v_patient,v_appointment,v_doctor,now(),'Review','Clinical remarks',null,null,
    'reviewed_none',true,'{}',null,'[]',
    '[{"treatment_code":"23.2","status":"completed","site_scope":"multi_tooth","tooth_numbers":["11","12","13"],"quantity":1,"unit_price":0,"notes":"One restoration record"}]','[]',v_admin);
  if (select count(*) from crm.treatments where case_sheet_id=v_sheet.id)<>1
    or not exists(select 1 from crm.treatments where case_sheet_id=v_sheet.id and quantity=3 and tooth_numbers=array['11','12','13']) then
    raise exception 'multi-tooth treatment split or incorrect quantity'; end if;
  select id into strict v_treatment from crm.treatments where case_sheet_id=v_sheet.id;
  select * into v_sheet from crm.amend_clinical_visit(v_sheet.id,v_sheet.version,'Correct selected teeth','Review','Updated clinical remarks',null,null,
    'reviewed_none',true,'{}',null,'[]',jsonb_build_array(jsonb_build_object('treatment_id',v_treatment,'treatment_code','23.2',
      'status','completed','site_scope','multi_tooth','tooth_number','11','tooth_numbers',jsonb_build_array('11','12'),'notes','Updated one-record description')),'[]',v_admin);
  if (select count(*) from crm.treatments where case_sheet_id=v_sheet.id)<>1
    or not exists(select 1 from crm.treatments where id=v_treatment and quantity=2 and tooth_numbers=array['11','12']) then
    raise exception 'amended multi-tooth treatment split or incorrect quantity'; end if;
  v_items:=jsonb_build_array(jsonb_build_object('treatment_type_id',v_type,'quantity',1,'unit_price',1000));
  select * into v_invoice from crm.create_patient_invoice(v_patient,18,0,null,null,null,v_items,v_admin,'2026-12-01','Synthetic Dentist','No referring doctor');
  perform crm.record_invoice_payment_batch_with_date(v_invoice.id,'[{"amount":200,"method":"cash"}]',gen_random_uuid(),v_admin,'2026-11-01');
  select version into v_version from crm.invoices where id=v_invoice.id;
  begin
    perform crm.record_invoice_payment_with_discount(v_invoice.id,'[]',v_bad_key,v_other,'2026-11-02',100,'Head','Approved discount',v_version);
    raise exception 'cross-center payment discount allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform crm.record_invoice_payment_with_discount(v_invoice.id,'[]',v_bad_key,v_admin,'2026-11-02',100,'Head','Approved discount',v_version-1);
    raise exception 'stale payment discount allowed';
  exception when serialization_failure then null; end;
  begin
    perform crm.record_invoice_payment_with_discount(v_invoice.id,'[{"amount":1000,"method":"upi"}]',v_bad_key,v_admin,'2026-11-02',100,'Head','Approved discount',v_version);
    raise exception 'excess payment after discount allowed';
  exception when invalid_parameter_value then null; end;
  if (select total from crm.invoices where id=v_invoice.id)<>1180
    or exists(select 1 from crm.invoice_payment_discounts where request_key=v_bad_key) then
    raise exception 'failed receipt left a partial discount'; end if;
  v_receipts:='[{"amount":400,"method":"upi"},{"amount":100,"method":"card"}]';
  perform crm.record_invoice_payment_with_discount(v_invoice.id,v_receipts,v_key,v_admin,'2026-11-02',100,'Head','Approved discount',v_version);
  perform crm.record_invoice_payment_with_discount(v_invoice.id,v_receipts,v_key,v_admin,'2026-11-02',100,'Head','Approved discount',v_version);
  if (select total from crm.invoices where id=v_invoice.id)<>1062
    or (select discount_amount from crm.invoices where id=v_invoice.id)<>100
    or (select sum(amount) from crm.invoice_payments where invoice_id=v_invoice.id)<>700
    or (select count(*) from crm.invoice_payments where invoice_id=v_invoice.id)<>3 then
    raise exception 'discount/split receipts replay changed totals'; end if;
  begin
    perform crm.record_invoice_payment_with_discount(v_invoice.id,v_receipts,v_key,v_admin,'2026-11-02',101,'Head','Approved discount',v_version);
    raise exception 'reused key with changed payload allowed';
  exception when invalid_parameter_value then null; end;
  v_result:=crm.get_report_payment_collections(v_admin,'2026-11-02T00:00:00+05:30','2026-11-03T00:00:00+05:30',v_branch);
  if (select sum((r->>'amount')::numeric) from jsonb_array_elements(v_result) r)<>500 then
    raise exception 'revenue did not follow receipt date or included discount'; end if;
  select * into v_second from crm.create_patient_invoice(v_patient,0,0,null,null,null,v_items,v_admin,'2026-11-01','Synthetic Dentist','No referring doctor');
  perform crm.record_invoice_payment_with_discount(v_second.id,'[]',v_zero_key,v_admin,'2026-11-02',1000,'Head','Complimentary care',v_second.version);
  perform crm.record_invoice_payment_with_discount(v_second.id,'[]',v_zero_key,v_admin,'2026-11-02',1000,'Head','Complimentary care',v_second.version);
  if (select status from crm.invoices where id=v_second.id)<>'paid'
    or exists(select 1 from crm.invoice_payments where invoice_id=v_second.id) then raise exception 'waiver fabricated a receipt'; end if;
  execute 'reset role';
  perform set_config('crm.importing_opening_balance','on',true);
  insert into crm.invoices(invoice_number,lead_id,branch_id,invoice_kind,legacy_patient_ref,invoice_date,subtotal,tax_rate,tax_amount,total,created_by,code_enforced,consulting_doctor_name,referring_doctor_name)
    values('TEST-OPEN-35',v_patient,v_branch,'opening_balance','TRPAVN-999999935','2026-11-14',100,0,0,100,v_admin,false,'Not recorded (old system)','No referring doctor') returning * into v_open;
  execute 'set local role service_role';
  perform crm.record_invoice_payment_with_discount(v_open.id,'[{"amount":80,"method":"cash"}]',gen_random_uuid(),v_admin,'2026-11-14',20,'Head','Old balance concession',v_open.version);
  if (select total from crm.invoices where id=v_open.id)<>80 or (select status from crm.invoices where id=v_open.id)<>'paid' then
    raise exception 'opening balance discount could not settle debt'; end if;
  if has_function_privilege('authenticated','crm.record_invoice_payment_with_discount(uuid,jsonb,uuid,uuid,date,numeric,text,text,bigint)','execute')
    or has_table_privilege('authenticated','crm.invoice_payment_discounts','select') then raise exception 'discount workflow exposed to browser'; end if;
end
$test$;
select 'ok 1 - atomic audited payment discount, receipt-date revenue and one multi-tooth treatment';
rollback;
