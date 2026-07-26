-- ============================================================
-- 20260726070822_transaction_and_rate_limit.sql
--
-- Transaction and distributed-enforcement hardening:
--   * create a lead and its initial activity in one transaction
--   * enforce Server Action fixed-window limits in PostgreSQL
--   * keep limiter storage bounded and safely prune expired rows
-- ============================================================

-- ------------------------------------------------------------
-- Transactional lead creation
-- ------------------------------------------------------------

create function crm.create_lead(
  p_branch_id uuid,
  p_name text,
  p_mobile text,
  p_email text,
  p_source_id uuid,
  p_interest_id uuid,
  p_age integer,
  p_dob date,
  p_notes text,
  p_actor uuid
) returns crm.leads
language plpgsql
set search_path = ''
as $function$
declare
  v_actor crm.profiles%rowtype;
  v_lead crm.leads%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_mobile text := btrim(coalesce(p_mobile, ''));
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  select *
  into v_actor
  from crm.profiles p
  where p.id = p_actor
  for share;

  if not found or not v_actor.is_active then
    raise exception 'actor % is missing or inactive', p_actor
      using errcode = '42501';
  end if;

  if v_actor.role::text not in
     ('admin', 'operations', 'front_office', 'clinical_head') then
    raise exception 'profile role % cannot create leads', v_actor.role
      using errcode = '42501';
  end if;

  perform 1
  from crm.branches b
  where b.id = p_branch_id
    and b.is_active
  for share;

  if not found then
    raise exception 'branch % is missing or inactive', p_branch_id
      using errcode = '22023';
  end if;

  if v_actor.role <> 'admin' then
    perform 1
    from crm.user_branches ub
    where ub.user_id = p_actor
      and ub.branch_id = p_branch_id
    for share;

    if not found then
      raise exception 'actor is not allocated to the lead branch'
        using errcode = '42501';
    end if;
  end if;

  if length(v_name) not between 1 and 200 then
    raise exception 'lead name must contain 1 to 200 characters'
      using errcode = '22023';
  end if;

  if length(v_mobile) not between 7 and 32 then
    raise exception 'lead mobile must contain 7 to 32 characters'
      using errcode = '22023';
  end if;

  if v_email is not null
     and (
       length(v_email) > 254
       or position('@' in v_email) <= 1
       or position('@' in v_email) = length(v_email)
     ) then
    raise exception 'lead email is invalid'
      using errcode = '22023';
  end if;

  if p_age is not null and p_age not between 0 and 120 then
    raise exception 'lead age must be between 0 and 120'
      using errcode = '22023';
  end if;

  if p_dob is not null and p_dob > current_date then
    raise exception 'lead date of birth cannot be in the future'
      using errcode = '22023';
  end if;

  if v_notes is not null and length(v_notes) > 4000 then
    raise exception 'lead notes cannot exceed 4000 characters'
      using errcode = '22023';
  end if;

  if p_source_id is not null then
    perform 1
    from crm.lead_sources s
    where s.id = p_source_id
      and s.is_active
    for share;

    if not found then
      raise exception 'lead source % is missing or inactive', p_source_id
        using errcode = '22023';
    end if;
  end if;

  if p_interest_id is not null then
    perform 1
    from crm.treatment_types t
    where t.id = p_interest_id
      and t.is_active
    for share;

    if not found then
      raise exception 'treatment type % is missing or inactive', p_interest_id
        using errcode = '22023';
    end if;
  end if;

  insert into crm.leads (
    branch_id,
    name,
    mobile,
    email,
    source_id,
    interest_id,
    age,
    dob,
    notes,
    created_by
  )
  values (
    p_branch_id,
    v_name,
    v_mobile,
    v_email,
    p_source_id,
    p_interest_id,
    p_age,
    p_dob,
    v_notes,
    p_actor
  )
  returning * into v_lead;

  insert into crm.lead_activity (
    lead_id,
    actor_id,
    type,
    detail
  )
  values (
    v_lead.id,
    p_actor,
    'note',
    jsonb_build_object('event', 'lead_created')
  );

  return v_lead;
end
$function$;

-- ------------------------------------------------------------
-- Durable fixed-window Server Action limiter
-- ------------------------------------------------------------

create table crm.action_rate_limits (
  actor_id uuid not null
    references crm.profiles(id) on delete cascade,
  scope text not null,
  window_started_at timestamptz not null,
  expires_at timestamptz not null,
  request_count integer not null,
  last_seen_at timestamptz not null,
  primary key (actor_id, scope),
  constraint action_rate_limits_scope_check
    check (
      length(scope) between 1 and 120
      and scope ~ '^[a-z0-9][a-z0-9:_-]*$'
    ),
  constraint action_rate_limits_window_check
    check (expires_at > window_started_at),
  constraint action_rate_limits_count_check
    check (request_count > 0)
);

