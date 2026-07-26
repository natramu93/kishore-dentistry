-- ============================================================
-- 20260726070825_admin_and_history_invariants.sql
--
-- Close the remaining destructive-write and administrator-account gaps:
--   * serialize active-admin membership through a protected singleton counter
--   * preserve lead activity as append-only history
--   * reject hard deletes of clinical workflow records
--   * add immutable, PII-free profile administration audit events
-- ============================================================

-- ------------------------------------------------------------
-- Serialized active-admin invariant
-- ------------------------------------------------------------

-- Every active-admin membership change updates this one row. PostgreSQL's
-- atomic UPDATE predicate is rechecked after a concurrent row-lock wait, so
-- two simultaneous exits from a count of two cannot both succeed.
create table crm.security_state (
  id smallint primary key default 1,
  active_admin_count integer not null,
  constraint security_state_singleton_check check (id = 1),
  constraint security_state_admin_count_check check (active_admin_count >= 0)
);

insert into crm.security_state (id, active_admin_count)
select
  1,
  count(*)::integer
from crm.profiles p
where p.role::text = 'admin'
  and p.is_active;

alter table crm.security_state enable row level security;

create function crm.maintain_active_admin_count() returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer;
  v_was_active_admin boolean;
  v_is_active_admin boolean;
begin
  if tg_op = 'INSERT' then
    v_is_active_admin := new.role::text = 'admin' and new.is_active;

    if v_is_active_admin then
      update crm.security_state
      set active_admin_count = active_admin_count + 1
      where id = 1
      returning active_admin_count into v_count;

      if not found then
        raise exception 'CRM security state is unavailable'
          using errcode = '55000';
      end if;
    end if;

    return new;
  end if;

  v_was_active_admin := old.role::text = 'admin' and old.is_active;

  if tg_op = 'DELETE' then
    if v_was_active_admin then
      update crm.security_state
      set active_admin_count = active_admin_count - 1
      where id = 1
        and active_admin_count > 1
      returning active_admin_count into v_count;

      if not found then
        raise exception 'The last active administrator cannot be removed'
          using errcode = '23514';
      end if;
    end if;

    return old;
  end if;

  v_is_active_admin := new.role::text = 'admin' and new.is_active;

  if not v_was_active_admin and v_is_active_admin then
    update crm.security_state
    set active_admin_count = active_admin_count + 1
    where id = 1
    returning active_admin_count into v_count;

    if not found then
      raise exception 'CRM security state is unavailable'
        using errcode = '55000';
    end if;
  elsif v_was_active_admin and not v_is_active_admin then
    update crm.security_state
    set active_admin_count = active_admin_count - 1
    where id = 1
      and active_admin_count > 1
    returning active_admin_count into v_count;

    if not found then
      raise exception 'The last active administrator cannot be deactivated or demoted'
        using errcode = '23514';
    end if;
  end if;

  return new;
end
$function$;

create trigger maintain_active_admin_count_insert
  before insert on crm.profiles
  for each row execute function crm.maintain_active_admin_count();

create trigger maintain_active_admin_count_update
  before update of role, is_active on crm.profiles
  for each row execute function crm.maintain_active_admin_count();

create trigger maintain_active_admin_count_delete
  before delete on crm.profiles
  for each row execute function crm.maintain_active_admin_count();

-- Application credentials cannot read, lock, or alter the invariant row.
-- The SECURITY DEFINER trigger is the sole application-time writer.
revoke all on crm.security_state
  from public, anon, authenticated, service_role;
revoke execute on function crm.maintain_active_admin_count()
  from public, anon, authenticated, service_role;

-- ------------------------------------------------------------
-- Append-only operational history and protected clinical rows
-- ------------------------------------------------------------

create function crm.reject_lead_activity_mutation() returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'crm.lead_activity is append-only'
    using errcode = '55000';
end
$function$;

create trigger protect_lead_activity_update_delete
  before update or delete on crm.lead_activity
  for each row execute function crm.reject_lead_activity_mutation();

create trigger protect_lead_activity_truncate
  before truncate on crm.lead_activity
  for each statement execute function crm.reject_lead_activity_mutation();

create trigger protect_appointment_hard_delete
  before delete on crm.appointments
  for each row execute function crm.reject_protected_hard_delete();

create trigger protect_treatment_hard_delete
  before delete on crm.treatments
  for each row execute function crm.reject_protected_hard_delete();

create trigger protect_follow_up_hard_delete
  before delete on crm.follow_ups
  for each row execute function crm.reject_protected_hard_delete();

create trigger protect_appointment_truncate
  before truncate on crm.appointments
  for each statement execute function crm.reject_protected_hard_delete();

