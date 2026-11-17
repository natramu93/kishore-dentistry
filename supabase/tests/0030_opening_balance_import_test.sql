begin;
select '1..1';
do $test$
declare
  v_admin uuid := gen_random_uuid();
  v_branch uuid;
  v_bill crm.invoices%rowtype;
  v_rows jsonb;
  v_result jsonb;
  v_before jsonb;
begin
  insert into auth.users(id,email,raw_user_meta_data) values(v_admin,'opening-admin@example.test','{"full_name":"Test Admin"}');
  update crm.profiles set role='admin',is_active=true where id=v_admin;
  select id into v_branch from crm.branches where code='TUP';
  if not found then insert into crm.branches(name,code) values('Test Tirupur','TUP') returning id into v_branch; end if;
  v_rows := jsonb_build_array(jsonb_build_object('legacy_ref','TRPAVN-999999999','branch_id',v_branch,
    'name','Test Opening Balance','mobile','9876500030','amount',123.45));
  execute 'set local role service_role';
  v_before := crm.get_report_invoice_values(v_admin,'2026-11-14T00:00:00+05:30','2026-11-15T00:00:00+05:30',v_branch,null);
  v_result := crm.import_legacy_opening_balances('2026-11-14',v_rows,v_admin);
  if (v_result->>'entries_posted')::int <> 1 or (v_result->>'patients_created')::int <> 1
     or (v_result->>'amount_posted')::numeric <> 123.45 then raise exception 'import did not reconcile'; end if;
  v_result := crm.import_legacy_opening_balances('2026-11-14',v_rows,v_admin);
  if (v_result->>'entries_already_present')::int <> 1 or (v_result->>'entries_posted')::int <> 0
    then raise exception 'import was not idempotent'; end if;
  select * into strict v_bill from crm.invoices where legacy_patient_ref='TRPAVN-999999999';
  if v_bill.billing_date <> '2026-11-14' or v_bill.total <> 123.45
    or not exists(select 1 from crm.invoice_items where invoice_id=v_bill.id and description='Due carry forward from old system')
    then raise exception 'opening balance bill is incorrect'; end if;
  if crm.get_report_invoice_values(v_admin,'2026-11-14T00:00:00+05:30','2026-11-15T00:00:00+05:30',v_branch,null) is distinct from v_before
    then raise exception 'opening balance affected new treatment billing'; end if;
  if (select balance_due from crm.get_patient_invoice_summary(v_bill.lead_id,v_admin)) <> 123.45 then
    raise exception 'opening balance missing from patient dues'; end if;
  perform crm.record_invoice_payment_batch(v_bill.id,'[{"amount":23.45,"method":"cash"}]',gen_random_uuid(),v_admin);
  if (select balance_due from crm.get_patient_invoice_summary(v_bill.lead_id,v_admin)) <> 100 then
    raise exception 'receipt did not reduce opening balance'; end if;
  if has_function_privilege('authenticated','crm.import_legacy_opening_balances(date,jsonb,uuid)','execute') then
    raise exception 'browser may not import opening balances'; end if;
end
$test$;
select 'ok 1 - legacy balances are collectible, idempotent and excluded from new billing';
rollback;
