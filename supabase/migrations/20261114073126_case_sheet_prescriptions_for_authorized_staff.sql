-- Prescription entry follows the same patient, role and visit scope as the
-- case sheet. Keep the locked authorization checks, validation and audit trail.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $migration$
declare
  v_definition text;
  v_doctor_lookup constant text := '  select * into v_doctor from crm.doctors where id = p_doctor_id;';
  v_finalize_restriction constant text := $anchor$  if jsonb_array_length(p_prescriptions) > 0 and not exists (
    select 1
    from crm.doctors doctor
    join crm.profiles profile on profile.id = doctor.profile_id
    where doctor.id = p_doctor_id
      and doctor.profile_id = p_actor
      and doctor.is_active
      and profile.is_active
      and profile.role::text = 'doctor'
  ) then
    raise exception 'only the treating doctor may sign prescription lines'
      using errcode = '42501';
  end if;

$anchor$;
  v_amend_restriction constant text := $anchor$    if not exists (
      select 1 from crm.doctors doctor where doctor.id = v_sheet.doctor_id
        and doctor.profile_id = p_actor and doctor.is_active
    ) then
      raise exception 'Only the treating doctor may amend prescriptions'
        using errcode = '42501';
    end if;
$anchor$;
  v_amend_comment constant text := $anchor$  -- Keep existing prescriptions unchanged for non-doctor amendments. Only the
  -- treating doctor may change or add a signed prescription.$anchor$;
begin
  -- Match the front-desk scope already used for amendment. The lead has been
  -- locked by this point, so a concurrent reassignment cannot bypass the check.
  v_definition := pg_get_functiondef(
    'crm.finalize_case_sheet(uuid,uuid,uuid,timestamptz,text,text,text,text,text,jsonb,uuid)'::regprocedure
  );
  if array_length(string_to_array(v_definition, v_doctor_lookup), 1) is distinct from 2 then
    raise exception 'Cannot safely extend case-sheet finalization with patient assignment scope';
  end if;
  execute replace(v_definition, v_doctor_lookup, $replacement$  if v_actor.role::text = 'front_office'
     and v_lead.assignee_id is distinct from p_actor
     and v_lead.assignee_id is not null then
    raise exception 'This patient is not assigned to you'
      using errcode = '42501';
  end if;

$replacement$ || v_doctor_lookup);

  -- The wrapper still delegates to the authorized finalizer before writing any
  -- prescription rows, and uses the real actor for the recorded signature.
  v_definition := pg_get_functiondef(
    'crm.finalize_clinical_visit(uuid,uuid,uuid,timestamptz,text,text,text,text,text,boolean,text[],text,jsonb,jsonb,jsonb,uuid)'::regprocedure
  );
  if array_length(string_to_array(v_definition, v_finalize_restriction), 1) is distinct from 2 then
    raise exception 'Cannot safely remove the prescription-only restriction on case-sheet finalization';
  end if;
  execute replace(v_definition, v_finalize_restriction, '');

  v_definition := pg_get_functiondef(
    'crm.amend_clinical_visit(uuid,integer,text,text,text,text,text,text,boolean,text[],text,jsonb,jsonb,jsonb,uuid)'::regprocedure
  );
  if array_length(string_to_array(v_definition, v_amend_restriction), 1) is distinct from 2
     or array_length(string_to_array(v_definition, v_amend_comment), 1) is distinct from 2 then
    raise exception 'Cannot safely remove the prescription-only restriction on case-sheet amendment';
  end if;
  execute replace(replace(v_definition, v_amend_restriction, ''), v_amend_comment,
    '  -- Preserve existing prescription rows when the editor has not changed them.');
end
$migration$;