create trigger protect_treatment_truncate
  before truncate on crm.treatments
  for each statement execute function crm.reject_protected_hard_delete();

create trigger protect_follow_up_truncate
  before truncate on crm.follow_ups
  for each statement execute function crm.reject_protected_hard_delete();

revoke update, delete, truncate on crm.lead_activity from service_role;
revoke delete, truncate on crm.leads from service_role;
revoke delete, truncate on crm.appointments from service_role;
revoke delete, truncate on crm.treatments from service_role;
revoke delete, truncate on crm.follow_ups from service_role;
revoke delete, truncate on crm.invoices from service_role;
revoke execute on function crm.reject_lead_activity_mutation()
  from public, anon, authenticated, service_role;

-- ------------------------------------------------------------
-- Immutable profile-administration audit
-- ------------------------------------------------------------

alter table crm.audit_log
  drop constraint audit_log_entity_type_check;

alter table crm.audit_log
  add constraint audit_log_entity_type_check
    check (
      entity_type in (
        'lead',
        'appointment',
        'treatment',
        'follow_up',
        'invoice',
        'comment',
        'profile'
      )
    );

-- Audit payloads intentionally exclude names, email addresses, phone numbers,
-- credentials, tokens, and free-form metadata. changed_fields records that a
-- PII field changed without copying the value into immutable history.
create function crm.validate_profile_audit_data(p_data jsonb) returns jsonb
language plpgsql
immutable
strict
set search_path = ''
as $function$
declare
  v_key text;
  v_changed_field text;
  v_allowed_keys constant text[] := array[
    'role',
    'is_active',
    'branch_ids',
    'doctor_id',
    'changed_fields'
  ];
  v_allowed_changed_fields constant text[] := array[
    'full_name',
    'phone',
    'role',
    'is_active',
    'branch_ids',
    'doctor_id'
  ];