create index action_rate_limits_expiry_idx
  on crm.action_rate_limits (expires_at);

alter table crm.action_rate_limits enable row level security;

-- Maintenance entry point for a scheduler or operations task. Deletes only a
-- bounded batch and skips rows currently used by another request.
create function crm.prune_action_rate_limits(
  p_batch_size integer default 1000
) returns integer
language plpgsql
set search_path = ''
as $function$
declare
  v_deleted integer;
begin
  if p_batch_size not between 1 and 10000 then
    raise exception 'batch size must be between 1 and 10000'
      using errcode = '22023';
  end if;

  with expired as (
    select r.actor_id, r.scope
    from crm.action_rate_limits r
    where r.expires_at <= clock_timestamp()
    order by r.expires_at
    limit p_batch_size
    for update skip locked
  )
  delete from crm.action_rate_limits r
  using expired e
  where r.actor_id = e.actor_id
    and r.scope = e.scope;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end
$function$;

create function crm.consume_action_rate_limit(
  p_actor uuid,
  p_scope text,
  p_limit integer,
  p_window_ms integer
) returns boolean
language plpgsql
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_expires_at timestamptz;
  v_count integer;
  v_active_scopes integer;
  v_scope text := btrim(coalesce(p_scope, ''));
  v_profile_active boolean;
begin
  if p_limit not between 1 and 10000 then
    raise exception 'limit must be between 1 and 10000'
      using errcode = '22023';
  end if;

  if p_window_ms not between 1000 and 86400000 then
    raise exception 'window must be between 1000 and 86400000 milliseconds'
      using errcode = '22023';
  end if;

  if length(v_scope) not between 1 and 120
     or v_scope !~ '^[a-z0-9][a-z0-9:_-]*$' then
    raise exception 'rate-limit scope is invalid'
      using errcode = '22023';
  end if;

  select p.is_active
  into v_profile_active
  from crm.profiles p
  where p.id = p_actor
  for share;

  if not found or not v_profile_active then
    raise exception 'actor % is missing or inactive', p_actor
      using errcode = '42501';
  end if;

  -- Serializing the tiny per-user critical section makes the active-scope cap
  -- strict even when a user starts mutations in different scopes concurrently.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor::text, 90421)
  );

  -- The table remains bounded to 64 live scopes per profile. Expired rows for
  -- this actor are removed first, while a separate bounded batch gradually
  -- removes stale rows belonging to actors who no longer make requests.
  delete from crm.action_rate_limits r
  where r.actor_id = p_actor
    and r.expires_at <= v_now;

  perform crm.prune_action_rate_limits(100);

  if not exists (
    select 1
    from crm.action_rate_limits r
    where r.actor_id = p_actor
      and r.scope = v_scope
  ) then
    select count(*)
    into v_active_scopes
    from crm.action_rate_limits r
    where r.actor_id = p_actor;

    if v_active_scopes >= 64 then
      raise exception 'actor has too many active rate-limit scopes'
        using errcode = '54000';
    end if;
  end if;

  v_expires_at :=
    v_now + pg_catalog.make_interval(secs => p_window_ms / 1000.0);

  insert into crm.action_rate_limits (
    actor_id,
    scope,
    window_started_at,
    expires_at,
    request_count,
    last_seen_at
  )
  values (
    p_actor,
    v_scope,
    v_now,
    v_expires_at,
    1,
    v_now
  )
  on conflict (actor_id, scope) do update
  set
    window_started_at = case
      when crm.action_rate_limits.expires_at <= v_now then v_now
      else crm.action_rate_limits.window_started_at
    end,
    expires_at = case
      when crm.action_rate_limits.expires_at <= v_now then v_expires_at
      else crm.action_rate_limits.expires_at
    end,
    request_count = case
      when crm.action_rate_limits.expires_at <= v_now then 1
      else least(crm.action_rate_limits.request_count, p_limit) + 1
    end,
    last_seen_at = v_now
  returning request_count into v_count;

  return v_count <= p_limit;
end
$function$;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default, so every
-- new object is locked down explicitly even though migration 0008 also set
-- restrictive default privileges.
revoke all on crm.action_rate_limits
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on crm.action_rate_limits to service_role;

revoke execute on function crm.create_lead(
  uuid, text, text, text, uuid, uuid, integer, date, text, uuid
) from public, anon, authenticated;
revoke execute on function crm.consume_action_rate_limit(
  uuid, text, integer, integer
) from public, anon, authenticated;
revoke execute on function crm.prune_action_rate_limits(integer)
  from public, anon, authenticated;

grant execute on function crm.create_lead(
  uuid, text, text, text, uuid, uuid, integer, date, text, uuid
) to service_role;
grant execute on function crm.consume_action_rate_limit(
  uuid, text, integer, integer
) to service_role;
grant execute on function crm.prune_action_rate_limits(integer)
  to service_role;
