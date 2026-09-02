-- Dependency-free TAP-compatible regression test for general tooth assessments.
begin;

select '1..1';

do $test$
declare
  v_admin constant uuid := 'c1500000-0000-4000-8000-000000000001';
  v_doctor_profile constant uuid := 'c1500000-0000-4000-8000-000000000002';
  v_branch uuid;
  v_doctor uuid;
  v_lead uuid;
  v_appointment uuid;
  v_second_appointment uuid;
  v_sheet crm.case_sheets%rowtype;
  v_second_sheet crm.case_sheets%rowtype;
  v_legacy_rpc_lead uuid;
  v_legacy_rpc_appointment uuid;
  v_legacy_rpc_sheet crm.case_sheets%rowtype;
  v_invalid_lead uuid;
  v_invalid_appointment uuid;
  v_rejected boolean;
begin
  if has_table_privilege('anon', 'crm.tooth_assessments', 'select')
     or has_table_privilege('authenticated', 'crm.tooth_assessments', 'select')
     or not has_table_privilege('service_role', 'crm.tooth_assessments', 'select')
     or has_table_privilege('service_role', 'crm.tooth_assessments', 'insert')
     or has_table_privilege('service_role', 'crm.tooth_assessments', 'update')
     or has_table_privilege('service_role', 'crm.tooth_assessments', 'delete') then
    raise exception 'tooth assessment table privileges are unsafe';
  end if;
  if not has_function_privilege(
       'service_role',
       'crm.finalize_case_sheet_with_odontogram(uuid,uuid,uuid,timestamptz,text,text,text,text,text,jsonb,jsonb,uuid)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'crm.finalize_case_sheet_with_odontogram(uuid,uuid,uuid,timestamptz,text,text,text,text,text,jsonb,jsonb,uuid)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'crm.finalize_case_sheet_with_odontogram(uuid,uuid,uuid,timestamptz,text,text,text,text,text,jsonb,jsonb,uuid)',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'crm.finalize_case_sheet(uuid,uuid,uuid,timestamptz,text,text,text,text,text,jsonb,uuid)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'crm.finalize_case_sheet(uuid,uuid,uuid,timestamptz,text,text,text,text,text,jsonb,uuid)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'crm.finalize_case_sheet(uuid,uuid,uuid,timestamptz,text,text,text,text,text,jsonb,uuid)',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'crm.current_tooth_assessments(uuid)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'crm.current_tooth_assessments(uuid)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'crm.current_tooth_assessments(uuid)',
       'execute'
     )
     or not (
       select p.prosecdef
       from pg_catalog.pg_proc p
       where p.oid = 'crm.finalize_case_sheet_with_odontogram(uuid,uuid,uuid,timestamptz,text,text,text,text,text,jsonb,jsonb,uuid)'::regprocedure
     ) then
    raise exception 'odontogram finalizer privileges are unsafe';
  end if;

  insert into auth.users(id,email,raw_user_meta_data) values
    (v_admin,'odontogram-admin@example.test','{"full_name":"Odontogram Admin"}'),
    (v_doctor_profile,'odontogram-doctor@example.test','{"full_name":"Odontogram Doctor"}');
  update crm.profiles set role='admin',is_active=true where id=v_admin;
  update crm.profiles set role='doctor',is_active=true where id=v_doctor_profile;

  insert into crm.branches(name,code)
  values('Odontogram Test Branch','H15')
  returning id into v_branch;
  insert into crm.user_branches(user_id,branch_id)
  values(v_doctor_profile,v_branch);
  insert into crm.doctors(branch_id,full_name,profile_id)
  values(v_branch,'Odontogram Doctor',v_doctor_profile)
  returning id into v_doctor;

  insert into crm.leads(branch_id,name,mobile,status,created_by)
  values(v_branch,'Odontogram Patient','9000000015','appointment_booked',v_admin)
  returning id into v_lead;
  insert into crm.appointments(lead_id,branch_id,doctor_id,scheduled_at,status,created_by)
  values(v_lead,v_branch,v_doctor,'2021-01-15T09:00:00Z','scheduled',v_admin)
  returning id into v_appointment;

  execute 'set local role service_role';
  begin
    select * into v_sheet from crm.finalize_case_sheet_with_odontogram(
      v_lead,v_appointment,v_doctor,'2021-01-15T09:05:00Z',
      'Routine examination','General examination completed','Dental assessment',
      'Monitor and review',null,
      jsonb_build_array(
        jsonb_build_object(
          'tooth_number','11','tooth_state','present',
          'conditions',jsonb_build_array('caries','sensitivity'),
          'surfaces',jsonb_build_array('mesial','facial'),
          'clinical_findings','Early enamel lesion','diagnosis','Initial caries',
          'prognosis','good','recommended_action','preventive',
          'future_plan','Review at the next visit','notes','Baseline assessment'
        ),
        jsonb_build_object(
          'tooth_number','55','tooth_state','sound',
          'conditions','[]'::jsonb,'surfaces','[]'::jsonb,
          'clinical_findings','No abnormality detected','prognosis','good',
          'recommended_action','monitor'
        )
      ),
      '[]'::jsonb,
      v_doctor_profile
    );
  exception when others then
    execute 'reset role';
    raise;
  end;
  execute 'reset role';

  if (select status from crm.appointments where id=v_appointment) <> 'completed'
     or (select status from crm.leads where id=v_lead) <> 'visited_treated'
     or (select count(*) from crm.treatments where case_sheet_id=v_sheet.id) <> 0
     or (select count(*) from crm.tooth_assessments where case_sheet_id=v_sheet.id) <> 2 then
    raise exception 'assessment-only case-sheet finalization was not atomic';
  end if;

  if not exists (
    select 1
    from crm.tooth_assessments a
    where a.case_sheet_id=v_sheet.id
      and a.lead_id=v_lead
      and a.branch_id=v_branch
      and a.appointment_id=v_appointment
      and a.doctor_id=v_doctor
      and a.tooth_number='11'
      and a.tooth_state='present'
      and a.conditions = array['caries','sensitivity']::text[]
      and a.surfaces = array['mesial','facial']::text[]
      and a.clinical_findings='Early enamel lesion'
      and a.diagnosis='Initial caries'
      and a.prognosis='good'
      and a.recommended_action='preventive'
      and a.future_plan='Review at the next visit'
      and a.notes='Baseline assessment'
      and a.assessed_at=v_sheet.visit_at
      and a.signed_at=v_sheet.finalized_at
      and a.signed_by=v_doctor_profile
      and a.created_by=v_doctor_profile
      and a.created_at=v_sheet.created_at
  ) then
    raise exception 'signed Indian Standard tooth assessment snapshot is incorrect';
  end if;

  if (
    select count(*)
    from crm.audit_log a
    where a.entity_type='tooth_assessment'
      and a.action='case_sheet_signed'
      and a.actor_id=v_doctor_profile
      and a.new_data->>'case_sheet_id'=v_sheet.id::text
  ) <> 2 or not exists (
    select 1
    from crm.audit_log a
    where a.entity_type='tooth_assessment'
      and a.action='case_sheet_signed'
      and a.actor_id=v_doctor_profile
      and a.new_data->>'case_sheet_id'=v_sheet.id::text
      and a.new_data->>'tooth_number'='11'
      and a.new_data->'surfaces'=jsonb_build_array('mesial','facial')
      and a.new_data->>'diagnosis'='Initial caries'
      and a.new_data->>'future_plan'='Review at the next visit'
      and a.new_data ? 'assessed_at'
  ) or not exists (
    select 1
    from crm.audit_log a
    where a.entity_type='case_sheet'
      and a.entity_id=v_sheet.id
      and a.action='odontogram_recorded'
      and (a.new_data->>'tooth_assessment_count')::integer=2
      and (a.new_data->>'treatment_count')::integer=0
  ) then
    raise exception 'tooth assessment audit entries are incomplete';
  end if;

  begin
    update crm.tooth_assessments
    set clinical_findings='Tampered'
    where case_sheet_id=v_sheet.id and tooth_number='11';
    raise exception 'signed tooth assessment remained mutable';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    delete from crm.tooth_assessments
    where case_sheet_id=v_sheet.id and tooth_number='11';
    raise exception 'signed tooth assessment remained deletable';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    truncate crm.tooth_assessments;
    raise exception 'signed tooth assessment table remained truncatable';
  exception when object_not_in_prerequisite_state then null;
  end;

  perform set_config('crm.finalizing_case_sheet', '', true);
  begin
    insert into crm.tooth_assessments(
      case_sheet_id,lead_id,branch_id,appointment_id,doctor_id,tooth_number,
      tooth_state,assessed_at,signed_at,signed_by,created_by
    ) values (
      v_sheet.id,v_lead,v_branch,v_appointment,v_doctor,'12','sound',
      v_sheet.visit_at,v_sheet.finalized_at,v_doctor_profile,v_doctor_profile
    );
    raise exception 'direct tooth assessment insert unexpectedly succeeded';
  exception when object_not_in_prerequisite_state then null;
  end;

  -- Even a forged finalization setting cannot bypass the RPC boundary because
  -- the service role has no direct INSERT privilege on signed snapshots.
  perform set_config('crm.finalizing_case_sheet', v_sheet.id::text, true);
  execute 'set local role service_role';
  begin
    insert into crm.tooth_assessments(
      case_sheet_id,lead_id,branch_id,appointment_id,doctor_id,tooth_number,
      tooth_state,assessed_at,signed_at,signed_by,created_by
    ) values (
      v_sheet.id,v_lead,v_branch,v_appointment,v_doctor,'12','sound',
      v_sheet.visit_at,v_sheet.finalized_at,v_doctor_profile,v_doctor_profile
    );
    execute 'reset role';
    raise exception 'service role directly appended a signed tooth assessment';
  exception when insufficient_privilege then
    execute 'reset role';
  end;
  perform set_config('crm.finalizing_case_sheet', '', true);

  v_rejected := false;
  begin
    perform crm.create_invoice(
      v_lead,null,0,'No completed coded treatment',
      jsonb_build_array(jsonb_build_object(
        'description','Assessment is not billable','quantity',1,'unit_price',100
      )),v_admin
    );
  exception when check_violation or invalid_parameter_value then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'tooth assessment unexpectedly became invoiceable';
  end if;

  -- A later visit may reassess the same tooth. Both signed rows remain, and
  -- the newest visit can be selected as the current patient odontogram.
  perform crm.transition_lead(
    v_lead,'follow_up',v_admin,
    jsonb_build_object('due_at','2021-02-15T09:00:00Z','reason','Clinical review')
  );
  perform crm.transition_lead(
    v_lead,'appointment_booked',v_admin,
    jsonb_build_object(
      'scheduled_at','2021-02-15T09:00:00Z','doctor_id',v_doctor,
      'duration_minutes',30,'notes','Odontogram review'
    )
  );
  select id into v_second_appointment
  from crm.appointments
  where lead_id=v_lead and status='scheduled'
  order by scheduled_at desc
  limit 1;

  select * into v_second_sheet from crm.finalize_case_sheet_with_odontogram(
    v_lead,v_second_appointment,v_doctor,'2021-02-15T09:05:00Z',
    'Review','Reassessed tooth 11','Condition resolved','Continue prevention',null,
    jsonb_build_array(jsonb_build_object(
      'tooth_number','11','tooth_state','sound',
      'conditions','[]'::jsonb,'surfaces','[]'::jsonb,
      'clinical_findings','No active lesion','diagnosis','Sound tooth',
      'prognosis','good','recommended_action','monitor',
      'future_plan','Routine recall','notes','Later signed assessment'
    )),
    '[]'::jsonb,
    v_doctor_profile
  );

  if (select count(*) from crm.tooth_assessments where lead_id=v_lead and tooth_number='11') <> 2
     or (
       select tooth_state
       from crm.tooth_assessments
       where lead_id=v_lead and tooth_number='11'
       order by assessed_at desc, signed_at desc, id desc
       limit 1
     ) <> 'sound' then
    raise exception 'repeat tooth assessment history was not preserved';
  end if;
  if (select count(*) from crm.current_tooth_assessments(v_lead)) <> 2
     or (
       select tooth_state
       from crm.current_tooth_assessments(v_lead)
       where tooth_number='11'
     ) <> 'sound' then
    raise exception 'current tooth assessment projection is incorrect';
  end if;

  -- Invalid or duplicate assessments roll back the case sheet, appointment,
  -- lead transition, and every child row as one transaction.
  insert into crm.leads(branch_id,name,mobile,status,created_by)
  values(v_branch,'Invalid Odontogram Patient','9000000115','appointment_booked',v_admin)
  returning id into v_invalid_lead;
  insert into crm.appointments(lead_id,branch_id,doctor_id,scheduled_at,status,created_by)
  values(v_invalid_lead,v_branch,v_doctor,'2021-03-15T09:00:00Z','scheduled',v_admin)
  returning id into v_invalid_appointment;

  v_rejected := false;
  begin
    perform crm.finalize_case_sheet_with_odontogram(
      v_invalid_lead,v_invalid_appointment,v_doctor,now() + interval '1 minute',
      'Review','Future dated input','Assessment','Review',null,
      '[]'::jsonb,
      '[]'::jsonb,
      v_doctor_profile
    );
  exception when invalid_parameter_value then
    v_rejected := true;
  end;
  if not v_rejected
     or (select status from crm.appointments where id=v_invalid_appointment) <> 'scheduled'
     or (select status from crm.leads where id=v_invalid_lead) <> 'appointment_booked'
     or exists (select 1 from crm.case_sheets where appointment_id=v_invalid_appointment) then
    raise exception 'near-future clinical history was not rejected atomically';
  end if;

  v_rejected := false;
  begin
    perform crm.finalize_case_sheet_with_odontogram(
      v_invalid_lead,v_invalid_appointment,v_doctor,'2021-03-15T09:05:00Z',
      'Review','Future treatment time','Assessment','Review',null,
      '[]'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'treatment_code','TMT_108','status','completed','site_scope','tooth',
        'tooth_number','21','surfaces',jsonb_build_array('facial'),
        'quantity',1,'unit_price',100,'performed_at',(now() + interval '1 minute')::text
      )),
      v_doctor_profile
    );
  exception when invalid_parameter_value then
    v_rejected := true;
  end;
  if not v_rejected
     or (select status from crm.appointments where id=v_invalid_appointment) <> 'scheduled'
     or (select status from crm.leads where id=v_invalid_lead) <> 'appointment_booked'
     or exists (select 1 from crm.case_sheets where appointment_id=v_invalid_appointment)
     or exists (select 1 from crm.treatments where lead_id=v_invalid_lead) then
    raise exception 'future completed-treatment time was not rejected atomically';
  end if;

  v_rejected := false;
  begin
    perform crm.finalize_case_sheet_with_odontogram(
      v_invalid_lead,v_invalid_appointment,v_doctor,'2021-03-15T09:05:00Z',
      'Review','Infinite treatment time','Assessment','Review',null,
      '[]'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'treatment_code','TMT_108','status','completed','site_scope','tooth',
        'tooth_number','21','surfaces',jsonb_build_array('facial'),
        'quantity',1,'unit_price',100,'performed_at','infinity'
      )),
      v_doctor_profile
    );
  exception when invalid_parameter_value then
    v_rejected := true;
  end;
  if not v_rejected
     or (select status from crm.appointments where id=v_invalid_appointment) <> 'scheduled'
     or exists (select 1 from crm.case_sheets where appointment_id=v_invalid_appointment)
     or exists (select 1 from crm.treatments where lead_id=v_invalid_lead) then
    raise exception 'infinite completed-treatment time was not rejected atomically';
  end if;

  v_rejected := false;
  begin
    perform crm.finalize_case_sheet_with_odontogram(
      v_invalid_lead,v_invalid_appointment,v_doctor,'2021-03-15T09:05:00Z',
      'Review','Duplicate input','Assessment','Review',null,
      jsonb_build_array(
        jsonb_build_object('tooth_number','21','tooth_state','sound'),
        jsonb_build_object('tooth_number','21','tooth_state','present')
      ),
      '[]'::jsonb,
      v_doctor_profile
    );
  exception when invalid_parameter_value or unique_violation then
    v_rejected := true;
  end;
  if not v_rejected
     or (select status from crm.appointments where id=v_invalid_appointment) <> 'scheduled'
     or (select status from crm.leads where id=v_invalid_lead) <> 'appointment_booked'
     or exists (select 1 from crm.case_sheets where appointment_id=v_invalid_appointment)
     or exists (select 1 from crm.tooth_assessments where lead_id=v_invalid_lead) then
    raise exception 'duplicate odontogram input was not rejected safely';
  end if;

  v_rejected := false;
  begin
    perform crm.finalize_case_sheet_with_odontogram(
      v_invalid_lead,v_invalid_appointment,v_doctor,'2021-03-15T09:05:00Z',
      'Review','Invalid surface input','Assessment','Review',null,
      jsonb_build_array(jsonb_build_object(
        'tooth_number','21','tooth_state','missing',
        'conditions','[]'::jsonb,'surfaces',jsonb_build_array('facial')
      )),
      jsonb_build_array(jsonb_build_object(
        'treatment_code','TMT_108','status','completed','site_scope','tooth',
        'tooth_number','21','surfaces',jsonb_build_array('facial'),
        'quantity',1,'unit_price',100,'performed_at','2021-03-15T09:05:00Z'
      )),
      v_doctor_profile
    );
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected
     or (select status from crm.appointments where id=v_invalid_appointment) <> 'scheduled'
     or (select status from crm.leads where id=v_invalid_lead) <> 'appointment_booked'
     or exists (select 1 from crm.case_sheets where appointment_id=v_invalid_appointment)
     or exists (select 1 from crm.treatments where lead_id=v_invalid_lead)
     or exists (select 1 from crm.tooth_assessments where lead_id=v_invalid_lead) then
    raise exception 'invalid odontogram did not roll back atomically';
  end if;

  v_rejected := false;
  begin
    perform crm.finalize_case_sheet_with_odontogram(
      v_invalid_lead,v_invalid_appointment,v_doctor,'2021-03-15T09:05:00Z',
      'Review','Invalid tooth input','Assessment','Review',null,
      jsonb_build_array(jsonb_build_object(
        'tooth_number','19','tooth_state','sound',
        'conditions','[]'::jsonb,'surfaces','[]'::jsonb
      )),
      '[]'::jsonb,
      v_doctor_profile
    );
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected
     or (select status from crm.appointments where id=v_invalid_appointment) <> 'scheduled'
     or (select status from crm.leads where id=v_invalid_lead) <> 'appointment_booked'
     or exists (select 1 from crm.case_sheets where appointment_id=v_invalid_appointment)
     or exists (select 1 from crm.tooth_assessments where lead_id=v_invalid_lead) then
    raise exception 'invalid Indian Standard tooth number did not roll back atomically';
  end if;

  -- Existing callers can finalize a visit with an empty treatment array while
  -- the application moves to the odontogram-aware wrapper RPC.
  insert into crm.leads(branch_id,name,mobile,status,created_by)
  values(v_branch,'Compatible RPC Patient','9000000215','appointment_booked',v_admin)
  returning id into v_legacy_rpc_lead;
  insert into crm.appointments(lead_id,branch_id,doctor_id,scheduled_at,status,created_by)
  values(v_legacy_rpc_lead,v_branch,v_doctor,'2021-04-15T09:00:00Z','scheduled',v_admin)
  returning id into v_legacy_rpc_appointment;

  execute 'set local role service_role';
  begin
    select * into v_legacy_rpc_sheet from crm.finalize_case_sheet(
    v_legacy_rpc_lead,v_legacy_rpc_appointment,v_doctor,'2021-04-15T09:05:00Z',
      'Consultation','General assessment','Observation only','Review later',null,
      '[]'::jsonb,
      v_admin
    );
  exception when others then
    execute 'reset role';
    raise;
  end;
  execute 'reset role';
  if v_legacy_rpc_sheet.id is null
     or exists (select 1 from crm.treatments where case_sheet_id=v_legacy_rpc_sheet.id) then
    raise exception 'compatible finalization RPC still required a treatment';
  end if;
end
$test$;

select 'ok 1 - general tooth assessments are signed, immutable, historical, and non-billable';

rollback;
