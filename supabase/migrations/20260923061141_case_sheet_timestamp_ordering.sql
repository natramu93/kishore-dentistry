-- Keep clinical timestamps ordered with the row's created_at/default now().
-- Appointment scheduled_at remains independent from case-sheet entry time.
create or replace function crm.enforce_case_sheet_creation() returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if current_setting('crm.finalizing_case_sheet', true) is distinct from new.id::text then
    raise exception 'case sheets may only be created by the finalization workflow'
      using errcode = '55000';
  end if;
  new.visit_at := now();
  return new;
end
$function$;
