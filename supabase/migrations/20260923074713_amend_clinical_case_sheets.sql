-- Preserve every finalized visit as an auditable record, while allowing an
-- explicitly authorized correction through one atomic, version-checked RPC.

alter table crm.case_sheets
  add column version integer not null default 1,
  add column updated_at timestamptz not null default now(),
  add constraint case_sheets_version_check check (version >= 1);

create table crm.case_sheet_amendments (
  id uuid primary key default gen_random_uuid(),
  case_sheet_id uuid not null references crm.case_sheets(id) on delete restrict,
  revision integer not null check (revision > 1),
  reason text not null check (length(btrim(reason)) between 5 and 1000),
  changed_by uuid not null,
  changed_by_name text not null check (length(btrim(changed_by_name)) between 1 and 200),
  changed_at timestamptz not null default now(),
  old_data jsonb not null,
  new_data jsonb not null,
  constraint case_sheet_amendments_revision_key unique (case_sheet_id, revision)
);
create index case_sheet_amendments_case_sheet_idx
  on crm.case_sheet_amendments (case_sheet_id, revision desc);
alter table crm.case_sheet_amendments enable row level security;
revoke all on crm.case_sheet_amendments from public, anon, authenticated, service_role;
grant select on crm.case_sheet_amendments to service_role;

create function crm.protect_case_sheet_amendment_history() returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'case-sheet amendment history is append-only'
    using errcode = '55000';
end
$function$;
create trigger protect_case_sheet_amendments_update_delete
  before update or delete on crm.case_sheet_amendments
  for each row execute function crm.protect_case_sheet_amendment_history();
create trigger protect_case_sheet_amendments_truncate
  before truncate on crm.case_sheet_amendments
  for each statement execute function crm.protect_case_sheet_amendment_history();
revoke execute on function crm.protect_case_sheet_amendment_history()
  from public, anon, authenticated, service_role;

-- This trigger remains a hard stop for all ordinary writes. The exception is
-- transaction-local and only the owner-executed amendment RPC sets it after
-- checking actor, branch, case-sheet ownership, and expected version.
create or replace function crm.protect_finalized_clinical_record() returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_case_sheet_id uuid;
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'finalized clinical records are immutable'
      using errcode = '55000';
  end if;

  if tg_table_name = 'case_sheets' then
    v_case_sheet_id := old.id;
    if tg_op = 'UPDATE'
       and current_setting('crm.amending_case_sheet', true) = v_case_sheet_id::text then
      return new;
    end if;
  elsif tg_table_name in ('treatments','tooth_assessments','prescription_items','case_sheet_medical_history') then
    v_case_sheet_id := old.case_sheet_id;
    if tg_op in ('UPDATE', 'DELETE')
       and current_setting('crm.amending_case_sheet', true) = v_case_sheet_id::text then
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end if;
  else
    raise exception 'finalized clinical records are immutable'
      using errcode = '55000';
  end if;

  raise exception 'finalized clinical records are immutable outside the amendment workflow'
    using errcode = '55000';
end
$function$;

create trigger protect_coded_treatment_delete
  before delete on crm.treatments
  for each row when (old.case_sheet_id is not null)
  execute function crm.protect_finalized_clinical_record();

create or replace function crm.enforce_prescription_scope() returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_sheet crm.case_sheets%rowtype;
  v_actor uuid;
begin
  select * into v_sheet from crm.case_sheets where id = new.case_sheet_id;
  if not found
     or new.lead_id is distinct from v_sheet.lead_id
     or new.branch_id is distinct from v_sheet.branch_id
     or new.appointment_id is distinct from v_sheet.appointment_id
     or new.doctor_id is distinct from v_sheet.doctor_id then
    raise exception 'prescription identity must match its signed case sheet'
      using errcode = '23514';
  end if;
  new.medicine_name := btrim(new.medicine_name);
  new.strength := nullif(btrim(new.strength), '');
  new.dosage := nullif(btrim(new.dosage), '');
  new.instructions := nullif(btrim(new.instructions), '');
  if current_setting('crm.amending_case_sheet', true) = v_sheet.id::text then
    v_actor := nullif(current_setting('crm.actor_id', true), '')::uuid;
    if v_actor is null then
      raise exception 'prescription amendment actor is required' using errcode = '42501';
    end if;
    new.prescribed_at := now();
    new.signed_at := now();
    new.signed_by := v_actor;
    new.created_by := v_actor;
    new.created_at := now();
  else
    new.prescribed_at := v_sheet.visit_at;
    new.signed_at := v_sheet.finalized_at;
    new.signed_by := v_sheet.signed_by;
    new.created_by := v_sheet.created_by;
    new.created_at := v_sheet.created_at;
  end if;
  return new;
