-- Treatment-level files share the existing private clinical attachment table
-- and bucket, while retaining the case-sheet identity needed for access
-- control and lifecycle management.

alter table crm.case_sheet_attachments
  add column treatment_id uuid references crm.treatments(id) on delete restrict;

create index case_sheet_attachments_treatment_idx
  on crm.case_sheet_attachments (treatment_id, created_at, id)
  where treatment_id is not null;

comment on column crm.case_sheet_attachments.treatment_id is
  'Optional treatment owning this file. Null means the file belongs to the whole case sheet.';

create or replace function crm.enforce_attachment_scope() returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_sheet crm.case_sheets%rowtype;
  v_treatment crm.treatments%rowtype;
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

  if new.treatment_id is null then
    v_expected_path := new.branch_id::text || '/' || new.lead_id::text
      || '/' || new.case_sheet_id::text || '/' || new.id::text || '.' || v_extension;
  else
    select * into v_treatment from crm.treatments where id = new.treatment_id;
    v_expected_path := new.branch_id::text || '/' || new.lead_id::text
      || '/' || new.case_sheet_id::text || '/treatments/'
      || new.treatment_id::text || '/' || new.id::text || '.' || v_extension;
  end if;

  if not found or v_sheet.finalized_at is null
     or new.lead_id is distinct from v_sheet.lead_id
     or new.branch_id is distinct from v_sheet.branch_id
     or (new.treatment_id is not null and (
       v_treatment.id is null
       or v_treatment.case_sheet_id is distinct from new.case_sheet_id
       or v_treatment.lead_id is distinct from new.lead_id
       or v_treatment.branch_id is distinct from new.branch_id
     ))
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

create or replace function crm.protect_attachment_mutation() returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' or old.status <> 'pending'
     or new.id is distinct from old.id
     or new.case_sheet_id is distinct from old.case_sheet_id
     or new.treatment_id is distinct from old.treatment_id
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

-- Capture the actual save time at the database boundary. The application
-- still sends the legacy parameter for compatibility, but it is never trusted.
create or replace function crm.enforce_case_sheet_creation() returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if current_setting('crm.finalizing_case_sheet', true) is distinct from new.id::text then
    raise exception 'case sheets may only be created by the finalization workflow'
      using errcode = '55000';
  end if;
  new.visit_at := clock_timestamp();
  return new;
end
$function$;

create or replace function crm.enforce_coded_treatment() returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_sheet crm.case_sheets%rowtype;
  v_code crm.treatment_codes%rowtype;
begin
  if current_user = 'postgres'
     and current_setting('crm.allow_legacy_test_records', true) = 'on' then
    return new;
  end if;
  if new.case_sheet_id is null
     and not crm.coded_dental_enforcement_enabled() then
    return new;
  end if;
  if new.case_sheet_id is null or new.treatment_code is null then
    raise exception 'new treatments require a finalized coded case sheet'
      using errcode = '23514';
  end if;

  if current_setting('crm.finalizing_case_sheet', true) is distinct from new.case_sheet_id::text then
    raise exception 'treatments may only be added while finalizing their case sheet'
      using errcode = '55000';
  end if;

  select * into v_sheet from crm.case_sheets where id = new.case_sheet_id;
  if not found or v_sheet.finalized_at is null then
    raise exception 'case sheet % is missing or not finalized', new.case_sheet_id
      using errcode = '23514';
  end if;
  if v_sheet.lead_id is distinct from new.lead_id
     or v_sheet.branch_id is distinct from new.branch_id
     or v_sheet.appointment_id is distinct from new.appointment_id
     or v_sheet.doctor_id is distinct from new.doctor_id then
    raise exception 'treatment identity must match its case sheet'
      using errcode = '23514';
  end if;

  select * into v_code from crm.treatment_codes where code = new.treatment_code;
  if not found or lower(v_code.status) <> 'active' then
    raise exception 'treatment code % is missing or inactive', new.treatment_code
      using errcode = '23514';
  end if;

  new.treatment_name := v_code.name;
  new.treatment_category := v_code.category;
  new.signed_at := v_sheet.finalized_at;
  new.signed_by := v_sheet.signed_by;
  new.treated_at := v_sheet.visit_at;
  if new.performed_at is not null then
    new.performed_at := v_sheet.visit_at;
  end if;
  new.surfaces := coalesce(new.surfaces, array[]::text[]);
  new.site_detail := nullif(btrim(new.site_detail), '');
  new.tooth_number := nullif(btrim(new.tooth_number), '');
  new.diagnosis := nullif(btrim(new.diagnosis), '');
  new.notes := nullif(btrim(new.notes), '');
  return new;
end;
$function$;
