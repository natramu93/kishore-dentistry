-- Dependency-free TAP-compatible regression test for migration 0008.
-- Run after all migrations with ON_ERROR_STOP enabled.

begin;

select '1..1';

do $test$
declare
  v_admin constant uuid := '80000000-0000-0000-0000-000000000001';
  v_operations constant uuid := '80000000-0000-0000-0000-000000000002';
  v_doctor_profile constant uuid := '80000000-0000-0000-0000-000000000003';
  v_front_office constant uuid := '80000000-0000-0000-0000-000000000004';
  v_branch uuid;
  v_doctor uuid;
  v_other_doctor uuid;
  v_treatment_type uuid;
  v_lead_one uuid;
  v_lead_two uuid;
  v_lead_three uuid;
  v_lead_four uuid;
  v_appointment_one uuid;
  v_appointment_two uuid;
  v_treatment uuid;
  v_legacy_treatment uuid;
  v_recorded_doctor uuid;
  v_invoice_one crm.invoices%rowtype;
  v_invoice_two crm.invoices%rowtype;
  v_updated_invoice crm.invoices%rowtype;
  v_paid_invoice crm.invoices%rowtype;
  v_deleted_invoice crm.invoices%rowtype;
  v_counter int;
  v_count int;
  v_repaired_count bigint;
  v_old_version bigint;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values
    (v_admin, 'hardening-admin@example.test', '{"full_name":"Hardening Admin"}'),
    (v_operations, 'hardening-operations@example.test', '{"full_name":"Hardening Operations"}'),
    (v_doctor_profile, 'hardening-doctor@example.test', '{"full_name":"Hardening Doctor"}'),
    (v_front_office, 'hardening-front-office@example.test', '{"full_name":"Hardening Front Office"}');

  if (
    select p.role::text
    from crm.profiles p
    where p.id = v_front_office
  ) <> 'front_office' then
    raise exception 'new profile did not receive the current front_office default role';
  end if;

  if (
    select p.is_active
    from crm.profiles p
    where p.id = v_front_office
  ) then
    raise exception 'new signup profile unexpectedly started active';
  end if;

  update crm.profiles set role = 'admin', is_active = true where id = v_admin;
  update crm.profiles set role = 'operations', is_active = true where id = v_operations;
  update crm.profiles set role = 'doctor', is_active = true where id = v_doctor_profile;
  update crm.profiles set is_active = true where id = v_front_office;

  begin
    update crm.profiles
    set role = 'agent'
    where id = v_front_office;
    raise exception 'legacy agent role unexpectedly passed the current-role constraint';
  exception
    when check_violation then null;
  end;

  insert into crm.branches (name, code)
  values ('Hardening Test Branch', 'H08')
  returning id into v_branch;

  insert into crm.user_branches (user_id, branch_id)
  values
    (v_operations, v_branch),
    (v_doctor_profile, v_branch),
    (v_front_office, v_branch);

  insert into crm.doctors (branch_id, full_name, profile_id)
  values (v_branch, 'Trusted Test Doctor', v_doctor_profile)
  returning id into v_doctor;

  insert into crm.doctors (branch_id, full_name)
  values (v_branch, 'Untrusted Payload Doctor')
  returning id into v_other_doctor;

  insert into crm.treatment_types (name, category, default_cost)
  values ('Hardening Test Treatment', 'Test', 1000)
  returning id into v_treatment_type;

  insert into crm.leads (
    branch_id, name, mobile, status, created_by
  )
  values
    (v_branch, 'Replay Lead', '9000000001', 'open', v_admin),
    (v_branch, 'Cancellation Lead', '9000000002', 'open', v_admin),
    (v_branch, 'Collision Lead One', '9000000003', 'open', v_admin),
    (v_branch, 'Collision Lead Two', '9000000004', 'open', v_admin);

  select l.id into v_lead_one
  from crm.leads l where l.mobile = '9000000001';
  select l.id into v_lead_two
  from crm.leads l where l.mobile = '9000000002';
  select l.id into v_lead_three
  from crm.leads l where l.mobile = '9000000003';
  select l.id into v_lead_four
  from crm.leads l where l.mobile = '9000000004';

  -- Front Office can claim an unassigned open-pool lead only for itself.
  perform crm.transition_lead(
    v_lead_three,
    'assigned',
    v_front_office,
    jsonb_build_object('assignee_id', v_front_office)
  );

  if (
    select l.assignee_id
    from crm.leads l
    where l.id = v_lead_three
  ) is distinct from v_front_office then
    raise exception 'front-office actor could not self-claim an open-pool lead';
  end if;

  begin
    perform crm.transition_lead(
      v_lead_four,
      'assigned',
      v_front_office,
      jsonb_build_object('assignee_id', v_operations)
    );
    raise exception 'front-office actor assigned an open-pool lead to another user';
  exception
    when insufficient_privilege then null;
  end;

  if (
    select l.status
    from crm.leads l
    where l.id = v_lead_four
  ) <> 'open' or (
    select l.assignee_id
    from crm.leads l
    where l.id = v_lead_four
  ) is not null then
    raise exception 'rejected open-pool claim partially changed the lead';
  end if;

  perform crm.transition_lead(
    v_lead_one,
    'assigned',
    v_admin,
    jsonb_build_object('assignee_id', v_operations)
  );
  perform crm.transition_lead(
    v_lead_one,
    'appointment_booked',
    v_admin,
    jsonb_build_object(
      'doctor_id', v_doctor,
      'scheduled_at', '2040-01-02T09:00:00Z',
      'duration_minutes', 30
    )
  );

  select a.id into v_appointment_one
  from crm.appointments a
  where a.lead_id = v_lead_one and a.status = 'scheduled';

  perform crm.transition_lead(
    v_lead_one,
    'visited_treated',
    v_admin,
    jsonb_build_object(
      'appointment_id', v_appointment_one,
      'treatment_type_id', v_treatment_type,
      'doctor_id', v_other_doctor,
      'cost', 1000
    )
  );

  -- Replaying the committed target state must not create another treatment.
  perform crm.transition_lead(
    v_lead_one,
    'visited_treated',
    v_admin,
    jsonb_build_object(
      'appointment_id', v_appointment_one,
      'treatment_type_id', v_treatment_type,
      'doctor_id', v_other_doctor,
      'cost', 1000
    )
  );

  select count(*)
  into v_count
  from crm.treatments t
  where t.lead_id = v_lead_one;

  if v_count <> 1 then
    raise exception 'replayed completion created % treatments instead of one', v_count;
  end if;

  select t.doctor_id, t.id
  into v_recorded_doctor, v_treatment
  from crm.treatments t
  where t.lead_id = v_lead_one;

  if v_recorded_doctor is distinct from v_doctor then
    raise exception 'treatment trusted payload doctor instead of appointment doctor';
  end if;

  -- Simulate one legacy row written before the integrity trigger existed,
  -- then exercise the same idempotent repair routine used by the migration.
  alter table crm.treatments
    disable trigger validate_treatment_integrity;

  insert into crm.treatments (
    lead_id,
    appointment_id,
    treatment_type_id,
    doctor_id,
    cost,
    created_by
  )
  values (
    v_lead_one,
    v_appointment_one,
    v_treatment_type,
    null,
    500,
    v_admin
  )
  returning id into v_legacy_treatment;

  alter table crm.treatments
    enable trigger validate_treatment_integrity;

  select crm.repair_treatment_doctor_attribution()
  into v_repaired_count;

  if v_repaired_count <> 1 or (
    select t.doctor_id
    from crm.treatments t
    where t.id = v_legacy_treatment
  ) is distinct from v_doctor then
    raise exception 'guarded treatment doctor backfill did not repair the legacy row';
  end if;

  if not exists (
    select 1
    from crm.audit_log a
    where a.entity_type = 'treatment'
      and a.entity_id = v_legacy_treatment
      and a.action = 'doctor_attribution_backfilled'
  ) then
    raise exception 'treatment doctor backfill was not audited';
  end if;

  select crm.repair_treatment_doctor_attribution()
  into v_repaired_count;

  if v_repaired_count <> 0 then
    raise exception 'treatment doctor backfill was not idempotent';
  end if;

  select count(*)
  into v_count
  from crm.treatments t
  join crm.appointments a
    on a.id = t.appointment_id
   and a.lead_id = t.lead_id
   and a.branch_id = t.branch_id
  join crm.doctors d
    on d.id = a.doctor_id
   and d.branch_id = t.branch_id
  where t.doctor_id is null
    and a.doctor_id is not null;

  if v_count <> 0 then
    raise exception '% safely repairable treatments remain without doctor attribution', v_count;
  end if;

  perform crm.transition_lead(
    v_lead_two,
    'assigned',
    v_admin,
    jsonb_build_object('assignee_id', v_operations)
  );
  perform crm.transition_lead(
    v_lead_two,
    'appointment_booked',
    v_admin,
    jsonb_build_object(
      'doctor_id', v_doctor,
      'scheduled_at', '2040-02-02T09:00:00Z',
      'duration_minutes', 30
    )
  );

  select a.id into v_appointment_two
  from crm.appointments a
  where a.lead_id = v_lead_two and a.status = 'scheduled';

  begin
    perform crm.transition_lead(
      v_lead_two,
      'assigned',
      v_admin,
      jsonb_build_object(
        'assignee_id', v_front_office,
        'cancelled_appointment_id', v_appointment_two
      )
    );
    raise exception 'appointment cancellation unexpectedly reassigned the lead';
  exception
    when check_violation then null;
  end;

  if (
    select l.assignee_id
    from crm.leads l
    where l.id = v_lead_two
  ) is distinct from v_operations or (
    select a.status
    from crm.appointments a
    where a.id = v_appointment_two
  ) <> 'scheduled' then
    raise exception 'failed reassignment attempt partially changed cancellation state';
  end if;

  perform crm.transition_lead(
    v_lead_two,
    'assigned',
    v_admin,
    jsonb_build_object(
      'assignee_id', v_operations,
      'cancelled_appointment_id', v_appointment_two
    )
  );
  perform crm.transition_lead(
    v_lead_two,
    'assigned',
    v_admin,
    jsonb_build_object(
      'assignee_id', v_operations,
      'cancelled_appointment_id', v_appointment_two
    )
  );

  if (
    select a.status
    from crm.appointments a
    where a.id = v_appointment_two
  ) <> 'cancelled' then
    raise exception 'appointment cancellation did not commit atomically';
  end if;

  if (
    select l.assignee_id
    from crm.leads l
    where l.id = v_lead_two
  ) is distinct from v_operations then
    raise exception 'appointment cancellation did not preserve the assignee';
  end if;

  select count(*) into v_count
  from crm.lead_activity a
  where a.lead_id = v_lead_two and a.type = 'assignment';

  if v_count <> 2 then
    raise exception 'replayed cancellation emitted duplicate assignment activity';
  end if;

  insert into crm.appointments (
    lead_id, doctor_id, scheduled_at, duration_minutes, created_by
  )
  values (
    v_lead_three, v_doctor, '2041-01-01T09:00:00Z', 30, v_admin
  );

  begin
    insert into crm.appointments (
      lead_id, doctor_id, scheduled_at, duration_minutes, created_by
    )
    values (
      v_lead_four, v_doctor, '2041-01-01T09:15:00Z', 30, v_admin
    );
    raise exception 'overlapping doctor appointment unexpectedly succeeded';
  exception
    when exclusion_violation then null;
  end;

  select * into v_invoice_one
  from crm.create_invoice(
    v_lead_one,
    v_treatment,
    5,
    'First invoice',
    '[
      {"description":"Treatment","quantity":2,"unit_price":1000},
      {"description":"Consultation","quantity":1,"unit_price":500}
    ]'::jsonb,
    v_admin
  );

  if v_invoice_one.subtotal <> 2500
     or v_invoice_one.tax_amount <> 125
     or v_invoice_one.total <> 2625 then
    raise exception 'server-calculated invoice totals are incorrect';
  end if;

  -- This allocates a number, then fails the treatment/lead relationship
  -- check. The function's subtransaction must roll the allocation back.
  begin
    perform crm.create_invoice(
      v_lead_two,
      v_treatment,
      0,
      null,
      '[{"description":"Invalid relation","quantity":1,"unit_price":100}]'::jsonb,
      v_admin
    );
    raise exception 'cross-lead treatment invoice unexpectedly succeeded';
  exception
    when check_violation then null;
  end;

  select * into v_invoice_two
  from crm.create_invoice(
    v_lead_one,
    null,
    0,
    null,
    '[{"description":"Second invoice","quantity":1,"unit_price":100}]'::jsonb,
    v_admin
  );

  if right(v_invoice_two.invoice_number, 4)::int
     <> right(v_invoice_one.invoice_number, 4)::int + 1 then
    raise exception 'failed invoice creation left a counter gap';
  end if;

  select c.last_no into v_counter
  from crm.invoice_counters c
  where c.branch_id = v_branch
    and c.year = extract(year from now() at time zone 'Asia/Kolkata')::int;

  if v_counter <> 2 then
    raise exception 'invoice counter is %, expected 2', v_counter;
  end if;

  v_old_version := v_invoice_one.version;
  select * into v_updated_invoice
  from crm.update_invoice(
    v_invoice_one.id,
    18,
    'Updated invoice',
    '[
      {"description":"Treatment","quantity":1,"unit_price":2500},
      {"description":"Consultation","quantity":1,"unit_price":500}
    ]'::jsonb,
    v_admin,
    v_old_version
  );

  if v_updated_invoice.total <> 3540
     or v_updated_invoice.version <> v_old_version + 1 then
    raise exception 'atomic invoice update totals/version are incorrect';
  end if;

  select count(*) into v_count
  from crm.invoice_items i
  where i.invoice_id = v_invoice_one.id;

  if v_count <> 2 then
    raise exception 'invoice line-item replacement is incomplete';
  end if;

  begin
    perform crm.update_invoice(
      v_invoice_one.id,
      0,
      null,
      '[{"description":"Stale","quantity":1,"unit_price":1}]'::jsonb,
      v_admin,
      v_old_version
    );
    raise exception 'stale invoice version unexpectedly succeeded';
  exception
    when serialization_failure then null;
  end;

  select * into v_paid_invoice
  from crm.transition_invoice_status(
    v_invoice_one.id,
    'paid',
    v_admin,
    v_updated_invoice.version
  );

  if v_paid_invoice.paid_at is null or v_paid_invoice.issued_at is null then
    raise exception 'paid invoice timestamps were not populated';
  end if;

  begin
    delete from crm.invoice_items
    where invoice_id = v_invoice_one.id;
    raise exception 'paid invoice items unexpectedly remained mutable';
  exception
    when object_not_in_prerequisite_state then null;
  end;

  begin
    perform crm.transition_invoice_status(
      v_invoice_one.id,
      'draft',
      v_admin,
      v_paid_invoice.version
    );
    raise exception 'paid invoice unexpectedly transitioned back to draft';
  exception
    when check_violation then null;
  end;

  begin
    perform crm.delete_invoice(
      v_invoice_one.id,
      v_admin,
      'Paid invoice must remain',
      v_paid_invoice.version
    );
    raise exception 'paid invoice unexpectedly soft-deleted';
  exception
    when object_not_in_prerequisite_state then null;
  end;

  if (
    select i.deleted_at
    from crm.invoices i
    where i.id = v_invoice_one.id
  ) is not null then
    raise exception 'failed paid-invoice deletion changed the invoice';
  end if;

  select * into v_deleted_invoice
  from crm.delete_invoice(
    v_invoice_two.id,
    v_admin,
    'Regression-test archive',
    v_invoice_two.version
  );

  if v_deleted_invoice.deleted_at is null then
    raise exception 'draft invoice delete RPC did not soft-delete';
  end if;

  select count(*) into v_count
  from crm.invoice_items i
  where i.invoice_id = v_invoice_two.id;

  if v_count <> 1 then
    raise exception 'soft-deleting invoice erased its financial line history';
  end if;

  begin
    delete from crm.invoices where id = v_invoice_two.id;
    raise exception 'protected invoice hard delete unexpectedly succeeded';
  exception
    when object_not_in_prerequisite_state then null;
  end;

  perform crm.soft_delete_lead(
    v_lead_two,
    v_admin,
    'Regression-test archive'
  );

  begin
    insert into crm.comments (lead_id, body, author_id)
    values (v_lead_two, 'Should be rejected', v_admin);
    raise exception 'child record was created for a deleted lead';
  exception
    when object_not_in_prerequisite_state then null;
  end;

  begin
    delete from crm.leads where id = v_lead_two;
    raise exception 'protected lead hard delete unexpectedly succeeded';
  exception
    when object_not_in_prerequisite_state then null;
  end;

  begin
    update crm.audit_log
    set action = 'tampered'
    where entity_type = 'invoice' and entity_id = v_invoice_one.id;
    raise exception 'append-only audit row unexpectedly changed';
  exception
    when object_not_in_prerequisite_state then null;
  end;

  if has_function_privilege(
    'public',
    'crm.transition_lead(uuid,crm.lead_status,uuid,jsonb)'::regprocedure,
    'execute'
  ) then
    raise exception 'PUBLIC still has EXECUTE on transition_lead';
  end if;

  if has_function_privilege(
    'anon',
    'crm.transition_lead(uuid,crm.lead_status,uuid,jsonb)'::regprocedure,
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'crm.transition_lead(uuid,crm.lead_status,uuid,jsonb)'::regprocedure,
    'execute'
  ) then
    raise exception 'browser roles still have EXECUTE on transition_lead';
  end if;

  if not has_function_privilege(
    'service_role',
    'crm.transition_lead(uuid,crm.lead_status,uuid,jsonb)'::regprocedure,
    'execute'
  ) then
    raise exception 'service_role is missing EXECUTE on transition_lead';
  end if;

  select count(*) into v_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'crm'
    and c.relkind in ('r', 'p')
    and not c.relrowsecurity;

  if v_count <> 0 then
    raise exception '% crm tables do not have RLS enabled', v_count;
  end if;

  select count(*) into v_count
  from pg_policies p
  where p.schemaname = 'crm';

  if v_count <> 0 then
    raise exception 'crm unexpectedly has % browser-facing RLS policies', v_count;
  end if;
end
$test$;

select 'ok 1 - migration 0008 role, workflow, invoice, audit, and privilege hardening';

rollback;
