begin;
select '1..1';

do $test$
declare
  v_admin uuid := 'c3300000-0000-4000-8000-000000000001';
  v_ops uuid := 'c3300000-0000-4000-8000-000000000002';
  v_other uuid := 'c3300000-0000-4000-8000-000000000003';
  v_branch uuid; v_lead uuid; v_type uuid; v_item uuid;
  v_original crm.invoices%rowtype; v_invoice crm.invoices%rowtype;
  v_legacy crm.invoices%rowtype; v_receipt crm.invoice_payments%rowtype;
  v_items jsonb; v_balance record;
  v_old_date date := (current_timestamp at time zone 'Asia/Kolkata')::date-5;
  v_new_date date := v_old_date+1;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (v_admin,'edit-paid-admin@example.test','{"full_name":"Paid Edit Admin"}'),
    (v_ops,'edit-paid-ops@example.test','{"full_name":"Paid Edit Operations"}'),
    (v_other,'edit-paid-other@example.test','{"full_name":"Other Operations"}');
  update crm.profiles set role='admin',is_active=true where id=v_admin;
  update crm.profiles set role='operations',is_active=true where id in (v_ops,v_other);
  insert into crm.branches(name,code) values('Paid Edit Center','I33') returning id into v_branch;
  insert into crm.user_branches(user_id,branch_id) values(v_ops,v_branch);
  insert into crm.leads(branch_id,name,mobile,status,created_by)
    values(v_branch,'Paid Edit Patient','9000000033','open',v_admin) returning id into v_lead;
  insert into crm.treatment_types(branch_id,name,default_cost) values(v_branch,'Paid edit treatment',100) returning id into v_type;
  execute 'set local role service_role';

  select * into v_original from crm.create_patient_invoice(v_lead,0,0,null,null,null,
    jsonb_build_array(jsonb_build_object('treatment_type_id',v_type,'quantity',1,'unit_price',100)),
    v_ops,v_old_date,'Dr. Test','Self');
  select id into v_item from crm.invoice_items where invoice_id=v_original.id;
  select * into v_receipt from crm.record_invoice_payment(v_original.id,60,'cash','Original receipt',null,v_ops);
  select * into v_invoice from crm.invoices where id=v_original.id;
  v_items:=jsonb_build_array(jsonb_build_object('invoice_item_id',v_item,'treatment_type_id',v_type,'quantity',1,'unit_price',90));
  begin
    perform crm.update_invoice_with_date(v_invoice.id,0,null,v_items,v_other,v_invoice.version,0,null,null,v_new_date);
    raise exception 'out-of-branch invoice edit accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform crm.update_invoice_with_date(v_invoice.id,0,null,v_items,v_ops,v_original.version,0,null,null,v_new_date);
    raise exception 'edit overwrote a newly added receipt';
  exception when serialization_failure then null;
  end;
  select * into v_invoice from crm.update_invoice_with_date(v_invoice.id,0,'Partial payment correction',v_items,v_ops,v_invoice.version,0,null,null,v_new_date);
  select * into v_balance from crm.get_invoice_patient_balance(v_invoice.id,v_ops);
  if v_invoice.status<>'sent' or v_invoice.total<>90 or v_invoice.billing_date<>v_new_date
    or (v_balance.amount_paid,v_balance.invoice_due) is distinct from (60::numeric,30::numeric) then
    raise exception 'partially paid invoice did not retain its receipts and edited balance';
  end if;
  v_items:=jsonb_set(v_items,'{0,unit_price}','60');
  select * into v_invoice from crm.update_invoice_with_date(v_invoice.id,0,'Matched full payment',v_items,v_ops,v_invoice.version,0,null,null,null);
  if v_invoice.status<>'paid' or v_invoice.paid_at is null then raise exception 'invoice did not settle at the received total'; end if;

  begin
    update crm.invoices set total=150,subtotal=150 where id=v_invoice.id;
    raise exception 'direct modification of paid charges accepted';
  exception when object_not_in_prerequisite_state then null;
  end;
  v_items:=jsonb_set(v_items,'{0,unit_price}','120');
  select * into v_invoice from crm.update_invoice_with_date(v_invoice.id,0,'Additional treatment charge',v_items,v_ops,v_invoice.version,0,null,null,null);
  select * into v_balance from crm.get_invoice_patient_balance(v_invoice.id,v_ops);
  if v_invoice.status<>'sent' or v_invoice.paid_at is not null or v_invoice.total<>120 or v_invoice.invoice_number<>v_original.invoice_number
    or (v_balance.amount_paid,v_balance.invoice_due) is distinct from (60::numeric,60::numeric)
    or not exists(select 1 from crm.invoice_items where invoice_id=v_invoice.id and id=v_item and unit_price=120)
    or (select to_jsonb(p) from crm.invoice_payments p where id=v_receipt.id) is distinct from to_jsonb(v_receipt)
    or not exists(select 1 from crm.audit_log where entity_type='invoice' and entity_id=v_invoice.id and action='updated' and actor_id=v_ops
      and old_data->>'status'='paid' and new_data->>'status'='sent' and (new_data->>'total')::numeric=120) then
    raise exception 'increasing a paid invoice did not safely reopen its balance and preserve its audit and receipts';
  end if;
  perform crm.record_invoice_payment(v_invoice.id,60,'upi','Second receipt',null,v_ops);
  select * into v_invoice from crm.invoices where id=v_invoice.id;
  select * into v_invoice from crm.update_invoice_with_date(v_invoice.id,0,'Paid date correction',v_items,v_ops,v_invoice.version,0,null,null,v_new_date+1);
  if v_invoice.status<>'paid' or v_invoice.billing_date<>v_new_date+1 then
    raise exception 'date-only correction changed settlement';
  end if;
  begin
    perform crm.update_invoice_with_date(v_invoice.id,0,null,jsonb_set(v_items,'{0,unit_price}','119.99'),v_ops,v_invoice.version,0,null,null,null);
    raise exception 'invoice total fell below split receipts';
  exception when invalid_parameter_value then null;
  end;
  if (select sum(amount) from crm.invoice_payments where invoice_id=v_invoice.id)<>120 then
    raise exception 'receipt total was changed by editing the invoice';
  end if;

  perform set_config('crm.allow_adhoc_invoice','on',true);
  insert into crm.invoices(invoice_number,lead_id,status,subtotal,tax_rate,tax_amount,total,created_by,
    code_enforced,invoice_kind,consulting_doctor_name,referring_doctor_name)
    values('I33/LEGACY/001',v_lead,'paid',75,0,0,75,v_admin,false,'consultation','Dr. Test','Self') returning * into v_legacy;
  perform set_config('crm.allow_adhoc_invoice','off',true);
  v_items:='[{"description":"Consultation","quantity":1,"unit_price":75}]';
  select * into v_legacy from crm.update_invoice_with_date(v_legacy.id,0,'Historical correction',v_items,v_ops,v_legacy.version,0,null,null,v_new_date);
  if v_legacy.status<>'paid' or v_legacy.notes is distinct from 'Historical correction' then raise exception 'historic correction rejected'; end if;
  begin
    perform crm.update_invoice_with_date(v_legacy.id,0,null,jsonb_set(v_items,'{0,unit_price}','100'),v_ops,v_legacy.version,0,null,null,null);
    raise exception 'paid invoice without a receipt ledger lost its implicit settlement';
  exception when invalid_parameter_value then null;
  end;
  if has_function_privilege('authenticated','crm.update_invoice_with_date(uuid,numeric,text,jsonb,uuid,bigint,numeric,text,text,date)','execute') then
    raise exception 'invoice editing RPC was exposed to browser callers';
  end if;
end
$test$;

select 'ok 1 - audited edits recalculate paid invoice balances without changing receipts';
rollback;
