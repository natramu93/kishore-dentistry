begin;
select '1..1';
do $test$
declare
  v_admin uuid := 'c3400000-0000-4000-8000-000000000001';
  v_front uuid := 'c3400000-0000-4000-8000-000000000002';
  v_other uuid := 'c3400000-0000-4000-8000-000000000003';
  v_doctor_user uuid := 'c3400000-0000-4000-8000-000000000004';
  v_owner uuid := 'c3400000-0000-4000-8000-000000000005';
  v_branch uuid; v_second uuid; v_patient uuid; v_hidden uuid;
  v_old crm.invoices%rowtype; v_today_bill crm.invoices%rowtype; v_future crm.invoices%rowtype;
  v_tomorrow_bill crm.invoices%rowtype; v_void crm.invoices%rowtype; v_foreign crm.invoices%rowtype;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_yesterday date := v_today-1;
  v_filters jsonb; v_result jsonb; v_details jsonb; v_page jsonb; v_receipt crm.invoice_payments%rowtype;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (v_admin,'activity-admin@example.test','{"full_name":"Activity admin"}'),
    (v_front,'activity-front@example.test','{"full_name":"Activity front"}'),
    (v_other,'activity-other@example.test','{"full_name":"Activity other"}'),
    (v_doctor_user,'activity-doctor@example.test','{"full_name":"Activity doctor"}'),
    (v_owner,'activity-owner@example.test','{"full_name":"Another front desk"}');
  update crm.profiles set is_active=true,role='admin' where id=v_admin;
  update crm.profiles set is_active=true,role='front_office' where id=v_front;
  update crm.profiles set is_active=true,role='operations' where id=v_other;
  update crm.profiles set is_active=true,role='doctor' where id=v_doctor_user;
  update crm.profiles set is_active=true,role='front_office' where id=v_owner;
  insert into crm.branches(name,code) values('Activity branch','I34') returning id into v_branch;
  insert into crm.branches(name,code) values('Other activity branch','J34') returning id into v_second;
  insert into crm.user_branches(user_id,branch_id) values(v_front,v_branch),(v_owner,v_branch),(v_other,v_second);
  insert into crm.leads(branch_id,name,mobile,assignee_id,created_by)
    values(v_branch,'Activity A Patient','9000000034',v_front,v_admin) returning id into v_patient;
  insert into crm.leads(branch_id,name,mobile,assignee_id,created_by)
    values(v_branch,'Activity B Patient','9000000035',v_owner,v_admin) returning id into v_hidden;
  execute 'set local role service_role';

  select * into v_old from crm.create_consultation_invoice(v_patient,200,null,v_admin,'Dr. Test','Self');
  select * into v_old from crm.update_invoice_with_date(v_old.id,0,null,
    '[{"description":"Consultation","quantity":1,"unit_price":200}]',v_admin,v_old.version,0,null,null,v_today-30);
  perform crm.record_invoice_payment_batch_with_date(v_old.id,'[{"amount":50,"method":"upi"},{"amount":30,"method":"cash"}]',gen_random_uuid(),v_admin,v_today);
  -- Same invoice also has a receipt outside the filter; it must not inflate today's cards.
  perform crm.record_invoice_payment_batch_with_date(v_old.id,'[{"amount":20,"method":"cash"}]',gen_random_uuid(),v_admin,v_yesterday);

  select * into v_future from crm.create_consultation_invoice(v_patient,100,null,v_admin,'Dr. Test','Self');
  select * into v_future from crm.update_invoice_with_date(v_future.id,0,null,
    '[{"description":"Consultation","quantity":1,"unit_price":100}]',v_admin,v_future.version,0,null,null,v_today+5);
  perform crm.record_invoice_payment_batch_with_date(v_future.id,'[{"amount":10,"method":"neft"}]',gen_random_uuid(),v_admin,v_yesterday);

  select * into v_today_bill from crm.create_consultation_invoice(v_patient,300,null,v_admin,'Dr. Test','Self');
  perform crm.record_invoice_payment_batch_with_date(v_today_bill.id,'[{"amount":40,"method":"card"}]',gen_random_uuid(),v_admin,v_yesterday);
  select * into v_tomorrow_bill from crm.create_consultation_invoice(v_patient,70,null,v_admin,'Dr. Test','Self');
  select * into v_tomorrow_bill from crm.update_invoice_with_date(v_tomorrow_bill.id,0,null,
    '[{"description":"Consultation","quantity":1,"unit_price":70}]',v_admin,v_tomorrow_bill.version,0,null,null,v_today+1);

  select * into v_foreign from crm.create_consultation_invoice(v_hidden,400,null,v_admin,'Dr. Test','Self');
  perform crm.record_invoice_payment(v_foreign.id,400,'cash',null,null,v_admin);
  select * into v_void from crm.create_consultation_invoice(v_patient,99,null,v_admin,'Dr. Test','Self');
  perform crm.record_invoice_payment(v_void.id,99,'cash',null,null,v_admin);
  select * into v_void from crm.invoices where id=v_void.id;
  perform crm.void_invoice(v_void.id,v_admin,'Exclude voided receipt',v_void.version,false);

  v_filters:=jsonb_build_object('branch',v_branch,'from',v_today,'to',v_today,'patient',v_patient);
  v_result:=crm.get_invoice_activity(v_front,v_filters,1,1,'total',false);
  v_page:=crm.get_invoice_activity(v_front,v_filters,2,1,'total',false);
  if (v_result->>'total')::int<>2 or jsonb_array_length(v_result->'invoices')<>1
    or v_result#>>'{invoices,0,id}'<>v_old.id::text or v_page#>>'{invoices,0,id}'<>v_today_bill.id::text
    or (v_result#>>'{collections,amount}')::numeric<>80 or (v_result->'collections') is distinct from (v_page->'collections')
    or (v_result#>>'{invoices,0,amount_paid}')::numeric<>100 or (v_result#>>'{invoices,0,received_in_range}')::numeric<>80 then
    raise exception 'activity date union, independent receipts, sort, deduplication or whole-result totals failed';
  end if;
  v_details:=crm.get_finance_details(v_front,v_filters,'invoices','receipts',1,100);
  if (v_details->>'amount')::numeric<>80 or (v_details->>'total')::int<>2
    or exists(select 1 from jsonb_array_elements(v_details->'rows') r where (r->>'date')::date<>v_today) then
    raise exception 'invoice summary drilldown does not reconcile';
  end if;
  v_result:=crm.get_invoice_activity(v_front,v_filters||jsonb_build_object('search',' '||lower(v_old.invoice_number)||' '),1,100,'number',false);
  if (v_result->>'total')::int<>1 or v_result#>>'{invoices,0,id}' is distinct from v_old.id::text
    or (v_result#>>'{collections,amount}')::numeric<>80 then
    raise exception 'case-insensitive invoice-number search did not preserve the date and receipt filters';
  end if;
  v_result:=crm.get_invoice_activity(v_front,v_filters||jsonb_build_object('search',right(v_today_bill.invoice_number,5)),1,100,'number',false);
  if (v_result->>'total')::int<>1 or v_result#>>'{invoices,0,id}' is distinct from v_today_bill.id::text then
    raise exception 'partial invoice-number search failed';
  end if;
  v_details:=crm.get_finance_details(v_front,v_filters||jsonb_build_object('search',v_old.invoice_number),'invoices','receipts',1,100);
  if (v_details->>'amount')::numeric<>80 or (v_details->>'total')::int<>2 then
    raise exception 'invoice-number search was not shared with receipt details';
  end if;
  v_result:=crm.get_invoice_activity(v_front,(v_filters-'patient')||jsonb_build_object('search',v_foreign.invoice_number),1,100,'number',false);
  if (v_result->>'total')::int<>0 then raise exception 'invoice-number search bypassed patient access'; end if;
  v_result:=crm.get_invoice_activity(v_front,v_filters||'{"search":"activity a patient"}',1,100,'number',false);
  if (v_result->>'total')::int<>2 then raise exception 'patient-name search no longer matches invoices'; end if;
  v_result:=crm.get_invoice_activity(v_front,v_filters||'{"search":"90000-00034"}',1,100,'number',false);
  if (v_result->>'total')::int<>2 then raise exception 'formatted mobile search no longer matches invoices'; end if;
  v_result:=crm.get_invoice_activity(v_front,v_filters||'{"method":"cash"}',1,100,'total',true);
  if (v_result->>'total')::int<>1 or (v_result#>>'{collections,cash}')::numeric<>30 then
    raise exception 'payment method is not constrained by receipt day';
  end if;
  v_result:=crm.get_invoice_activity(v_front,v_filters-'patient',1,100,'patient',false);
  if exists(select 1 from jsonb_array_elements(v_result->'invoices') r where r->>'lead_id'=v_hidden::text) then
    raise exception 'front desk scope leaked another assignee';
  end if;

  v_filters:=v_filters||jsonb_build_object('from',v_yesterday,'to',v_yesterday);
  v_result:=crm.get_invoice_activity(v_front,v_filters,1,100,'total',false);
  if (v_result->>'total')::int<>3 or (v_result#>>'{collections,amount}')::numeric<>70
    or not exists(select 1 from jsonb_array_elements(v_result->'invoices') r where r->>'id'=v_future.id::text) then
    raise exception 'advance receipt on a future-dated invoice is missing';
  end if;
  v_details:=crm.get_finance_details(v_admin,v_filters,'reports','receipts',1,100);
  if (v_details->>'amount')::numeric<>70 then raise exception 'report receipt detail uses invoice date'; end if;
  if (select sum((r->>'amount')::numeric) from jsonb_array_elements(crm.get_report_payment_collections(
      v_admin,v_yesterday::timestamp at time zone 'Asia/Kolkata',v_today::timestamp at time zone 'Asia/Kolkata',v_branch)) r)<>70 then
    raise exception 'revenue must follow receipt date even before a future invoice';
  end if;
  v_details:=crm.get_finance_details(v_admin,v_filters||jsonb_build_object('from',v_today,'to',v_today),'reports','subtotal',1,100);
  if (v_details->>'amount')::numeric<>300 then raise exception 'billed detail must use invoice date'; end if;
  select * into v_today_bill from crm.invoices where id=v_today_bill.id;
  select * into v_today_bill from crm.update_invoice_with_date(v_today_bill.id,10,null,
    '[{"description":"Consultation","quantity":1,"unit_price":300}]',v_admin,v_today_bill.version,20,'Admin',null,v_today);
  v_filters:=v_filters||jsonb_build_object('from',v_today,'to',v_today);
  v_details:=crm.get_finance_details(v_admin,v_filters,'reports','net',1,100);
  if (v_details->>'amount')::numeric<>308 or (v_details->>'total')::int<>3
    or (select sum((r->>'amount')::numeric) from jsonb_array_elements(v_details->'rows') r)<>308 then
    raise exception 'net billed detail must reconcile lines, negative discounts and tax';
  end if;
  select * into v_receipt from crm.invoice_payments where invoice_id=v_future.id;
  perform crm.update_invoice_payment_with_date(v_future.id,v_receipt.id,v_receipt.amount,v_receipt.payment_method,
    v_receipt.reference,'Correct receipt day',v_receipt.version,v_admin,v_today);
  v_result:=crm.get_invoice_activity(v_front,v_filters,1,100,'total',false);
  if (v_result->>'total')::int<>3 or (v_result#>>'{collections,amount}')::numeric<>90 then
    raise exception 'correcting a receipt date must move both invoice activity and revenue';
  end if;
  v_details:=crm.get_finance_details(v_admin,v_filters||jsonb_build_object('from',v_yesterday,'to',v_yesterday),'reports','receipts',1,100);
  if (v_details->>'amount')::numeric<>60 then raise exception 'corrected receipt remained on its previous revenue day'; end if;
  -- Archived patient records must not silently remove live financial history.
  update crm.leads set deleted_at=now(),deleted_by=v_admin,delete_reason='Archive synthetic patient' where id=v_patient;
  v_details:=crm.get_finance_details(v_admin,v_filters,'reports','receipts',1,100);
  if (v_details->>'amount')::numeric<>90 then raise exception 'patient archival removed active invoice receipts'; end if;
  v_details:=crm.get_finance_details(v_admin,v_filters-'patient','reports','receipts',1,100);
  if (v_details->>'amount')::numeric<>(select sum((r->>'amount')::numeric) from jsonb_array_elements(crm.get_report_payment_collections(
    v_admin,v_today::timestamp at time zone 'Asia/Kolkata',(v_today+1)::timestamp at time zone 'Asia/Kolkata',v_branch)) r) then
    raise exception 'report receipt card and details diverge after patient archival';
  end if;
  v_details:=crm.get_finance_details(v_admin,v_filters-'patient','reports','subtotal',1,100);
  if (v_details->>'amount')::numeric<>(crm.get_report_invoice_values(v_admin,
    v_today::timestamp at time zone 'Asia/Kolkata',(v_today+1)::timestamp at time zone 'Asia/Kolkata',v_branch,null)->>'subtotal')::numeric then
    raise exception 'report treatment value card and details diverge after patient archival';
  end if;
  begin
    perform crm.get_finance_details(v_front,v_filters,'reports','receipts',1,100);
    raise exception 'front desk obtained report drilldown';
  exception when insufficient_privilege then null;
  end;
  begin
    perform crm.get_invoice_activity(v_doctor_user,v_filters,1,100,'total',true);
    raise exception 'doctor obtained financial data';
  exception when insufficient_privilege then null;
  end;
  begin
    perform crm.get_finance_details(v_other,v_filters,'reports','receipts',1,100);
    raise exception 'cross branch drilldown accepted';
  exception when insufficient_privilege then null;
  end;
  if has_function_privilege('anon','crm.get_finance_details(uuid,jsonb,text,text,integer,integer)','execute')
    or has_function_privilege('authenticated','crm.get_invoice_activity(uuid,jsonb,integer,integer,text,boolean)','execute') then
    raise exception 'finance endpoints exposed to browser clients';
  end if;
end
$test$;
select 'ok 1 - invoice/payment date union, receipt revenue, line-item drilldowns and access-scoped sorting';
rollback;
