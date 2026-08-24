-- Dependency-free TAP-compatible regression test for migration 0010.
-- Run after all migrations with ON_ERROR_STOP enabled.

begin;

select '1..1';

do $test$
declare
  v_admin constant uuid := 'a1000000-0000-0000-0000-000000000001';
  v_operations constant uuid := 'a1000000-0000-0000-0000-000000000002';
  v_front_office constant uuid := 'a1000000-0000-0000-0000-000000000003';
  v_doctor_profile constant uuid := 'a1000000-0000-0000-0000-000000000004';
  v_branch_a uuid;
  v_branch_b uuid;
  v_doctor_a1 uuid;
  v_doctor_a2 uuid;
  v_doctor_b uuid;
  v_type_x uuid;
  v_type_y uuid;
  v_lead_a1 uuid;
  v_lead_a2 uuid;
  v_lead_a3 uuid;
  v_lead_b1 uuid;
  v_appointment_a1 uuid;
  v_appointment_a2 uuid;
  v_appointment_b1 uuid;
  v_row record;
  v_payload jsonb;
  v_item jsonb;
  v_from constant timestamptz := '2026-07-01 18:30:00+00';
  v_to constant timestamptz := '2026-07-03 18:30:00+00';
begin
  perform set_config('crm.allow_legacy_test_records', 'on', true);
  insert into auth.users (id, email, raw_user_meta_data)
  values
    (v_admin, 'report-admin@example.test', '{"full_name":"Report Admin"}'),
    (v_operations, 'report-operations@example.test', '{"full_name":"Report Operations"}'),
    (v_front_office, 'report-front-office@example.test', '{"full_name":"Report Front Office"}'),
    (v_doctor_profile, 'report-doctor@example.test', '{"full_name":"Report Doctor"}');

  update crm.profiles
  set role = 'admin', is_active = true
  where id = v_admin;

  update crm.profiles
  set role = 'operations', is_active = true
  where id = v_operations;

  update crm.profiles
  set role = 'front_office', is_active = true
  where id = v_front_office;

  update crm.profiles
  set role = 'doctor', is_active = true
  where id = v_doctor_profile;

  insert into crm.branches (name, code)
  values ('Report Branch A', 'R10A')
  returning id into v_branch_a;

  insert into crm.branches (name, code)
  values ('Report Branch B', 'R10B')
  returning id into v_branch_b;

  insert into crm.user_branches (user_id, branch_id)
  values
    (v_operations, v_branch_a),
    (v_front_office, v_branch_a);

  insert into crm.doctors (branch_id, full_name, profile_id)
  values (v_branch_a, 'Report Doctor A1', v_doctor_profile)
  returning id into v_doctor_a1;

  insert into crm.doctors (branch_id, full_name)
  values (v_branch_a, 'Report Doctor A2')
  returning id into v_doctor_a2;

  insert into crm.doctors (branch_id, full_name)
  values (v_branch_b, 'Report Doctor B')
  returning id into v_doctor_b;

  insert into crm.treatment_types (name, category, default_cost)
  values ('Report Treatment X', 'Report', 100)
  returning id into v_type_x;

  insert into crm.treatment_types (name, category, default_cost)
  values ('Report Treatment Y', 'Report', 200)
  returning id into v_type_y;

  insert into crm.leads (branch_id, name, mobile, created_by, created_at)
  values (v_branch_a, 'Report Lead A1', '9111111111', v_admin, '2026-07-01 19:00:00+00')
  returning id into v_lead_a1;

  insert into crm.leads (branch_id, name, mobile, created_by, created_at)
  values (v_branch_a, 'Report Lead A2', '9222222222', v_admin, '2026-07-02 19:00:00+00')
  returning id into v_lead_a2;

  insert into crm.leads (branch_id, name, mobile, created_by, created_at)
  values (v_branch_a, 'Report Lead A3', '9333333333', v_admin, '2026-06-30 10:00:00+00')
  returning id into v_lead_a3;

  insert into crm.leads (branch_id, name, mobile, created_by, created_at)
  values (v_branch_b, 'Report Lead B1', '9444444444', v_admin, '2026-07-01 19:30:00+00')
  returning id into v_lead_b1;

  insert into crm.appointments (
    lead_id,
    doctor_id,
    scheduled_at,
    duration_minutes,
    status,
    created_by
  )
  values (
    v_lead_a1,
    v_doctor_a1,
    '2026-07-01 20:00:00+00',
    30,
    'completed',
    v_admin
  )
  returning id into v_appointment_a1;

  insert into crm.appointments (
    lead_id,
    doctor_id,
    scheduled_at,
    duration_minutes,
    status,
    created_by
  )
  values (
    v_lead_a1,
    v_doctor_a2,
    '2026-07-02 20:00:00+00',
    30,
    'completed',
    v_admin
  )
  returning id into v_appointment_a2;

  insert into crm.appointments (
    lead_id,
    doctor_id,
    scheduled_at,
    duration_minutes,
    status,
    created_by
  )
  values (
    v_lead_a3,
    v_doctor_a1,
    '2026-07-02 04:00:00+00',
    30,
    'completed',
    v_admin
  );

  insert into crm.appointments (
    lead_id,
    doctor_id,
    scheduled_at,
    duration_minutes,
    status,
    created_by
  )
  values (
    v_lead_a2,
    null,
    '2026-07-02 21:00:00+00',
    30,
    'completed',
    v_admin
  );

  insert into crm.appointments (
    lead_id,
    doctor_id,
    scheduled_at,
    duration_minutes,
    status,
    created_by
  )
  values (
    v_lead_b1,
    v_doctor_b,
    '2026-07-01 21:00:00+00',
    30,
    'completed',
    v_admin
  )
  returning id into v_appointment_b1;

  insert into crm.treatments (
    lead_id,
    appointment_id,
    treatment_type_id,
    cost,
    treated_at,
    created_by
  )
  values (
    v_lead_a1,
    v_appointment_a1,
    v_type_x,
    100,
    '2026-07-01 21:00:00+00',
    v_admin
  );

  insert into crm.treatments (
    lead_id,
    treatment_type_id,
    doctor_id,
    cost,
    treated_at,
    created_by
  )
  values (
    v_lead_a3,
    v_type_x,
    v_doctor_a1,
    300,
    '2026-07-02 05:00:00+00',
    v_admin
  );

  insert into crm.treatments (
    lead_id,
    appointment_id,
    treatment_type_id,
    cost,
    treated_at,
    created_by
  )
  values (
    v_lead_a1,
    v_appointment_a2,
    v_type_y,
    200,
    '2026-07-02 21:00:00+00',
    v_admin
  );

  insert into crm.treatments (
    lead_id,
    appointment_id,
    treatment_type_id,
    cost,
    treated_at,
    created_by
  )
  values (
    v_lead_b1,
    v_appointment_b1,
    v_type_y,
    500,
    '2026-07-01 22:00:00+00',
    v_admin
  );

  insert into crm.follow_ups (lead_id, due_at, reason, created_by)
  values
    (v_lead_a1, '2026-07-01 22:00:00+00', 'A1 follow-up', v_admin),
    (v_lead_a3, '2026-07-02 22:00:00+00', 'A3 follow-up', v_admin),
    (v_lead_a2, '2026-07-02 23:00:00+00', 'A2 follow-up', v_admin),
    (v_lead_b1, '2026-07-01 23:00:00+00', 'B1 follow-up', v_admin);

  select to_jsonb(report)
  into strict v_payload
  from crm.get_report_aggregates(
    v_operations,
    v_from,
    v_to,
    null,
    null
  ) report;

  if (v_payload #>> '{totals,leads}')::bigint <> 2
     or (v_payload #>> '{totals,appointments}')::bigint <> 4
     or (v_payload #>> '{totals,followUps}')::bigint <> 3
     or (v_payload #>> '{totals,revenue}')::numeric <> 600 then
    raise exception 'operations totals were incorrect or crossed branch scope: %', v_payload->'totals';
  end if;

  select item
  into strict v_item
  from jsonb_array_elements(v_payload->'by_doctor') item
  where item->>'key' = v_doctor_a1::text;

  if (v_item->>'leads')::bigint <> 2
     or (v_item->>'appointments')::bigint <> 2
     or (v_item->>'followUps')::bigint <> 2
     or (v_item->>'revenue')::numeric <> 400 then
    raise exception 'doctor A1 aggregate was incorrect: %', v_item;
  end if;

  select item
  into strict v_item
  from jsonb_array_elements(v_payload->'by_treatment') item
  where item->>'key' = v_type_x::text;

  if (v_item->>'leads')::bigint <> 2
     or (v_item->>'appointments')::bigint <> 1
     or (v_item->>'followUps')::bigint <> 0
     or (v_item->>'revenue')::numeric <> 400 then
    raise exception 'treatment aggregate was incorrect: %', v_item;
  end if;

  select to_jsonb(report)
  into strict v_payload
  from crm.get_report_aggregates(
    v_operations,
    v_from,
    v_to,
    null,
    v_doctor_a1
  ) report;

  if (v_payload #>> '{totals,leads}')::bigint <> 1
     or (v_payload #>> '{totals,appointments}')::bigint <> 2
     or (v_payload #>> '{totals,followUps}')::bigint <> 2
     or (v_payload #>> '{totals,revenue}')::numeric <> 400 then
    raise exception 'doctor filter did not preserve derived patient semantics: %', v_payload->'totals';
  end if;

  if jsonb_array_length(v_payload->'by_doctor') <> 1
     or v_payload #>> '{by_doctor,0,key}' <> v_doctor_a1::text then
    raise exception 'doctor filter returned another doctor';
  end if;

  select to_jsonb(report)
  into strict v_payload
  from crm.get_report_aggregates(
    v_operations,
    v_from,
    v_to,
    null,
    null
  ) report;

  select item
  into strict v_item
  from jsonb_array_elements(v_payload->'by_day') item
  where item->>'key' = '2026-07-02';

  if v_item->>'label' <> '2 Jul'
     or (v_item->>'leads')::bigint <> 1
     or (v_item->>'appointments')::bigint <> 2
     or (v_item->>'followUps')::bigint <> 1
     or (v_item->>'revenue')::numeric <> 400 then
    raise exception 'Asia/Kolkata day aggregate was incorrect: %', v_item;
  end if;

  select to_jsonb(report)
  into strict v_payload
  from crm.get_report_aggregates(
    v_admin,
    v_from,
    v_to,
    v_branch_a,
    null
  ) report;

  if (v_payload #>> '{totals,leads}')::bigint <> 2
     or (v_payload #>> '{totals,appointments}')::bigint <> 4
     or (v_payload #>> '{totals,followUps}')::bigint <> 3
     or (v_payload #>> '{totals,revenue}')::numeric <> 600 then
    raise exception 'admin branch filter was incorrect: %', v_payload->'totals';
  end if;

  select to_jsonb(report)
  into strict v_payload
  from crm.get_report_aggregates(v_admin, v_from, v_to, null, null) report;

  if (v_payload #>> '{totals,leads}')::bigint <> 3
     or (v_payload #>> '{totals,appointments}')::bigint <> 5
     or (v_payload #>> '{totals,followUps}')::bigint <> 4
     or (v_payload #>> '{totals,revenue}')::numeric <> 1100 then
    raise exception 'admin all-branch aggregate was incorrect: %', v_payload->'totals';
  end if;

  -- Dashboard fixtures are added after report assertions so they independently
  -- cover current-day schedule and assignment scoping.
  update crm.leads
  set assignee_id = v_operations,
      interest_id = v_type_x
  where id = v_lead_a1;

  update crm.leads
  set interest_id = v_type_y
  where id = v_lead_a2;

  update crm.leads
  set interest_id = v_type_x
  where id = v_lead_a3;

  insert into crm.appointments (
    lead_id,
    doctor_id,
    scheduled_at,
    duration_minutes,
    status,
    created_by
  )
  values
    (
      v_lead_a1,
      v_doctor_a1,
      '2026-07-02 10:00:00+00',
      30,
      'scheduled',
      v_admin
    ),
    (
      v_lead_a3,
      v_doctor_a1,
      '2026-07-04 10:00:00+00',
      30,
      'scheduled',
      v_admin
    ),
    (
      v_lead_a2,
      v_doctor_a2,
      '2026-07-02 11:00:00+00',
      30,
      'scheduled',
      v_admin
    );

  insert into crm.follow_ups (lead_id, due_at, reason, created_by)
  values (
    v_lead_a2,
    '2026-07-02 12:00:00+00',
    'Dashboard open-pool follow-up',
    v_admin
  );

  select *
  into strict v_row
  from crm.get_business_dashboard(
    v_operations,
    '2026-07-01 18:30:00+00',
    '2026-07-02 18:30:00+00'
  )
  where metric = 'summary'
    and row_key = 'total_leads';

  if v_row.value <> 3 then
    raise exception 'business dashboard total crossed branch scope: %', row_to_json(v_row);
  end if;

  select *
  into strict v_row
  from crm.get_business_dashboard(
    v_operations,
    '2026-07-01 18:30:00+00',
    '2026-07-02 18:30:00+00'
  )
  where metric = 'summary'
    and row_key = 'todays_appointments';

  if v_row.value <> 2 then
    raise exception 'business dashboard appointment count was incorrect: %', row_to_json(v_row);
  end if;

  select *
  into strict v_row
  from crm.get_business_dashboard(
    v_operations,
    '2026-07-01 18:30:00+00',
    '2026-07-02 18:30:00+00'
  )
  where metric = 'summary'
    and row_key = 'due_follow_ups';

  if v_row.value <> 2 then
    raise exception 'business dashboard due follow-up count was incorrect: %', row_to_json(v_row);
  end if;

  select *
  into strict v_row
  from crm.get_business_dashboard(
    v_front_office,
    '2026-07-01 18:30:00+00',
    '2026-07-02 18:30:00+00'
  )
  where metric = 'summary'
    and row_key = 'total_leads';

  if v_row.value <> 2 then
    raise exception 'front-office dashboard did not enforce own/open-pool scope: %', row_to_json(v_row);
  end if;

  select *
  into strict v_row
  from crm.get_business_dashboard(
    v_front_office,
    '2026-07-01 18:30:00+00',
    '2026-07-02 18:30:00+00'
  )
  where metric = 'summary'
    and row_key = 'todays_appointments';

  if v_row.value <> 1 then
    raise exception 'front-office appointment scope was incorrect: %', row_to_json(v_row);
  end if;

  select *
  into strict v_row
  from crm.get_doctor_dashboard(
    v_doctor_profile,
    '2026-07-01 18:30:00+00',
    '2026-07-02 18:30:00+00'
  );

  if v_row.todays_appointments <> 1
     or v_row.week_appointments <> 2
     or v_row.patients_treated <> 2
     or v_row.revenue_generated <> 400 then
    raise exception 'doctor dashboard aggregate was incorrect: %', row_to_json(v_row);
  end if;

  begin
    perform *
    from crm.get_business_dashboard(
      v_doctor_profile,
      '2026-07-01 18:30:00+00',
      '2026-07-02 18:30:00+00'
    );
    raise exception 'doctor unexpectedly received the business dashboard';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform *
    from crm.get_doctor_dashboard(
      v_operations,
      '2026-07-01 18:30:00+00',
      '2026-07-02 18:30:00+00'
    );
    raise exception 'operations unexpectedly received a doctor dashboard';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform *
    from crm.get_report_aggregates(v_front_office, v_from, v_to, null, null);
    raise exception 'front office unexpectedly received report data';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform *
    from crm.get_report_aggregates(v_operations, v_from, v_to, v_branch_b, null);
    raise exception 'operations unexpectedly received an unallocated branch report';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform *
    from crm.get_report_aggregates(v_operations, v_from, v_to, v_branch_a, v_doctor_b);
    raise exception 'mismatched branch and doctor filter unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform *
    from crm.get_report_aggregates(
      v_operations,
      v_from,
      v_from + interval '367 days',
      null,
      null
    );
    raise exception 'oversized report range unexpectedly succeeded';
  exception
    when invalid_parameter_value then null;
  end;

  if has_function_privilege(
    'public',
    'crm.get_report_aggregates(uuid,timestamptz,timestamptz,uuid,uuid)'::regprocedure,
    'execute'
  ) or has_function_privilege(
    'anon',
    'crm.get_report_aggregates(uuid,timestamptz,timestamptz,uuid,uuid)'::regprocedure,
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'crm.get_report_aggregates(uuid,timestamptz,timestamptz,uuid,uuid)'::regprocedure,
    'execute'
  ) then
    raise exception 'browser roles can execute get_report_aggregates';
  end if;

  if not has_function_privilege(
    'service_role',
    'crm.get_report_aggregates(uuid,timestamptz,timestamptz,uuid,uuid)'::regprocedure,
    'execute'
  ) then
    raise exception 'service_role cannot execute get_report_aggregates';
  end if;

  if has_function_privilege(
    'public',
    'crm.get_business_dashboard(uuid,timestamptz,timestamptz)'::regprocedure,
    'execute'
  ) or has_function_privilege(
    'anon',
    'crm.get_business_dashboard(uuid,timestamptz,timestamptz)'::regprocedure,
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'crm.get_business_dashboard(uuid,timestamptz,timestamptz)'::regprocedure,
    'execute'
  ) or has_function_privilege(
    'public',
    'crm.get_doctor_dashboard(uuid,timestamptz,timestamptz)'::regprocedure,
    'execute'
  ) or has_function_privilege(
    'anon',
    'crm.get_doctor_dashboard(uuid,timestamptz,timestamptz)'::regprocedure,
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'crm.get_doctor_dashboard(uuid,timestamptz,timestamptz)'::regprocedure,
    'execute'
  ) then
    raise exception 'browser roles can execute a dashboard aggregate function';
  end if;

  if not has_function_privilege(
    'service_role',
    'crm.get_business_dashboard(uuid,timestamptz,timestamptz)'::regprocedure,
    'execute'
  ) or not has_function_privilege(
    'service_role',
    'crm.get_doctor_dashboard(uuid,timestamptz,timestamptz)'::regprocedure,
    'execute'
  ) then
    raise exception 'service_role cannot execute a dashboard aggregate function';
  end if;
end
$test$;

select 'ok 1 - migration 0010 scoped report/dashboard aggregates, filters, clinic time, and privileges';

rollback;
