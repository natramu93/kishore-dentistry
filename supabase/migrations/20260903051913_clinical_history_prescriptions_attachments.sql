-- Structured longitudinal medical history, signed per-visit prescriptions,
-- private clinical attachments, and the simplified follow-up/dropped lead
-- outcome policy.

-- ---------------------------------------------------------------------------
-- Lead outcomes: keep historical closed rows readable, but prevent any new
-- transition (including direct service-role writes) into the retired status.

create function crm.reject_new_closed_lead() returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.status::text = 'closed'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    raise exception 'closed is a legacy lead status; use follow-up or dropped'
      using errcode = '23514';
  end if;
  return new;
end
$function$;

create trigger reject_new_closed_lead
  before insert or update on crm.leads
  for each row execute function crm.reject_new_closed_lead();

revoke execute on function crm.reject_new_closed_lead()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Patient medical history is versioned instead of being placed on crm.leads.
-- This keeps health information out of broad lead projections and preserves
-- exactly what was known for each signed visit.

create function crm.text_array_is_unique(p_values text[]) returns boolean
language sql
immutable
set search_path = ''
as $function$
  select cardinality(coalesce(p_values, array[]::text[])) = (
    select count(distinct value)::integer
    from unnest(coalesce(p_values, array[]::text[])) as item(value)
  )
$function$;

revoke execute on function crm.text_array_is_unique(text[])
  from public, anon, authenticated, service_role;

create table crm.patient_medical_history_versions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references crm.leads(id) on delete restrict,
  branch_id uuid not null references crm.branches(id) on delete restrict,
  review_status text not null,
  reviewed_with_patient boolean not null,
  conditions text[] not null default array[]::text[],
  description text,
  recorded_at timestamptz not null,
  recorded_by uuid not null references crm.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint patient_medical_history_review_status_check check (
    review_status in ('reviewed_none','reviewed_conditions')
  ),
  constraint patient_medical_history_review_confirmation_check check (
    reviewed_with_patient
  ),
  constraint patient_medical_history_conditions_check check (
    array_position(conditions, null) is null
    and conditions <@ array[
      'diabetes','hypertension','thyroid_disorder','pregnancy',
      'kidney_disease','liver_disease','heart_condition','asthma',
      'bleeding_disorder','allergies','other'
    ]::text[]
    and crm.text_array_is_unique(conditions)
  ),
  constraint patient_medical_history_review_shape_check check (
    (review_status = 'reviewed_none' and cardinality(conditions) = 0)
    or (review_status = 'reviewed_conditions' and cardinality(conditions) > 0)
  ),
  constraint patient_medical_history_other_check check (
    not ('other' = any(conditions))
    or nullif(btrim(description), '') is not null
  ),
  constraint patient_medical_history_description_check check (
    coalesce(length(description), 0) <= 4000
  ),
  constraint patient_medical_history_recorded_time_check check (
    isfinite(recorded_at) and recorded_at <= created_at
  )
);

comment on table crm.patient_medical_history_versions
is 'Append-only patient medical-history versions. The newest row is the current history; signed visits link to their exact version.';

create index patient_medical_history_lead_current_idx
  on crm.patient_medical_history_versions (lead_id, recorded_at desc, created_at desc, id desc);
create index patient_medical_history_branch_recorded_idx
  on crm.patient_medical_history_versions (branch_id, recorded_at desc);
create index patient_medical_history_recorded_by_idx
  on crm.patient_medical_history_versions (recorded_by);

