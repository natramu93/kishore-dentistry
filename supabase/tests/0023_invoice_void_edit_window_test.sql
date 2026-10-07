-- All fixtures and mutations roll back; no production patient records are used.
begin;
select '1..1';
do $test$
declare
  v_admin uuid := 'c2300000-0000-4000-8000-000000000001';
  v_front uuid := 'c2300000-0000-4000-8000-000000000002';
  v_branch uuid; v_lead uuid; v_type uuid; v_items jsonb;
  v_invoice crm.invoices%rowtype; v_old crm.invoices%rowtype; v_rejected boolean;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (v_admin,'void-admin@example.test','{"full_name":"Invoice Void Admin"}'),
    (v_front,'void-front@example.test','{"full_name":"Invoice Void Front"}');
  update crm.profiles set role='admin',is_active=true where id=v_admin;
  update crm.profiles set role='front_office',is_active=true where id=v_front;
  insert into crm.branches(name,code) values('Invoice Void Center','I23') returning id into v_branch;
  insert into crm.user_branches(user_id,branch_id) values(v_front,v_branch);
  insert into crm.leads(branch_id,name,mobile,status,created_by)
    values(v_branch,'Invoice Void Patient','9000000023','open',v_admin) returning id into v_lead;
  insert into crm.treatment_types(branch_id,name,default_cost) values(v_branch,'Consultation',200) returning id into v_type;
  v_items := jsonb_build_array(jsonb_build_object('treatment_type_id',v_type,'quantity',1,'unit_price',200));
  execute 'set local role service_role';
  select * into v_invoice from crm.create_patient_invoice(v_lead,0,0,null,null,null,v_items,v_admin,'2026-08-01','Dr. Consulting','No referring doctor');
  if v_invoice.billing_date <> date '2026-08-01' then raise exception 'billing filter ignores selected invoice date'; end if;
  select * into v_invoice from crm.update_invoice(v_invoice.id,0,'Edited within 24 hours',v_items,v_admin,v_invoice.version);
  v_rejected:=false;
  begin perform crm.cancel_invoice(v_invoice.id,v_admin,'Wrong invoice',v_invoice.version-1);
  exception when serialization_failure then v_rejected:=true; end;
  if not v_rejected then raise exception 'stale void accepted'; end if;
  v_rejected:=false;
  begin perform crm.cancel_invoice(v_invoice.id,v_front,'Wrong invoice',v_invoice.version);
  exception when insufficient_privilege then v_rejected:=true; end;
  if not v_rejected then raise exception 'non-admin void accepted'; end if;
  v_rejected:=false;
  begin perform crm.cancel_invoice(v_invoice.id,v_admin,' ',v_invoice.version);
  exception when invalid_parameter_value then v_rejected:=true; end;
  if not v_rejected then raise exception 'empty void reason accepted'; end if;
  select * into v_invoice from crm.cancel_invoice(v_invoice.id,v_admin,'Wrong invoice',v_invoice.version);
  if v_invoice.status<>'cancelled' or v_invoice.void_reason<>'Wrong invoice' or v_invoice.voided_by<>v_admin or v_invoice.voided_at is null
    or v_invoice.deleted_at is not null or not exists(select 1 from crm.invoice_items where invoice_id=v_invoice.id) then
    raise exception 'void did not preserve invoice and lines with audited reason'; end if;
  if not exists(select 1 from crm.audit_log where entity_id=v_invoice.id and action='cancelled' and new_data->>'void_reason'='Wrong invoice') then
    raise exception 'void metadata not audited'; end if;
  select * into v_invoice from crm.create_consultation_invoice(v_lead,200,null,v_admin,'Dr. Consulting','No referring doctor');
  select * into v_invoice from crm.update_invoice(v_invoice.id,0,'Consultation correction',
    '[{"description":"Consultation","quantity":1,"unit_price":250}]',v_admin,v_invoice.version);
  if v_invoice.total<>250 then raise exception 'consultation invoice not editable'; end if;
  perform crm.record_invoice_payment(v_invoice.id,100,'cash',null,null,v_admin);
  v_rejected:=false;
  begin perform crm.cancel_invoice(v_invoice.id,v_admin,'Wrong invoice');
  exception when object_not_in_prerequisite_state then v_rejected:=true; end;
  if not v_rejected then raise exception 'partially paid invoice voided'; end if;
  v_rejected:=false;
  begin perform crm.update_invoice(v_invoice.id,0,null,'[{"description":"Consultation","quantity":1,"unit_price":300}]',v_admin);
  exception when object_not_in_prerequisite_state then v_rejected:=true; end;
  if not v_rejected then raise exception 'partially paid invoice edited'; end if;

  -- Seed a historical header directly: the insert is valid; late line editing is not.
  perform set_config('crm.allow_adhoc_invoice','on',true);
  insert into crm.invoices(invoice_number,lead_id,status,subtotal,tax_rate,tax_amount,total,created_by,
    code_enforced,invoice_kind,created_at,consulting_doctor_name,referring_doctor_name)
    values('I23/AGED/001',v_lead,'draft',200,0,0,200,v_admin,false,'consultation',
      clock_timestamp()-interval '24 hours','Dr. Consulting','No referring doctor') returning * into v_old;
  perform set_config('crm.allow_adhoc_invoice','off',true);
  v_rejected:=false;
  begin perform crm.update_invoice(v_old.id,0,null,'[{"description":"Consultation","quantity":1,"unit_price":300}]',v_admin);
  exception when object_not_in_prerequisite_state then v_rejected:=true; end;
  if not v_rejected then raise exception 'expired RPC editing accepted'; end if;
  v_rejected:=false;
  begin update crm.invoices set notes='Late change' where id=v_old.id;
  exception when object_not_in_prerequisite_state then v_rejected:=true; end;
  if not v_rejected then raise exception 'expired direct header edit accepted'; end if;
  v_rejected:=false;
  begin insert into crm.invoice_items(invoice_id,description,quantity,unit_price) values(v_old.id,'Late line',1,200);
  exception when object_not_in_prerequisite_state then v_rejected:=true; end;
  if not v_rejected then raise exception 'expired line insertion accepted'; end if;
  select * into v_old from crm.cancel_invoice(v_old.id,v_admin,'Old incorrect invoice',v_old.version);
  if v_old.status<>'cancelled' then raise exception 'old unpaid invoice cannot be voided'; end if;
  select * into v_invoice from crm.create_consultation_invoice(v_lead,200,null,v_admin,'Dr. Consulting','No referring doctor');
  perform crm.record_invoice_payment(v_invoice.id,200,'upi',null,null,v_admin);
  v_rejected:=false;
  begin perform crm.cancel_invoice(v_invoice.id,v_admin,'Paid incorrect invoice');
  exception when object_not_in_prerequisite_state then v_rejected:=true; end;
  if not v_rejected then raise exception 'fully paid invoice voided'; end if;
  if has_function_privilege('authenticated','crm.cancel_invoice(uuid,uuid,text,bigint)','execute') then
    raise exception 'void RPC exposed to public clients'; end if;
end
$test$;
select 'ok 1 - invoice date filters, edit deadline, audited voids and payment locks';
rollback;
