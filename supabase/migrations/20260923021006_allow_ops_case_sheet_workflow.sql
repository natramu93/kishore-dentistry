-- Allow operations/front-desk staff to complete the clinical workflow while
-- keeping treatment pricing in the invoice editor. A treatment can now cover
-- several Indian Standard teeth, with the first selected tooth retained in
-- tooth_number for compatibility with existing reports.

alter table crm.treatments
  add column if not exists tooth_numbers text[];

-- This is a deterministic backfill of the newly added column. The existing
-- row-protection trigger correctly blocks clinical edits, so pause only that
-- trigger for the metadata-only backfill and restore it immediately.
alter table crm.treatments disable trigger protect_coded_treatment_update;
update crm.treatments
set tooth_numbers = case
  when tooth_number is not null then array[tooth_number]
  else array[]::text[]
end
where tooth_numbers is null;
alter table crm.treatments enable trigger protect_coded_treatment_update;

alter table crm.treatments
  alter column tooth_numbers set default array[]::text[],
  alter column tooth_numbers set not null;

alter table crm.invoice_items
  add column if not exists tooth_numbers text[];

alter table crm.treatments drop constraint if exists treatments_coded_shape_check;
alter table crm.treatments drop constraint if exists treatments_site_check;

alter table crm.treatments
  add constraint treatments_coded_shape_check check (
    case_sheet_id is null or (
      treatment_code is not null and
      treatment_name is not null and
      length(btrim(treatment_name)) between 1 and 300 and
      clinical_status is not null and
      clinical_status in ('planned', 'completed') and
      site_scope in ('not_applicable', 'full_mouth', 'arch', 'quadrant', 'tooth', 'multi_tooth') and
      quantity is not null and
      quantity > 0 and
      signed_at is not null and
      signed_by is not null and
      (clinical_status = 'planned' or performed_at is not null) and
      (site_scope <> 'multi_tooth' or cardinality(tooth_numbers) >= 2)
    )
  ) not valid,
  add constraint treatments_site_check check (
    case_sheet_id is null or
    case site_scope
      when 'tooth' then
        tooth_number ~ '^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$'
        and cardinality(tooth_numbers) = 1
        and tooth_numbers[1] = tooth_number
        and site_detail is null
      when 'multi_tooth' then
        tooth_number ~ '^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$'
        and cardinality(tooth_numbers) >= 2
        and tooth_numbers[1] = tooth_number
        and tooth_numbers <@ array[
          '11','12','13','14','15','16','17','18',
          '21','22','23','24','25','26','27','28',
          '31','32','33','34','35','36','37','38',
          '41','42','43','44','45','46','47','48',
          '51','52','53','54','55','61','62','63','64','65',
          '71','72','73','74','75','81','82','83','84','85'
        ]::text[]
        and site_detail is null
      when 'arch' then tooth_number is null and cardinality(tooth_numbers) = 0 and cardinality(surfaces) = 0 and site_detail in ('upper', 'lower')
      when 'quadrant' then tooth_number is null and cardinality(tooth_numbers) = 0 and cardinality(surfaces) = 0 and site_detail in ('upper_right', 'upper_left', 'lower_right', 'lower_left')
      when 'full_mouth' then tooth_number is null and cardinality(tooth_numbers) = 0 and cardinality(surfaces) = 0 and site_detail is null
      when 'not_applicable' then tooth_number is null and cardinality(tooth_numbers) = 0 and cardinality(surfaces) = 0 and site_detail is null
      else false
    end
  ) not valid;

create index if not exists treatments_tooth_numbers_gin_idx
  on crm.treatments using gin (tooth_numbers)
  where case_sheet_id is not null;

-- The finalizer is already deployed by the odontogram migration. Rewrite its
-- stable definition in-place so this migration remains compatible with the
-- existing RPC signature and with any later wrapper functions.
do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(p.oid)
    into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'crm'
    and p.proname = 'finalize_case_sheet'
    and p.pronargs = 11;

  if v_definition is null then
    raise exception 'crm.finalize_case_sheet(uuid,uuid,uuid,timestamptz,text,text,text,text,text,jsonb,uuid) is missing';
  end if;

  v_updated := regexp_replace(
    v_definition,
    $pattern$v_actor\.role::text\s+not\s+in\s*\('admin'\s*,\s*'clinical_head'\s*,\s*'doctor'\)$pattern$,
    $replacement$v_actor.role::text not in ('admin','operations','front_office','clinical_head','doctor')$replacement$,
    1
  );
  v_updated := regexp_replace(
    v_updated,
    $pattern$v_scope\s+not\s+in\s*\('not_applicable'\s*,\s*'full_mouth'\s*,\s*'arch'\s*,\s*'quadrant'\s*,\s*'tooth'\s*\)$pattern$,
    $replacement$v_scope not in ('not_applicable','full_mouth','arch','quadrant','tooth','multi_tooth')$replacement$,
    1
  );
  v_updated := replace(
    v_updated,
    $needle$v_tooth := nullif(btrim(v_item->>'tooth_number'), '');$needle$,
    $replacement$v_tooth := nullif(btrim(v_item->>'tooth_number'), '');
    perform set_config(
      'crm.current_treatment_tooth_numbers',
      coalesce(v_item->'tooth_numbers', jsonb_build_array(v_tooth))::text,
      true
    );$replacement$
  );
  v_updated := replace(
    v_updated,
    $needle$return v_sheet;$needle$,
    $replacement$perform set_config('crm.current_treatment_tooth_numbers', '', true);
  return v_sheet;$replacement$
  );

  if v_updated = v_definition
     or v_updated not like '%operations%'
     or v_updated not like '%multi_tooth%'
     or v_updated not like '%current_treatment_tooth_numbers%' then
    raise exception 'unable to update crm.finalize_case_sheet safely';
  end if;
  execute v_updated;
