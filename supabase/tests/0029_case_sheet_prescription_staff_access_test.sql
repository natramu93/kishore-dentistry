-- Test both server-only workflows with synthetic records. No fixtures persist.
begin;
select '1..1';

do $test$
declare
  v_admin uuid := gen_random_uuid();
  v_front uuid := gen_random_uuid();
  v_ops uuid := gen_random_uuid();
  v_head uuid := gen_random_uuid();
  v_doctor_profile uuid := gen_random_uuid();
  v_other_doctor uuid := gen_random_uuid();
  v_other_front uuid := gen_random_uuid();
  v_other_ops uuid := gen_random_uuid();
  v_inactive uuid := gen_random_uuid();
  v_authors uuid[] := array[v_doctor_profile,v_front,v_ops,v_head,v_admin];
  v_editors uuid[] := array[v_front,v_ops,v_head,v_admin,v_doctor_profile];
  v_unpermitted uuid[] := array[v_other_doctor,v_other_front,v_other_ops,v_inactive];
  v_branch uuid;
  v_other_branch uuid;
  v_lead uuid;
  v_doctor uuid;
  v_appointment uuid;
  v_sheet crm.case_sheets%rowtype;
  v_prescription crm.prescription_items%rowtype;
  v_lines jsonb := '[{"medicine_name":"Recorded medicine","morning":true}]';
  v_updated jsonb;
  v_actor uuid;
  v_rpc regprocedure;
  v_index integer;
