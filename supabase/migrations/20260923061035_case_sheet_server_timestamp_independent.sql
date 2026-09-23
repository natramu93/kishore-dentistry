-- Case-sheet entry time is captured by the database trigger, independently of
-- the appointment's scheduled time. The legacy p_visit_at argument remains in
-- the RPC signature for compatibility, but must not reject a valid save merely
-- because the browser clock is a few milliseconds ahead of the database clock.
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

  v_updated := replace(
    v_definition,
    $needle$  if not isfinite(p_visit_at) or p_visit_at > now() then
    raise exception 'visit time cannot be in the future'
      using errcode = '22023';
  end if;
$needle$,
    $replacement$  if not isfinite(p_visit_at) then
    raise exception 'visit time must be finite'
      using errcode = '22023';
  end if;
  -- The enforce_case_sheet_creation trigger records the server-side save time.
  -- Use the transaction timestamp for legacy treatment-time validation and do
  -- not compare it with the appointment's scheduled_at value.
  p_visit_at := now();
$replacement$
  );

  if v_updated = v_definition
     or v_updated not like '%p_visit_at := now();%'
     or v_updated like '%visit time cannot be in the future%' then
    raise exception 'unable to update crm.finalize_case_sheet safely';
  end if;
  execute v_updated;
end
$migration$;
