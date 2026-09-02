-- General, signed per-tooth assessments that remain independent of billable
-- treatment lines. Tooth numbers use Indian Standard IS 8815 two-digit
-- notation.

create table crm.tooth_assessments (
  id uuid primary key default gen_random_uuid(),
  case_sheet_id uuid not null references crm.case_sheets(id) on delete restrict,
  lead_id uuid not null references crm.leads(id) on delete restrict,
  branch_id uuid not null references crm.branches(id) on delete restrict,
  appointment_id uuid not null references crm.appointments(id) on delete restrict,
  doctor_id uuid not null references crm.doctors(id) on delete restrict,
  tooth_number text not null,
  tooth_state text not null,
  conditions text[] not null default array[]::text[],
  surfaces text[] not null default array[]::text[],
  clinical_findings text,
  diagnosis text,
  prognosis text,
  recommended_action text,
  future_plan text,
  notes text,
  assessed_at timestamptz not null,
  signed_at timestamptz not null,
  signed_by uuid not null references crm.profiles(id) on delete restrict,
  created_by uuid not null references crm.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint tooth_assessments_case_sheet_tooth_key unique (case_sheet_id, tooth_number),
  constraint tooth_assessments_tooth_number_check check (
    tooth_number ~ '^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$'
  ),
  constraint tooth_assessments_state_check check (
    tooth_state in ('sound','present','missing','unerupted','impacted','retained_root','implant')
  ),
  constraint tooth_assessments_conditions_check check (
    array_position(conditions, null) is null
    and conditions <@ array[
      'caries','existing_restoration','crown','bridge_abutment',
      'root_canal_treated','fracture','mobility','periodontal_involvement',
      'recession','wear_erosion','periapical_pathology','discoloration',
      'sensitivity','other'
    ]::text[]
  ),
  constraint tooth_assessments_surfaces_check check (
    array_position(surfaces, null) is null
    and surfaces <@ array[
      'mesial','distal','occlusal','incisal','buccal','lingual','palatal','facial'
    ]::text[]
  ),
  constraint tooth_assessments_sound_check check (
    tooth_state <> 'sound' or cardinality(conditions) = 0
  ),
  constraint tooth_assessments_surface_state_check check (
    tooth_state not in ('missing','unerupted','impacted','retained_root','implant')
    or cardinality(surfaces) = 0
  ),
  constraint tooth_assessments_prognosis_check check (
    prognosis is null or prognosis in ('good','fair','guarded','poor','hopeless')
  ),
  constraint tooth_assessments_recommended_action_check check (
    recommended_action is null or recommended_action in (
      'monitor','investigate','preventive','restorative','endodontic','periodontal',
      'surgical','prosthetic','orthodontic','referral','other'
    )
  ),
  constraint tooth_assessments_text_length_check check (
    coalesce(length(clinical_findings), 0) <= 2000
    and coalesce(length(diagnosis), 0) <= 1000
    and coalesce(length(future_plan), 0) <= 2000
    and coalesce(length(notes), 0) <= 2000
  ),
  constraint tooth_assessments_assessment_time_check check (assessed_at <= signed_at),
  constraint tooth_assessments_signature_time_check check (signed_at >= created_at)
);

comment on table crm.tooth_assessments
is 'Append-only signed tooth assessments, independent of treatment and invoice lines.';
comment on column crm.tooth_assessments.tooth_number
is 'Indian Standard IS 8815 two-digit tooth designation.';
comment on column crm.tooth_assessments.assessed_at
is 'Visit time copied from the parent finalized case sheet.';

create index tooth_assessments_lead_tooth_assessed_idx
  on crm.tooth_assessments (lead_id, tooth_number, assessed_at desc, signed_at desc, id desc);
create index tooth_assessments_branch_assessed_idx
  on crm.tooth_assessments (branch_id, assessed_at desc);
create index tooth_assessments_appointment_idx
  on crm.tooth_assessments (appointment_id);
create index tooth_assessments_doctor_assessed_idx
  on crm.tooth_assessments (doctor_id, assessed_at desc);
create index tooth_assessments_signed_by_idx
  on crm.tooth_assessments (signed_by);
create index tooth_assessments_created_by_idx
  on crm.tooth_assessments (created_by);

