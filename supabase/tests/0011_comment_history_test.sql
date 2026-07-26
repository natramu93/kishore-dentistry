-- Dependency-free TAP-compatible regression test for migration 0011.
-- Run after all migrations with ON_ERROR_STOP enabled.

begin;

select '1..1';

do $test$
declare
  v_admin constant uuid := 'b1000000-0000-0000-0000-000000000001';
  v_operations constant uuid := 'b1000000-0000-0000-0000-000000000002';
  v_front_office constant uuid := 'b1000000-0000-0000-0000-000000000003';
  v_other_front_office constant uuid := 'b1000000-0000-0000-0000-000000000004';
  v_doctor constant uuid := 'b1000000-0000-0000-0000-000000000005';
  v_branch_a uuid;
  v_branch_b uuid;
  v_owned_lead uuid;
  v_unassigned_lead uuid;
  v_other_branch_lead uuid;
  v_comment crm.comments%rowtype;
  v_updated crm.comments%rowtype;
  v_archived crm.comments%rowtype;
  v_other_branch_comment crm.comments%rowtype;
  v_doctor_comment uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values
    (v_admin, 'comment-admin@example.test', '{"full_name":"Comment Admin"}'),
    (v_operations, 'comment-operations@example.test', '{"full_name":"Comment Operations"}'),
    (v_front_office, 'comment-front@example.test', '{"full_name":"Comment Front"}'),
    (
      v_other_front_office,
      'comment-other-front@example.test',
      '{"full_name":"Comment Other Front"}'
    ),
    (v_doctor, 'comment-doctor@example.test', '{"full_name":"Comment Doctor"}');

  update crm.profiles
  set role = 'admin', is_active = true
  where id = v_admin;

  update crm.profiles
  set role = 'operations', is_active = true
  where id = v_operations;

  update crm.profiles
  set role = 'front_office', is_active = true
  where id in (v_front_office, v_other_front_office);

  update crm.profiles
  set role = 'doctor', is_active = true
  where id = v_doctor;

  insert into crm.branches (name, code)
  values ('Comment Branch A', 'C11A')
  returning id into v_branch_a;

  insert into crm.branches (name, code)
  values ('Comment Branch B', 'C11B')
  returning id into v_branch_b;

  insert into crm.user_branches (user_id, branch_id)
  values
    (v_operations, v_branch_a),
    (v_front_office, v_branch_a),
    (v_other_front_office, v_branch_a),
    (v_doctor, v_branch_a);

  insert into crm.leads (
    branch_id,
    name,
    mobile,
    assignee_id,
    created_by
  )
  values (
    v_branch_a,
    'Comment Owned Lead',
    '9555000001',
    v_front_office,
    v_admin
  )
  returning id into v_owned_lead;

  insert into crm.leads (branch_id, name, mobile, created_by)
  values (v_branch_a, 'Comment Pool Lead', '9555000002', v_admin)
  returning id into v_unassigned_lead;

  insert into crm.leads (branch_id, name, mobile, created_by)
  values (v_branch_b, 'Comment Other Branch Lead', '9555000003', v_admin)
  returning id into v_other_branch_lead;

  select *
  into v_comment
  from crm.create_comment(
    v_owned_lead,
    'lead',
    null,
    '  Original comment  ',
    v_front_office
  );

  if v_comment.body <> 'Original comment' or v_comment.version <> 1 then
    raise exception 'comment creation did not normalize text or initialize version';
  end if;

  if not exists (
    select 1
    from crm.audit_log a
    where a.entity_type = 'comment'
      and a.entity_id = v_comment.id
      and a.action = 'created'
      and a.actor_id = v_front_office
      and a.new_data->>'body' = 'Original comment'
  ) then
    raise exception 'comment creation was not captured in the immutable audit stream';
  end if;

  -- Reading an unassigned lead does not grant Front Office write access.
  begin
    perform crm.create_comment(
      v_unassigned_lead,
      'lead',
      null,
      'Must claim first',
      v_front_office
    );
    raise exception 'front-office actor wrote to an unassigned pool lead';
  exception
    when insufficient_privilege then null;
  end;

  -- Direct mutation is blocked even for the migration owner.
  begin
    update crm.comments
    set body = 'Direct overwrite'
    where id = v_comment.id;
    raise exception 'direct comment update unexpectedly succeeded';
  exception
    when object_not_in_prerequisite_state then null;
  end;

  begin
    delete from crm.comments where id = v_comment.id;
    raise exception 'comment hard delete unexpectedly succeeded';
  exception
    when object_not_in_prerequisite_state then null;
  end;

  select *
  into v_updated
  from crm.update_comment(
    v_comment.id,
    '  Revised comment  ',
    v_front_office,
    1
  );

  if v_updated.body <> 'Revised comment' or v_updated.version <> 2 then
    raise exception 'authorized comment edit did not update text and version';
  end if;

  if not exists (
    select 1
    from crm.audit_log a
    where a.entity_type = 'comment'
      and a.entity_id = v_comment.id
      and a.action = 'updated'
      and a.actor_id = v_front_office
      and a.old_data->>'body' = 'Original comment'
      and a.new_data->>'body' = 'Revised comment'
      and (a.old_data->>'version')::bigint = 1
      and (a.new_data->>'version')::bigint = 2
  ) then
    raise exception 'comment edit did not preserve the before/after revision';
  end if;

  begin
    perform crm.update_comment(
      v_comment.id,
      'Stale edit',
      v_front_office,
      1
    );
    raise exception 'stale comment edit unexpectedly succeeded';
  exception
    when serialization_failure then null;
  end;

  begin
    perform crm.soft_delete_comment(
      v_comment.id,
      v_other_front_office,
      'Unauthorized moderation attempt',
      2
    );
    raise exception 'front-office actor archived another author''s comment';
  exception
    when insufficient_privilege then null;
  end;

  select *
  into v_archived
  from crm.soft_delete_comment(
    v_comment.id,
    v_operations,
    'Duplicate patient note',
    2
  );

  if v_archived.deleted_at is null
     or v_archived.deleted_by is distinct from v_operations
     or v_archived.delete_reason <> 'Duplicate patient note'
     or v_archived.version <> 3 then
    raise exception 'authorized moderation did not retain archive metadata';
  end if;

  if not exists (
    select 1
    from crm.audit_log a
    where a.entity_type = 'comment'
      and a.entity_id = v_comment.id
      and a.action = 'soft_deleted'
      and a.actor_id = v_operations
      and a.old_data->>'deleted_at' is null
      and a.new_data->>'delete_reason' = 'Duplicate patient note'
      and (a.new_data->>'version')::bigint = 3
  ) then
    raise exception 'comment archive did not preserve its reason and before/after state';
  end if;

  if not exists (
    select 1
    from crm.comments c
    where c.id = v_comment.id
      and c.deleted_at is not null
  ) then
    raise exception 'comment archive physically removed the row';
  end if;

  -- Branch-wide roles remain limited to their allocated branches.
  select *
  into v_other_branch_comment
  from crm.create_comment(
    v_other_branch_lead,
    'lead',
    null,
    'Other branch comment',
    v_admin
  );

  begin
    perform crm.soft_delete_comment(
      v_other_branch_comment.id,
      v_operations,
      'Cross-branch attempt',
      1
    );
    raise exception 'operations actor moderated a comment outside its branches';
  exception
    when insufficient_privilege then null;
  end;

  -- Doctor profiles remain outside the Leads/comment write surface.
  insert into crm.comments (lead_id, body, author_id)
  values (v_owned_lead, 'Doctor fixture comment', v_doctor)
  returning id into v_doctor_comment;

  begin
    perform crm.update_comment(
      v_doctor_comment,
      'Doctor edit attempt',
      v_doctor,
      1
    );
    raise exception 'doctor actor unexpectedly edited a Leads comment';
  exception
    when insufficient_privilege then null;
  end;

  -- Browser roles retain no table or RPC path, while the server role can only
  -- select directly and must use the narrow functions for every write.
  if has_table_privilege('authenticated', 'crm.comments', 'SELECT')
     or has_table_privilege('authenticated', 'crm.comments', 'INSERT')
     or has_table_privilege('authenticated', 'crm.comments', 'UPDATE')
     or has_table_privilege('authenticated', 'crm.comments', 'DELETE') then
    raise exception 'authenticated browser role has a direct comments privilege';
  end if;

  if has_table_privilege('service_role', 'crm.comments', 'INSERT')
     or has_table_privilege('service_role', 'crm.comments', 'UPDATE')
     or has_table_privilege('service_role', 'crm.comments', 'DELETE')
     or has_table_privilege('service_role', 'crm.comments', 'TRUNCATE')
     or has_table_privilege('service_role', 'crm.comments', 'REFERENCES')
     or has_table_privilege('service_role', 'crm.comments', 'TRIGGER')
     or not has_table_privilege('service_role', 'crm.comments', 'SELECT') then
    raise exception 'service_role direct comment privileges are not read-only';
  end if;

  if has_function_privilege(
       'authenticated',
       'crm.create_comment(uuid,crm.comment_entity,uuid,text,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'crm.update_comment(uuid,text,uuid,bigint)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'crm.soft_delete_comment(uuid,uuid,text,bigint)',
       'EXECUTE'
     ) then
    raise exception 'authenticated browser role can execute a comment write RPC';
  end if;
end
$test$;

select 'ok 1 - comment writes are scoped, versioned, soft-deleted, and audited';

rollback;