end
$migration$;

create or replace function crm.enforce_coded_treatment() returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_sheet crm.case_sheets%rowtype;
  v_code crm.treatment_codes%rowtype;
  v_tooth_numbers text[];
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

  select coalesce(
    array_agg(btrim(item.value #>> '{}') order by item.ordinality),
    array[]::text[]
  )
    into v_tooth_numbers
  from jsonb_array_elements(
    coalesce(nullif(current_setting('crm.current_treatment_tooth_numbers', true), '')::jsonb, '[]'::jsonb)
  ) with ordinality as item(value, ordinality)
  where jsonb_typeof(item.value) = 'string'
    and btrim(item.value #>> '{}') <> '';

  new.treatment_name := v_code.name;
  new.treatment_category := v_code.category;
  new.signed_at := v_sheet.finalized_at;
  new.signed_by := v_sheet.signed_by;
  new.surfaces := coalesce(new.surfaces, array[]::text[]);
  new.site_detail := nullif(btrim(new.site_detail), '');
  new.tooth_number := nullif(btrim(new.tooth_number), '');
  new.diagnosis := nullif(btrim(new.diagnosis), '');
  new.notes := nullif(btrim(new.notes), '');

  if new.site_scope = 'tooth' then
    if cardinality(v_tooth_numbers) > 0 then
      new.tooth_number := v_tooth_numbers[1];
    end if;
    new.tooth_numbers := case
      when new.tooth_number is null then array[]::text[]
      else array[new.tooth_number]
    end;
  elsif new.site_scope = 'multi_tooth' then
    if cardinality(v_tooth_numbers) = 0 and new.tooth_number is not null then
      v_tooth_numbers := array[new.tooth_number];
    end if;
    if cardinality(v_tooth_numbers) < 2
       or cardinality(v_tooth_numbers) <> (select count(distinct items.tooth) from unnest(v_tooth_numbers) as items(tooth))
       or exists (
         select 1 from unnest(v_tooth_numbers) as items(tooth)
         where items.tooth !~ '^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$'
       ) then
      raise exception 'multi-tooth treatments require at least two unique Indian Standard teeth'
        using errcode = '23514';
    end if;
    new.tooth_numbers := v_tooth_numbers;
    new.tooth_number := v_tooth_numbers[1];
  else
    new.tooth_number := null;
    new.tooth_numbers := array[]::text[];
  end if;
  return new;
end;
$function$;

create or replace function crm.populate_coded_invoice_item() returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_invoice crm.invoices%rowtype;
  v_treatment crm.treatments%rowtype;
  v_site text;
begin
  select * into v_invoice from crm.invoices where id = new.invoice_id;
  if not found then return new; end if;
  new.active_billing := case
    when current_user = 'postgres'
      and current_setting('crm.archiving_invoice', true) = new.invoice_id::text
      then false
    else v_invoice.deleted_at is null
  end;
  if not v_invoice.code_enforced then return new; end if;
  if new.treatment_id is null then
    raise exception 'code-enforced invoice lines require treatment_id' using errcode = '23514';
  end if;
  select * into v_treatment from crm.treatments where id = new.treatment_id;
  if not found or v_treatment.lead_id is distinct from v_invoice.lead_id
     or v_treatment.branch_id is distinct from v_invoice.branch_id
     or v_treatment.clinical_status is distinct from 'completed'
     or v_treatment.treatment_code is null or v_treatment.case_sheet_id is null
     or v_treatment.performed_at is null then
    raise exception 'invoice treatment must be a completed coded line for the same patient and branch'
      using errcode = '23514';
  end if;
  if not exists (select 1 from crm.case_sheets c where c.id = v_treatment.case_sheet_id and c.finalized_at is not null) then
    raise exception 'invoice treatment case sheet is not finalized' using errcode = '23514';
  end if;
  v_site := case v_treatment.site_scope
    when 'tooth' then ' - Tooth ' || v_treatment.tooth_number
    when 'multi_tooth' then ' - Teeth ' || array_to_string(v_treatment.tooth_numbers, ', ')
    when 'arch' then ' - ' || initcap(v_treatment.site_detail) || ' arch'
    when 'quadrant' then ' - ' || initcap(replace(v_treatment.site_detail, '_', ' '))
    when 'full_mouth' then ' - Full mouth'
    else ''
  end;
  new.description := '[' || v_treatment.treatment_code || '] ' || v_treatment.treatment_name || v_site;
  new.treatment_code := v_treatment.treatment_code;
  new.treatment_name := v_treatment.treatment_name;
  new.treatment_category := v_treatment.treatment_category;
  new.case_sheet_id := v_treatment.case_sheet_id;
  new.tooth_number := v_treatment.tooth_number;
  new.tooth_numbers := v_treatment.tooth_numbers;
  new.site_scope := v_treatment.site_scope;
  new.site_detail := v_treatment.site_detail;
  new.surfaces := v_treatment.surfaces;
  return new;
end
$function$;
