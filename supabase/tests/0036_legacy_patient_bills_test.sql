begin;
select '1..1';
do $test$
declare
  v_branch uuid;
  v_other uuid;
  v_lead uuid;
  v_invoices bigint;
  v_receipts bigint;
begin
  insert into crm.branches(name,code) values('Synthetic history branch','LH1') returning id into v_branch;
  insert into crm.branches(name,code) values('Different history branch','LH2') returning id into v_other;
  insert into crm.leads(branch_id,name,mobile) values(v_branch,'Synthetic Legacy Patient','9000000036') returning id into v_lead;
  select count(*) into v_invoices from crm.invoices;
  select count(*) into v_receipts from crm.invoice_payments;
  execute 'set local role service_role';
  insert into crm.legacy_patient_bills(branch_id,lead_id,bill_number,billed_at,legacy_patient_ref,source_export,
    gross_paise,discount_paise,tax_paise,net_paise,service_names,service_lines)
  values(v_branch,v_lead,'SYN-1','2025-10-01T08:30:00+05:30','TRPAVN-999999999','B25',
    100000,10000,0,90000,array['Cleaning'],'[{"service":"Cleaning","net_paise":90000}]');
  begin
    insert into crm.legacy_patient_bills select v_other,lead_id,bill_number,billed_at,legacy_patient_ref,source_export,
      gross_paise,discount_paise,tax_paise,net_paise,service_names,service_lines,imported_at
      from crm.legacy_patient_bills where branch_id=v_branch;
    raise exception 'Historical bill escaped branch scope';
  exception when foreign_key_violation then null; end;
  if (select count(*) from crm.invoices)<>v_invoices or (select count(*) from crm.invoice_payments)<>v_receipts then
    raise exception 'Historical bill changed current ledger';
  end if;
  if has_table_privilege('authenticated','crm.legacy_patient_bills','select')
     or has_table_privilege('anon','crm.legacy_patient_bills','select')
     or has_table_privilege('service_role','crm.legacy_patient_bills','update,delete,truncate') then
    raise exception 'Historical bill table access widened';
  end if;
end
$test$;
select 'ok 1 - immutable history separate from live billing and scoped to the patient branch';
rollback;
