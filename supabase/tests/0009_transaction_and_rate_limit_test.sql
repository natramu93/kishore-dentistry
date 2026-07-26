-- Dependency-free TAP-compatible regression test for migration 0009.
-- Run after all migrations with ON_ERROR_STOP enabled.

begin;

select '1..1';

-- Test-only fault injection used to verify that the RPC never commits the
-- lead half when its activity insert fails.
create function crm.test_reject_atomic_lead_activity() returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if exists (
    select 1
    from crm.leads l
    where l.id = new.lead_id
      and l.mobile = '9000000999'
  ) then
    raise exception 'intentional lead activity failure';
  end if;
  return new;
end
$function$;

create trigger test_reject_atomic_lead_activity
  before insert on crm.lead_activity
  for each row execute function crm.test_reject_atomic_lead_activity();

do $test$
declare
  v_admin constant uuid := '90000000-0000-0000-0000-000000000001';
  v_operations constant uuid := '90000000-0000-0000-0000-000000000002';
  v_unallocated constant uuid := '90000000-0000-0000-0000-000000000003';
  v_doctor constant uuid := '90000000-0000-0000-0000-000000000004';
  v_inactive constant uuid := '90000000-0000-0000-0000-000000000005';
  v_branch uuid;
  v_other_branch uuid;
  v_source uuid;
  v_interest uuid;
  v_lead crm.leads%rowtype;
  v_count integer;
  v_deleted integer;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values
    (v_admin, 'transaction-admin@example.test', '{"full_name":"Transaction Admin"}'),
    (v_operations, 'transaction-operations@example.test', '{"full_name":"Transaction Operations"}'),
    (v_unallocated, 'transaction-unallocated@example.test', '{"full_name":"Transaction Unallocated"}'),
    (v_doctor, 'transaction-doctor@example.test', '{"full_name":"Transaction Doctor"}'),
    (v_inactive, 'transaction-inactive@example.test', '{"full_name":"Transaction Inactive"}');

  update crm.profiles set role = 'admin', is_active = true where id = v_admin;
  update crm.profiles set role = 'operations', is_active = true where id = v_operations;
  update crm.profiles set role = 'operations', is_active = true where id = v_unallocated;
  update crm.profiles set role = 'doctor', is_active = true where id = v_doctor;

  insert into crm.branches (name, code)
  values ('Transaction Test Branch', 'T09')
  returning id into v_branch;

  insert into crm.branches (name, code)
  values ('Transaction Other Branch', 'O09')
  returning id into v_other_branch;

  insert into crm.user_branches (user_id, branch_id)
  values (v_operations, v_branch);

  insert into crm.lead_sources (name)
  values ('Transaction Test Source')
  returning id into v_source;

  insert into crm.treatment_types (name, category, default_cost)
  values ('Transaction Test Treatment', 'Test', 100)
  returning id into v_interest;

  select *
  into v_lead
  from crm.create_lead(
    v_branch,
    '  Atomic Lead  ',
    '  9000000900  ',
    ' atomic@example.test ',
    v_source,
    v_interest,
    30,
    '1995-01-01',
    '  Created transactionally  ',
    v_operations
  );

  if v_lead.name <> 'Atomic Lead'
     or v_lead.mobile <> '9000000900'
     or v_lead.email <> 'atomic@example.test'
     or v_lead.notes <> 'Created transactionally'
     or v_lead.created_by is distinct from v_operations
     or v_lead.branch_id is distinct from v_branch then
    raise exception 'create_lead did not normalize and attribute the lead';
  end if;

  select count(*)
  into v_count
  from crm.lead_activity a
  where a.lead_id = v_lead.id
    and a.actor_id = v_operations
    and a.type = 'note'
    and a.detail = '{"event":"lead_created"}'::jsonb;

  if v_count <> 1 then
    raise exception 'create_lead did not add exactly one lead_created activity';
  end if;

  -- Force the activity half to fail and prove that the lead insert rolls back
  -- to the savepoint created by the PL/pgSQL exception block.
  begin
    perform crm.create_lead(
      v_branch,
      'Must Roll Back',
      '9000000999',
      null,
      null,
      null,
      null,
      null,
      null,
      v_operations
    );
    raise exception 'create_lead unexpectedly survived activity failure';
  exception
    when raise_exception then
      if sqlerrm = 'create_lead unexpectedly survived activity failure' then
        raise;
      end if;
  end;

  select count(*)
  into v_count
  from crm.leads l
  where l.mobile = '9000000999';

  if v_count <> 0 then
    raise exception 'failed activity left a partially-created lead';
  end if;

  begin
    perform crm.create_lead(
      v_other_branch, 'Unauthorized Branch', '9000000901', null,
      null, null, null, null, null, v_operations
    );
    raise exception 'non-allocated actor created a lead in another branch';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform crm.create_lead(
      v_branch, 'Unallocated Actor', '9000000902', null,
      null, null, null, null, null, v_unallocated
    );
    raise exception 'unallocated actor created a lead';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform crm.create_lead(
      v_branch, 'Doctor Lead', '9000000903', null,
      null, null, null, null, null, v_doctor
    );
    raise exception 'doctor actor created a lead';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform crm.create_lead(
      v_branch, 'Inactive Actor', '9000000904', null,
      null, null, null, null, null, v_inactive
    );
    raise exception 'inactive actor created a lead';
  exception
    when insufficient_privilege then null;
  end;

  update crm.lead_sources set is_active = false where id = v_source;
  begin
    perform crm.create_lead(
      v_branch, 'Inactive Source', '9000000905', null,
      v_source, null, null, null, null, v_admin
    );
    raise exception 'lead with inactive source was created';
  exception
    when invalid_parameter_value then null;
  end;

  -- Fixed-window boundary, rejection, and scope isolation.
  if not crm.consume_action_rate_limit(v_operations, 'test:write', 2, 60000)
     or not crm.consume_action_rate_limit(v_operations, 'test:write', 2, 60000)
     or crm.consume_action_rate_limit(v_operations, 'test:write', 2, 60000) then
    raise exception 'fixed-window limit did not allow exactly two requests';
  end if;

  if not crm.consume_action_rate_limit(v_operations, 'test:other', 1, 60000)
     or not crm.consume_action_rate_limit(v_admin, 'test:write', 1, 60000) then
    raise exception 'rate-limit scopes or actors were not isolated';
  end if;

  update crm.action_rate_limits
  set window_started_at = clock_timestamp() - interval '2 minutes',
      expires_at = clock_timestamp() - interval '1 minute'
  where actor_id = v_operations
    and scope = 'test:write';

  if not crm.consume_action_rate_limit(v_operations, 'test:write', 2, 60000) then
    raise exception 'expired fixed window did not reset';
  end if;

  select request_count
  into v_count
  from crm.action_rate_limits
  where actor_id = v_operations
    and scope = 'test:write';

  if v_count <> 1 then
    raise exception 'reset fixed window did not restart at one request';
  end if;

  insert into crm.action_rate_limits (
    actor_id,
    scope,
    window_started_at,
    expires_at,
    request_count,
    last_seen_at
  )
  values
    (
      v_operations, 'expired:test-a',
      clock_timestamp() - interval '2 minutes',
      clock_timestamp() - interval '1 minute',
      1, clock_timestamp() - interval '1 minute'
    ),
    (
      v_operations, 'expired:test-b',
      clock_timestamp() - interval '2 minutes',
      clock_timestamp() - interval '1 minute',
      1, clock_timestamp() - interval '1 minute'
    ),
    (
      v_operations, 'expired:test-c',
      clock_timestamp() - interval '2 minutes',
      clock_timestamp() - interval '1 minute',
      1, clock_timestamp() - interval '1 minute'
    );

  select crm.prune_action_rate_limits(2) into v_deleted;
  if v_deleted <> 2 then
    raise exception 'bounded cleanup deleted % rows instead of 2', v_deleted;
  end if;

  select count(*)
  into v_count
  from crm.action_rate_limits
  where expires_at <= clock_timestamp();

  if v_count <> 1 then
    raise exception 'bounded cleanup did not leave exactly one expired row';
  end if;

  -- One profile can retain at most 64 live buckets, even when every scope is
  -- distinct. The per-actor advisory lock makes this cap concurrency-safe.
  insert into crm.action_rate_limits (
    actor_id,
    scope,
    window_started_at,
    expires_at,
    request_count,
    last_seen_at
  )
  select
    v_admin,
    'cap:' || value,
    clock_timestamp(),
    clock_timestamp() + interval '1 hour',
    1,
    clock_timestamp()
  from generate_series(1, 63) as series(value);

  begin
    perform crm.consume_action_rate_limit(v_admin, 'cap:overflow', 1, 60000);
    raise exception 'actor exceeded the active scope cap';
  exception
    when program_limit_exceeded then null;
  end;

  begin
    perform crm.consume_action_rate_limit(v_inactive, 'test:write', 1, 60000);
    raise exception 'inactive actor consumed a rate-limit bucket';
  exception
    when insufficient_privilege then null;
  end;

  if has_function_privilege(
    'public',
    'crm.create_lead(uuid,text,text,text,uuid,uuid,integer,date,text,uuid)'::regprocedure,
    'execute'
  ) or has_function_privilege(
    'anon',
    'crm.consume_action_rate_limit(uuid,text,integer,integer)'::regprocedure,
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'crm.prune_action_rate_limits(integer)'::regprocedure,
    'execute'
  ) then
    raise exception 'browser roles retain access to migration 0009 functions';
  end if;

  if not has_function_privilege(
    'service_role',
    'crm.create_lead(uuid,text,text,text,uuid,uuid,integer,date,text,uuid)'::regprocedure,
    'execute'
  ) or not has_function_privilege(
    'service_role',
    'crm.consume_action_rate_limit(uuid,text,integer,integer)'::regprocedure,
    'execute'
  ) then
    raise exception 'service_role is missing migration 0009 function access';
  end if;

  if not (
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'crm'
      and c.relname = 'action_rate_limits'
  ) then
    raise exception 'action_rate_limits does not have RLS enabled';
  end if;
end
$test$;

drop trigger test_reject_atomic_lead_activity on crm.lead_activity;
drop function crm.test_reject_atomic_lead_activity();

select 'ok 1 - migration 0009 transactional lead creation and durable rate limiting';

rollback;
