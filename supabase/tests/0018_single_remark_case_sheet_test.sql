-- Exercise the deployed clinical RPC chain, with isolated fixtures rolled back.
begin;
select '1..1';

do $test$
declare
  v_admin uuid := 'c1800000-0000-4000-8000-000000000001';
  v_doctor_profile uuid := 'c1800000-0000-4000-8000-000000000002';
  v_ops uuid := 'c1800000-0000-4000-8000-000000000003';
  v_front uuid := 'c1800000-0000-4000-8000-000000000004';
  v_branch uuid; v_doctor uuid; v_actor uuid; v_lead uuid; v_appointment uuid;
  v_sheet crm.case_sheets%rowtype;
  v_original_visit timestamptz;
  v_scheduled timestamptz := now() + interval '7 days';
  v_rejected boolean;
  v_index integer := 0;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (v_admin,'remarks-admin-18@example.test','{"full_name":"Remarks Admin"}'),
    (v_doctor_profile,'remarks-doctor-18@example.test','{"full_name":"Remarks Doctor"}'),
    (v_ops,'remarks-ops-18@example.test','{"full_name":"Remarks Ops"}'),
    (v_front,'remarks-front-18@example.test','{"full_name":"Remarks Front Desk"}');
  update crm.profiles set role='admin',is_active=true where id=v_admin;
  update crm.profiles set role='doctor',is_active=true where id=v_doctor_profile;
  update crm.profiles set role='operations',is_active=true where id=v_ops;
  update crm.profiles set role='front_office',is_active=true where id=v_front;
  insert into crm.branches(name,code) values('Single Remark Test Center','R18') returning id into v_branch;
  insert into crm.user_branches(user_id,branch_id) values
    (v_doctor_profile,v_branch),(v_ops,v_branch),(v_front,v_branch);
  insert into crm.doctors(branch_id,full_name,profile_id)
    values(v_branch,'Single Remark Doctor',v_doctor_profile) returning id into v_doctor;

  foreach v_actor in array array[v_admin,v_doctor_profile,v_ops,v_front] loop
    v_index := v_index + 1;
    insert into crm.leads(branch_id,name,mobile,status,assignee_id,created_by)
      values(v_branch,'Single Remark Patient','900000018'||v_index::text,'appointment_booked',v_front,v_admin) returning id into v_lead;
    insert into crm.appointments(lead_id,branch_id,doctor_id,scheduled_at,status,created_by)
      values(v_lead,v_branch,v_doctor,v_scheduled,'scheduled',v_admin) returning id into v_appointment;

    execute 'set local role service_role';
    v_rejected := false;
    begin
      perform crm.finalize_clinical_visit(
        v_lead,v_appointment,v_doctor,now(),'Routine review','One clinical remark',null,null,
        'reviewed_none',false,array[]::text[],null,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,v_actor
      );
    exception when invalid_parameter_value then v_rejected := true;
    end;
    if not v_rejected then raise exception 'simplified narrative bypassed medical-history review'; end if;

    select * into v_sheet from crm.finalize_clinical_visit(
      v_lead,v_appointment,v_doctor,now()-interval '10 years',
      'Routine review','Examination, assessment and next steps in one remark.',null,null,
      'reviewed_none',true,array[]::text[],null,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,v_actor
    );
    execute 'reset role';
    if v_sheet.findings <> 'Examination, assessment and next steps in one remark.'
       or v_sheet.diagnosis is not null or v_sheet.plan is not null
       or exists (select 1 from crm.treatments where case_sheet_id=v_sheet.id)
       or exists (select 1 from crm.tooth_assessments where case_sheet_id=v_sheet.id)
       or exists (select 1 from crm.prescription_items where case_sheet_id=v_sheet.id) then
      raise exception 'single-remark examination failed or created unwanted details for actor %',v_actor;
    end if;
    if (select status from crm.appointments where id=v_appointment) <> 'completed'
       or (select scheduled_at from crm.appointments where id=v_appointment) is distinct from v_scheduled
       or abs(extract(epoch from (v_sheet.visit_at-now()))) > 30 then
      raise exception 'case-sheet save changed appointment timing or failed to record server time';
    end if;
    v_original_visit := v_sheet.visit_at;

    execute 'set local role service_role';
    select * into v_sheet from crm.amend_clinical_visit(
      v_sheet.id,v_sheet.version,'Update clinical review',
      'Routine review','Updated single clinical remark.',null,null,
      'reviewed_none',true,array[]::text[],null,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,v_actor
    );
    execute 'reset role';
    if v_sheet.version <> 2 or v_sheet.findings <> 'Updated single clinical remark.'
       or v_sheet.diagnosis is not null or v_sheet.plan is not null
       or v_sheet.visit_at is distinct from v_original_visit
       or exists (select 1 from crm.treatments where case_sheet_id=v_sheet.id)
       or not exists (select 1 from crm.case_sheet_amendments where case_sheet_id=v_sheet.id
         and old_data->'case_sheet'->>'findings'='Examination, assessment and next steps in one remark.'
         and new_data->'case_sheet'->>'findings'='Updated single clinical remark.') then
      raise exception 'single-remark amendment failed preservation or audit for actor %',v_actor;
    end if;

    execute 'set local role service_role';
    v_rejected := false;
    begin
      perform crm.amend_clinical_visit(
        v_sheet.id,1,'Stale clinical review','Routine review','Stale remark',null,null,
        'reviewed_none',true,array[]::text[],null,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,v_actor
      );
    exception when serialization_failure then v_rejected := true;
    end;
    execute 'reset role';
    if not v_rejected then raise exception 'stale version accepted by simplified amendment'; end if;
  end loop;
end
$test$;

select 'ok 1 - single-remark visits finalize and amend without diagnosis, plan or treatment lines for admin, doctor, ops and front desk';
rollback;