create function crm.enforce_tooth_assessment() returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_sheet crm.case_sheets%rowtype;
begin
  if current_setting('crm.finalizing_case_sheet', true) is distinct from new.case_sheet_id::text then
    raise exception 'tooth assessments may only be added while finalizing their case sheet'
      using errcode = '55000';
  end if;

  select * into v_sheet
  from crm.case_sheets
  where id = new.case_sheet_id;

  if not found or v_sheet.finalized_at is null then
    raise exception 'tooth assessment case sheet is missing or not finalized'
      using errcode = '23514';
  end if;
  if new.lead_id is distinct from v_sheet.lead_id
     or new.branch_id is distinct from v_sheet.branch_id
     or new.appointment_id is distinct from v_sheet.appointment_id
     or new.doctor_id is distinct from v_sheet.doctor_id then
    raise exception 'tooth assessment identity must match its case sheet'
      using errcode = '23514';
  end if;

  new.tooth_number := nullif(btrim(new.tooth_number), '');
  new.tooth_state := lower(nullif(btrim(new.tooth_state), ''));
  new.conditions := array(
    select lower(btrim(item))
    from unnest(coalesce(new.conditions, array[]::text[])) as condition_item(item)
  );
  new.surfaces := array(
    select lower(btrim(item))
    from unnest(coalesce(new.surfaces, array[]::text[])) as surface_item(item)
  );

  if cardinality(new.conditions) is distinct from (
       select count(distinct item)::integer from unnest(new.conditions) as condition_item(item)
     ) then
    raise exception 'a tooth condition cannot be selected more than once'
      using errcode = '22023';
  end if;
  if cardinality(new.surfaces) is distinct from (
       select count(distinct item)::integer from unnest(new.surfaces) as surface_item(item)
     ) then
    raise exception 'a tooth surface cannot be selected more than once'
      using errcode = '22023';
  end if;

  new.clinical_findings := nullif(btrim(new.clinical_findings), '');
  new.diagnosis := nullif(btrim(new.diagnosis), '');
  new.prognosis := lower(nullif(btrim(new.prognosis), ''));
  new.recommended_action := lower(nullif(btrim(new.recommended_action), ''));
  new.future_plan := nullif(btrim(new.future_plan), '');
  new.notes := nullif(btrim(new.notes), '');
  new.assessed_at := v_sheet.visit_at;
  new.signed_at := v_sheet.finalized_at;
  new.signed_by := v_sheet.signed_by;
  new.created_by := v_sheet.created_by;
  new.created_at := v_sheet.created_at;
  return new;
end
$function$;

create trigger enforce_tooth_assessment
  before insert on crm.tooth_assessments
  for each row execute function crm.enforce_tooth_assessment();

create trigger protect_tooth_assessment_update_delete
  before update or delete on crm.tooth_assessments
  for each row execute function crm.protect_finalized_clinical_record();
create trigger protect_tooth_assessment_truncate
  before truncate on crm.tooth_assessments
  for each statement execute function crm.protect_finalized_clinical_record();

-- Preserve the existing RPC signature for the deployed application, but a
-- case sheet is no longer required to contain a treatment. Billing remains
-- gated separately by completed coded treatment rows.
create or replace function crm.finalize_case_sheet(
  p_lead_id uuid,
  p_appointment_id uuid,
  p_doctor_id uuid,
  p_visit_at timestamptz,
  p_chief_complaint text,
  p_findings text,
  p_diagnosis text,
  p_plan text,
  p_medical_alerts text,
  p_treatments jsonb,
  p_actor uuid
) returns crm.case_sheets
language plpgsql
set search_path = ''
as $function$
declare
  v_actor crm.profiles%rowtype;
  v_lead crm.leads%rowtype;
  v_appointment crm.appointments%rowtype;
  v_doctor crm.doctors%rowtype;
  v_sheet crm.case_sheets%rowtype;
  v_item jsonb;
  v_treatment crm.treatments%rowtype;
  v_code text;
  v_status text;
  v_scope text;
  v_detail text;
  v_tooth text;
  v_surfaces text[];
  v_quantity numeric;
  v_cost numeric;
  v_performed_at timestamptz;
