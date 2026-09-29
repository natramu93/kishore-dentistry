-- Later care is a new signed record, never an edit of an older signed plan.
alter table crm.treatments add column planned_treatment_id uuid
  references crm.treatments(id) on delete restrict;
create index treatments_planned_treatment_idx on crm.treatments(planned_treatment_id)
  where planned_treatment_id is not null;
alter table crm.treatments add constraint treatments_plan_completion_check check (
  planned_treatment_id is null or (
    planned_treatment_id <> id and clinical_status = 'completed' and case_sheet_id is not null
  )
);

create function crm.validate_treatment_plan_continuation() returns trigger
language plpgsql set search_path = '' as $function$
declare
  v_source crm.treatments%rowtype;
begin
  if tg_op = 'UPDATE' then
    if old.planned_treatment_id is distinct from new.planned_treatment_id then
      raise exception 'A signed treatment cannot be linked to a different plan' using errcode = '23514';
    end if;
    if exists (select 1 from crm.treatments where planned_treatment_id=old.id)
       and (old.lead_id,old.branch_id,old.case_sheet_id,old.clinical_status,old.treatment_code,
            old.site_scope,old.site_detail,old.tooth_numbers,old.surfaces)
         is distinct from
           (new.lead_id,new.branch_id,new.case_sheet_id,new.clinical_status,new.treatment_code,
            new.site_scope,new.site_detail,new.tooth_numbers,new.surfaces) then
      raise exception 'A plan with recorded later care cannot change its code, site or status' using errcode = '23514';
    end if;
  end if;
  if new.planned_treatment_id is null then return new; end if;
  -- Finalize/amend already lock the patient first. Lock the source too before
  -- checking overlapping completions, in the same transaction as the new visit.
  select * into v_source from crm.treatments where id=new.planned_treatment_id for update;
  if not found or v_source.clinical_status is distinct from 'planned'
     or v_source.planned_treatment_id is not null
     or v_source.case_sheet_id is null or v_source.case_sheet_id=new.case_sheet_id
     or not exists (select 1 from crm.case_sheets s where s.id=v_source.case_sheet_id and s.finalized_at is not null)
     or new.clinical_status is distinct from 'completed'
     or v_source.lead_id is distinct from new.lead_id
     or v_source.branch_id is distinct from new.branch_id
     or v_source.treatment_code is distinct from new.treatment_code
     or not (coalesce(v_source.surfaces,'{}') @> coalesce(new.surfaces,'{}')
         and coalesce(v_source.surfaces,'{}') <@ coalesce(new.surfaces,'{}')) then
    raise exception 'Select an earlier pending plan for this patient with the same code and surfaces' using errcode = '23514';
  end if;
  if v_source.site_scope in ('tooth','multi_tooth') then
    if new.site_scope not in ('tooth','multi_tooth') or cardinality(new.tooth_numbers)=0
       or not new.tooth_numbers <@ v_source.tooth_numbers then
      raise exception 'Complete only teeth from the selected plan' using errcode = '23514';
    end if;
    if exists (select 1 from crm.treatments t where t.planned_treatment_id=v_source.id
        and t.id<>new.id and t.tooth_numbers && new.tooth_numbers) then
      raise exception 'These planned teeth already have a recorded completion. Refresh the patient.' using errcode = '23514';
    end if;
  else
    if new.site_scope is distinct from v_source.site_scope
       or new.site_detail is distinct from v_source.site_detail
       or exists (select 1 from crm.treatments t where t.planned_treatment_id=v_source.id and t.id<>new.id) then
      raise exception 'This planned site is different or already completed' using errcode = '23514';
    end if;
  end if;
  return new;
end
$function$;
create trigger validate_treatment_plan_continuation
  before insert or update on crm.treatments
  for each row execute function crm.validate_treatment_plan_continuation();
revoke all on function crm.validate_treatment_plan_continuation() from public,anon,authenticated,service_role;

