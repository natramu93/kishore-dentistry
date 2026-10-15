-- Synthetic fixtures only. The complete test and all records are rolled back.
begin;
select '1..1';
do $test$
declare
  v_admin uuid := 'c2500000-0000-4000-8000-000000000001';
  v_branch uuid; v_lead uuid; v_type uuid; v_zero_items jsonb;
  v_invoice crm.invoices%rowtype; v_consultation crm.invoices%rowtype;
  v_balance record; v_rejected boolean; v_amount numeric;
begin
  insert into auth.users(id,email,raw_user_meta_data)
    values(v_admin,'zero-invoice-admin@example.test','{"full_name":"Zero Invoice Admin"}');
  update crm.profiles set role='admin',is_active=true where id=v_admin;
  insert into crm.branches(name,code) values('Zero Invoice Test Center','I25') returning id into v_branch;
  insert into crm.leads(branch_id,name,mobile,status,created_by)
    values(v_branch,'Zero Invoice Test Patient','9000000025','open',v_admin) returning id into v_lead;
  insert into crm.treatment_types(branch_id,name,default_cost)
    values(v_branch,'Complimentary consultation',0) returning id into v_type;
  v_zero_items := jsonb_build_array(jsonb_build_object('treatment_type_id',v_type,'quantity',1,'unit_price',0,'tooth_numbers',jsonb_build_array('18','17')));
  execute 'set local role service_role';

  -- Earlier debt is not waived or moved into the complimentary invoice.
  -- now() is fixed within this transaction. Seed an explicitly earlier invoice
  -- rather than letting equal timestamps fall back to random UUID ordering.
  perform set_config('crm.allow_adhoc_invoice','on',true);
  insert into crm.invoices(invoice_number,lead_id,status,subtotal,tax_rate,tax_amount,total,created_by,
    code_enforced,invoice_kind,created_at,consulting_doctor_name,referring_doctor_name)
    values('I25/PRIOR/001',v_lead,'draft',200,0,0,200,v_admin,false,'consultation',
      now()-interval '1 minute','Dr. Consultant','No referring doctor') returning * into v_consultation;
  insert into crm.invoice_items(invoice_id,description,quantity,unit_price)
    values(v_consultation.id,'Consultation',1,200);
  perform set_config('crm.allow_adhoc_invoice','off',true);
  select * into v_invoice from crm.create_patient_invoice(v_lead,0,0,null,null,'Complimentary visit',
    v_zero_items,v_admin,current_date,'Dr. Consultant','No referring doctor');
  if v_invoice.total<>0 or v_invoice.subtotal<>0 or v_invoice.tax_amount<>0 then
    raise exception 'zero-priced catalog invoice rejected or charged'; end if;
  if not exists(select 1 from crm.invoice_items where invoice_id=v_invoice.id and amount=0 and tooth_numbers=array['18','17']) then
    raise exception 'zero-priced invoice lost its tooth details'; end if;
  select * into v_balance from crm.get_invoice_patient_balance(v_invoice.id,v_admin);
  if v_balance.amount_paid<>0 or v_balance.invoice_due<>0 or v_balance.earlier_due<>200 or v_balance.overall_due<>200 then
    raise exception 'zero invoice changed earlier patient debt or fabricated a payment'; end if;
  if exists(select 1 from crm.invoice_payments where invoice_id=v_invoice.id) then
    raise exception 'zero invoice fabricated a receipt'; end if;
  select * into v_invoice from crm.transition_invoice_status(v_invoice.id,'sent',v_admin,v_invoice.version);
  select * into v_invoice from crm.update_invoice(v_invoice.id,0,'Zero-fee review',v_zero_items,v_admin,v_invoice.version);
  if v_invoice.total<>0 then raise exception 'zero invoice cannot be sent or edited'; end if;

  v_rejected:=false;
  begin perform crm.record_invoice_payment(v_invoice.id,0,'cash',null,null,v_admin);
  exception when invalid_parameter_value then v_rejected:=true; end;
  if not v_rejected then raise exception 'zero payment receipt accepted'; end if;
  v_rejected:=false;
  begin perform crm.record_invoice_payment(v_invoice.id,1,'cash',null,null,v_admin);
  exception when invalid_parameter_value then v_rejected:=true; end;
  if not v_rejected then raise exception 'payment accepted against zero due'; end if;
  select * into v_invoice from crm.cancel_invoice(v_invoice.id,v_admin,'Duplicate complimentary invoice',v_invoice.version);
  if v_invoice.status<>'cancelled' then raise exception 'zero invoice cannot be voided'; end if;

  -- Fully discounted charges remain valid zero-total invoices even with tax.
  select * into v_invoice from crm.create_patient_invoice(v_lead,18,200,'Center head',null,null,
    jsonb_build_array(jsonb_build_object('treatment_type_id',v_type,'quantity',1,'unit_price',200)),
    v_admin,current_date,'Dr. Consultant','No referring doctor');
  if v_invoice.total<>0 or v_invoice.subtotal<>200 or v_invoice.tax_amount<>0 or v_invoice.discount_amount<>200 then
    raise exception 'fully discounted invoice is not zero'; end if;

  -- Both legacy consultation creation and correction allow an explicit zero.
  select * into v_consultation from crm.create_consultation_invoice(v_lead,0,'Free follow-up',v_admin,'Dr. Consultant','No referring doctor');
  if v_consultation.total<>0 or v_consultation.invoice_kind<>'consultation' then
    raise exception 'complimentary consultation rejected'; end if;
  select * into v_consultation from crm.update_invoice(v_consultation.id,0,null,
    '[{"description":"Consultation","quantity":1,"unit_price":0}]',v_admin,v_consultation.version);
  if v_consultation.total<>0 then raise exception 'consultation cannot be corrected to zero'; end if;

  foreach v_amount in array array[-0.01,0.001,100000000,null,'NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric] loop
    v_rejected:=false;
    begin perform crm.create_consultation_invoice(v_lead,v_amount,null,v_admin,'Dr. Consultant','No referring doctor');
    exception when invalid_parameter_value then v_rejected:=true; end;
    if not v_rejected then raise exception 'invalid consultation amount accepted: %',v_amount; end if;
  end loop;
  v_rejected:=false;
  begin perform crm.create_patient_invoice(v_lead,0,0,null,null,null,'[]',v_admin,current_date,'Dr. Consultant','No referring doctor');
  exception when invalid_parameter_value then v_rejected:=true; end;
  if not v_rejected then raise exception 'empty zero invoice accepted'; end if;
  v_rejected:=false;
  begin perform crm.coded_invoice_items_subtotal(jsonb_build_array(jsonb_build_object('treatment_type_id',v_type,'quantity',1,'unit_price',-1)));
  exception when invalid_parameter_value then v_rejected:=true; end;
  if not v_rejected then raise exception 'negative price accepted'; end if;
  v_rejected:=false;
  begin perform crm.coded_invoice_items_subtotal(jsonb_build_array(jsonb_build_object('treatment_type_id',v_type,'quantity',0,'unit_price',0)));
  exception when invalid_parameter_value then v_rejected:=true; end;
  if not v_rejected then raise exception 'zero quantity accepted'; end if;
  if has_function_privilege('authenticated','crm.create_consultation_invoice(uuid,numeric,text,uuid,text,text)','execute')
    or has_function_privilege('anon','crm.create_consultation_invoice(uuid,numeric,text,uuid,text,text)','execute') then
    raise exception 'consultation RPC exposed to public clients'; end if;
end
$test$;
select 'ok 1 - zero invoices preserve debt, teeth, audit, receipt and access rules';
rollback;