begin
  if p_actor is null or p_lead_id is null or p_appointment_id is null
     or p_doctor_id is null or p_visit_at is null then
    raise exception 'lead, appointment, doctor, visit time, and actor are required'
      using errcode = '22023';
  end if;
  if not isfinite(p_visit_at) or p_visit_at > now() then
    raise exception 'visit time cannot be in the future'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_treatments) is distinct from 'array'
     or jsonb_array_length(p_treatments) > 50 then
    raise exception 'case sheet accepts at most 50 treatment lines'
      using errcode = '22023';
  end if;

  select * into v_actor from crm.profiles where id = p_actor;
  if not found or not v_actor.is_active
     or v_actor.role::text not in ('admin','clinical_head','doctor') then
    raise exception 'actor is not authorized to finalize case sheets'
      using errcode = '42501';
  end if;
  select * into v_lead from crm.leads where id = p_lead_id for update;
  if not found or v_lead.deleted_at is not null then
    raise exception 'active lead % not found', p_lead_id using errcode = 'P0002';
  end if;
  if v_lead.status <> 'appointment_booked' then
    raise exception 'lead must have a booked appointment before case-sheet finalization'
      using errcode = '55000';
  end if;
  if v_actor.role::text <> 'admin' and not exists (
    select 1 from crm.user_branches ub
    where ub.user_id = p_actor and ub.branch_id = v_lead.branch_id
  ) then
    raise exception 'actor is not allocated to the patient branch'
      using errcode = '42501';
  end if;

  select * into v_doctor from crm.doctors where id = p_doctor_id;
  if not found or not v_doctor.is_active or v_doctor.branch_id is distinct from v_lead.branch_id then
    raise exception 'doctor is missing, inactive, or belongs to another branch'
      using errcode = '23514';
  end if;
  select * into v_appointment from crm.appointments
  where id = p_appointment_id and lead_id = p_lead_id for update;
  if not found or v_appointment.branch_id is distinct from v_lead.branch_id
     or v_appointment.status <> 'scheduled'
     or (v_appointment.doctor_id is not null and v_appointment.doctor_id is distinct from p_doctor_id) then
    raise exception 'case sheet requires this patient''s scheduled appointment and doctor'
      using errcode = '23514';
  end if;
  if v_appointment.doctor_id is null and v_actor.role::text = 'doctor' then
    raise exception 'a manager must assign the appointment before a doctor can finalize it'
      using errcode = '42501';
  end if;
  if v_actor.role::text = 'doctor'
     and v_doctor.profile_id is distinct from p_actor then
    raise exception 'doctor may finalize only their own appointment'
      using errcode = '42501';
  end if;

  perform set_config('crm.actor_id', p_actor::text, true);
  v_sheet.id := gen_random_uuid();
  perform set_config('crm.finalizing_case_sheet', v_sheet.id::text, true);

  insert into crm.case_sheets (
    id, lead_id, branch_id, appointment_id, doctor_id, visit_at,
    chief_complaint, findings, diagnosis, plan, medical_alerts,
    finalized_at, signed_by, created_by
  ) values (
    v_sheet.id, p_lead_id, v_lead.branch_id, p_appointment_id, p_doctor_id, p_visit_at,
    nullif(btrim(p_chief_complaint), ''), nullif(btrim(p_findings), ''),
    nullif(btrim(p_diagnosis), ''), nullif(btrim(p_plan), ''),
    nullif(btrim(p_medical_alerts), ''), now(), p_actor, p_actor
  ) returning * into v_sheet;

  update crm.appointments
  set doctor_id = p_doctor_id, status = 'completed'
  where id = p_appointment_id;

  for v_item in select value from jsonb_array_elements(p_treatments)
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or jsonb_typeof(v_item->'treatment_code') is distinct from 'string'
       or jsonb_typeof(v_item->'status') is distinct from 'string'
       or jsonb_typeof(v_item->'site_scope') is distinct from 'string'
       or jsonb_typeof(v_item->'quantity') is distinct from 'number'
       or jsonb_typeof(v_item->'unit_price') is distinct from 'number'
       or (v_item ? 'surfaces' and jsonb_typeof(v_item->'surfaces') <> 'array') then
      raise exception 'each treatment line requires code, status, scope, and numeric quantity'
        using errcode = '22023';
    end if;
    v_code := btrim(v_item->>'treatment_code');
    v_status := btrim(v_item->>'status');
    v_scope := btrim(v_item->>'site_scope');
    v_detail := nullif(btrim(v_item->>'site_detail'), '');
    v_tooth := nullif(btrim(v_item->>'tooth_number'), '');
    v_quantity := (v_item->>'quantity')::numeric;
    v_cost := (v_item->>'unit_price')::numeric;
    v_performed_at := case
      when v_status = 'completed' then coalesce(nullif(v_item->>'performed_at', '')::timestamptz, p_visit_at)
      else null
    end;

    if v_performed_at is not null
       and (not isfinite(v_performed_at) or v_performed_at > v_sheet.finalized_at) then
      raise exception 'completed treatment time must be finite and cannot follow case-sheet signature'
        using errcode = '22023';
    end if;

    if v_status not in ('planned','completed')
       or v_scope not in ('not_applicable','full_mouth','arch','quadrant','tooth')
       or v_quantity <= 0 or v_quantity > 999999.99 or v_quantity <> round(v_quantity, 2)
       or v_cost < 0 or v_cost > 99999999.99 or v_cost <> round(v_cost, 2) then
      raise exception 'treatment status, scope, quantity, or cost is invalid'
        using errcode = '22023';
    end if;
    if v_item ? 'surfaces' and exists (
      select 1 from jsonb_array_elements(v_item->'surfaces') s
      where jsonb_typeof(s.value) <> 'string'
         or lower(s.value #>> '{}') not in (
           'mesial','distal','occlusal','incisal','buccal','lingual','palatal','facial'
         )
    ) then
      raise exception 'tooth surfaces are invalid' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct lower(s.value #>> '{}') order by lower(s.value #>> '{}')), array[]::text[])
    into v_surfaces
    from jsonb_array_elements(coalesce(v_item->'surfaces', '[]'::jsonb)) s;

    insert into crm.treatments (
      lead_id, branch_id, appointment_id, doctor_id, case_sheet_id,
      treatment_code, clinical_status, site_scope, site_detail, tooth_number,
      surfaces, diagnosis, quantity, cost, notes, performed_at, treated_at, created_by
    ) values (
      p_lead_id, v_lead.branch_id, p_appointment_id, p_doctor_id, v_sheet.id,
      v_code, v_status, v_scope, v_detail, v_tooth, v_surfaces,
      coalesce(nullif(btrim(v_item->>'diagnosis'), ''), nullif(btrim(p_diagnosis), '')), v_quantity, v_cost,
      nullif(btrim(v_item->>'notes'), ''), v_performed_at, p_visit_at, p_actor
    ) returning * into v_treatment;

    insert into crm.audit_log(entity_type, entity_id, action, actor_id, new_data)
    values (
      'treatment', v_treatment.id, 'case_sheet_signed', p_actor,
      jsonb_build_object(
        'case_sheet_id', v_sheet.id,
        'treatment_code', v_treatment.treatment_code,
        'clinical_status', v_treatment.clinical_status,
        'site_scope', v_treatment.site_scope,
        'tooth_number', v_treatment.tooth_number,
        'signed_at', v_treatment.signed_at
      )
    );
  end loop;

  update crm.leads set status = 'visited_treated' where id = p_lead_id;
  insert into crm.lead_activity(lead_id, actor_id, type, detail)
  values (p_lead_id, p_actor, 'treatment', jsonb_build_object(
    'event','case_sheet_finalized','case_sheet_id',v_sheet.id,
    'appointment_id',p_appointment_id,'doctor_id',p_doctor_id,
    'treatment_count',jsonb_array_length(p_treatments)
  ));
  insert into crm.audit_log(entity_type, entity_id, action, actor_id, new_data)
  values (
    'case_sheet', v_sheet.id, 'finalized', p_actor,
    jsonb_build_object(
      'lead_id', v_sheet.lead_id,
      'branch_id', v_sheet.branch_id,
      'appointment_id', v_sheet.appointment_id,
      'doctor_id', v_sheet.doctor_id,
      'visit_at', v_sheet.visit_at,
      'finalized_at', v_sheet.finalized_at,
      'treatment_count', jsonb_array_length(p_treatments)
    )
  );
  perform set_config('crm.finalizing_case_sheet', '', true);
  return v_sheet;
end
$function$;

create function crm.finalize_case_sheet_with_odontogram(
  p_lead_id uuid,
  p_appointment_id uuid,
  p_doctor_id uuid,
  p_visit_at timestamptz,
  p_chief_complaint text,
  p_findings text,
  p_diagnosis text,
  p_plan text,
  p_medical_alerts text,
  p_tooth_assessments jsonb,
  p_treatments jsonb,
  p_actor uuid
) returns crm.case_sheets
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_sheet crm.case_sheets%rowtype;
  v_item jsonb;
  v_assessment crm.tooth_assessments%rowtype;
begin
  if jsonb_typeof(p_tooth_assessments) is distinct from 'array'
     or jsonb_array_length(p_tooth_assessments) > 52 then
    raise exception 'case sheet accepts at most 52 tooth assessments'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_tooth_assessments) as assessment(value)
    where jsonb_typeof(assessment.value) is distinct from 'object'
       or jsonb_typeof(assessment.value->'tooth_number') is distinct from 'string'
       or jsonb_typeof(assessment.value->'tooth_state') is distinct from 'string'
       or (
         assessment.value ? 'conditions'
         and jsonb_typeof(assessment.value->'conditions') is distinct from 'array'
       )
       or (
         assessment.value ? 'surfaces'
         and jsonb_typeof(assessment.value->'surfaces') is distinct from 'array'
       )
       or (
         assessment.value ? 'clinical_findings'
         and jsonb_typeof(assessment.value->'clinical_findings') not in ('string','null')
       )
       or (
         assessment.value ? 'diagnosis'
         and jsonb_typeof(assessment.value->'diagnosis') not in ('string','null')
       )
       or (
         assessment.value ? 'prognosis'
         and jsonb_typeof(assessment.value->'prognosis') not in ('string','null')
       )
       or (
         assessment.value ? 'recommended_action'
         and jsonb_typeof(assessment.value->'recommended_action') not in ('string','null')
       )
       or (
         assessment.value ? 'future_plan'
         and jsonb_typeof(assessment.value->'future_plan') not in ('string','null')
       )
       or (
         assessment.value ? 'notes'
         and jsonb_typeof(assessment.value->'notes') not in ('string','null')
       )
  ) then
    raise exception 'each tooth assessment requires a tooth number and state with valid field types'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_tooth_assessments) as assessment(value),
         jsonb_array_elements(coalesce(assessment.value->'conditions', '[]'::jsonb)) as condition(value)
    where jsonb_typeof(condition.value) is distinct from 'string'
  ) or exists (
    select 1
    from jsonb_array_elements(p_tooth_assessments) as assessment(value),
         jsonb_array_elements(coalesce(assessment.value->'surfaces', '[]'::jsonb)) as surface(value)
    where jsonb_typeof(surface.value) is distinct from 'string'
  ) then
    raise exception 'tooth conditions and surfaces must be string arrays'
      using errcode = '22023';
  end if;

  if (
    select count(*) <> count(distinct btrim(assessment.value->>'tooth_number'))
    from jsonb_array_elements(p_tooth_assessments) as assessment(value)
  ) then
    raise exception 'a tooth can only be assessed once per case sheet'
      using errcode = '22023';
  end if;

  v_sheet := crm.finalize_case_sheet(
    p_lead_id, p_appointment_id, p_doctor_id, p_visit_at,
    p_chief_complaint, p_findings, p_diagnosis, p_plan, p_medical_alerts,
    p_treatments, p_actor
  );
  perform set_config('crm.finalizing_case_sheet', v_sheet.id::text, true);

  for v_item in select value from jsonb_array_elements(p_tooth_assessments)
  loop
    insert into crm.tooth_assessments (
      case_sheet_id, lead_id, branch_id, appointment_id, doctor_id,
      tooth_number, tooth_state, conditions, surfaces, clinical_findings,
      diagnosis, prognosis, recommended_action, future_plan, notes,
      assessed_at, signed_at, signed_by, created_by
    ) values (
      v_sheet.id, v_sheet.lead_id, v_sheet.branch_id, v_sheet.appointment_id, v_sheet.doctor_id,
      v_item->>'tooth_number', v_item->>'tooth_state',
      array(
        select condition.value #>> '{}'
        from jsonb_array_elements(coalesce(v_item->'conditions', '[]'::jsonb)) as condition(value)
      ),
      array(
        select surface.value #>> '{}'
        from jsonb_array_elements(coalesce(v_item->'surfaces', '[]'::jsonb)) as surface(value)
      ),
      v_item->>'clinical_findings', v_item->>'diagnosis', v_item->>'prognosis',
      v_item->>'recommended_action', v_item->>'future_plan', v_item->>'notes',
      v_sheet.visit_at, v_sheet.finalized_at, v_sheet.signed_by, v_sheet.created_by
    ) returning * into v_assessment;

    insert into crm.audit_log(entity_type, entity_id, action, actor_id, new_data)
    values (
      'tooth_assessment', v_assessment.id, 'case_sheet_signed', p_actor,
      jsonb_build_object(
        'case_sheet_id', v_assessment.case_sheet_id,
        'lead_id', v_assessment.lead_id,
        'tooth_number', v_assessment.tooth_number,
        'tooth_state', v_assessment.tooth_state,
        'conditions', to_jsonb(v_assessment.conditions),
        'surfaces', to_jsonb(v_assessment.surfaces),
        'clinical_findings', v_assessment.clinical_findings,
        'diagnosis', v_assessment.diagnosis,
        'prognosis', v_assessment.prognosis,
        'recommended_action', v_assessment.recommended_action,
        'future_plan', v_assessment.future_plan,
        'notes', v_assessment.notes,
        'assessed_at', v_assessment.assessed_at,
        'signed_at', v_assessment.signed_at
      )
    );
  end loop;

  insert into crm.audit_log(entity_type, entity_id, action, actor_id, new_data)
  values (
    'case_sheet', v_sheet.id, 'odontogram_recorded', p_actor,
    jsonb_build_object(
      'tooth_assessment_count', jsonb_array_length(p_tooth_assessments),
      'treatment_count', jsonb_array_length(p_treatments)
    )
  );

  perform set_config('crm.finalizing_case_sheet', '', true);
  return v_sheet;
