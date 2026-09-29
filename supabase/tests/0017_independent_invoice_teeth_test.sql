-- Real invoice RPC/trigger regression; all fixtures roll back, no live data required.
begin;
select '1..1';
do $test$
declare
  v_admin uuid := 'c1700000-0000-4000-8000-000000000001';
  v_other uuid := 'c1700000-0000-4000-8000-000000000002';
  v_branch uuid; v_other_branch uuid; v_lead uuid; v_type uuid; v_other_type uuid;
  v_invoice crm.invoices%rowtype; v_cancelled crm.invoices%rowtype;
  v_items jsonb; v_bad jsonb; v_count bigint; v_rejected boolean; v_treatment uuid;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (v_admin,'invoice-17@example.test','{"full_name":"Invoice Test Admin"}'),
    (v_other,'invoice-other-17@example.test','{"full_name":"Other Center Ops"}');
  update crm.profiles set role='admin',is_active=true where id=v_admin;
  update crm.profiles set role='operations',is_active=true where id=v_other;
  insert into crm.branches(name,code) values('Invoice Test Center','I17') returning id into v_branch;
  insert into crm.branches(name,code) values('Other Invoice Center','I17B') returning id into v_other_branch;
  insert into crm.user_branches(user_id,branch_id) values(v_other,v_other_branch);
  insert into crm.leads(branch_id,name,mobile,status,created_by)
    values(v_branch,'Invoice Test Patient','9000000017','open',v_admin) returning id into v_lead;
  insert into crm.treatment_types(branch_id,name,default_cost) values(v_branch,'Invoice restoration',200) returning id into v_type;
  insert into crm.treatment_types(branch_id,name,default_cost) values(v_other_branch,'Other restoration',200) returning id into v_other_type;
  v_items := jsonb_build_array(
    jsonb_build_object('treatment_type_id',v_type,'quantity',1,'unit_price',200,'tooth_numbers',jsonb_build_array('11','12'),'line_note','Discussed restoration'),
    jsonb_build_object('treatment_type_id',v_type,'quantity',2,'unit_price',300,'tooth_numbers',jsonb_build_array('55'),'line_note','Primary tooth'));
  execute 'set local role service_role';
  select * into v_invoice from crm.create_patient_invoice(v_lead,10,100,'Admin','Review next week','Invoice remark',v_items,v_admin);
  execute 'reset role';
  if v_invoice.treatment_id is not null or v_invoice.total <> 770 or v_invoice.discount_amount <> 100
     or (select count(*) from crm.treatments where lead_id=v_lead) <> 0
     or (select count(*) from crm.case_sheets where lead_id=v_lead) <> 0 then
    raise exception 'standalone invoice unexpectedly requires or creates clinical records / miscalculates totals';
  end if;
  if not exists (select 1 from crm.invoice_items where invoice_id=v_invoice.id and tooth_numbers=array['11','12']
    and site_scope='multi_tooth' and tooth_number='11' and line_note='Discussed restoration' and quantity=1)
    or not exists (select 1 from crm.invoice_items where invoice_id=v_invoice.id and tooth_numbers=array['55'] and site_scope='tooth') then
    raise exception 'catalog tooth selection / notes lost in insert trigger';
  end if;
  select jsonb_agg(jsonb_build_object('invoice_item_id',id,'treatment_type_id',treatment_type_id,
    'quantity',quantity,'unit_price',unit_price,'tooth_numbers',tooth_numbers,'line_note',line_note))
    into v_items from crm.invoice_items where invoice_id=v_invoice.id;
  execute 'set local role service_role';
  select * into v_invoice from crm.update_invoice(v_invoice.id,10,'Updated remark',v_items,v_admin,v_invoice.version);
  execute 'reset role';
  if v_invoice.total <> 770 or v_invoice.discount_amount <> 100 or v_invoice.discount_given_by <> 'Admin' or v_invoice.mention <> 'Review next week' then
    raise exception 'editing independent invoice lost its discount metadata';
  end if;
  execute 'set local role service_role';
  select * into v_invoice from crm.update_invoice(v_invoice.id,10,'Updated remark',v_items,v_admin,v_invoice.version,50,'Center head','Follow up');
  execute 'reset role';
  if v_invoice.total <> 825 or v_invoice.discount_amount <> 50 or v_invoice.discount_given_by <> 'Center head'
     or v_invoice.mention <> 'Follow up' or not exists
       (select 1 from crm.invoice_items where invoice_id=v_invoice.id and tooth_numbers=array['11','12'] and line_note='Discussed restoration') then
    raise exception 'editing discount, teeth or note failed';
  end if;
  v_rejected := false;
  begin
    perform crm.update_invoice(v_invoice.id,10,'Stale',v_items,v_admin,v_invoice.version-1);
  exception when serialization_failure then v_rejected := true;
  end;
  if not v_rejected then raise exception 'stale invoice edit accepted'; end if;
  v_rejected := false;
  begin
    perform crm.create_patient_invoice(v_lead,0,0,null,null,null,v_items,v_other);
  exception when insufficient_privilege then v_rejected := true;
  end;
  if not v_rejected then raise exception 'cross-center actor created invoice'; end if;
  select count(*) into v_count from crm.invoices;
  for v_bad in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('tooth_numbers',jsonb_build_array('11','11')),
    jsonb_build_object('tooth_numbers',jsonb_build_array('99')),
    jsonb_build_object('tooth_numbers',jsonb_build_array(11)),
    jsonb_build_object('tooth_numbers','11'),
    jsonb_build_object('line_note',repeat('x',1001)),
    jsonb_build_object('treatment_type_id',v_other_type)
  )) loop
    v_rejected := false;
    begin
      perform crm.create_patient_invoice(v_lead,0,0,null,null,null,jsonb_build_array((v_items->0)||v_bad),v_admin);
    exception when invalid_parameter_value or check_violation then v_rejected := true;
    end;
    if not v_rejected then raise exception 'invalid tooth/note/center data accepted: %',v_bad; end if;
  end loop;
  if (select count(*) from crm.invoices) <> v_count then raise exception 'failed invoice creation left partial records'; end if;
  select * into v_cancelled from crm.create_patient_invoice(v_lead,0,0,null,null,null,v_items,v_admin);
  perform crm.cancel_invoice(v_cancelled.id,v_admin,'Regression test');
  v_rejected := false;
  begin
    perform crm.update_invoice(v_cancelled.id,0,null,v_items,v_admin,null);
  exception when object_not_in_prerequisite_state then v_rejected := true;
  end;
  if not v_rejected then raise exception 'cancelled invoice edit accepted'; end if;
  if exists (select 1 from crm.invoice_items where invoice_id=v_cancelled.id and active_billing) then
    raise exception 'cancelled invoice retained active billing references';
  end if;
  v_rejected := false;
  begin
    perform crm.record_invoice_payment(v_cancelled.id,10,'cash',null,null,v_admin);
  exception when object_not_in_prerequisite_state then v_rejected := true;
  end;
  if not v_rejected or exists (select 1 from crm.invoice_payments where invoice_id=v_cancelled.id) then
    raise exception 'cancelled invoice accepted a payment';
  end if;
  v_rejected := false;
  begin
    update crm.invoices set status='cancelled' where id=v_invoice.id;
  exception when object_not_in_prerequisite_state then v_rejected := true;
  end;
  if not v_rejected then raise exception 'direct invoice cancellation bypassed admin workflow'; end if;
  update crm.treatment_types set name='Renamed restoration' where id=v_type;
  execute 'set local role service_role';
  select * into v_invoice from crm.update_invoice(v_invoice.id,10,'Note after catalog rename',v_items,v_admin,v_invoice.version,50,'Center head','Follow up');
  execute 'reset role';
  if exists (select 1 from crm.invoice_items where invoice_id=v_invoice.id and description<>'Invoice restoration')
     or exists (select 1 from jsonb_array_elements(v_items) e where not exists
       (select 1 from crm.invoice_items ii where ii.id=(e.value->>'invoice_item_id')::uuid and ii.invoice_id=v_invoice.id)) then
    raise exception 'unchanged invoice line snapshots / stable IDs lost on note edit after catalog rename';
  end if;
  update crm.treatment_types set is_active=false where id=v_type;
  execute 'set local role service_role';
  perform crm.delete_invoice(v_cancelled.id,v_admin,'Archive after catalog retirement',null);
  execute 'reset role';
  if not exists (select 1 from crm.invoices where id=v_cancelled.id and deleted_at is not null)
     or exists (select 1 from crm.invoice_items where invoice_id=v_cancelled.id and active_billing) then
    raise exception 'archiving historical invoice after catalog retirement failed';
  end if;
  execute 'set local role service_role';
  perform crm.record_invoice_payment(v_invoice.id,100,'cash',null,null,v_admin);
  execute 'reset role';
  if not exists (select 1 from crm.invoice_items where invoice_id=v_invoice.id and description='Invoice restoration') then
    raise exception 'retiring/renaming catalog changed invoice snapshot';
  end if;
  v_rejected := false;
  begin
    perform crm.update_invoice(v_invoice.id,10,'Change after receipt',v_items,v_admin,null,50,'Admin',null);
  exception when object_not_in_prerequisite_state then v_rejected := true;
  end;
  if not v_rejected then raise exception 'partially paid invoice lines were replaced at equal total'; end if;
  execute 'set local role service_role';
  perform crm.record_invoice_payment(v_invoice.id,725,'upi','TEST',null,v_admin);
  execute 'reset role';
  if (select status from crm.invoices where id=v_invoice.id) <> 'paid'
     or (select sum(amount) from crm.invoice_payments where invoice_id=v_invoice.id) <> 825 then
    raise exception 'split payments for historical catalog invoice failed';
  end if;
  -- The narrow row-lock privilege never permits direct clinical edits/identity changes.
  if not has_column_privilege('service_role','crm.treatments','id','UPDATE')
     or has_column_privilege('service_role','crm.treatments','notes','UPDATE') then
    raise exception 'treatment row-lock privilege is not narrowly scoped';
  end if;
  perform set_config('crm.allow_legacy_test_records','on',true);
  update crm.treatment_types set is_active=true where id=v_type;
  insert into crm.treatments(lead_id,branch_id,treatment_type_id,created_by)
    values(v_lead,v_branch,v_type,v_admin) returning id into v_treatment;
  execute 'set local role service_role';
  perform 1 from crm.treatments where id=v_treatment for update;
  perform set_config('crm.amending_case_sheet','00000000-0000-4000-8000-000000000001',true);
  v_rejected := false;
  begin
    update crm.treatments set notes='Unauthorized direct clinical change' where id=v_treatment;
  exception when insufficient_privilege then v_rejected := true;
  end;
  if not v_rejected then raise exception 'clinical column update privilege was broadened'; end if;
  v_rejected := false;
  begin
    update crm.treatments set id=gen_random_uuid() where id=v_treatment;
  exception when object_not_in_prerequisite_state then v_rejected := true;
  end;
  if not v_rejected then raise exception 'treatment identity changed by service role'; end if;
  execute 'reset role';
  if not exists (select 1 from crm.treatments where id=v_treatment) then raise exception 'original treatment identity lost'; end if;
  if has_function_privilege('anon','crm.invoice_line_teeth(jsonb)','execute')
     or has_function_privilege('authenticated','crm.insert_invoice_lines(uuid,jsonb,boolean)','execute')
     or has_function_privilege('authenticated','crm.update_invoice(uuid,numeric,text,jsonb,uuid,bigint,numeric,text,text)','execute') then
    raise exception 'private invoice functions exposed';
  end if;
end
$test$;
select 'ok 1 - standalone invoices preserve teeth, notes and discounts with access and atomicity guards';
rollback;