begin
  if jsonb_typeof(p_data) <> 'object'
     or octet_length(p_data::text) > 4096 then
    raise exception 'Profile audit data must be a small JSON object'
      using errcode = '22023';
  end if;

  for v_key in
    select e.key
    from jsonb_each(p_data) e
  loop
    if not (v_key = any(v_allowed_keys)) then
      raise exception 'Profile audit field "%" is not allowed', v_key
        using errcode = '22023';
    end if;
  end loop;

  if p_data ? 'role'
     and (
       jsonb_typeof(p_data->'role') <> 'string'
       or p_data->>'role' not in (
         'admin',
         'operations',
         'front_office',
         'clinical_head',
         'doctor'
       )
     ) then
    raise exception 'Profile audit role is invalid'
      using errcode = '22023';
  end if;

  if p_data ? 'is_active'
     and jsonb_typeof(p_data->'is_active') <> 'boolean' then
    raise exception 'Profile audit active state is invalid'
      using errcode = '22023';
  end if;

  if p_data ? 'branch_ids' then
    if jsonb_typeof(p_data->'branch_ids') <> 'array'
       or jsonb_array_length(p_data->'branch_ids') > 50 then
      raise exception 'Profile audit branch list is invalid'
        using errcode = '22023';
    end if;

    begin
      perform (entry.value #>> '{}')::uuid
      from jsonb_array_elements(p_data->'branch_ids') entry
      where jsonb_typeof(entry.value) = 'string';

      if exists (
        select 1
        from jsonb_array_elements(p_data->'branch_ids') entry
        where jsonb_typeof(entry.value) <> 'string'
      ) then
        raise exception 'Profile audit branch list is invalid'
          using errcode = '22023';
      end if;
    exception
      when invalid_text_representation then
        raise exception 'Profile audit branch list is invalid'
          using errcode = '22023';
    end;
  end if;

  if p_data ? 'doctor_id'
     and jsonb_typeof(p_data->'doctor_id') not in ('string', 'null') then
    raise exception 'Profile audit doctor is invalid'
      using errcode = '22023';
  end if;

  if p_data ? 'doctor_id'
     and jsonb_typeof(p_data->'doctor_id') = 'string' then
    begin
      perform (p_data->>'doctor_id')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'Profile audit doctor is invalid'
          using errcode = '22023';
    end;
  end if;

  if p_data ? 'changed_fields' then
    if jsonb_typeof(p_data->'changed_fields') <> 'array'
       or jsonb_array_length(p_data->'changed_fields') > 6 then
      raise exception 'Profile audit changed-fields list is invalid'
        using errcode = '22023';
    end if;

    for v_changed_field in
      select entry.value #>> '{}'
      from jsonb_array_elements(p_data->'changed_fields') entry
    loop
      if v_changed_field is null
         or not (v_changed_field = any(v_allowed_changed_fields)) then
        raise exception 'Profile audit changed field is invalid'
          using errcode = '22023';
      end if;
    end loop;

    if (
      select count(*) <> count(distinct entry.value)
      from jsonb_array_elements_text(p_data->'changed_fields') entry(value)
    ) then
      raise exception 'Profile audit changed fields must be unique'
        using errcode = '22023';
    end if;
  end if;

  return p_data;
end
$function$;

create function crm.record_profile_admin_audit(
  p_profile_id uuid,
  p_actor uuid,
  p_action text,
  p_old_data jsonb,
  p_new_data jsonb
) returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_audit_id bigint;
  v_old_data jsonb;
  v_new_data jsonb;
begin
  if p_profile_id is null
     or not exists (
       select 1
       from crm.profiles p
       where p.id = p_profile_id
     ) then
    raise exception 'Profile % does not exist', p_profile_id
      using errcode = 'P0002';
  end if;

  if p_actor is null
     or not exists (
       select 1
       from crm.profiles p
       where p.id = p_actor
         and p.role::text = 'admin'
         and p.is_active
     ) then
    raise exception 'An active administrator is required'
      using errcode = '42501';
  end if;

  if v_action = 'created' then
    if p_old_data is not null or p_new_data is null then
      raise exception 'Created profile audits require only new_data'
        using errcode = '22023';
    end if;
  elsif v_action = 'updated' then
    if p_old_data is null or p_new_data is null then
      raise exception 'Updated profile audits require old_data and new_data'
        using errcode = '22023';
    end if;
  else
    raise exception 'Profile audit action is invalid'
      using errcode = '22023';
  end if;

  v_old_data := case
    when p_old_data is null then null
    else crm.validate_profile_audit_data(p_old_data)
  end;
  v_new_data := crm.validate_profile_audit_data(p_new_data);

  if not (
    v_new_data ? 'role'
    and v_new_data ? 'is_active'
    and v_new_data ? 'branch_ids'
    and v_new_data ? 'doctor_id'
    and v_new_data ? 'changed_fields'
  ) then
    raise exception 'New profile audit data is incomplete'
      using errcode = '22023';
  end if;

  if v_action = 'updated'
     and not (
       v_old_data ? 'role'
       and v_old_data ? 'is_active'
       and v_old_data ? 'branch_ids'
       and v_old_data ? 'doctor_id'
     ) then
    raise exception 'Old profile audit data is incomplete'
      using errcode = '22023';
  end if;

  insert into crm.audit_log (
    entity_type,
    entity_id,
    action,
    actor_id,
    old_data,
    new_data
  )
  values (
    'profile',
    p_profile_id,
    v_action,
    p_actor,
    v_old_data,
    v_new_data
  )
  returning id into v_audit_id;

  return v_audit_id;
end
$function$;

-- A profile audit row is accepted only while INSERT runs with the effective
-- owner identity of the SECURITY DEFINER RPC. A service-role caller cannot
-- spoof current_user with set_config or a custom transaction setting.
create function crm.guard_profile_audit_insert() returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_rpc_owner name;
begin
  if new.entity_type <> 'profile' then
    return new;
  end if;

  select pg_catalog.pg_get_userbyid(p.proowner)
  into v_rpc_owner
  from pg_catalog.pg_proc p
  where p.oid = 'crm.record_profile_admin_audit(uuid,uuid,text,jsonb,jsonb)'::regprocedure;

  if v_rpc_owner is null or current_user <> v_rpc_owner then
    raise exception 'Profile audit rows must be written through the administration audit RPC'
      using errcode = '42501';
  end if;

  return new;
end
$function$;

create trigger guard_profile_audit_insert
  before insert on crm.audit_log
  for each row execute function crm.guard_profile_audit_insert();

-- The original append-only trigger covers row mutation. Explicitly close
-- TRUNCATE as well so immutable profile records cannot be removed wholesale.
create trigger protect_audit_log_truncate
  before truncate on crm.audit_log
  for each statement execute function crm.protect_audit_log();

revoke update, delete, truncate on crm.audit_log from service_role;

revoke execute on function crm.validate_profile_audit_data(jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function crm.guard_profile_audit_insert()
  from public, anon, authenticated, service_role;
revoke execute on function crm.record_profile_admin_audit(
  uuid,
  uuid,
  text,
  jsonb,
  jsonb
) from public, anon, authenticated;

grant execute on function crm.record_profile_admin_audit(
  uuid,
  uuid,
  text,
  jsonb,
  jsonb
) to service_role;

comment on table crm.security_state
is 'Private singleton state used to serialize active-administrator membership.';

comment on function crm.record_profile_admin_audit(uuid, uuid, text, jsonb, jsonb)
is 'Records an immutable, allowlisted, PII-free profile administration event.';