end
$function$;

create function crm.current_tooth_assessments(p_lead_id uuid)
returns setof crm.tooth_assessments
language sql
stable
set search_path = ''
as $function$
  select distinct on (assessment.tooth_number) assessment.*
  from crm.tooth_assessments assessment
  where assessment.lead_id = p_lead_id
  order by assessment.tooth_number, assessment.assessed_at desc,
           assessment.signed_at desc, assessment.id desc
$function$;

alter table crm.tooth_assessments enable row level security;
revoke all on crm.tooth_assessments from public, anon, authenticated, service_role;
-- The service role reads snapshots directly, but can create them only through
-- the atomic SECURITY DEFINER finalizer. This keeps its caller-settable session
-- settings from being used to append data to an already signed case sheet.
grant select on crm.tooth_assessments to service_role;
revoke execute on function crm.enforce_tooth_assessment()
  from public, anon, authenticated, service_role;
revoke execute on function crm.finalize_case_sheet_with_odontogram(
  uuid,uuid,uuid,timestamptz,text,text,text,text,text,jsonb,jsonb,uuid
) from public, anon, authenticated;
grant execute on function crm.finalize_case_sheet_with_odontogram(
  uuid,uuid,uuid,timestamptz,text,text,text,text,text,jsonb,jsonb,uuid
) to service_role;
revoke execute on function crm.current_tooth_assessments(uuid)
  from public, anon, authenticated;
