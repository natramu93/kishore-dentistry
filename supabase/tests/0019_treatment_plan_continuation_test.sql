-- Real signed-visit RPCs, invoked as the application service role. Fixtures roll back.
begin;
select '1..1';
do $test$
declare
  v_admin uuid := 'c1900000-0000-4000-8000-000000000001';
  v_ops uuid := 'c1900000-0000-4000-8000-000000000002';
  v_front uuid := 'c1900000-0000-4000-8000-000000000003';
  v_doc uuid := 'c1900000-0000-4000-8000-000000000004';
  v_outsider uuid := 'c1900000-0000-4000-8000-000000000005';
  v_branch uuid; v_other_branch uuid; v_doctor uuid; v_other_doctor uuid;
  v_lead uuid; v_other_lead uuid; v_appointment uuid; v_actor uuid;
  v_source crm.case_sheets%rowtype; v_sheet crm.case_sheets%rowtype;
  v_plan uuid; v_completion uuid; v_rejected boolean; v_line jsonb; v_bad jsonb;
  v_index integer := 0;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (v_admin,'plan-admin@example.test','{"full_name":"Plan Admin"}'),
    (v_ops,'plan-ops@example.test','{"full_name":"Plan Ops"}'),
    (v_front,'plan-front@example.test','{"full_name":"Plan Front"}'),
    (v_doc,'plan-doctor@example.test','{"full_name":"Plan Doctor"}'),
    (v_outsider,'plan-outsider@example.test','{"full_name":"Other Doctor"}');
  update crm.profiles set role='admin',is_active=true where id=v_admin;
  update crm.profiles set role='operations',is_active=true where id=v_ops;
  update crm.profiles set role='front_office',is_active=true where id=v_front;
  update crm.profiles set role='doctor',is_active=true where id in (v_doc,v_outsider);
  insert into crm.branches(name,code) values('Continuation Center','P19') returning id into v_branch;
  insert into crm.branches(name,code) values('Other Continuation Center','P19B') returning id into v_other_branch;
  insert into crm.user_branches(user_id,branch_id) values (v_ops,v_branch),(v_front,v_branch),(v_doc,v_branch),(v_outsider,v_other_branch);
  insert into crm.doctors(branch_id,full_name,profile_id) values(v_branch,'Plan Doctor',v_doc) returning id into v_doctor;
  insert into crm.doctors(branch_id,full_name,profile_id) values(v_other_branch,'Other Plan Doctor',v_outsider) returning id into v_other_doctor;

  foreach v_actor in array array[v_admin,v_ops,v_front,v_doc] loop
    v_index := v_index+1;
    insert into crm.leads(branch_id,name,mobile,status,assignee_id,created_by)
      values(v_branch,'Plan Patient','900000019'||v_index,'appointment_booked',v_front,v_admin) returning id into v_lead;
    insert into crm.appointments(lead_id,branch_id,doctor_id,scheduled_at,status,created_by)
      values(v_lead,v_branch,v_doctor,now()+interval '1 day','scheduled',v_admin) returning id into v_appointment;
    v_line := jsonb_build_object('treatment_code','K02.9','status','planned','site_scope','multi_tooth',
      'site_detail',null,'tooth_number','16','tooth_numbers',jsonb_build_array('16','26'),
      'surfaces',jsonb_build_array('occlusal'),'quantity',1,'unit_price',0,'notes','Original plan note must survive');
    execute 'set local role service_role';
    select * into v_source from crm.finalize_clinical_visit(v_lead,v_appointment,v_doctor,now(),
      'Review','Discuss planned work',null,null,'reviewed_none',true,'{}',null,'[]',jsonb_build_array(v_line),'[]',v_actor);
    execute 'reset role';
    select id into v_plan from crm.treatments where case_sheet_id=v_source.id;
    insert into crm.appointments(lead_id,branch_id,doctor_id,scheduled_at,status,created_by)
      values(v_lead,v_branch,v_doctor,now()+interval '2 days','scheduled',v_admin) returning id into v_appointment;
    v_line := v_line || jsonb_build_object('planned_treatment_id',v_plan,'status','completed','site_scope','tooth',
      'tooth_numbers',jsonb_build_array('16'),'notes','Treated 16 today');

    -- Authorization must still be enforced inside the existing signed-visit workflow.
    execute 'set local role service_role';
    v_rejected := false;
    begin
      perform crm.finalize_clinical_visit(v_lead,v_appointment,v_doctor,now(),'Review','Today',null,null,
        'reviewed_none',true,'{}',null,'[]',jsonb_build_array(v_line),'[]',v_outsider);
    exception when insufficient_privilege then v_rejected:=true; end;
    if not v_rejected then raise exception 'wrong-branch actor continued a plan'; end if;
    select * into v_sheet from crm.finalize_clinical_visit(v_lead,v_appointment,v_doctor,now(),
      'Review','Today work',null,null,'reviewed_none',true,'{}',null,'[]',jsonb_build_array(v_line),'[]',v_actor);
    execute 'reset role';
    select id into v_completion from crm.treatments where case_sheet_id=v_sheet.id;
    if not exists(select 1 from crm.treatments where id=v_plan and clinical_status='planned' and notes='Original plan note must survive')
       or not exists(select 1 from crm.treatments where id=v_completion and planned_treatment_id=v_plan and clinical_status='completed')
       or not exists(select 1 from crm.clinical_treatment_progress where id=v_plan and is_pending and remaining_tooth_numbers=array['26']) then
      raise exception 'partial continuation lost lineage, old notes, or unresolved teeth';
    end if;

    -- Exact explicit linkage is needed, not just a completed code on the same tooth.
    insert into crm.appointments(lead_id,branch_id,doctor_id,scheduled_at,status,created_by)
      values(v_lead,v_branch,v_doctor,now()+interval '3 days','scheduled',v_admin) returning id into v_appointment;
    execute 'set local role service_role';
    v_rejected:=false;
    if not exists(select 1 from crm.clinical_treatment_progress where id=v_plan and is_pending and remaining_tooth_numbers=array['26']) then
      raise exception 'application service role cannot read the correct pending plan';
    end if;
    begin
      perform crm.finalize_clinical_visit(v_lead,v_appointment,v_doctor,now(),'Review','Overlap',null,null,
        'reviewed_none',true,'{}',null,'[]',jsonb_build_array(v_line),'[]',v_actor);
    exception when check_violation then v_rejected:=true; end;
    if not v_rejected then raise exception 'duplicate completion accepted'; end if;
    foreach v_bad in array array[
      v_line || jsonb_build_object('status','planned'),
      v_line || jsonb_build_object('tooth_number','36','tooth_numbers',jsonb_build_array('36')),
      v_line || jsonb_build_object('surfaces',jsonb_build_array('mesial')),
      v_line || jsonb_build_object('planned_treatment_id',v_completion)
    ] loop
      v_rejected:=false;
      begin
        perform crm.finalize_clinical_visit(v_lead,v_appointment,v_doctor,now(),'Review','Invalid continuation',null,null,
          'reviewed_none',true,'{}',null,'[]',jsonb_build_array(v_bad),'[]',v_actor);
      exception when check_violation then v_rejected:=true; end;
      if not v_rejected then raise exception 'invalid status, outside tooth, surface, or completion chain accepted'; end if;
    end loop;
    execute 'reset role';
    if exists(select 1 from crm.case_sheets where appointment_id=v_appointment)
       or (select status from crm.appointments where id=v_appointment)<>'scheduled' then
      raise exception 'failed continuation was not atomic';
    end if;

    -- Even within24h the source identity/status cannot change after later care.
    v_bad := (v_line-'planned_treatment_id') || jsonb_build_object('treatment_id',v_plan,
      'status','completed','site_scope','multi_tooth','tooth_numbers',jsonb_build_array('16','26'));
    execute 'set local role service_role';
    v_rejected:=false;
    begin
      perform crm.amend_clinical_visit(v_source.id,v_source.version,'Change old plan','Review','New narrative',null,null,
        'reviewed_none',true,'{}',null,'[]',jsonb_build_array(v_bad),'[]',v_actor);
    exception when check_violation then v_rejected:=true; end;
    if not v_rejected then raise exception 'source with later care changed status'; end if;
    v_rejected:=false;
    begin
      perform crm.amend_clinical_visit(v_source.id,v_source.version,'Remove old plan','Review','New narrative',null,null,
        'reviewed_none',true,'{}',null,'[]','[]','[]',v_actor);
    exception when foreign_key_violation or object_not_in_prerequisite_state then v_rejected:=true; end;
    if not v_rejected then raise exception 'source with later care was removed'; end if;

    -- A child can be corrected within24h and history retains the prior state.
    v_line := v_line || jsonb_build_object('treatment_id',v_completion,'notes','Corrected completion note');
    select * into v_sheet from crm.amend_clinical_visit(v_sheet.id,v_sheet.version,'Clarify completion note','Review','Today work',null,null,
      'reviewed_none',true,'{}',null,'[]',jsonb_build_array(v_line),'[]',v_actor);
    execute 'reset role';
    if not exists(select 1 from crm.case_sheet_amendments where case_sheet_id=v_sheet.id
      and old_data->'treatments'->0->>'planned_treatment_id'=v_plan::text
      and new_data->'treatments'->0->>'notes'='Corrected completion note') then
      raise exception 'completion amendment lost source lineage or audit';
    end if;
    execute 'set local role service_role';
    v_rejected:=false;
    begin
      perform crm.amend_clinical_visit(v_sheet.id,v_sheet.version,'Remove lineage link','Review','Today work',null,null,
        'reviewed_none',true,'{}',null,'[]',jsonb_build_array(v_line-'planned_treatment_id'),'[]',v_actor);
    exception when check_violation then v_rejected:=true; end;
    if not v_rejected then raise exception 'existing signed completion lost its source'; end if;
    execute 'reset role';

    -- Age only the isolated fixture, then prove new care works without reopening it.
    alter table crm.case_sheets disable trigger protect_case_sheet_update_delete;
    update crm.case_sheets set created_at=now()-interval '2 days',finalized_at=now()-interval '2 days' where id=v_source.id;
    alter table crm.case_sheets enable trigger protect_case_sheet_update_delete;
    execute 'set local role service_role';
    v_rejected:=false;
    begin
      perform crm.amend_clinical_visit(v_source.id,v_source.version,'Old plan correction','Review','Expired',null,null,
        'reviewed_none',true,'{}',null,'[]','[]','[]',v_actor);
    exception when object_not_in_prerequisite_state then v_rejected:=true; end;
    if not v_rejected then raise exception '24-hour amendment limit was bypassed'; end if;
    v_line := (v_line-'treatment_id') || jsonb_build_object('tooth_number','26','tooth_numbers',jsonb_build_array('26'),'notes','Remaining tooth treated');
    perform crm.finalize_clinical_visit(v_lead,v_appointment,v_doctor,now(),'Review','Remaining care',null,null,
      'reviewed_none',true,'{}',null,'[]',jsonb_build_array(v_line),'[]',v_actor);
    execute 'reset role';
    if not exists(select 1 from crm.clinical_treatment_progress where id=v_plan and not is_pending and remaining_tooth_numbers='{}') then
      raise exception 'explicit final completion did not resolve plan';
    end if;
  end loop;

  -- Cross-patient and cross-center plan IDs are invalid even for an admin.
  insert into crm.leads(branch_id,name,mobile,status,created_by)
    values(v_other_branch,'Other Plan Patient','9000000199','appointment_booked',v_admin) returning id into v_other_lead;
  insert into crm.appointments(lead_id,branch_id,doctor_id,scheduled_at,status,created_by)
    values(v_other_lead,v_other_branch,v_other_doctor,now()+interval '4 days','scheduled',v_admin) returning id into v_appointment;
  execute 'set local role service_role';
  v_rejected:=false;
  begin
    perform crm.finalize_clinical_visit(v_other_lead,v_appointment,v_other_doctor,now(),'Review','Wrong plan',null,null,
      'reviewed_none',true,'{}',null,'[]',jsonb_build_array(v_line),'[]',v_admin);
  exception when check_violation then v_rejected:=true; end;
  if not v_rejected then raise exception 'cross-patient cross-center source accepted'; end if;
  execute 'reset role';
  if has_table_privilege('anon','crm.clinical_treatment_progress','select')
     or has_table_privilege('authenticated','crm.clinical_treatment_progress','select') then
    raise exception 'clinical progress view exposed outside server authorization';
  end if;
end
$test$;
select 'ok 1 - signed planned care continues safely across visits with partial teeth, explicit completion, actor scope, unchanged24h rules and preserved audit';
rollback;
