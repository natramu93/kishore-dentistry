-- ============================================================
-- 0011_comment_history.sql
--
-- Preserve comment history and make every destructive mutation explicit:
--   * active-thread reads use soft deletion
--   * edits and archives use optimistic versions
--   * immutable audit rows retain the before/after record
--   * actor, branch, lead-assignment, and moderator scope is rechecked in SQL
--   * browser roles cannot read or invoke any CRM comment data path
-- ============================================================

alter table crm.comments
  add column deleted_at timestamptz,
  add column deleted_by uuid references crm.profiles(id) on delete set null,
  add column delete_reason text,
  add column version bigint not null default 1;

alter table crm.comments
  add constraint comments_body_not_blank_check
    check (length(btrim(body)) between 1 and 4000) not valid,
  add constraint comments_version_positive_check
    check (version > 0),
  add constraint comments_delete_metadata_check
    check (
      (deleted_at is null and deleted_by is null and delete_reason is null)
      or
      (
        deleted_at is not null
        and coalesce(length(btrim(delete_reason)), 0) between 1 and 500
      )
    );

-- Migration 0008 introduced this allowlist. Comments now participate in the
-- same immutable audit stream as the other workflow records.
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
        'comment'
      )
    );

create index comments_live_lead_created_idx
  on crm.comments (lead_id, created_at)
  where deleted_at is null;

create index comments_live_entity_created_idx
  on crm.comments (entity_type, entity_id, created_at)
  where deleted_at is null;

-- Recording creation here makes the audit stream complete even though the
-- live row is still the source of truth until its first edit.
create function crm.audit_comment_insert() returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  insert into crm.audit_log (
    entity_type,
    entity_id,
    action,
    actor_id,
    old_data,
    new_data
  )
  values (
    'comment',
    new.id,
    'created',
    new.author_id,
    null,
    to_jsonb(new)
  );

  return new;
end
$function$;

create trigger audit_comment_insert
  after insert on crm.comments
  for each row execute function crm.audit_comment_insert();

create trigger protect_comment_hard_delete
  before delete on crm.comments
  for each row execute function crm.reject_protected_hard_delete();

-- Only the RPCs below may update a comment. The service role also loses direct
-- write grants later in this migration; this trigger catches
-- accidental owner-level writes and protects identity fields within the RPC.
create function crm.guard_comment_mutation() returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if current_setting('crm.allow_comment_mutation', true) is distinct from 'on' then
    raise exception 'direct comment mutation is disabled; use the comment RPC'
      using errcode = '55000';
  end if;

  if old.deleted_at is not null then
    raise exception 'archived comment % is immutable', old.id
      using errcode = '55000';
  end if;

  if new.id is distinct from old.id
     or new.lead_id is distinct from old.lead_id
     or new.branch_id is distinct from old.branch_id
     or new.entity_type is distinct from old.entity_type
     or new.entity_id is distinct from old.entity_id
     or new.author_id is distinct from old.author_id
     or new.created_at is distinct from old.created_at then
    raise exception 'comment identity fields are immutable'
      using errcode = '55000';
  end if;

  return new;
end
$function$;

create trigger guard_comment_mutation
  before update on crm.comments
  for each row execute function crm.guard_comment_mutation();

create function crm.bump_comment_version() returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.version := old.version + 1;
  return new;
end
$function$;

create trigger bump_comment_version
  before update on crm.comments
  for each row execute function crm.bump_comment_version();