begin
  foreach v_rpc in array array[
    'crm.finalize_clinical_visit(uuid,uuid,uuid,timestamptz,text,text,text,text,text,boolean,text[],text,jsonb,jsonb,jsonb,uuid)'::regprocedure,
    'crm.amend_clinical_visit(uuid,integer,text,text,text,text,text,text,boolean,text[],text,jsonb,jsonb,jsonb,uuid)'::regprocedure
  ] loop
    if has_function_privilege('anon',v_rpc,'execute')
       or has_function_privilege('authenticated',v_rpc,'execute')
       or not has_function_privilege('service_role',v_rpc,'execute') then
      raise exception 'unsafe access to case-sheet workflow: %',v_rpc;
    end if;
  end loop;
  if has_table_privilege('service_role','crm.prescription_items','insert,update,delete,truncate') then
    raise exception 'the application could bypass the audited prescription workflow';
  end if;

  insert into auth.users(id,email,raw_user_meta_data)
  select id,id::text || '@prescription.example.test',jsonb_build_object('full_name','Test staff')
  from unnest(v_authors || v_unpermitted) as staff(id);
  update crm.profiles p set role=s.staff_role::crm.user_role,is_active=(p.id<>v_inactive)
  from (values (v_admin,'admin'),(v_front,'front_office'),(v_ops,'operations'),
    (v_head,'clinical_head'),(v_doctor_profile,'doctor'),(v_other_doctor,'doctor'),
    (v_other_front,'front_office'),(v_other_ops,'operations'),(v_inactive,'operations')) s(id,staff_role)
  where p.id=s.id;
  insert into crm.branches(name,code) values('Prescription Test Center','RX29') returning id into v_branch;
  insert into crm.branches(name,code) values('Other Prescription Test Center','RX29B') returning id into v_other_branch;
  insert into crm.user_branches(user_id,branch_id)
  select id,case when id=v_other_ops then v_other_branch else v_branch end
  from unnest(v_authors || v_unpermitted) as staff(id) where id<>v_admin;
  insert into crm.doctors(branch_id,full_name,profile_id) values(v_branch,'Treating Dentist',v_doctor_profile)
    returning id into v_doctor;
  insert into crm.doctors(branch_id,full_name,profile_id) values(v_branch,'Other Dentist',v_other_doctor);

  for v_index in 1..cardinality(v_authors) loop
    insert into crm.leads(branch_id,name,mobile,status,assignee_id,created_by)
      values(v_branch,'Prescription Test Patient','900000029'||v_index,'appointment_booked',v_front,v_admin)
      returning id into v_lead;
    insert into crm.appointments(lead_id,branch_id,doctor_id,scheduled_at,status,created_by)
      values(v_lead,v_branch,v_doctor,now(),'scheduled',v_admin) returning id into v_appointment;

    execute 'set local role service_role';
    if v_index=1 then
      foreach v_actor in array v_unpermitted loop
        begin
          perform crm.finalize_clinical_visit(v_lead,v_appointment,v_doctor,now(),'Review','Exam recorded',null,null,
            'reviewed_none',true,'{}',null,'[]','[]',v_lines,v_actor);
          raise exception 'out-of-scope staff member % could create a prescription',v_actor;
        exception when insufficient_privilege then null;
        end;
      end loop;
    end if;

    select * into v_sheet from crm.finalize_clinical_visit(
      v_lead,v_appointment,v_doctor,now(),'Review','Exam recorded',null,null,
      'reviewed_none',true,'{}',null,'[]','[]',v_lines,v_authors[v_index]);
    select * into strict v_prescription from crm.prescription_items where case_sheet_id=v_sheet.id;
    if v_prescription.doctor_id is distinct from v_doctor
       or v_prescription.signed_by is distinct from v_authors[v_index]
       or v_prescription.created_by is distinct from v_authors[v_index] then
      raise exception 'wrong doctor or actor on recorded prescription';
    end if;

    v_updated := jsonb_build_array((v_lines->0) || jsonb_build_object(
      'client_id',v_prescription.id,'instructions','Correction from the treating doctor'));
    if v_index=1 then
      foreach v_actor in array v_unpermitted loop
        begin
          perform crm.amend_clinical_visit(v_sheet.id,v_sheet.version,'Correct instructions','Review','Exam recorded',null,null,
            'reviewed_none',true,'{}',null,'[]','[]',v_updated,v_actor);
          raise exception 'out-of-scope staff member % could amend a prescription',v_actor;
        exception when insufficient_privilege then null;
        end;
      end loop;

      -- Changing narrative alone must not re-record the original prescription.
      select * into v_sheet from crm.amend_clinical_visit(
        v_sheet.id,v_sheet.version,'Clarify clinical visit','Review','Exam clarified',null,null,
        'reviewed_none',true,'{}',null,'[]','[]',
        jsonb_build_array((v_lines->0) || jsonb_build_object('client_id',v_prescription.id)),v_front);
      if not exists(select 1 from crm.prescription_items where id=v_prescription.id and signed_by=v_doctor_profile) then
        raise exception 'a case-sheet-only amendment replaced the original prescription';
      end if;

      begin
        perform crm.amend_clinical_visit(v_sheet.id,v_sheet.version,'Try invalid entry','Review','Exam recorded',null,null,
          'reviewed_none',true,'{}',null,'[]','[]','[{"medicine_name":"Invalid schedule"}]',v_front);
        raise exception 'invalid prescription saved';
      exception when invalid_parameter_value then null;
      end;
      begin
        perform crm.amend_clinical_visit(v_sheet.id,v_sheet.version-1,'Try stale edit','Review','Exam recorded',null,null,
          'reviewed_none',true,'{}',null,'[]','[]',v_updated,v_front);
        raise exception 'stale prescription overwrite allowed';
      exception when serialization_failure then null;
      end;
    end if;

    select * into v_sheet from crm.amend_clinical_visit(
      v_sheet.id,v_sheet.version,'Correct instructions','Review','Exam recorded',null,null,
      'reviewed_none',true,'{}',null,'[]','[]',v_updated,v_editors[v_index]);
    if not exists(select 1 from crm.prescription_items
      where case_sheet_id=v_sheet.id and doctor_id=v_doctor and signed_by=v_editors[v_index]
        and created_by=v_editors[v_index] and instructions='Correction from the treating doctor')
      or not exists(select 1 from crm.case_sheet_amendments
      where case_sheet_id=v_sheet.id and revision=v_sheet.version and changed_by=v_editors[v_index]
        and old_data->'prescriptions'->0->>'id'=v_prescription.id::text
        and new_data->'prescriptions'->0->>'instructions'='Correction from the treating doctor') then
      raise exception 'amendment did not persist the prescription and both audit versions';
    end if;

    if v_index=1 then
      select * into v_sheet from crm.amend_clinical_visit(
        v_sheet.id,v_sheet.version,'Remove incorrectly recorded line','Review','Exam recorded',null,null,
        'reviewed_none',true,'{}',null,'[]','[]','[]',v_front);
      if exists(select 1 from crm.prescription_items where case_sheet_id=v_sheet.id) then
        raise exception 'front desk could not remove a prescription line';
      end if;

      execute 'reset role';
      -- Age only this synthetic fixture to verify the deadline at the database.
      alter table crm.case_sheets disable trigger protect_case_sheet_update_delete;
      update crm.case_sheets set created_at=now()-interval '25 hours',finalized_at=now()-interval '25 hours'
        where id=v_sheet.id;
      alter table crm.case_sheets enable trigger protect_case_sheet_update_delete;
      execute 'set local role service_role';
      begin
        perform crm.amend_clinical_visit(v_sheet.id,v_sheet.version,'Try late prescription edit','Review','Exam recorded',null,null,
          'reviewed_none',true,'{}',null,'[]','[]',v_lines,v_front);
        raise exception 'staff bypassed the 24-hour amendment window';
      exception when object_not_in_prerequisite_state then
        if sqlerrm<>'case-sheet amendment window has expired' then raise; end if;
      end;
    end if;
    execute 'reset role';
  end loop;
end
$test$;

select 'ok 1 - prescriptions follow case-sheet access, scope, audit and deadline';
rollback;
