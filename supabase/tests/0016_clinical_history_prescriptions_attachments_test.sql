-- Dependency-free TAP-compatible regression test for longitudinal medical
-- history, signed prescriptions, private attachment metadata and lead outcomes.
begin;

select '1..1';

do $test$
declare
  v_admin constant uuid := 'c1600000-0000-4000-8000-000000000001';
  v_doctor_profile constant uuid := 'c1600000-0000-4000-8000-000000000002';
  v_branch uuid;
  v_doctor uuid;
  v_lead uuid;
  v_appointment uuid;
  v_sheet crm.case_sheets%rowtype;
  v_history crm.patient_medical_history_versions%rowtype;
  v_invalid_lead uuid;
  v_invalid_appointment uuid;
  v_follow_up_lead uuid;
  v_attachment_id uuid := gen_random_uuid();
  v_invalid_attachment_id uuid := gen_random_uuid();
  v_rejected boolean;
begin
  if has_table_privilege('anon', 'crm.patient_medical_history_versions', 'select')
     or has_table_privilege('authenticated', 'crm.patient_medical_history_versions', 'select')
     or not has_table_privilege('service_role', 'crm.patient_medical_history_versions', 'select')
     or has_table_privilege('service_role', 'crm.patient_medical_history_versions', 'insert')
     or not has_table_privilege('service_role', 'crm.prescription_items', 'select')
     or has_table_privilege('service_role', 'crm.prescription_items', 'insert')
     or not has_table_privilege('service_role', 'crm.case_sheet_attachments', 'select')
     or not has_table_privilege('service_role', 'crm.case_sheet_attachments', 'insert')
     or not has_table_privilege('service_role', 'crm.case_sheet_attachments', 'update')
     or has_table_privilege('service_role', 'crm.case_sheets', 'insert')
     or has_table_privilege('service_role', 'crm.treatments', 'insert')
     or has_table_privilege('service_role', 'crm.treatments', 'update') then
    raise exception 'clinical table privileges are unsafe';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname='crm'
      and relation.relname in (
        'patient_medical_history_versions','case_sheet_medical_history',
        'prescription_items','case_sheet_attachments'
      )
      and not relation.relrowsecurity
  ) then
    raise exception 'clinical tables must keep row-level security enabled';
  end if;

  if not has_function_privilege(
       'service_role',
       'crm.finalize_clinical_visit(uuid,uuid,uuid,timestamptz,text,text,text,text,text,boolean,text[],text,jsonb,jsonb,jsonb,uuid)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'crm.finalize_clinical_visit(uuid,uuid,uuid,timestamptz,text,text,text,text,text,boolean,text[],text,jsonb,jsonb,jsonb,uuid)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'crm.finalize_clinical_visit(uuid,uuid,uuid,timestamptz,text,text,text,text,text,boolean,text[],text,jsonb,jsonb,jsonb,uuid)',
       'execute'
     )
     or has_function_privilege(
       'service_role',
       'crm.finalize_case_sheet(uuid,uuid,uuid,timestamptz,text,text,text,text,text,jsonb,uuid)',
       'execute'
     )
     or has_function_privilege(
       'service_role',
       'crm.finalize_case_sheet_with_odontogram(uuid,uuid,uuid,timestamptz,text,text,text,text,text,jsonb,jsonb,uuid)',
       'execute'
     )
     or not (
       select p.prosecdef
       from pg_catalog.pg_proc p
       where p.oid = 'crm.finalize_clinical_visit(uuid,uuid,uuid,timestamptz,text,text,text,text,text,boolean,text[],text,jsonb,jsonb,jsonb,uuid)'::regprocedure
     ) then
    raise exception 'clinical finalizer privileges are unsafe';
  end if;

  insert into auth.users(id,email,raw_user_meta_data) values
    (v_admin,'clinical-admin@example.test','{"full_name":"Clinical Admin"}'),
    (v_doctor_profile,'clinical-doctor@example.test','{"full_name":"Clinical Doctor"}');
  update crm.profiles set role='admin',is_active=true where id=v_admin;
  update crm.profiles set role='doctor',is_active=true where id=v_doctor_profile;

  insert into crm.branches(name,code)
  values('Clinical Details Test Branch','H16')
  returning id into v_branch;
  insert into crm.user_branches(user_id,branch_id)
  values(v_doctor_profile,v_branch);
  insert into crm.doctors(branch_id,full_name,profile_id)
  values(v_branch,'Clinical Doctor',v_doctor_profile)
  returning id into v_doctor;

  insert into crm.leads(branch_id,name,mobile,status,created_by)
  values(v_branch,'Clinical Details Patient','9000000016','appointment_booked',v_admin)
  returning id into v_lead;
  insert into crm.appointments(lead_id,branch_id,doctor_id,scheduled_at,status,created_by)
  values(v_lead,v_branch,v_doctor,'2022-01-16T09:00:00Z','scheduled',v_admin)
  returning id into v_appointment;

  execute 'set local role service_role';
  v_rejected := false;
  begin
    perform crm.finalize_clinical_visit(
      v_lead,v_appointment,v_doctor,'2022-01-16T09:05:00Z',
      'Tooth pain','Clinical examination','Pulpitis','Root canal planning',
      'reviewed_none',false,array[]::text[],null,
      '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,v_doctor_profile
    );
  exception when sqlstate '22023' then
    v_rejected := true;
  end;
  if not v_rejected then
    execute 'reset role';
    raise exception 'unconfirmed medical history was accepted';
  end if;

  v_rejected := false;
  begin
    perform crm.finalize_clinical_visit(
      v_lead,v_appointment,v_doctor,'2022-01-16T09:05:00Z',
      'Tooth pain','Clinical examination','Pulpitis','Root canal planning',
      'reviewed_none',true,array[]::text[],null,
      '[]'::jsonb,'[]'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'medicine_name','Amoxicillin','morning',true,'noon',false,'night',false,
        'food_timing','after_food'
      )),
      v_admin
    );
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  if not v_rejected then
    execute 'reset role';
    raise exception 'a non-treating account signed prescription lines';
  end if;

  begin
    select * into v_sheet from crm.finalize_clinical_visit(
      v_lead,v_appointment,v_doctor,'2022-01-16T09:05:00Z',
      'Tooth pain','Clinical examination','Pulpitis','Root canal planning',
      'reviewed_conditions',true,array['diabetes','hypertension']::text[],
      'Diabetes and blood pressure controlled with regular medication',
      jsonb_build_array(jsonb_build_object(
        'tooth_number','36','tooth_state','present',
        'conditions',jsonb_build_array('caries'),
        'surfaces',jsonb_build_array('occlusal'),
        'clinical_findings','Deep occlusal caries','diagnosis','Pulpitis',
        'prognosis','good','recommended_action','endodontic',
        'future_plan','Root canal treatment'
      )),
      jsonb_build_array(jsonb_build_object(
        'treatment_code','TMT_108','status','planned','site_scope','tooth',
        'tooth_number','36','surfaces',jsonb_build_array('occlusal'),
        'quantity',1,'unit_price',2500,'notes','Discussed with patient'
      )),
      jsonb_build_array(
        jsonb_build_object(
          'medicine_name','Amoxicillin','strength','500 mg','dosage','1 capsule',
          'morning',true,'noon',true,'night',true,
          'food_timing','after_food','duration_days',5,'instructions','Complete the course'
        ),
        jsonb_build_object(
          'medicine_name','Paracetamol','strength','500 mg','dosage','1 tablet',
          'morning',false,'noon',false,'night',true,
          'food_timing','after_food','duration_days',3
        )
      ),
      v_doctor_profile
    );
  exception when others then
    execute 'reset role';
    raise;
  end;
  execute 'reset role';

  select * into v_history
  from crm.patient_medical_history_versions
  where lead_id=v_lead
  order by recorded_at desc,created_at desc,id desc
  limit 1;

  if v_sheet.id is null
     or not v_history.reviewed_with_patient
     or v_history.conditions <> array['diabetes','hypertension']::text[]
     or v_history.description <> 'Diabetes and blood pressure controlled with regular medication'
     or not exists (
       select 1 from crm.case_sheet_medical_history link
       where link.case_sheet_id=v_sheet.id
         and link.medical_history_version_id=v_history.id
     )
     or (select count(*) from crm.prescription_items where case_sheet_id=v_sheet.id) <> 2
     or (select count(*) from crm.treatments where case_sheet_id=v_sheet.id) <> 1 then
    raise exception 'clinical finalizer did not persist the signed visit details';
  end if;

  v_rejected := false;
  begin
    update crm.prescription_items set medicine_name='Changed'
    where case_sheet_id=v_sheet.id;
  exception when object_not_in_prerequisite_state then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'signed prescription remained mutable';
  end if;

  v_rejected := false;
  begin
    insert into crm.case_sheet_attachments(
      id,case_sheet_id,lead_id,branch_id,category,object_path,
      original_name,mime_type,size_bytes,status,uploaded_at,sha256_hex,created_by
    ) values (
      v_invalid_attachment_id,v_sheet.id,v_lead,v_branch,'xray',
      v_branch::text || '/' || v_lead::text || '/' || v_sheet.id::text || '/' || v_invalid_attachment_id::text || '.png',
      'unverified.png','image/png',1024,'ready',now(),repeat('a',64),v_doctor_profile
    );
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'attachment metadata bypassed pending verification';
  end if;

  insert into crm.case_sheet_attachments(
    id,case_sheet_id,lead_id,branch_id,category,object_path,
    original_name,mime_type,size_bytes,created_by
  ) values (
    v_attachment_id,v_sheet.id,v_lead,v_branch,'xray',
    v_branch::text || '/' || v_lead::text || '/' || v_sheet.id::text || '/' || v_attachment_id::text || '.png',
    'xray.png','image/png',1024,v_doctor_profile
  );
  update crm.case_sheet_attachments
  set status='ready',uploaded_at=now(),sha256_hex=repeat('b',64)
  where id=v_attachment_id;
  v_rejected := false;
  begin
    update crm.case_sheet_attachments set original_name='renamed.png'
    where id=v_attachment_id;
  exception when object_not_in_prerequisite_state then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'ready attachment metadata remained mutable';
  end if;

  -- A bad prescription must roll back the inner case-sheet finalizer as one
  -- transaction, including appointment and lead status changes.
  insert into crm.leads(branch_id,name,mobile,status,created_by)
  values(v_branch,'Invalid Prescription Patient','9000000116','appointment_booked',v_admin)
  returning id into v_invalid_lead;
  insert into crm.appointments(lead_id,branch_id,doctor_id,scheduled_at,status,created_by)
  values(v_invalid_lead,v_branch,v_doctor,'2022-02-16T09:00:00Z','scheduled',v_admin)
  returning id into v_invalid_appointment;

  v_rejected := false;
  execute 'set local role service_role';
  begin
    perform crm.finalize_clinical_visit(
      v_invalid_lead,v_invalid_appointment,v_doctor,'2022-02-16T09:05:00Z',
      'Review','Examination','Assessment','Observe',
      'reviewed_none',true,array[]::text[],null,
      '[]'::jsonb,'[]'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'medicine_name','Invalid duration','morning',true,'noon',false,'night',false,
        'food_timing','not_applicable','duration_days',1.5
      )),
      v_doctor_profile
    );
  exception when sqlstate '22023' then
    v_rejected := true;
  end;
  execute 'reset role';
  if not v_rejected
     or (select status from crm.leads where id=v_invalid_lead) <> 'appointment_booked'
     or (select status from crm.appointments where id=v_invalid_appointment) <> 'scheduled'
     or exists (select 1 from crm.case_sheets where appointment_id=v_invalid_appointment)
     or exists (select 1 from crm.patient_medical_history_versions where lead_id=v_invalid_lead)
     or exists (select 1 from crm.prescription_items where lead_id=v_invalid_lead) then
    raise exception 'invalid prescription did not roll back the visit atomically';
  end if;

  -- Follow-ups may be years in the future; closed is now a read-only legacy
  -- state and cannot be newly entered.
  insert into crm.leads(branch_id,name,mobile,status,created_by)
  values(v_branch,'Future Follow-up Patient','9000000216','visited_treated',v_admin)
  returning id into v_follow_up_lead;
  perform crm.transition_lead(
    v_follow_up_lead,'follow_up',v_admin,
    jsonb_build_object('due_at','2046-01-16T09:00:00Z','reason','Long-term review')
  );
  if (select status from crm.leads where id=v_follow_up_lead) <> 'follow_up'
     or not exists (
       select 1 from crm.follow_ups
       where lead_id=v_follow_up_lead
         and due_at='2046-01-16T09:00:00Z'::timestamptz
         and status='pending'
     ) then
    raise exception 'far-future follow-up was not preserved';
  end if;

  v_rejected := false;
  begin
    perform crm.transition_lead(
      v_follow_up_lead,'closed',v_admin,'{}'::jsonb
    );
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected
     or (select status from crm.leads where id=v_follow_up_lead) <> 'follow_up'
     or not exists (
       select 1 from crm.follow_ups
       where lead_id=v_follow_up_lead
         and due_at='2046-01-16T09:00:00Z'::timestamptz
         and status='pending'
     ) then
    raise exception 'retired closed status remained reachable';
  end if;
end
$test$;

select 'ok 1 - medical history, prescriptions, attachments and lead outcomes are constrained';

rollback;