grant execute on function crm.current_tooth_assessments(uuid) to service_role;
revoke execute on function crm.finalize_case_sheet(
  uuid,uuid,uuid,timestamptz,text,text,text,text,text,jsonb,uuid
) from public, anon, authenticated;
grant execute on function crm.finalize_case_sheet(
  uuid,uuid,uuid,timestamptz,text,text,text,text,text,jsonb,uuid
) to service_role;

comment on function crm.finalize_case_sheet_with_odontogram(
  uuid,uuid,uuid,timestamptz,text,text,text,text,text,jsonb,jsonb,uuid
) is 'Atomically finalizes a visit with zero or more general tooth assessments and zero or more coded treatment lines.';
comment on function crm.finalize_case_sheet(
  uuid,uuid,uuid,timestamptz,text,text,text,text,text,jsonb,uuid
) is 'Compatibility finalizer for a visit with zero or more coded treatment lines; use the odontogram-aware finalizer for tooth assessments.';
comment on function crm.current_tooth_assessments(uuid)
is 'Returns the latest signed assessment for each recorded tooth of one patient.';

-- Keep the ACCESS EXCLUSIVE constraint swap at the very end so the lock is
-- held only for these metadata changes. NOT VALID still enforces new rows; a
-- following migration validates existing rows with a weaker lock.
alter table crm.audit_log add constraint audit_log_entity_type_check_expanded
  check (entity_type in (
    'lead','appointment','treatment','follow_up','invoice','comment','profile',
    'case_sheet','tooth_assessment'
  )) not valid;
alter table crm.audit_log drop constraint audit_log_entity_type_check;
alter table crm.audit_log rename constraint audit_log_entity_type_check_expanded
  to audit_log_entity_type_check;
