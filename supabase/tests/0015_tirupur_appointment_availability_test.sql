-- Dependency-free TAP-compatible regression test for branch appointment hours.
begin;

select '1..1';

do $test$
declare
  v_branch uuid;
  v_saturday_lead uuid;
  v_sunday_lead uuid;
  v_closing_lead uuid;
  v_early_lead uuid;
  v_late_lead uuid;
  v_start_at_close_lead uuid;
  v_historical_lead uuid;
  v_historical_appointment uuid;
  v_reschedule_lead uuid;
  v_reschedule_appointment uuid;
  v_other_branch uuid;
  v_other_lead uuid;
begin
  select id into strict v_branch
  from crm.branches
  where code = 'TUP';

  if (
    select count(*)
    from crm.branch_business_hours
    where branch_id = v_branch
      and iso_weekday between 1 and 7
      and opens_at = time '09:00'
      and closes_at = time '19:30'
  ) <> 7 then
    raise exception 'Tirupur does not have seven daily 09:00-19:30 schedule rows';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'crm'
      and c.relname = 'branch_business_hours'
      and c.relrowsecurity
  ) then
    raise exception 'branch business hours does not have RLS enabled';
  end if;

  if not has_table_privilege('service_role', 'crm.branch_business_hours', 'SELECT')
     or has_table_privilege('service_role', 'crm.branch_business_hours', 'INSERT')
     or has_table_privilege('anon', 'crm.branch_business_hours', 'SELECT')
     or has_table_privilege('authenticated', 'crm.branch_business_hours', 'SELECT')
     or has_function_privilege('anon', 'crm.validate_appointment_availability()', 'EXECUTE')
     or has_function_privilege('authenticated', 'crm.validate_appointment_availability()', 'EXECUTE') then
    raise exception 'branch business hours privileges are unsafe';
  end if;

  if not coalesce((
    select p.proconfig @> array['search_path=""']
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'crm'
      and p.proname = 'validate_appointment_availability'
  ), false) then
    raise exception 'appointment availability function search path is mutable';
  end if;

  insert into crm.leads(branch_id, name, mobile, status)
  values
    (v_branch, 'Saturday Availability', '9000001501', 'appointment_booked'),
    (v_branch, 'Sunday Availability', '9000001502', 'appointment_booked'),
    (v_branch, 'Closing Boundary', '9000001503', 'appointment_booked'),
    (v_branch, 'Early Boundary', '9000001504', 'appointment_booked'),
    (v_branch, 'Late Boundary', '9000001505', 'appointment_booked'),
    (v_branch, 'Start At Close', '9000001506', 'appointment_booked'),
    (v_branch, 'Historical Outside Hours', '9000001507', 'visited_treated'),
    (v_branch, 'Reschedule Boundary', '9000001509', 'appointment_booked');

  select id into strict v_saturday_lead from crm.leads where mobile = '9000001501';
  select id into strict v_sunday_lead from crm.leads where mobile = '9000001502';
  select id into strict v_closing_lead from crm.leads where mobile = '9000001503';
  select id into strict v_early_lead from crm.leads where mobile = '9000001504';
  select id into strict v_late_lead from crm.leads where mobile = '9000001505';
  select id into strict v_start_at_close_lead from crm.leads where mobile = '9000001506';
  select id into strict v_historical_lead from crm.leads where mobile = '9000001507';
  select id into strict v_reschedule_lead from crm.leads where mobile = '9000001509';

  -- 2026-08-29 and 2026-08-30 are Saturday and Sunday. 03:30 UTC is 09:00 IST.
  insert into crm.appointments(lead_id, branch_id, scheduled_at, duration_minutes)
  values(v_saturday_lead, v_branch, '2026-08-29T03:30:00Z', 30);

  insert into crm.appointments(lead_id, branch_id, scheduled_at, duration_minutes)
  values(v_sunday_lead, v_branch, '2026-08-30T03:30:00Z', 30);

  -- 13:30 UTC is 19:00 IST, so this appointment finishes exactly at 19:30.
  insert into crm.appointments(lead_id, branch_id, scheduled_at, duration_minutes)
  values(v_closing_lead, v_branch, '2026-08-31T13:30:00Z', 30);

  begin
    insert into crm.appointments(lead_id, branch_id, scheduled_at, duration_minutes)
    values(v_early_lead, v_branch, '2026-09-01T03:29:00Z', 30);
    raise exception 'an 08:59 IST appointment was accepted';
  exception when check_violation then
    null;
  end;

  begin
    insert into crm.appointments(lead_id, branch_id, scheduled_at, duration_minutes)
    values(v_late_lead, v_branch, '2026-09-01T13:31:00Z', 30);
    raise exception 'an appointment finishing at 19:31 IST was accepted';
  exception when check_violation then
    null;
  end;

  begin
    insert into crm.appointments(lead_id, branch_id, scheduled_at, duration_minutes)
    values(v_start_at_close_lead, v_branch, '2026-09-01T14:00:00Z', 5);
    raise exception 'a 19:30 IST appointment start was accepted';
  exception when check_violation then
    null;
  end;

  -- Historical non-scheduled rows remain valid even when their recorded time
  -- is outside the newly configured booking window.
  insert into crm.appointments(
    lead_id, branch_id, scheduled_at, duration_minutes, status
  ) values(
    v_historical_lead, v_branch, '2026-09-01T00:00:00Z', 30, 'completed'
  ) returning id into v_historical_appointment;

  begin
    update crm.appointments
    set status = 'scheduled'
    where id = v_historical_appointment;
    raise exception 'an outside-hours appointment was promoted to scheduled';
  exception when check_violation then
    null;
  end;

  insert into crm.appointments(lead_id, branch_id, scheduled_at, duration_minutes)
  values(v_reschedule_lead, v_branch, '2026-09-01T03:30:00Z', 30)
  returning id into v_reschedule_appointment;
  begin
    update crm.appointments
    set scheduled_at = '2026-09-01T03:29:00Z'
    where id = v_reschedule_appointment;
    raise exception 'a scheduled appointment was rescheduled before opening';
  exception when check_violation then
    null;
  end;

  -- Other branches are unchanged until they receive their own schedule rows.
  select id into strict v_other_branch
  from crm.branches
  where code <> 'TUP'
  order by code
  limit 1;
  insert into crm.leads(branch_id, name, mobile, status)
  values(v_other_branch, 'Unconfigured Branch', '9000001508', 'appointment_booked')
  returning id into v_other_lead;
  insert into crm.appointments(lead_id, branch_id, scheduled_at, duration_minutes)
  values(v_other_lead, v_other_branch, '2026-09-01T00:00:00Z', 30);
end
$test$;

select 'ok 1 - Tirupur accepts appointments daily from 09:00 through a 19:30 finish';

rollback;