end
$function$;

create function crm.amend_clinical_visit(
  p_case_sheet_id uuid,
  p_expected_version integer,
  p_reason text,
  p_chief_complaint text,
  p_findings text,
  p_diagnosis text,
  p_plan text,
  p_medical_history_review_status text,
  p_medical_history_confirmed boolean,
  p_medical_history_conditions text[],
  p_medical_history_description text,
  p_tooth_assessments jsonb,
  p_treatments jsonb,
  p_prescriptions jsonb,
  p_actor uuid
) returns crm.case_sheets
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor crm.profiles%rowtype;
  v_lead crm.leads%rowtype;
  v_sheet crm.case_sheets%rowtype;
  v_code crm.treatment_codes%rowtype;
  v_treatment crm.treatments%rowtype;
  v_item jsonb;
  v_old_data jsonb;
  v_new_data jsonb;
  v_existing_history crm.patient_medical_history_versions%rowtype;
  v_history crm.patient_medical_history_versions%rowtype;
  v_existing_prescriptions jsonb;
  v_input_prescriptions jsonb;
  v_treatment_ids uuid[] := array[]::uuid[];
  v_tooth_numbers text[] := array[]::text[];
  v_surfaces text[];
  v_conditions text[];
  v_code_text text;
  v_status text;
  v_scope text;
  v_detail text;
  v_tooth text;
  v_treatment_id uuid;
  v_has_invoice boolean;
  v_has_files boolean;
  v_food_timing text;
  v_duration integer;
  v_line integer := 0;
