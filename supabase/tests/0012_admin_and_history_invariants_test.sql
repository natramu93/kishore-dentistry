-- Dependency-free TAP-compatible regression test for migration 0012.
-- Run after all migrations with ON_ERROR_STOP enabled.

begin;

select '1..1';

do $test$
declare
  v_admin_one constant uuid := 'c1200000-0000-0000-0000-000000000001';
  v_admin_two constant uuid := 'c1200000-0000-0000-0000-000000000002';
  v_operations constant uuid := 'c1200000-0000-0000-0000-000000000003';
  v_branch uuid;
  v_lead uuid;
  v_appointment uuid;
  v_treatment uuid;
  v_follow_up uuid;
  v_activity uuid;
  v_audit_id bigint;
begin
  perform set_config('crm.allow_legacy_test_records', 'on', true);
  if (
    select active_admin_count
    from crm.security_state
    where id = 1
  ) <> 0 then
    raise exception 'clean migration did not initialize the active-admin counter to zero';
  end if;

  insert into auth.users (id, email, raw_user_meta_data)
  values
    (
      v_admin_one,
      'invariant-admin-one@example.test',
      '{"full_name":"Invariant Admin One"}'
    ),
    (
      v_admin_two,
      'invariant-admin-two@example.test',
      '{"full_name":"Invariant Admin Two"}'
    ),
    (
      v_operations,
      'invariant-operations@example.test',
      '{"full_name":"Invariant Operations"}'
    );

  -- Bootstrap is intentionally zero-safe.
  update crm.profiles
  set role = 'admin', is_active = true
  where id = v_admin_one;

  if (
    select active_admin_count
    from crm.security_state
    where id = 1
  ) <> 1 then
    raise exception 'first administrator promotion did not increment zero to one';
  end if;

  begin
    update crm.profiles
    set is_active = false
    where id = v_admin_one;
    raise exception 'last active administrator was deactivated';
  exception
    when check_violation then null;
  end;

  begin
    update crm.profiles
    set role = 'operations'
    where id = v_admin_one;
    raise exception 'last active administrator was demoted';
  exception
    when check_violation then null;
  end;

  begin
    delete from crm.profiles
    where id = v_admin_one;
    raise exception 'last active administrator profile was deleted';
  exception
    when check_violation then null;
  end;

  update crm.profiles
  set role = 'admin', is_active = true
  where id = v_admin_two;

  if (
    select active_admin_count
    from crm.security_state
    where id = 1
  ) <> 2 then
    raise exception 'second administrator promotion did not increment the counter';
  end if;

  -- A multi-row attempt cannot transition the protected counter through zero;
  -- the failed statement restores both profile rows and the singleton counter.
  begin
    update crm.profiles
    set is_active = false
    where id in (v_admin_one, v_admin_two);
    raise exception 'all active administrators were deactivated together';
  exception
    when check_violation then null;
  end;

  if (
    select count(*)
    from crm.profiles
    where role::text = 'admin'
      and is_active
      and id in (v_admin_one, v_admin_two)
  ) <> 2
     or (
       select active_admin_count
       from crm.security_state
       where id = 1
     ) <> 2 then
    raise exception 'failed administrator exit left the counter or profiles inconsistent';
  end if;

  update crm.profiles
  set role = 'operations', is_active = true
  where id = v_operations;

  insert into crm.branches (name, code)
  values ('Invariant Test Branch', 'I12')
  returning id into v_branch;

  insert into crm.user_branches (user_id, branch_id)
  values (v_operations, v_branch);

  insert into crm.leads (
    branch_id,
    name,
    mobile,
    created_by
  )
  values (
    v_branch,
    'Invariant Test Lead',
    '9120000001',
    v_admin_one
  )
  returning id into v_lead;

  -- Invoker-style workflows retain audit INSERT access without reopening the
  -- production-only coded invoice gate.
  execute 'set local role service_role';
  insert into crm.audit_log(entity_type,entity_id,action,actor_id,new_data)
  values('lead',v_lead,'service_role_audit_probe',v_operations,'{}'::jsonb)
  returning id into v_audit_id;
  execute 'reset role';

  if not exists (
    select 1
    from crm.audit_log a
    where a.id = v_audit_id
      and a.entity_type = 'lead'
      and a.entity_id = v_lead
      and a.action = 'service_role_audit_probe'
      and a.actor_id = v_operations
  ) then
    raise exception 'service-role audit workflow stopped recording events';
  end if;

  -- The only accepted profile metadata is non-PII authorization/allocation
  -- state plus an allowlisted list of changed field names.
  execute 'set local role service_role';
  select crm.record_profile_admin_audit(
    v_operations,
    v_admin_one,
    'updated',
    jsonb_build_object(
      'role', 'front_office',
      'is_active', false,
      'branch_ids', '[]'::jsonb,
      'doctor_id', null
    ),
    jsonb_build_object(
      'role', 'operations',
      'is_active', true,
      'branch_ids', jsonb_build_array(v_branch),
      'doctor_id', null,
      'changed_fields', jsonb_build_array(
        'full_name',
        'phone',
        'role',
        'is_active',
        'branch_ids'
      )
    )
  )
  into v_audit_id;
  execute 'reset role';

  if not exists (
    select 1
    from crm.audit_log a
    where a.id = v_audit_id
      and a.entity_type = 'profile'
      and a.entity_id = v_operations
      and a.actor_id = v_admin_one
      and a.old_data->>'role' = 'front_office'
      and a.new_data->>'role' = 'operations'
      and a.new_data->'changed_fields' ? 'full_name'
      and not (
        a.old_data ?| array['full_name', 'email', 'phone', 'password', 'token']
        or a.new_data ?| array['full_name', 'email', 'phone', 'password', 'token']
      )
  ) then
    raise exception 'profile audit RPC did not preserve the allowlisted metadata';
  end if;

  begin
    perform crm.record_profile_admin_audit(
      v_operations,
      v_admin_one,
      'updated',
      jsonb_build_object(
        'role', 'front_office',
        'is_active', false,
        'branch_ids', '[]'::jsonb,
        'doctor_id', null
      ),
      jsonb_build_object(
        'role', 'operations',
        'is_active', true,
        'branch_ids', jsonb_build_array(v_branch),
        'doctor_id', null,
        'changed_fields', jsonb_build_array('role'),
        'email', 'must-not-enter-audit@example.test',
        'password', 'must-not-enter-audit',
        'token', 'must-not-enter-audit'
      )
    );
    raise exception 'PII/credential fields were accepted by the profile audit RPC';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform crm.record_profile_admin_audit(
      v_operations,
      v_admin_one,
      'updated',
      jsonb_build_object(
        'role', 'front_office',
        'is_active', false,
        'branch_ids', '[]'::jsonb,
        'doctor_id', null
      ),
      jsonb_build_object(
        'role', 'operations',
        'is_active', true,
        'branch_ids', jsonb_build_array(v_branch),
        'doctor_id', null,
        'changed_fields', to_jsonb(array_fill('full_name'::text, array[1000]))
      )
    );
    raise exception 'oversized profile audit metadata was accepted';
  exception
    when invalid_parameter_value then null;
  end;

  -- A transaction setting cannot spoof the SECURITY DEFINER owner's identity.
  begin
    execute 'set local role service_role';
    perform set_config('crm.allow_profile_audit_insert', 'on', true);
    insert into crm.audit_log (
      entity_type,
      entity_id,
      action,
      actor_id,
      new_data
    )
    values (
      'profile',
      v_operations,
      'forged',
      v_admin_one,
      '{}'::jsonb
    );
    execute 'reset role';
    raise exception 'service role directly forged a profile audit row';
  exception
    when insufficient_privilege then
      execute 'reset role';
  end;

  begin
    update crm.audit_log
    set action = 'rewritten'
    where id = v_audit_id;
    raise exception 'profile audit row was updated';
  exception
    when object_not_in_prerequisite_state then null;
  end;

  begin
    delete from crm.audit_log
    where id = v_audit_id;
    raise exception 'profile audit row was deleted';
  exception
    when object_not_in_prerequisite_state then null;
  end;

  begin
    truncate crm.audit_log;
    raise exception 'audit history was truncated';
  exception
    when object_not_in_prerequisite_state then null;
  end;

  insert into crm.appointments (
    lead_id,
    scheduled_at,
    status,
    created_by
  )
  values (
    v_lead,
    '2027-01-10 04:30:00+00',
    'completed',
    v_operations
  )
  returning id into v_appointment;

  insert into crm.treatments (
    lead_id,
    appointment_id,
    cost,
    created_by
  )
  values (
    v_lead,
    v_appointment,
    100,
    v_operations
  )
  returning id into v_treatment;

  insert into crm.follow_ups (
    lead_id,
    due_at,
    created_by
  )
  values (
    v_lead,
    '2027-01-11 04:30:00+00',
    v_operations
  )
  returning id into v_follow_up;

  insert into crm.lead_activity (
    lead_id,
    actor_id,
    type,
    detail
  )
  values (
    v_lead,
    v_operations,
    'note',
    '{"summary":"immutable"}'
  )
  returning id into v_activity;

  begin
    update crm.lead_activity
    set detail = '{"summary":"rewritten"}'
    where id = v_activity;
    raise exception 'lead activity row was updated';
  exception
    when object_not_in_prerequisite_state then null;
  end;

  begin
    delete from crm.lead_activity
    where id = v_activity;
    raise exception 'lead activity row was deleted';
  exception
    when object_not_in_prerequisite_state then null;
  end;

  begin
    truncate crm.lead_activity;
    raise exception 'lead activity history was truncated';
  exception
    when object_not_in_prerequisite_state then null;
  end;

  begin
    delete from crm.treatments where id = v_treatment;
    raise exception 'treatment hard delete succeeded';
  exception
    when object_not_in_prerequisite_state then null;
  end;

  begin
    delete from crm.follow_ups where id = v_follow_up;
    raise exception 'follow-up hard delete succeeded';
  exception
    when object_not_in_prerequisite_state then null;
  end;

  begin
    delete from crm.appointments where id = v_appointment;
    raise exception 'appointment hard delete succeeded';
  exception
    when object_not_in_prerequisite_state then null;
  end;

  if has_table_privilege('service_role', 'crm.security_state', 'SELECT')
     or has_table_privilege('service_role', 'crm.security_state', 'UPDATE')
     or has_table_privilege('service_role', 'crm.security_state', 'DELETE')
     or has_table_privilege('service_role', 'crm.security_state', 'TRUNCATE') then
    raise exception 'service role retained access to serialized security state';
  end if;

  if not has_table_privilege('service_role', 'crm.lead_activity', 'SELECT')
     or not has_table_privilege('service_role', 'crm.lead_activity', 'INSERT')
     or has_table_privilege('service_role', 'crm.lead_activity', 'UPDATE')
     or has_table_privilege('service_role', 'crm.lead_activity', 'DELETE')
     or has_table_privilege('service_role', 'crm.lead_activity', 'TRUNCATE') then
    raise exception 'lead activity service-role privileges are unsafe';
  end if;

  if has_table_privilege('service_role', 'crm.appointments', 'DELETE')
     or has_table_privilege('service_role', 'crm.appointments', 'TRUNCATE')
     or has_table_privilege('service_role', 'crm.leads', 'DELETE')
     or has_table_privilege('service_role', 'crm.leads', 'TRUNCATE')
     or has_table_privilege('service_role', 'crm.treatments', 'DELETE')
     or has_table_privilege('service_role', 'crm.treatments', 'TRUNCATE')
     or has_table_privilege('service_role', 'crm.follow_ups', 'DELETE')
     or has_table_privilege('service_role', 'crm.follow_ups', 'TRUNCATE')
     or has_table_privilege('service_role', 'crm.invoices', 'DELETE')
     or has_table_privilege('service_role', 'crm.invoices', 'TRUNCATE') then
    raise exception 'clinical tables retained destructive service-role privileges';
  end if;

  if not has_table_privilege('service_role', 'crm.audit_log', 'INSERT')
     or has_table_privilege('service_role', 'crm.audit_log', 'UPDATE')
     or has_table_privilege('service_role', 'crm.audit_log', 'DELETE')
     or has_table_privilege('service_role', 'crm.audit_log', 'TRUNCATE') then
    raise exception 'audit-log service-role privileges are unsafe';
  end if;

  if has_function_privilege(
       'authenticated',
       'crm.record_profile_admin_audit(uuid,uuid,text,jsonb,jsonb)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'crm.record_profile_admin_audit(uuid,uuid,text,jsonb,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'crm.validate_profile_audit_data(jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'crm.guard_profile_audit_insert()',
       'EXECUTE'
     ) then
    raise exception 'profile audit function privileges are unsafe';
  end if;
end
$test$;

select 'ok 1 - administrator, history, deletion, and audit invariants hold';

rollback;
