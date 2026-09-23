-- Keep the database-side lead transition default aligned with the UI and
-- appointments table default. This preserves the rest of the deployed
-- function body while changing only its duration fallback.
do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'crm.transition_lead(uuid,crm.lead_status,uuid,jsonb)'::regprocedure
  ) into v_definition;
  v_updated := replace(
    v_definition,
    'coalesce(nullif(v_payload->>''duration_minutes'', '''')::int, 30)',
    'coalesce(nullif(v_payload->>''duration_minutes'', '''')::int, 15)'
  );
  if v_updated = v_definition then
    raise exception 'transition_lead duration default was not found';
  end if;
  execute v_updated;
end
$migration$;
