-- Case sheets may be amended for 24 elapsed hours from finalization.
-- Enforce this in the same database trigger that guards finalized records so
-- every path through the amendment workflow observes the deadline.
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
      if old.finalized_at is null
         or clock_timestamp() > old.finalized_at + interval '24 hours' then
        raise exception 'case-sheet amendment window has expired'
          using errcode = '55000';
      end if;
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

revoke execute on function crm.protect_finalized_clinical_record()
  from public, anon, authenticated, service_role;

create or replace function crm.case_sheet_amendment_window_open(p_case_sheet_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select exists (
    select 1 from crm.case_sheets
    where id = p_case_sheet_id
      and finalized_at is not null
      and statement_timestamp() <= finalized_at + interval '24 hours'
  )
$function$;

revoke execute on function crm.case_sheet_amendment_window_open(uuid)
  from public, anon, authenticated;
grant execute on function crm.case_sheet_amendment_window_open(uuid)
  to service_role;