begin
  if p_actor is null or p_case_sheet_id is null
     or p_expected_version is null or p_expected_version < 1
     or length(btrim(coalesce(p_reason, ''))) not between 5 and 1000 then
    raise exception 'case sheet, version, actor, and a reason for amendment are required'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_tooth_assessments) is distinct from 'array'
     or jsonb_array_length(p_tooth_assessments) > 52
     or jsonb_typeof(p_treatments) is distinct from 'array'
     or jsonb_array_length(p_treatments) > 50
     or jsonb_typeof(p_prescriptions) is distinct from 'array'
     or jsonb_array_length(p_prescriptions) > 30 then
    raise exception 'case-sheet amendment has too many or invalid clinical detail lines'
      using errcode = '22023';
  end if;
  if coalesce(length(p_chief_complaint), 0) > 4000
     or coalesce(length(p_findings), 0) > 12000
     or coalesce(length(p_diagnosis), 0) > 4000
     or coalesce(length(p_plan), 0) > 8000 then
    raise exception 'case-sheet text is too long' using errcode = '22023';
  end if;
  if p_medical_history_confirmed is distinct from true
     or p_medical_history_review_status not in ('reviewed_none','reviewed_conditions')
     or p_medical_history_conditions is null
     or array_position(p_medical_history_conditions, null) is not null
     or not p_medical_history_conditions <@ array[
       'diabetes','hypertension','thyroid_disorder','pregnancy',
       'kidney_disease','liver_disease','heart_condition','asthma',
       'bleeding_disorder','allergies','other'
     ]::text[]
     or not crm.text_array_is_unique(p_medical_history_conditions)
     or (p_medical_history_review_status = 'reviewed_none'
         and cardinality(p_medical_history_conditions) <> 0)
     or (p_medical_history_review_status = 'reviewed_conditions'
         and cardinality(p_medical_history_conditions) = 0)
     or ('other' = any(p_medical_history_conditions)
         and nullif(btrim(p_medical_history_description), '') is null)
     or coalesce(length(p_medical_history_description), 0) > 4000 then
    raise exception 'medical history details are invalid'
      using errcode = '22023';
  end if;

  select * into v_actor from crm.profiles where id = p_actor for share;
  if not found or not v_actor.is_active
     or v_actor.role::text not in ('admin','operations','front_office','clinical_head','doctor') then
    raise exception 'actor is not authorized to amend case sheets'
      using errcode = '42501';
  end if;
  select * into v_sheet from crm.case_sheets where id = p_case_sheet_id;
  if not found then raise exception 'case sheet not found' using errcode = 'P0002'; end if;
  select * into v_lead from crm.leads
    where id = v_sheet.lead_id and deleted_at is null for update;
  if not found or v_lead.branch_id is distinct from v_sheet.branch_id then
    raise exception 'patient record is not active' using errcode = 'P0002';
  end if;
  select * into v_sheet from crm.case_sheets
    where id = p_case_sheet_id for update;
  if not found then raise exception 'case sheet not found' using errcode = 'P0002'; end if;
  if v_sheet.version <> p_expected_version then
    raise exception 'This case sheet changed after it was loaded. Refresh and try again.'
      using errcode = '40001';
  end if;
  if v_actor.role::text <> 'admin' and not exists (
    select 1 from crm.user_branches ub
    where ub.user_id = p_actor and ub.branch_id = v_sheet.branch_id
  ) then
    raise exception 'actor is not allocated to the patient branch'
      using errcode = '42501';
  end if;
  if v_actor.role::text = 'front_office'
     and v_lead.assignee_id is distinct from p_actor
     and v_lead.assignee_id is not null then
    raise exception 'This patient is not assigned to you'
      using errcode = '42501';
  end if;
  if v_actor.role::text = 'doctor' and not exists (
    select 1 from crm.doctors doctor
    where doctor.id = v_sheet.doctor_id and doctor.profile_id = p_actor
      and doctor.is_active
  ) then
    raise exception 'Doctors can amend only their own case sheets'
      using errcode = '42501';
  end if;

  -- Serialize with invoice/file creation so an attachment or bill cannot be
  -- added between the lock check and a clinical treatment update.
  perform 1 from crm.treatments treatment
    where treatment.case_sheet_id = v_sheet.id
    order by treatment.id for update;

  select to_jsonb(sheet_row) into v_old_data
  from (
    select to_jsonb(v_sheet) as case_sheet,
      coalesce((select jsonb_agg(to_jsonb(t) order by t.id)
        from crm.treatments t where t.case_sheet_id = v_sheet.id), '[]'::jsonb) as treatments,
      coalesce((select jsonb_agg(to_jsonb(t) order by t.tooth_number)
        from crm.tooth_assessments t where t.case_sheet_id = v_sheet.id), '[]'::jsonb) as tooth_assessments,
      coalesce((select jsonb_agg(to_jsonb(p) order by p.line_number)
        from crm.prescription_items p where p.case_sheet_id = v_sheet.id), '[]'::jsonb) as prescriptions,
      (select to_jsonb(h) from crm.case_sheet_medical_history link
        join crm.patient_medical_history_versions h on h.id = link.medical_history_version_id
        where link.case_sheet_id = v_sheet.id) as medical_history
  ) as sheet_row;

  perform set_config('crm.amending_case_sheet', v_sheet.id::text, true);
  perform set_config('crm.finalizing_case_sheet', v_sheet.id::text, true);
  perform set_config('crm.actor_id', p_actor::text, true);
  update crm.case_sheets set
    chief_complaint = nullif(btrim(p_chief_complaint), ''),
    findings = nullif(btrim(p_findings), ''),
    diagnosis = nullif(btrim(p_diagnosis), ''),
    plan = nullif(btrim(p_plan), ''),
    version = version + 1,
    updated_at = now()
  where id = v_sheet.id
  returning * into v_sheet;

  -- Invoice-linked rows stay fully frozen to preserve bill history. A row with
  -- attached evidence keeps its code/site immutable, while its status and notes
  -- can still be corrected as part of a later case-sheet amendment.
  for v_item in select value from jsonb_array_elements(p_treatments)
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or jsonb_typeof(v_item->'treatment_code') is distinct from 'string'
       or jsonb_typeof(v_item->'status') is distinct from 'string'
       or jsonb_typeof(v_item->'site_scope') is distinct from 'string'
       or jsonb_typeof(v_item->'notes') is distinct from 'string'
       or (v_item ? 'tooth_number' and jsonb_typeof(v_item->'tooth_number') not in ('string','null'))
       or (v_item ? 'tooth_numbers' and jsonb_typeof(v_item->'tooth_numbers') <> 'array')
       or (v_item ? 'surfaces' and jsonb_typeof(v_item->'surfaces') <> 'array') then
      raise exception 'treatment line has invalid field types' using errcode = '22023';
    end if;

    v_code_text := btrim(v_item->>'treatment_code');
    v_status := btrim(v_item->>'status');
    v_scope := btrim(v_item->>'site_scope');
    v_detail := nullif(btrim(v_item->>'site_detail'), '');
    v_tooth := nullif(btrim(v_item->>'tooth_number'), '');
    select coalesce(array_agg(btrim(item.value #>> '{}') order by item.ordinality), array[]::text[])
      into v_tooth_numbers
      from jsonb_array_elements(coalesce(v_item->'tooth_numbers', '[]'::jsonb))
        with ordinality as item(value, ordinality)
      where jsonb_typeof(item.value) = 'string';
    select coalesce(array_agg(lower(btrim(item.value #>> '{}')) order by item.ordinality), array[]::text[])
      into v_surfaces
      from jsonb_array_elements(coalesce(v_item->'surfaces', '[]'::jsonb))
        with ordinality as item(value, ordinality)
      where jsonb_typeof(item.value) = 'string';
    if exists (select 1 from jsonb_array_elements(coalesce(v_item->'tooth_numbers', '[]'::jsonb)) as tooth_item(value)
         where jsonb_typeof(tooth_item.value) is distinct from 'string')
       or exists (select 1 from jsonb_array_elements(coalesce(v_item->'surfaces', '[]'::jsonb)) as surface_item(value)
         where jsonb_typeof(surface_item.value) is distinct from 'string') then
      raise exception 'treatment teeth and surfaces must be string arrays' using errcode = '22023';
    end if;
    if v_status not in ('planned','completed')
       or v_scope not in ('not_applicable','full_mouth','arch','quadrant','tooth','multi_tooth')
       or cardinality(v_surfaces) is distinct from (
         select count(distinct surface_item.value)::integer from unnest(v_surfaces) as surface_item(value)
       ) then
      raise exception 'treatment status, scope, or surfaces are invalid' using errcode = '22023';
    end if;
    if (v_scope = 'tooth' and (v_tooth is null or v_tooth_numbers <> array[v_tooth]))
       or (v_scope = 'multi_tooth' and (cardinality(v_tooth_numbers) < 2 or v_tooth_numbers[1] is distinct from v_tooth))
       or (v_scope = 'multi_tooth' and cardinality(v_tooth_numbers) is distinct from (
         select count(distinct tooth_item.value)::integer from unnest(v_tooth_numbers) as tooth_item(value)
       ))
       or (v_scope not in ('tooth','multi_tooth') and (v_tooth is not null or cardinality(v_tooth_numbers) > 0))
       or (v_scope in ('tooth','multi_tooth') and exists (
         select 1 from unnest(v_tooth_numbers) number(value)
         where value !~ '^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$'
       ))
       or (v_scope = 'arch' and (v_detail is null or v_detail not in ('upper','lower')))
       or (v_scope = 'quadrant' and (v_detail is null or v_detail not in ('upper_right','upper_left','lower_left','lower_right')))
       or (v_scope not in ('arch','quadrant') and v_detail is not null)
       or (v_scope not in ('tooth','multi_tooth') and cardinality(v_surfaces) > 0)
       or exists (select 1 from unnest(v_surfaces) as surface_item(value)
         where surface_item.value not in ('mesial','distal','occlusal','incisal','buccal','lingual','palatal','facial')) then
      raise exception 'treatment site details are invalid' using errcode = '22023';
    end if;

    v_treatment_id := nullif(v_item->>'treatment_id', '')::uuid;
    select t.* into v_treatment from crm.treatments t
      where t.id = v_treatment_id and t.case_sheet_id = v_sheet.id;
    if v_treatment_id is not null and not found then
      raise exception 'treatment line does not belong to this case sheet' using errcode = '22023';
    end if;
    if v_treatment_id is not null and v_treatment_id = any(v_treatment_ids) then
      raise exception 'a treatment line cannot be included more than once' using errcode = '22023';
    end if;
    if v_treatment_id is not null then v_treatment_ids := array_append(v_treatment_ids, v_treatment_id); end if;

    v_has_invoice := false;
    v_has_files := false;
    if v_treatment_id is not null then
      select exists(select 1 from crm.invoice_items item where item.treatment_id = v_treatment_id)
        into v_has_invoice;
      select exists(select 1 from crm.case_sheet_attachments attachment where attachment.treatment_id = v_treatment_id)
        into v_has_files;
    end if;
    if v_has_invoice and (
      v_treatment.treatment_code is distinct from v_code_text
      or v_treatment.clinical_status is distinct from v_status
      or v_treatment.site_scope is distinct from v_scope
      or v_treatment.site_detail is distinct from v_detail
      or v_treatment.tooth_number is distinct from v_tooth
      or v_treatment.tooth_numbers is distinct from v_tooth_numbers
      or v_treatment.surfaces is distinct from v_surfaces
      or v_treatment.notes is distinct from nullif(btrim(v_item->>'notes'), '')
    ) then
      raise exception 'An invoice-linked treatment cannot be changed'
        using errcode = '55000';
    end if;
    if v_has_files and (
      v_treatment.treatment_code is distinct from v_code_text
      or v_treatment.site_scope is distinct from v_scope
      or v_treatment.site_detail is distinct from v_detail
      or v_treatment.tooth_number is distinct from v_tooth
      or v_treatment.tooth_numbers is distinct from v_tooth_numbers
      or v_treatment.surfaces is distinct from v_surfaces
    ) then
      raise exception 'A treatment linked to a file cannot change its code or tooth/site'
        using errcode = '55000';
    end if;
    if v_has_invoice then continue; end if;

    select * into v_code from crm.treatment_codes code
      where code.code = v_code_text
        and (code.status = 'active'
          or (v_treatment_id is not null and v_treatment.treatment_code = v_code_text));
    if not found then
      raise exception 'Select an active approved dental code for each editable treatment'
        using errcode = '23514';
    end if;

    if v_treatment_id is null then
      perform set_config('crm.current_treatment_tooth_numbers', to_jsonb(v_tooth_numbers)::text, true);
      insert into crm.treatments (
        lead_id, branch_id, appointment_id, doctor_id, case_sheet_id, treatment_code,
        clinical_status, site_scope, site_detail, tooth_number, tooth_numbers, surfaces,
        diagnosis, quantity, cost, notes, performed_at, treated_at, created_by
      ) values (
        v_sheet.lead_id, v_sheet.branch_id, v_sheet.appointment_id, v_sheet.doctor_id, v_sheet.id,
        v_code_text, v_status, v_scope, v_detail, v_tooth, v_tooth_numbers, v_surfaces,
        v_sheet.diagnosis, 1, 0, nullif(btrim(v_item->>'notes'), ''),
        case when v_status = 'completed' then v_sheet.visit_at else null end,
        v_sheet.visit_at, p_actor
      ) returning * into v_treatment;
      v_treatment_ids := array_append(v_treatment_ids, v_treatment.id);
    else
      update crm.treatments set
        treatment_code = v_code_text,
        treatment_name = v_code.name,
        treatment_category = v_code.category,
        clinical_status = v_status,
        site_scope = v_scope,
        site_detail = v_detail,
        tooth_number = v_tooth,
        tooth_numbers = v_tooth_numbers,
        surfaces = v_surfaces,
        diagnosis = v_sheet.diagnosis,
        notes = nullif(btrim(v_item->>'notes'), ''),
        performed_at = case when v_status = 'completed'
          then coalesce(v_treatment.performed_at, v_sheet.visit_at) else null end
      where id = v_treatment.id;
    end if;
  end loop;

  if exists (
    select 1 from crm.treatments t
    where t.case_sheet_id = v_sheet.id and not (t.id = any(v_treatment_ids))
      and (exists(select 1 from crm.invoice_items item where item.treatment_id = t.id)
        or exists(select 1 from crm.case_sheet_attachments attachment where attachment.treatment_id = t.id))
  ) then
    raise exception 'A treatment linked to an invoice or file cannot be removed'
      using errcode = '55000';
  end if;
  delete from crm.treatments t
  where t.case_sheet_id = v_sheet.id and not (t.id = any(v_treatment_ids));

  -- Synchronize the per-tooth examination. Its visit date and original author
  -- remain intact; new and revised values are captured in the amendment log.
  v_tooth_numbers := array[]::text[];
  for v_item in select value from jsonb_array_elements(p_tooth_assessments)
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or jsonb_typeof(v_item->'tooth_number') is distinct from 'string'
       or jsonb_typeof(v_item->'tooth_state') is distinct from 'string' then
      raise exception 'tooth assessment requires a tooth number and state' using errcode = '22023';
    end if;
    v_tooth := btrim(v_item->>'tooth_number');
    if (v_item ? 'conditions' and jsonb_typeof(v_item->'conditions') is distinct from 'array')
       or (v_item ? 'surfaces' and jsonb_typeof(v_item->'surfaces') is distinct from 'array')
       or exists (select 1 from jsonb_array_elements(coalesce(v_item->'conditions','[]'::jsonb)) as condition_item(value)
         where jsonb_typeof(condition_item.value) is distinct from 'string')
       or exists (select 1 from jsonb_array_elements(coalesce(v_item->'surfaces','[]'::jsonb)) as surface_item(value)
         where jsonb_typeof(surface_item.value) is distinct from 'string') then
      raise exception 'tooth conditions and surfaces must be string arrays' using errcode = '22023';
    end if;
    select coalesce(array_agg(value #>> '{}'), array[]::text[]) into v_conditions
      from jsonb_array_elements(coalesce(v_item->'conditions','[]'::jsonb)) as condition_item(value);
    select coalesce(array_agg(lower(value #>> '{}')), array[]::text[]) into v_surfaces
      from jsonb_array_elements(coalesce(v_item->'surfaces','[]'::jsonb)) as surface_item(value);
    if v_tooth !~ '^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$'
       or v_item->>'tooth_state' not in ('sound','present','missing','unerupted','impacted','retained_root','implant')
       or not crm.text_array_is_unique(v_conditions)
       or not crm.text_array_is_unique(v_surfaces)
       or (v_item->>'tooth_state' = 'sound' and cardinality(v_conditions) > 0)
       or (v_item->>'tooth_state' in ('missing','unerupted','impacted','retained_root','implant')
           and cardinality(v_surfaces) > 0) then
      raise exception 'tooth assessment details are invalid' using errcode = '22023';
    end if;
    insert into crm.tooth_assessments (
      case_sheet_id, lead_id, branch_id, appointment_id, doctor_id, tooth_number,
      tooth_state, conditions, surfaces, clinical_findings, diagnosis, prognosis,
      recommended_action, future_plan, notes, assessed_at, signed_at, signed_by, created_by
    ) values (
      v_sheet.id, v_sheet.lead_id, v_sheet.branch_id, v_sheet.appointment_id, v_sheet.doctor_id,
      v_tooth, v_item->>'tooth_state', v_conditions, v_surfaces,
      v_item->>'clinical_findings', v_item->>'diagnosis', v_item->>'prognosis',
      v_item->>'recommended_action', v_item->>'future_plan', v_item->>'notes',
      v_sheet.visit_at, v_sheet.finalized_at, v_sheet.signed_by, v_sheet.created_by
    ) on conflict (case_sheet_id, tooth_number) do update set
      tooth_state = excluded.tooth_state,
      conditions = excluded.conditions,
      surfaces = excluded.surfaces,
      clinical_findings = excluded.clinical_findings,
      diagnosis = excluded.diagnosis,
      prognosis = excluded.prognosis,
      recommended_action = excluded.recommended_action,
      future_plan = excluded.future_plan,
      notes = excluded.notes;
    v_tooth_numbers := array_append(v_tooth_numbers, v_tooth);
  end loop;
  delete from crm.tooth_assessments tooth
  where tooth.case_sheet_id = v_sheet.id and not (tooth.tooth_number = any(v_tooth_numbers));

  -- Patient history is versioned, never overwritten. A correction creates a
  -- fresh history version and updates only this visit's pointer.
  select history.* into v_existing_history
  from crm.case_sheet_medical_history link
  join crm.patient_medical_history_versions history
    on history.id = link.medical_history_version_id
  where link.case_sheet_id = v_sheet.id;
  if not found or v_existing_history.review_status is distinct from p_medical_history_review_status
     or v_existing_history.reviewed_with_patient is distinct from p_medical_history_confirmed
     or v_existing_history.conditions is distinct from p_medical_history_conditions
     or v_existing_history.description is distinct from nullif(btrim(p_medical_history_description), '') then
    insert into crm.patient_medical_history_versions (
      lead_id, branch_id, review_status, reviewed_with_patient, conditions,
      description, recorded_at, recorded_by, created_at
    ) values (
      v_sheet.lead_id, v_sheet.branch_id, p_medical_history_review_status,
      p_medical_history_confirmed, p_medical_history_conditions,
      nullif(btrim(p_medical_history_description), ''), now(), p_actor, now()
    ) returning * into v_history;
    delete from crm.case_sheet_medical_history where case_sheet_id = v_sheet.id;
    insert into crm.case_sheet_medical_history (
      case_sheet_id, medical_history_version_id, lead_id, branch_id, signed_at, signed_by, created_at
    ) values (
      v_sheet.id, v_history.id, v_sheet.lead_id, v_sheet.branch_id,
      v_sheet.finalized_at, v_sheet.signed_by, v_sheet.created_at
    );
  end if;

  -- Keep existing prescriptions unchanged for non-doctor amendments. Only the
  -- treating doctor may change or add a signed prescription.
  select coalesce(jsonb_agg(jsonb_build_object(
    'client_id', p.id::text, 'medicine_name', p.medicine_name,
    'strength', coalesce(p.strength, ''), 'dosage', coalesce(p.dosage, ''),
    'morning', p.morning, 'noon', p.noon, 'night', p.night,
    'food_timing', p.food_timing, 'duration_days', p.duration_days,
    'instructions', coalesce(p.instructions, '')
  ) order by p.line_number), '[]'::jsonb)
    into v_existing_prescriptions
  from crm.prescription_items p where p.case_sheet_id = v_sheet.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'client_id', item.value->>'client_id',
    'medicine_name', btrim(item.value->>'medicine_name'),
    'strength', coalesce(nullif(btrim(item.value->>'strength'), ''), ''),
    'dosage', coalesce(nullif(btrim(item.value->>'dosage'), ''), ''),
    'morning', coalesce((item.value->>'morning')::boolean, false),
    'noon', coalesce((item.value->>'noon')::boolean, false),
    'night', coalesce((item.value->>'night')::boolean, false),
    'food_timing', coalesce(nullif(btrim(item.value->>'food_timing'), ''), 'not_applicable'),
    'duration_days', nullif(item.value->>'duration_days', '')::integer,
    'instructions', coalesce(nullif(btrim(item.value->>'instructions'), ''), '')
  ) order by item.ordinality), '[]'::jsonb)
    into v_input_prescriptions
  from jsonb_array_elements(p_prescriptions) with ordinality as item(value, ordinality);
  if v_existing_prescriptions is distinct from v_input_prescriptions then
    if not exists (
      select 1 from crm.doctors doctor where doctor.id = v_sheet.doctor_id
        and doctor.profile_id = p_actor and doctor.is_active
    ) then
      raise exception 'Only the treating doctor may amend prescriptions'
        using errcode = '42501';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_prescriptions) item(value)
      where jsonb_typeof(item.value->'medicine_name') is distinct from 'string'
        or length(btrim(item.value->>'medicine_name')) not between 1 and 200
        or coalesce(length(item.value->>'strength'),0) > 100
        or coalesce(length(item.value->>'dosage'),0) > 100
        or coalesce(length(item.value->>'instructions'),0) > 1000
        or not (coalesce((item.value->>'morning')::boolean,false)
          or coalesce((item.value->>'noon')::boolean,false)
          or coalesce((item.value->>'night')::boolean,false))
        or coalesce(item.value->>'food_timing','not_applicable') not in ('before_food','after_food','with_food','not_applicable')
        or (item.value->>'duration_days' is not null and item.value->>'duration_days' !~ '^[0-9]{1,4}$')
        or nullif(item.value->>'duration_days','')::integer not between 1 and 3650
    ) then
      raise exception 'prescription line details are invalid' using errcode = '22023';
    end if;
    delete from crm.prescription_items where case_sheet_id = v_sheet.id;
    for v_item in select value from jsonb_array_elements(p_prescriptions)
    loop
      v_line := v_line + 1;
      v_food_timing := coalesce(nullif(btrim(v_item->>'food_timing'),''),'not_applicable');
      insert into crm.prescription_items (
        case_sheet_id, lead_id, branch_id, appointment_id, doctor_id, line_number,
        medicine_name, strength, dosage, morning, noon, night, food_timing,
        duration_days, instructions, prescribed_at, signed_at, signed_by, created_by, created_at
      ) values (
        v_sheet.id, v_sheet.lead_id, v_sheet.branch_id, v_sheet.appointment_id, v_sheet.doctor_id,
        v_line, btrim(v_item->>'medicine_name'), nullif(btrim(v_item->>'strength'),''),
        nullif(btrim(v_item->>'dosage'),''), coalesce((v_item->>'morning')::boolean,false),
        coalesce((v_item->>'noon')::boolean,false), coalesce((v_item->>'night')::boolean,false),
        v_food_timing, nullif(v_item->>'duration_days','')::integer,
        nullif(btrim(v_item->>'instructions'),''), v_sheet.visit_at, v_sheet.finalized_at,
        v_sheet.signed_by, v_sheet.created_by, v_sheet.created_at
      );
    end loop;
  end if;

  select jsonb_build_object(
    'case_sheet', to_jsonb(v_sheet),
    'treatments', coalesce((select jsonb_agg(to_jsonb(t) order by t.id)
      from crm.treatments t where t.case_sheet_id = v_sheet.id), '[]'::jsonb),
    'tooth_assessments', coalesce((select jsonb_agg(to_jsonb(t) order by t.tooth_number)
      from crm.tooth_assessments t where t.case_sheet_id = v_sheet.id), '[]'::jsonb),
    'prescriptions', coalesce((select jsonb_agg(to_jsonb(p) order by p.line_number)
      from crm.prescription_items p where p.case_sheet_id = v_sheet.id), '[]'::jsonb),
    'medical_history', (select to_jsonb(h) from crm.case_sheet_medical_history link
      join crm.patient_medical_history_versions h on h.id = link.medical_history_version_id
      where link.case_sheet_id = v_sheet.id)
  ) into v_new_data;
  insert into crm.case_sheet_amendments (
    case_sheet_id, revision, reason, changed_by, changed_by_name, old_data, new_data
  ) values (
    v_sheet.id, v_sheet.version, btrim(p_reason), p_actor, v_actor.full_name, v_old_data, v_new_data
  );
  insert into crm.audit_log(entity_type, entity_id, action, actor_id, old_data, new_data)
  values (
    'case_sheet', v_sheet.id, 'amended', p_actor,
    jsonb_build_object('revision', v_sheet.version - 1),
    jsonb_build_object('revision', v_sheet.version, 'reason', btrim(p_reason))
  );
  perform set_config('crm.current_treatment_tooth_numbers', '', true);
  perform set_config('crm.finalizing_case_sheet', '', true);
  perform set_config('crm.amending_case_sheet', '', true);
  perform set_config('crm.actor_id', '', true);
  return v_sheet;
end
$function$;

revoke execute on function crm.amend_clinical_visit(
  uuid,integer,text,text,text,text,text,text,boolean,text[],text,jsonb,jsonb,jsonb,uuid
) from public, anon, authenticated;
grant execute on function crm.amend_clinical_visit(
  uuid,integer,text,text,text,text,text,text,boolean,text[],text,jsonb,jsonb,jsonb,uuid
) to service_role;

comment on function crm.amend_clinical_visit(
  uuid,integer,text,text,text,text,text,text,boolean,text[],text,jsonb,jsonb,jsonb,uuid
) is 'Atomically amends a finalized visit through actor authorization, optimistic version check, immutable before/after snapshot, and preserved invoice/file history.';