-- Mirrors src/lib/auth/guards.ts write policy. Doctors do not use the Leads
-- module; Front Office must claim a lead before writing; leadership roles have
-- branch-wide access; Admin is global. Only leadership may moderate another
-- author's comment.
create function crm.assert_comment_write_access(
  p_actor uuid,
  p_author uuid,
  p_branch_id uuid,
  p_lead_id uuid,
  p_allow_moderation boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor crm.profiles%rowtype;
  v_lead_branch_id uuid;
  v_lead_assignee_id uuid;
  v_lead_deleted_at timestamptz;
begin
  select *
  into v_actor
  from crm.profiles p
  where p.id = p_actor
    and p.is_active
  for share;

  if not found then
    raise exception 'comment actor is missing or inactive'
      using errcode = '42501';
  end if;

  if v_actor.role::text not in (
    'admin',
    'operations',
    'front_office',
    'clinical_head'
  ) then
    raise exception 'actor does not have comment access'
      using errcode = '42501';
  end if;

  select l.branch_id, l.assignee_id, l.deleted_at
  into v_lead_branch_id, v_lead_assignee_id, v_lead_deleted_at
  from crm.leads l
  where l.id = p_lead_id
  for share;

  if not found then
    raise exception 'comment lead % not found', p_lead_id
      using errcode = 'P0002';
  end if;

  if v_lead_deleted_at is not null then
    raise exception 'comments on an archived lead are immutable'
      using errcode = '55000';
  end if;

  if v_lead_branch_id is distinct from p_branch_id then
    raise exception 'comment branch does not match its lead'
      using errcode = '55000';
  end if;

  if v_actor.role <> 'admin'
     and not exists (
       select 1
       from crm.user_branches ub
       where ub.user_id = p_actor
         and ub.branch_id = p_branch_id
     ) then
    raise exception 'actor is not allocated to the comment branch'
      using errcode = '42501';
  end if;

  if v_actor.role = 'front_office'
     and v_lead_assignee_id is distinct from p_actor then
    raise exception 'front-office actor must claim the lead before writing comments'
      using errcode = '42501';
  end if;

  if p_author is distinct from p_actor
     and (
       not p_allow_moderation
       or v_actor.role::text not in ('admin', 'operations', 'clinical_head')
     ) then
    raise exception 'actor cannot mutate another author''s comment'
      using errcode = '42501';
  end if;
end
$function$;

create function crm.create_comment(
  p_lead_id uuid,
  p_entity_type crm.comment_entity,
  p_entity_id uuid,
  p_body text,
  p_actor uuid
) returns crm.comments
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_branch_id uuid;
  v_comment crm.comments%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if length(v_body) not between 1 and 4000 then
    raise exception 'comment must contain 1 to 4000 characters'
      using errcode = '22023';
  end if;

  if p_entity_type is null then
    raise exception 'comment target type is required'
      using errcode = '22023';
  end if;

  if p_entity_type = 'lead' then
    if p_entity_id is not null and p_entity_id is distinct from p_lead_id then
      raise exception 'lead comment entity must match lead_id'
        using errcode = '22023';
    end if;
  elsif p_entity_id is null then
    raise exception 'a non-lead comment target is required'
      using errcode = '22023';
  end if;

  select l.branch_id
  into v_branch_id
  from crm.leads l
  where l.id = p_lead_id;

  if not found then
    raise exception 'comment lead % not found', p_lead_id
      using errcode = 'P0002';
  end if;

  perform crm.assert_comment_write_access(
    p_actor,
    p_actor,
    v_branch_id,
    p_lead_id,
    false
  );

  insert into crm.comments (
    lead_id,
    entity_type,
    entity_id,
    body,
    author_id
  )
  values (
    p_lead_id,
    p_entity_type,
    p_entity_id,
    v_body,
    p_actor
  )
  returning * into v_comment;

  return v_comment;
end
$function$;

create function crm.update_comment(
  p_comment_id uuid,
  p_body text,
  p_actor uuid,
  p_expected_version bigint
) returns crm.comments
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old crm.comments%rowtype;
  v_comment crm.comments%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'comment version must be a positive integer'
      using errcode = '22023';
  end if;

  if length(v_body) not between 1 and 4000 then
    raise exception 'comment must contain 1 to 4000 characters'
      using errcode = '22023';
  end if;

  select *
  into v_old
  from crm.comments c
  where c.id = p_comment_id
  for update;

  if not found then
    raise exception 'comment % not found', p_comment_id
      using errcode = 'P0002';
  end if;

  perform crm.assert_comment_write_access(
    p_actor,
    v_old.author_id,
    v_old.branch_id,
    v_old.lead_id,
    false
  );

  if v_old.deleted_at is not null then
    raise exception 'archived comment % is immutable', p_comment_id
      using errcode = '55000';
  end if;

  if p_expected_version <> v_old.version then
    raise exception 'comment % was modified by another request', p_comment_id
      using errcode = '40001';
  end if;

  -- A replay that carries the current version and identical text is harmless
  -- and should not manufacture an audit revision.
  if v_body = v_old.body then
    return v_old;
  end if;

  perform pg_catalog.set_config('crm.allow_comment_mutation', 'on', true);

  update crm.comments
  set body = v_body
  where id = p_comment_id
  returning * into v_comment;

  perform pg_catalog.set_config('crm.allow_comment_mutation', 'off', true);

  insert into crm.audit_log (
    entity_type,
    entity_id,
    action,
    actor_id,
    old_data,
    new_data
  )
  values (
    'comment',
    v_comment.id,
    'updated',
    p_actor,
    to_jsonb(v_old),
    to_jsonb(v_comment)
  );

  return v_comment;
end
$function$;

create function crm.soft_delete_comment(
  p_comment_id uuid,
  p_actor uuid,
  p_reason text,
  p_expected_version bigint
) returns crm.comments
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old crm.comments%rowtype;
  v_comment crm.comments%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'comment version must be a positive integer'
      using errcode = '22023';
  end if;

  if length(v_reason) not between 1 and 500 then
    raise exception 'archive reason must contain 1 to 500 characters'
      using errcode = '22023';
  end if;

  select *
  into v_old
  from crm.comments c
  where c.id = p_comment_id
  for update;

  if not found then
    raise exception 'comment % not found', p_comment_id
      using errcode = 'P0002';
  end if;

  perform crm.assert_comment_write_access(
    p_actor,
    v_old.author_id,
    v_old.branch_id,
    v_old.lead_id,
    true
  );

  if v_old.deleted_at is not null then
    raise exception 'comment % is already archived', p_comment_id
      using errcode = '55000';
  end if;

  if p_expected_version <> v_old.version then
    raise exception 'comment % was modified by another request', p_comment_id
      using errcode = '40001';
  end if;

  perform pg_catalog.set_config('crm.allow_comment_mutation', 'on', true);

  update crm.comments
  set deleted_at = now(),
      deleted_by = p_actor,
      delete_reason = v_reason
  where id = p_comment_id
  returning * into v_comment;

  perform pg_catalog.set_config('crm.allow_comment_mutation', 'off', true);

  insert into crm.audit_log (
    entity_type,
    entity_id,
    action,
    actor_id,
    old_data,
    new_data
  )
  values (
    'comment',
    v_comment.id,
    'soft_deleted',
    p_actor,
    to_jsonb(v_old),
    to_jsonb(v_comment)
  );

  return v_comment;
end
$function$;

comment on function crm.update_comment(uuid, text, uuid, bigint)
is 'Version-checked author edit with lead-scope authorization and immutable before/after audit.';

comment on function crm.soft_delete_comment(uuid, uuid, text, bigint)
is 'Version-checked comment archive with author/moderator scope and immutable before/after audit.';

comment on function crm.create_comment(
  uuid,
  crm.comment_entity,
  uuid,
  text,
  uuid
)
is 'Creates and audits a comment after enforcing lead-write and target ownership scope.';

-- service_role remains the only application data path, but ordinary DAL code
-- can no longer issue a comment write by mistake. The SECURITY DEFINER RPCs
-- above are the narrow create/update/archive capabilities.
revoke all on crm.comments from service_role;
grant select on crm.comments to service_role;

revoke execute on function crm.audit_comment_insert()
  from public, anon, authenticated, service_role;
revoke execute on function crm.guard_comment_mutation()
  from public, anon, authenticated, service_role;
revoke execute on function crm.bump_comment_version()
  from public, anon, authenticated, service_role;
revoke execute on function crm.assert_comment_write_access(
  uuid,
  uuid,
  uuid,
  uuid,
  boolean
) from public, anon, authenticated, service_role;

revoke execute on function crm.create_comment(
  uuid,
  crm.comment_entity,
  uuid,
  text,
  uuid
) from public, anon, authenticated;
revoke execute on function crm.update_comment(uuid, text, uuid, bigint)
  from public, anon, authenticated;
revoke execute on function crm.soft_delete_comment(uuid, uuid, text, bigint)
  from public, anon, authenticated;

grant execute on function crm.create_comment(
  uuid,
  crm.comment_entity,
  uuid,
  text,
  uuid
) to service_role;
grant execute on function crm.update_comment(uuid, text, uuid, bigint)
  to service_role;
grant execute on function crm.soft_delete_comment(uuid, uuid, text, bigint)
  to service_role;