create table crm.case_sheet_medical_history (
  case_sheet_id uuid primary key references crm.case_sheets(id) on delete restrict,
  medical_history_version_id uuid not null unique
    references crm.patient_medical_history_versions(id) on delete restrict,
  lead_id uuid not null references crm.leads(id) on delete restrict,
  branch_id uuid not null references crm.branches(id) on delete restrict,
  signed_at timestamptz not null,
  signed_by uuid not null references crm.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

comment on table crm.case_sheet_medical_history
is 'One immutable link from a signed case sheet to the exact structured medical-history version reviewed for that visit.';

create index case_sheet_medical_history_lead_idx
  on crm.case_sheet_medical_history (lead_id, signed_at desc);
create index case_sheet_medical_history_branch_idx
  on crm.case_sheet_medical_history (branch_id, signed_at desc);
create index case_sheet_medical_history_signed_by_idx
  on crm.case_sheet_medical_history (signed_by);

-- ---------------------------------------------------------------------------
-- A prescription is a signed child of the visit; it never creates invoice
-- eligibility, which remains limited to completed coded treatments.

create table crm.prescription_items (
  id uuid primary key default gen_random_uuid(),
  case_sheet_id uuid not null references crm.case_sheets(id) on delete restrict,
  lead_id uuid not null references crm.leads(id) on delete restrict,
  branch_id uuid not null references crm.branches(id) on delete restrict,
  appointment_id uuid not null references crm.appointments(id) on delete restrict,
  doctor_id uuid not null references crm.doctors(id) on delete restrict,
  line_number smallint not null,
  medicine_name text not null,
  strength text,
  dosage text,
  morning boolean not null default false,
  noon boolean not null default false,
  night boolean not null default false,
  food_timing text not null default 'not_applicable',
  duration_days integer,
  instructions text,
  prescribed_at timestamptz not null,
  signed_at timestamptz not null,
  signed_by uuid not null references crm.profiles(id) on delete restrict,
  created_by uuid not null references crm.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint prescription_items_case_sheet_line_key unique (case_sheet_id, line_number),
  constraint prescription_items_line_number_check check (line_number between 1 and 30),
  constraint prescription_items_medicine_name_check check (
    length(btrim(medicine_name)) between 1 and 200
  ),
  constraint prescription_items_text_length_check check (
    coalesce(length(strength), 0) <= 100
    and coalesce(length(dosage), 0) <= 100
    and coalesce(length(instructions), 0) <= 1000
  ),
  constraint prescription_items_schedule_check check (morning or noon or night),
  constraint prescription_items_food_timing_check check (
    food_timing in ('before_food','after_food','with_food','not_applicable')
  ),
  constraint prescription_items_duration_check check (
    duration_days is null or duration_days between 1 and 3650
  ),
  constraint prescription_items_time_check check (
    prescribed_at <= signed_at and signed_at >= created_at
  )
);

comment on table crm.prescription_items
is 'Append-only signed prescription lines for a finalized visit; independent of billing.';

create index prescription_items_lead_time_idx
  on crm.prescription_items (lead_id, prescribed_at desc, line_number);
create index prescription_items_branch_time_idx
  on crm.prescription_items (branch_id, prescribed_at desc);
create index prescription_items_appointment_idx
  on crm.prescription_items (appointment_id);
create index prescription_items_doctor_time_idx
  on crm.prescription_items (doctor_id, prescribed_at desc);
create index prescription_items_signed_by_idx
  on crm.prescription_items (signed_by);
create index prescription_items_created_by_idx
  on crm.prescription_items (created_by);

-- ---------------------------------------------------------------------------
-- Private file metadata. The object itself lives in the private Storage
-- bucket; CRM authorization is checked before issuing an upload or download.

create table crm.case_sheet_attachments (
  id uuid primary key default gen_random_uuid(),
  case_sheet_id uuid not null references crm.case_sheets(id) on delete restrict,
  lead_id uuid not null references crm.leads(id) on delete restrict,
  branch_id uuid not null references crm.branches(id) on delete restrict,
  category text not null,
  bucket_id text not null default 'clinical-attachments',
  object_path text not null unique,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  sha256_hex text,
  status text not null default 'pending',
  uploaded_at timestamptz,
  created_by uuid not null references crm.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint case_sheet_attachments_category_check check (
    category in ('photograph','xray','scan','report','other')
  ),
  constraint case_sheet_attachments_bucket_check check (
    bucket_id = 'clinical-attachments'
  ),
  constraint case_sheet_attachments_path_check check (
    length(object_path) between 10 and 500
    and object_path !~ '(^|/)\.\.(/|$)'
    and object_path !~ '[\\\x00-\x1f]'
  ),
  constraint case_sheet_attachments_name_check check (
    length(btrim(original_name)) between 1 and 255
  ),
  constraint case_sheet_attachments_mime_check check (
    mime_type in (
      'image/jpeg','image/png','image/webp','image/heic','image/heif','image/tiff',
      'application/pdf','application/dicom'
    )
  ),
  constraint case_sheet_attachments_size_check check (
    size_bytes between 1 and 26214400
  ),
  constraint case_sheet_attachments_sha256_check check (
    sha256_hex is null or sha256_hex ~ '^[0-9a-f]{64}$'
  ),
  constraint case_sheet_attachments_status_check check (
    status in ('pending','ready','failed')
  ),
  constraint case_sheet_attachments_upload_state_check check (
    (status = 'ready' and uploaded_at is not null and sha256_hex is not null
      and isfinite(uploaded_at) and uploaded_at >= created_at)
    or (status in ('pending','failed') and uploaded_at is null and sha256_hex is null)
  )
);

comment on table crm.case_sheet_attachments
is 'Metadata for private clinical photographs, X-rays, scans and reports associated with a signed case sheet.';

create index case_sheet_attachments_case_sheet_idx
  on crm.case_sheet_attachments (case_sheet_id, created_at, id);
create index case_sheet_attachments_lead_idx
  on crm.case_sheet_attachments (lead_id, created_at desc);
create index case_sheet_attachments_branch_idx
  on crm.case_sheet_attachments (branch_id, created_at desc);
create index case_sheet_attachments_created_by_idx
  on crm.case_sheet_attachments (created_by);
create index case_sheet_attachments_pending_idx
  on crm.case_sheet_attachments (created_at)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- Scope/immutability triggers. These are database backstops in addition to
-- server authorization.

create function crm.enforce_medical_history_scope() returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_lead crm.leads%rowtype;
begin
  select * into v_lead from crm.leads where id = new.lead_id;
  if not found or v_lead.deleted_at is not null
     or v_lead.branch_id is distinct from new.branch_id then
    raise exception 'medical history must match an active patient and branch'
      using errcode = '23514';
  end if;
  new.conditions := array(
    select lower(btrim(value))
    from unnest(coalesce(new.conditions, array[]::text[])) as item(value)
  );
  new.description := nullif(btrim(new.description), '');
  return new;
end
$function$;

create trigger enforce_medical_history_scope
  before insert on crm.patient_medical_history_versions
  for each row execute function crm.enforce_medical_history_scope();

create function crm.enforce_case_sheet_medical_history_scope() returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_sheet crm.case_sheets%rowtype;
  v_history crm.patient_medical_history_versions%rowtype;
begin
  select * into v_sheet from crm.case_sheets where id = new.case_sheet_id;
  select * into v_history from crm.patient_medical_history_versions
    where id = new.medical_history_version_id;
  if v_sheet.id is null or v_history.id is null
     or new.lead_id is distinct from v_sheet.lead_id
     or new.branch_id is distinct from v_sheet.branch_id
     or v_history.lead_id is distinct from v_sheet.lead_id
     or v_history.branch_id is distinct from v_sheet.branch_id then
    raise exception 'case-sheet medical history identity is invalid'
      using errcode = '23514';
  end if;
  new.lead_id := v_sheet.lead_id;
  new.branch_id := v_sheet.branch_id;
  new.signed_at := v_sheet.finalized_at;
  new.signed_by := v_sheet.signed_by;
  new.created_at := v_sheet.created_at;
  return new;
end
$function$;

create trigger enforce_case_sheet_medical_history_scope
  before insert on crm.case_sheet_medical_history
  for each row execute function crm.enforce_case_sheet_medical_history_scope();

create function crm.enforce_prescription_scope() returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_sheet crm.case_sheets%rowtype;
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
  new.prescribed_at := v_sheet.visit_at;
  new.signed_at := v_sheet.finalized_at;
  new.signed_by := v_sheet.signed_by;
  new.created_by := v_sheet.created_by;
  new.created_at := v_sheet.created_at;
  return new;
end
$function$;

create trigger enforce_prescription_scope
  before insert on crm.prescription_items
  for each row execute function crm.enforce_prescription_scope();

create function crm.enforce_attachment_scope() returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_sheet crm.case_sheets%rowtype;
  v_extension text;
  v_expected_path text;
begin
  select * into v_sheet from crm.case_sheets where id = new.case_sheet_id;
  v_extension := case new.mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    when 'image/heic' then 'heic'
    when 'image/heif' then 'heif'
    when 'image/tiff' then 'tiff'
    when 'application/pdf' then 'pdf'
    when 'application/dicom' then 'dcm'
    else null
  end;
  v_expected_path := v_sheet.branch_id::text || '/' || v_sheet.lead_id::text
    || '/' || v_sheet.id::text || '/' || new.id::text || '.' || v_extension;
  if not found or new.lead_id is distinct from v_sheet.lead_id
     or new.branch_id is distinct from v_sheet.branch_id
     or v_extension is null
     or new.status is distinct from 'pending'
     or new.uploaded_at is not null
     or new.sha256_hex is not null
     or new.object_path is distinct from v_expected_path then
    raise exception 'attachment identity or storage path is invalid'
      using errcode = '23514';
  end if;
  new.original_name := btrim(new.original_name);
  return new;
end
$function$;

create trigger enforce_attachment_scope
  before insert on crm.case_sheet_attachments
  for each row execute function crm.enforce_attachment_scope();

create function crm.protect_attachment_mutation() returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' or old.status <> 'pending'
     or new.id is distinct from old.id
     or new.case_sheet_id is distinct from old.case_sheet_id
     or new.lead_id is distinct from old.lead_id
     or new.branch_id is distinct from old.branch_id
     or new.category is distinct from old.category
     or new.bucket_id is distinct from old.bucket_id
     or new.object_path is distinct from old.object_path
     or new.original_name is distinct from old.original_name
     or new.mime_type is distinct from old.mime_type
     or new.size_bytes is distinct from old.size_bytes
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.status not in ('ready','failed')
     or (new.status = 'ready'
         and (new.uploaded_at is null or new.sha256_hex is null))
     or (new.status = 'failed'
         and (new.uploaded_at is not null or new.sha256_hex is not null)) then
    raise exception 'clinical attachment metadata is immutable outside upload completion'
      using errcode = '55000';
  end if;
  return new;
end
$function$;

create trigger protect_attachment_update_delete
  before update or delete on crm.case_sheet_attachments
  for each row execute function crm.protect_attachment_mutation();
create trigger protect_attachment_truncate
  before truncate on crm.case_sheet_attachments
  for each statement execute function crm.protect_finalized_clinical_record();

create trigger protect_medical_history_update_delete
  before update or delete on crm.patient_medical_history_versions
  for each row execute function crm.protect_finalized_clinical_record();
create trigger protect_medical_history_truncate
  before truncate on crm.patient_medical_history_versions
  for each statement execute function crm.protect_finalized_clinical_record();
create trigger protect_case_sheet_medical_history_update_delete
  before update or delete on crm.case_sheet_medical_history
  for each row execute function crm.protect_finalized_clinical_record();
create trigger protect_case_sheet_medical_history_truncate
  before truncate on crm.case_sheet_medical_history
  for each statement execute function crm.protect_finalized_clinical_record();
create trigger protect_prescription_items_update_delete
  before update or delete on crm.prescription_items
  for each row execute function crm.protect_finalized_clinical_record();
create trigger protect_prescription_items_truncate
  before truncate on crm.prescription_items
  for each statement execute function crm.protect_finalized_clinical_record();

revoke execute on function crm.enforce_medical_history_scope()
  from public, anon, authenticated, service_role;
revoke execute on function crm.enforce_case_sheet_medical_history_scope()
  from public, anon, authenticated, service_role;
revoke execute on function crm.enforce_prescription_scope()
  from public, anon, authenticated, service_role;
revoke execute on function crm.enforce_attachment_scope()
  from public, anon, authenticated, service_role;
revoke execute on function crm.protect_attachment_mutation()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The single application finalizer wraps the established odontogram finalizer.
-- Any validation failure in history or prescriptions rolls the whole visit
-- back, including appointment/lead transitions made by the inner function.

create function crm.finalize_clinical_visit(
  p_lead_id uuid,
  p_appointment_id uuid,
  p_doctor_id uuid,
  p_visit_at timestamptz,
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
  v_sheet crm.case_sheets%rowtype;
  v_history crm.patient_medical_history_versions%rowtype;
  v_item jsonb;
  v_line_number integer := 0;
  v_morning boolean;
  v_noon boolean;
  v_night boolean;
  v_duration integer;
  v_duration_invalid boolean;
  v_duration_text text;
  v_food_timing text;
begin
  if p_medical_history_confirmed is distinct from true
     or p_medical_history_review_status is null
     or p_medical_history_review_status not in ('reviewed_none','reviewed_conditions') then
    raise exception 'medical history must be reviewed before finalizing the visit'
      using errcode = '22023';
  end if;
  if p_medical_history_conditions is null
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
  if jsonb_typeof(p_prescriptions) is distinct from 'array' then
    raise exception 'prescriptions must be an array'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_prescriptions) > 30 then
    raise exception 'a visit accepts at most 30 prescription lines'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_prescriptions) > 0 and not exists (
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

  v_sheet := crm.finalize_case_sheet_with_odontogram(
    p_lead_id, p_appointment_id, p_doctor_id, p_visit_at,
    p_chief_complaint, p_findings, p_diagnosis, p_plan,
    p_medical_history_description, p_tooth_assessments, p_treatments, p_actor
  );

  insert into crm.patient_medical_history_versions (
    lead_id, branch_id, review_status, reviewed_with_patient, conditions, description,
    recorded_at, recorded_by, created_at
  ) values (
    v_sheet.lead_id, v_sheet.branch_id, p_medical_history_review_status, true,
    p_medical_history_conditions, nullif(btrim(p_medical_history_description), ''),
    v_sheet.visit_at, p_actor, v_sheet.created_at
  ) returning * into v_history;

  insert into crm.case_sheet_medical_history (
    case_sheet_id, medical_history_version_id, lead_id, branch_id,
    signed_at, signed_by, created_at
  ) values (
    v_sheet.id, v_history.id, v_sheet.lead_id, v_sheet.branch_id,
    v_sheet.finalized_at, v_sheet.signed_by, v_sheet.created_at
  );

  for v_item in select value from jsonb_array_elements(p_prescriptions)
  loop
    v_line_number := v_line_number + 1;
    if jsonb_typeof(v_item) is distinct from 'object'
       or jsonb_typeof(v_item->'medicine_name') is distinct from 'string'
       or (v_item ? 'strength' and jsonb_typeof(v_item->'strength') not in ('string','null'))
       or (v_item ? 'dosage' and jsonb_typeof(v_item->'dosage') not in ('string','null'))
       or (v_item ? 'instructions' and jsonb_typeof(v_item->'instructions') not in ('string','null'))
       or (v_item ? 'morning' and jsonb_typeof(v_item->'morning') <> 'boolean')
       or (v_item ? 'noon' and jsonb_typeof(v_item->'noon') <> 'boolean')
       or (v_item ? 'night' and jsonb_typeof(v_item->'night') <> 'boolean')
       or (v_item ? 'food_timing' and jsonb_typeof(v_item->'food_timing') <> 'string')
       or (v_item ? 'duration_days' and jsonb_typeof(v_item->'duration_days') not in ('number','null')) then
      raise exception 'prescription line % has invalid field types', v_line_number
        using errcode = '22023';
    end if;

    v_morning := coalesce((v_item->>'morning')::boolean, false);
    v_noon := coalesce((v_item->>'noon')::boolean, false);
    v_night := coalesce((v_item->>'night')::boolean, false);
    v_food_timing := coalesce(nullif(btrim(v_item->>'food_timing'), ''), 'not_applicable');
    v_duration_text := v_item->>'duration_days';
    v_duration_invalid := false;
    if v_duration_text is null then
      v_duration := null;
    elsif v_duration_text ~ '^[0-9]{1,4}$' then
      v_duration := v_duration_text::integer;
    else
      v_duration := null;
      v_duration_invalid := true;
    end if;

    if length(btrim(v_item->>'medicine_name')) not between 1 and 200
       or coalesce(length(v_item->>'strength'), 0) > 100
       or coalesce(length(v_item->>'dosage'), 0) > 100
       or coalesce(length(v_item->>'instructions'), 0) > 1000
       or not (v_morning or v_noon or v_night)
       or v_food_timing not in ('before_food','after_food','with_food','not_applicable')
       or v_duration_invalid
       or (v_duration is not null and v_duration not between 1 and 3650) then
      raise exception 'prescription line % is invalid', v_line_number
        using errcode = '22023';
    end if;

    insert into crm.prescription_items (
      case_sheet_id, lead_id, branch_id, appointment_id, doctor_id,
      line_number, medicine_name, strength, dosage,
      morning, noon, night, food_timing, duration_days, instructions,
      prescribed_at, signed_at, signed_by, created_by, created_at
    ) values (
      v_sheet.id, v_sheet.lead_id, v_sheet.branch_id, v_sheet.appointment_id, v_sheet.doctor_id,
      v_line_number, btrim(v_item->>'medicine_name'),
      nullif(btrim(v_item->>'strength'), ''), nullif(btrim(v_item->>'dosage'), ''),
      v_morning, v_noon, v_night, v_food_timing, v_duration,
      nullif(btrim(v_item->>'instructions'), ''),
      v_sheet.visit_at, v_sheet.finalized_at, v_sheet.signed_by,
      v_sheet.created_by, v_sheet.created_at
    );
  end loop;

  insert into crm.audit_log(entity_type, entity_id, action, actor_id, new_data)
  values (
    'case_sheet', v_sheet.id, 'clinical_details_recorded', p_actor,
    jsonb_build_object(
      'medical_history_version_id', v_history.id,
      'medical_condition_count', cardinality(v_history.conditions),
      'prescription_count', jsonb_array_length(p_prescriptions)
    )
  );
  return v_sheet;
end
$function$;

-- ---------------------------------------------------------------------------
-- RLS/grants. Browser roles receive no CRM table access. The service-role
-- server boundary can read signed records and manage pending attachment
-- metadata, while clinical rows are inserted only by the atomic finalizer.

alter table crm.patient_medical_history_versions enable row level security;
alter table crm.case_sheet_medical_history enable row level security;
alter table crm.prescription_items enable row level security;
alter table crm.case_sheet_attachments enable row level security;

revoke all on crm.patient_medical_history_versions
  from public, anon, authenticated, service_role;
revoke all on crm.case_sheet_medical_history
  from public, anon, authenticated, service_role;
revoke all on crm.prescription_items
  from public, anon, authenticated, service_role;
revoke all on crm.case_sheet_attachments
  from public, anon, authenticated, service_role;

grant select on crm.patient_medical_history_versions to service_role;
grant select on crm.case_sheet_medical_history to service_role;
grant select on crm.prescription_items to service_role;
grant select, insert, update on crm.case_sheet_attachments to service_role;

-- Prevent the server client from bypassing the clinical finalizer. The
-- security-definer owner can still compose these inserts atomically.
revoke insert on crm.case_sheets from service_role;
revoke insert, update, delete, truncate on crm.treatments from service_role;

revoke execute on function crm.finalize_clinical_visit(
  uuid,uuid,uuid,timestamptz,text,text,text,text,text,boolean,text[],text,jsonb,jsonb,jsonb,uuid
) from public, anon, authenticated;
grant execute on function crm.finalize_clinical_visit(
  uuid,uuid,uuid,timestamptz,text,text,text,text,text,boolean,text[],text,jsonb,jsonb,jsonb,uuid
) to service_role;

-- All application finalization must now pass through the wrapper above so a
-- signed visit cannot omit its reviewed medical-history version. The older
-- functions remain available to the owner for internal composition only.
revoke execute on function crm.finalize_case_sheet(
  uuid,uuid,uuid,timestamptz,text,text,text,text,text,jsonb,uuid
) from service_role;
revoke execute on function crm.finalize_case_sheet_with_odontogram(
  uuid,uuid,uuid,timestamptz,text,text,text,text,text,jsonb,jsonb,uuid
) from service_role;

comment on function crm.finalize_clinical_visit(
  uuid,uuid,uuid,timestamptz,text,text,text,text,text,boolean,text[],text,jsonb,jsonb,jsonb,uuid
) is 'Atomically finalizes a visit with odontogram, coded treatments, reviewed medical-history version and signed prescription lines.';