-- Keep the deployed finalizer composition and signature. Assert the exact
-- insertion points so a differing historical function fails safely at migration.
do $migration$
declare v_definition text; v_updated text; v_anchor text[];
begin
  select pg_get_functiondef('crm.finalize_case_sheet(uuid,uuid,uuid,timestamptz,text,text,text,text,text,jsonb,uuid)'::regprocedure)
    into v_definition;
  foreach v_anchor slice 1 in array array[
    array['treatment_code, clinical_status, site_scope, site_detail, tooth_number,'],
    array['v_code, v_status, v_scope, v_detail, v_tooth, v_surfaces,'],
    array[$anchor$  if v_lead.status <> 'appointment_booked' then
    raise exception 'lead must have a booked appointment before case-sheet finalization'
      using errcode = '55000';
  end if;$anchor$]
  ] loop
    if array_length(string_to_array(v_definition,v_anchor[1]),1)<>2 then
      raise exception 'Treatment finalizer anchor must occur exactly once: %',v_anchor[1];
    end if;
  end loop;
  v_updated := replace(v_definition,
    'treatment_code, clinical_status, site_scope, site_detail, tooth_number,',
    'treatment_code, clinical_status, site_scope, site_detail, tooth_number, planned_treatment_id,');
  v_updated := replace(v_updated,
    'v_code, v_status, v_scope, v_detail, v_tooth, v_surfaces,',
    'v_code, v_status, v_scope, v_detail, v_tooth, nullif(v_item->>''planned_treatment_id'','''')::uuid, v_surfaces,');
  v_updated := replace(v_updated,$anchor$  if v_lead.status <> 'appointment_booked' then
    raise exception 'lead must have a booked appointment before case-sheet finalization'
      using errcode = '55000';
  end if;$anchor$,
    '-- The actual scheduled appointment below is authoritative, including later visits for an already visited patient.');
  if v_updated=v_definition or v_updated not like '%nullif(v_item->>''planned_treatment_id''%' then
    raise exception 'Cannot safely extend treatment finalizer with plan lineage';
  end if;
  execute v_updated;

  select pg_get_functiondef('crm.amend_clinical_visit(uuid,integer,text,text,text,text,text,text,boolean,text[],text,jsonb,jsonb,jsonb,uuid)'::regprocedure)
    into v_definition;
  foreach v_anchor slice 1 in array array[
    array['clinical_status, site_scope, site_detail, tooth_number, tooth_numbers, surfaces,'],
    array['v_code_text, v_status, v_scope, v_detail, v_tooth, v_tooth_numbers, v_surfaces,'],
    array['if v_has_invoice then continue; end if;']
  ] loop
    if array_length(string_to_array(v_definition,v_anchor[1]),1)<>2 then
      raise exception 'Treatment amendment anchor must occur exactly once: %',v_anchor[1];
    end if;
  end loop;
  v_updated := replace(v_definition,
    'clinical_status, site_scope, site_detail, tooth_number, tooth_numbers, surfaces,',
    'clinical_status, site_scope, site_detail, tooth_number, tooth_numbers, surfaces, planned_treatment_id,');
  v_updated := replace(v_updated,
    'v_code_text, v_status, v_scope, v_detail, v_tooth, v_tooth_numbers, v_surfaces,',
    'v_code_text, v_status, v_scope, v_detail, v_tooth, v_tooth_numbers, v_surfaces, nullif(v_item->>''planned_treatment_id'','''')::uuid,');
  v_updated := replace(v_updated,
    'if v_has_invoice then continue; end if;',
    'if v_treatment_id is not null and v_treatment.planned_treatment_id is distinct from nullif(v_item->>''planned_treatment_id'','''')::uuid then
      raise exception ''A signed treatment cannot be linked to a different plan'' using errcode = ''23514'';
    end if;
    if v_has_invoice then continue; end if;');
  if v_updated=v_definition or v_updated not like '%v_treatment.planned_treatment_id is distinct from%' then
    raise exception 'Cannot safely extend treatment amendment with plan lineage';
  end if;
  execute v_updated;
end
$migration$;

-- No billing or patient-contact fields. Derived progress is filtered before
-- counting/pagination, so older unresolved plans cannot be hidden by resolved ones.
create view crm.clinical_treatment_progress with (security_invoker=true) as
select t.id,t.lead_id,t.branch_id,t.case_sheet_id,t.planned_treatment_id,t.treatment_code,t.treatment_name,
  t.clinical_status,t.site_scope,t.site_detail,t.tooth_number,t.tooth_numbers,t.surfaces,t.notes,
  t.treated_at,t.performed_at,d.full_name as doctor_name,
  remaining.teeth as remaining_tooth_numbers,
  (t.clinical_status='planned' and case when t.site_scope in ('tooth','multi_tooth')
    then cardinality(remaining.teeth)>0 else not exists (
      select 1 from crm.treatments c where c.planned_treatment_id=t.id
    ) end) as is_pending
from crm.treatments t
left join crm.doctors d on d.id=t.doctor_id
cross join lateral (
  select coalesce(array_agg(n.tooth order by n.ordinality),'{}'::text[]) as teeth
  from unnest(t.tooth_numbers) with ordinality n(tooth,ordinality)
  where not exists (select 1 from crm.treatments c
    where c.planned_treatment_id=t.id and n.tooth=any(c.tooth_numbers))
) remaining;
revoke all on crm.clinical_treatment_progress from public,anon,authenticated;
grant select on crm.clinical_treatment_progress to service_role;
comment on column crm.treatments.planned_treatment_id is
  'Explicit plan fulfilled by this later signed completion. Null never implies a match by tooth, code, invoice or payment.';
notify pgrst, 'reload schema';
