-- ============================================================
-- 20260726070821_data_integrity_hardening.sql
--
-- Forward-only database hardening:
--   * current profile roles and safer signup defaults
--   * append-only audit history and soft-delete primitives
--   * cross-entity/value validation
--   * collision-safe appointment scheduling
--   * replay-safe lead transitions with trusted doctor attribution
--   * transactional invoice RPCs
--   * explicit function privilege lockdown and targeted indexes
-- ============================================================

-- ------------------------------------------------------------
-- Current role model
-- ------------------------------------------------------------

update crm.profiles
set role = case role::text
  when 'manager' then 'operations'::crm.user_role
  when 'agent' then 'front_office'::crm.user_role
  else role
end
where role::text in ('manager', 'agent');

alter table crm.profiles
  alter column role set default 'front_office'::crm.user_role,
  alter column is_active set default false;

alter table crm.profiles
  add constraint profiles_current_role_check
  check (role::text in ('admin', 'operations', 'front_office', 'clinical_head', 'doctor'))
  not valid;

alter table crm.profiles validate constraint profiles_current_role_check;

create or replace function crm.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into crm.profiles (id, email, full_name, role, is_active)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'front_office'::crm.user_role,
    false
  )
  on conflict (id) do nothing;

  return new;
end
$function$;

-- ------------------------------------------------------------
-- Durable audit history and soft-delete metadata
-- ------------------------------------------------------------

alter table crm.leads
  add column deleted_at timestamptz,
  add column deleted_by uuid references crm.profiles(id) on delete set null,
  add column delete_reason text;

alter table crm.invoices
  add column paid_at timestamptz,
  add column deleted_at timestamptz,
  add column deleted_by uuid references crm.profiles(id) on delete set null,
  add column delete_reason text,
  add column version bigint not null default 1;

create table crm.audit_log (
  id bigint generated always as identity primary key,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  -- Deliberately not an FK: the immutable actor identifier must survive
  -- profile/auth retention changes without mutating the audit record.
  actor_id uuid,
  old_data jsonb,
  new_data jsonb,
  occurred_at timestamptz not null default now(),
  constraint audit_log_entity_type_check
    check (entity_type in ('lead', 'appointment', 'treatment', 'follow_up', 'invoice')),
  constraint audit_log_action_check
    check (length(btrim(action)) between 1 and 80)
);

create index audit_log_entity_idx
  on crm.audit_log (entity_type, entity_id, occurred_at desc);
create index audit_log_actor_idx
  on crm.audit_log (actor_id, occurred_at desc)
  where actor_id is not null;

create function crm.protect_audit_log() returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'crm.audit_log is append-only'
    using errcode = '55000';
end
$function$;

create trigger protect_audit_log
  before update or delete on crm.audit_log
  for each row execute function crm.protect_audit_log();

create function crm.reject_protected_hard_delete() returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if current_setting('crm.allow_hard_delete', true) is distinct from 'on' then
    raise exception 'hard delete of crm.% is disabled; use the soft-delete RPC', tg_table_name
      using errcode = '55000';
  end if;

  return old;
end
$function$;

create trigger protect_lead_hard_delete
  before delete on crm.leads
  for each row execute function crm.reject_protected_hard_delete();

create trigger protect_invoice_hard_delete
  before delete on crm.invoices
  for each row execute function crm.reject_protected_hard_delete();

-- ------------------------------------------------------------
-- Value constraints
--
-- NOT VALID avoids making a forward migration depend on the
-- cleanliness of historical rows while still protecting all new
-- and subsequently modified rows.
-- ------------------------------------------------------------

alter table crm.leads
  add constraint leads_name_not_blank_check
    check (length(btrim(name)) between 1 and 200) not valid,
  add constraint leads_mobile_not_blank_check
    check (length(btrim(mobile)) between 7 and 32) not valid,
  add constraint leads_age_range_check
    check (age is null or age between 0 and 120) not valid,
  add constraint leads_delete_metadata_check
    check (
      (deleted_at is null and deleted_by is null and delete_reason is null)
      or
      (deleted_at is not null
       and coalesce(length(btrim(delete_reason)), 0) between 1 and 500)
    ) not valid;

alter table crm.appointments
  add constraint appointments_duration_range_check
    check (duration_minutes between 5 and 480) not valid;

alter table crm.treatments
  add constraint treatments_cost_nonnegative_check
    check (cost is null or cost >= 0) not valid;

alter table crm.follow_ups
  add constraint follow_ups_completion_state_check
    check (
      (status = 'pending' and completed_at is null)
      or status <> 'pending'
    ) not valid;

alter table crm.invoices
  add constraint invoices_amounts_valid_check
    check (
      subtotal >= 0
      and tax_rate between 0 and 100
      and tax_amount >= 0
      and total >= 0
      and total = subtotal + tax_amount
    ) not valid,
  add constraint invoices_version_positive_check
    check (version > 0) not valid,
  add constraint invoices_delete_metadata_check
    check (
      (deleted_at is null and deleted_by is null and delete_reason is null)
      or
      (deleted_at is not null
       and coalesce(length(btrim(delete_reason)), 0) between 1 and 500)
    ) not valid;

alter table crm.invoice_items
  add constraint invoice_items_description_not_blank_check
    check (length(btrim(description)) between 1 and 500) not valid,
  add constraint invoice_items_values_valid_check
    check (
      quantity > 0
      and unit_price >= 0
      and amount = round(quantity * unit_price, 2)
    ) not valid;

-- ------------------------------------------------------------
-- Existing-data repair: trusted doctor attribution
--
-- Only repair an unattributed treatment when its linked appointment is
-- unambiguous and agrees on both lead and branch. The doctor's own branch
-- must also agree. Rows that fail any guard remain untouched for manual
-- review instead of receiving a guessed attribution.
-- ------------------------------------------------------------

create function crm.repair_treatment_doctor_attribution() returns bigint
language plpgsql
set search_path = ''
as $function$
declare
  v_repaired bigint;
begin
  with repair_candidates as materialized (
    select
      t.id,
      a.doctor_id,
      to_jsonb(t) as old_data
    from crm.treatments t
    join crm.appointments a
      on a.id = t.appointment_id
     and a.lead_id = t.lead_id
     and a.branch_id = t.branch_id
    join crm.doctors d
      on d.id = a.doctor_id
     and d.branch_id = t.branch_id
    where t.doctor_id is null
      and a.doctor_id is not null
    for update of t
  ),
  repaired as (
    update crm.treatments t
    set doctor_id = c.doctor_id
    from repair_candidates c
    where t.id = c.id
      and t.doctor_id is null
    returning t.id, to_jsonb(t) as new_data
  ),
  audited as (
    insert into crm.audit_log (
      entity_type,
      entity_id,
      action,
      actor_id,
      old_data,
      new_data
    )
    select
      'treatment',
      r.id,
      'doctor_attribution_backfilled',
      null,
      c.old_data,
      r.new_data
    from repaired r
    join repair_candidates c on c.id = r.id
    returning 1
  )
  select count(*) into v_repaired
  from audited;

  return v_repaired;
end
$function$;

select crm.repair_treatment_doctor_attribution();

-- ------------------------------------------------------------
-- Relationship validation and appointment collision prevention
-- ------------------------------------------------------------

create function crm.validate_lead_assignment_integrity() returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_branch_active boolean;
  v_assignee crm.profiles%rowtype;
begin
  select b.is_active
  into v_branch_active
  from crm.branches b
  where b.id = new.branch_id;

  if not found then
    raise exception 'branch % not found', new.branch_id
      using errcode = '23503';
  end if;

  if not v_branch_active then
    raise exception 'branch % is inactive', new.branch_id
      using errcode = '55000';
  end if;

  if tg_op = 'UPDATE' then
    if new.branch_id is distinct from old.branch_id
       and (
         exists (select 1 from crm.appointments a where a.lead_id = old.id)
         or exists (select 1 from crm.treatments t where t.lead_id = old.id)
         or exists (select 1 from crm.follow_ups f where f.lead_id = old.id)
         or exists (select 1 from crm.invoices i where i.lead_id = old.id)
         or exists (select 1 from crm.lead_activity la where la.lead_id = old.id)
         or exists (select 1 from crm.comments c where c.lead_id = old.id)
       ) then
      raise exception 'lead branch cannot change after related records exist'
        using errcode = '23514';
    end if;
  end if;

  if new.assignee_id is not null then
    select *
    into v_assignee
    from crm.profiles p
    where p.id = new.assignee_id;

    if not found or not v_assignee.is_active then
      raise exception 'lead assignee is missing or inactive'
        using errcode = '23514';
    end if;

    if v_assignee.role::text not in
       ('admin', 'operations', 'front_office', 'clinical_head') then
      raise exception 'profile role % cannot own leads', v_assignee.role
        using errcode = '23514';
    end if;

    if v_assignee.role <> 'admin'
       and not exists (
         select 1
         from crm.user_branches ub
         where ub.user_id = new.assignee_id
           and ub.branch_id = new.branch_id
       ) then
      raise exception 'lead assignee is not allocated to the branch'
        using errcode = '23514';
    end if;
  end if;

  return new;
end
$function$;

create trigger validate_lead_assignment_integrity
  before insert or update of branch_id, assignee_id
  on crm.leads
  for each row execute function crm.validate_lead_assignment_integrity();

create function crm.validate_appointment_integrity() returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_lead_branch uuid;
  v_lead_deleted_at timestamptz;
  v_doctor_branch uuid;
  v_doctor_active boolean;
begin
  select l.branch_id, l.deleted_at
  into v_lead_branch, v_lead_deleted_at
  from crm.leads l
  where l.id = new.lead_id;

  if not found then
    raise exception 'lead % not found', new.lead_id
      using errcode = '23503';
  end if;

  if v_lead_deleted_at is not null then
    raise exception 'lead % is deleted', new.lead_id
      using errcode = '55000';
  end if;

  if new.branch_id is distinct from v_lead_branch then
    raise exception 'appointment branch must match lead branch'
      using errcode = '23514';
  end if;

  if new.doctor_id is not null then
    select d.branch_id, d.is_active
    into v_doctor_branch, v_doctor_active
    from crm.doctors d
    where d.id = new.doctor_id;

    if not found then
      raise exception 'doctor % not found', new.doctor_id
        using errcode = '23503';
    end if;

    if new.status = 'scheduled' and not v_doctor_active then
      raise exception 'doctor % is inactive', new.doctor_id
        using errcode = '55000';
    end if;

    if v_doctor_branch is distinct from v_lead_branch then
      raise exception 'appointment doctor must belong to the lead branch'
        using errcode = '23514';
    end if;
  end if;

  if new.status = 'scheduled' and new.doctor_id is not null then
    -- Serialize schedule decisions for a doctor so the overlap check is
    -- safe even when two bookings arrive concurrently.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('crm.doctor.' || new.doctor_id::text, 0)
    );

    if exists (
      select 1
      from crm.appointments a
      where a.doctor_id = new.doctor_id
        and a.status = 'scheduled'
        and a.id is distinct from new.id
        and a.scheduled_at
              < new.scheduled_at
                + pg_catalog.make_interval(mins => new.duration_minutes)
        and a.scheduled_at
              + pg_catalog.make_interval(mins => a.duration_minutes)
              > new.scheduled_at
    ) then
      raise exception 'doctor % already has an overlapping appointment', new.doctor_id
        using errcode = '23P01';
    end if;
  end if;

  return new;
end
$function$;

create trigger validate_appointment_integrity
  before insert or update of lead_id, branch_id, doctor_id, scheduled_at,
    duration_minutes, status
  on crm.appointments
  for each row execute function crm.validate_appointment_integrity();

create function crm.validate_treatment_integrity() returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_lead_branch uuid;
  v_lead_deleted_at timestamptz;
  v_appointment crm.appointments%rowtype;
  v_doctor_branch uuid;
  v_doctor_active boolean;
  v_treatment_type_active boolean;
begin
  select l.branch_id, l.deleted_at
  into v_lead_branch, v_lead_deleted_at
  from crm.leads l
  where l.id = new.lead_id;

  if not found then
    raise exception 'lead % not found', new.lead_id
      using errcode = '23503';
  end if;

  if v_lead_deleted_at is not null then
    raise exception 'lead % is deleted', new.lead_id
      using errcode = '55000';
  end if;

  if new.branch_id is distinct from v_lead_branch then
    raise exception 'treatment branch must match lead branch'
      using errcode = '23514';
  end if;

  if new.appointment_id is not null then
    select *
    into v_appointment
    from crm.appointments a
    where a.id = new.appointment_id;

    if not found then
      raise exception 'appointment % not found', new.appointment_id
        using errcode = '23503';
    end if;

    if v_appointment.lead_id is distinct from new.lead_id
       or v_appointment.branch_id is distinct from new.branch_id then
      raise exception 'treatment appointment must belong to the same lead and branch'
        using errcode = '23514';
    end if;

    if v_appointment.status <> 'completed' then
      raise exception 'linked appointment must be completed before treatment is recorded'
        using errcode = '55000';
    end if;

    -- Appointment ownership is the trusted source of doctor attribution.
    if v_appointment.doctor_id is not null then
      new.doctor_id := v_appointment.doctor_id;
    end if;
  end if;

  if new.doctor_id is not null then
    select d.branch_id, d.is_active
    into v_doctor_branch, v_doctor_active
    from crm.doctors d
    where d.id = new.doctor_id;

    if not found then
      raise exception 'doctor % not found', new.doctor_id
        using errcode = '23503';
    end if;

    if not v_doctor_active then
      raise exception 'doctor % is inactive', new.doctor_id
        using errcode = '55000';
    end if;

    if v_doctor_branch is distinct from new.branch_id then
      raise exception 'treatment doctor must belong to the treatment branch'
        using errcode = '23514';
    end if;
  end if;

  if new.treatment_type_id is not null then
    select t.is_active
    into v_treatment_type_active
    from crm.treatment_types t
    where t.id = new.treatment_type_id;

    if not found then
      raise exception 'treatment type % not found', new.treatment_type_id
        using errcode = '23503';
    end if;

    if not v_treatment_type_active then
      raise exception 'treatment type % is inactive', new.treatment_type_id
        using errcode = '55000';
    end if;
  end if;

  return new;
end
$function$;

create trigger validate_treatment_integrity
  before insert or update of lead_id, branch_id, appointment_id,
    treatment_type_id, doctor_id
  on crm.treatments
  for each row execute function crm.validate_treatment_integrity();

create function crm.validate_invoice_integrity() returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_lead_branch uuid;
  v_lead_deleted_at timestamptz;
  v_treatment_lead uuid;
  v_treatment_branch uuid;
begin
  select l.branch_id, l.deleted_at
  into v_lead_branch, v_lead_deleted_at
  from crm.leads l
  where l.id = new.lead_id;

  if not found then
    raise exception 'lead % not found', new.lead_id
      using errcode = '23503';
  end if;

  if v_lead_deleted_at is not null then
    raise exception 'lead % is deleted', new.lead_id
      using errcode = '55000';
  end if;

  if new.branch_id is distinct from v_lead_branch then
    raise exception 'invoice branch must match lead branch'
      using errcode = '23514';
  end if;

  if new.treatment_id is not null then
    select t.lead_id, t.branch_id
    into v_treatment_lead, v_treatment_branch
    from crm.treatments t
    where t.id = new.treatment_id;

    if not found then
      raise exception 'treatment % not found', new.treatment_id
        using errcode = '23503';
    end if;

    if v_treatment_lead is distinct from new.lead_id
       or v_treatment_branch is distinct from new.branch_id then
      raise exception 'invoice treatment must belong to the same lead and branch'
        using errcode = '23514';
    end if;
  end if;

  return new;
end
$function$;

create trigger validate_invoice_integrity
  before insert or update of lead_id, branch_id, treatment_id
  on crm.invoices
  for each row execute function crm.validate_invoice_integrity();

create function crm.normalize_invoice_item() returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.description := btrim(new.description);
  new.amount := round(new.quantity * new.unit_price, 2);
  return new;
end
$function$;

create trigger normalize_invoice_item
  before insert or update of description, quantity, unit_price, amount
  on crm.invoice_items
  for each row execute function crm.normalize_invoice_item();

create function crm.validate_comment_integrity() returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.entity_id is null then
    return new;
  end if;

  case new.entity_type
    when 'lead' then
      if new.entity_id is distinct from new.lead_id then
        raise exception 'lead comment entity must match lead_id'
          using errcode = '23514';
      end if;
    when 'appointment' then
      perform 1 from crm.appointments a
      where a.id = new.entity_id and a.lead_id = new.lead_id;
      if not found then
        raise exception 'comment appointment must belong to lead %', new.lead_id
          using errcode = '23514';
      end if;
    when 'treatment' then
      perform 1 from crm.treatments t
      where t.id = new.entity_id and t.lead_id = new.lead_id;
      if not found then
        raise exception 'comment treatment must belong to lead %', new.lead_id
          using errcode = '23514';
      end if;
    when 'follow_up' then
      perform 1 from crm.follow_ups f
      where f.id = new.entity_id and f.lead_id = new.lead_id;
      if not found then
        raise exception 'comment follow-up must belong to lead %', new.lead_id
          using errcode = '23514';
      end if;
    when 'invoice' then
      perform 1 from crm.invoices i
      where i.id = new.entity_id and i.lead_id = new.lead_id;
      if not found then
        raise exception 'comment invoice must belong to lead %', new.lead_id
          using errcode = '23514';
      end if;
  end case;

  return new;
end
$function$;

create trigger validate_comment_integrity
  before insert or update of lead_id, entity_type, entity_id
  on crm.comments
  for each row execute function crm.validate_comment_integrity();

create function crm.prevent_child_reparenting() returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.lead_id is distinct from old.lead_id
     or new.branch_id is distinct from old.branch_id then
    raise exception 'crm.% records cannot be moved to another lead or branch', tg_table_name
      using errcode = '23514';
  end if;

  return new;
end
$function$;

create trigger prevent_appointment_reparenting
  before update of lead_id, branch_id on crm.appointments
  for each row execute function crm.prevent_child_reparenting();

create trigger prevent_treatment_reparenting
  before update of lead_id, branch_id on crm.treatments
  for each row execute function crm.prevent_child_reparenting();

create trigger prevent_follow_up_reparenting
  before update of lead_id, branch_id on crm.follow_ups
  for each row execute function crm.prevent_child_reparenting();

create trigger prevent_invoice_reparenting
  before update of lead_id, branch_id on crm.invoices
  for each row execute function crm.prevent_child_reparenting();

create trigger prevent_comment_reparenting
  before update of lead_id, branch_id on crm.comments
  for each row execute function crm.prevent_child_reparenting();

-- ------------------------------------------------------------
-- Invoice state/version protection
-- ------------------------------------------------------------

create function crm.bump_invoice_version() returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.version := old.version + 1;
  return new;
end
$function$;

create trigger bump_invoice_version
  before update on crm.invoices
  for each row execute function crm.bump_invoice_version();

create function crm.validate_invoice_update() returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_allowed boolean;
begin
  if old.deleted_at is not null then
    raise exception 'deleted invoice % is immutable', old.id
      using errcode = '55000';
  end if;

  if new.invoice_number is distinct from old.invoice_number
     or new.lead_id is distinct from old.lead_id
     or new.branch_id is distinct from old.branch_id
     or new.treatment_id is distinct from old.treatment_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'invoice identity fields are immutable'
      using errcode = '55000';
  end if;

  if old.status = 'paid'
     and (
       new.subtotal is distinct from old.subtotal
       or new.tax_rate is distinct from old.tax_rate
       or new.tax_amount is distinct from old.tax_amount
       or new.total is distinct from old.total
       or new.issued_at is distinct from old.issued_at
       or new.notes is distinct from old.notes
     ) then
    raise exception 'paid invoice % financial data is immutable', old.id
      using errcode = '55000';
  end if;

  if new.status is distinct from old.status then
    v_allowed := case old.status
      when 'draft' then new.status in ('sent', 'paid')
      when 'sent' then new.status = 'paid'
      else false
    end;

    if not v_allowed then
      raise exception 'illegal invoice transition: % -> %', old.status, new.status
        using errcode = '23514';
    end if;

    if new.status in ('sent', 'paid') then
      new.issued_at := coalesce(old.issued_at, new.issued_at, now());
    end if;

    if new.status = 'paid' then
      new.paid_at := coalesce(old.paid_at, now());
    end if;
  end if;

  return new;
end
$function$;

create trigger validate_invoice_update
  before update on crm.invoices
  for each row execute function crm.validate_invoice_update();

-- ------------------------------------------------------------
-- Replay-safe, atomic lead transitions
--
-- Signature is intentionally unchanged for DAL compatibility.
-- ------------------------------------------------------------

create or replace function crm.transition_lead(
  p_lead_id uuid,
  p_to crm.lead_status,
  p_actor uuid,
  p_payload jsonb default '{}'
) returns crm.leads
language plpgsql
set search_path = ''
as $function$
declare
  v_lead crm.leads%rowtype;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_allowed boolean;
  v_appointment crm.appointments%rowtype;
  v_appointment_id uuid;
  v_assignee crm.profiles%rowtype;
  v_assignee_id uuid;
  v_doctor_id uuid;
  v_actor crm.profiles%rowtype;
begin
  if p_actor is null then
    raise exception 'actor is required'
      using errcode = '22023';
  end if;

  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'transition payload must be a JSON object'
      using errcode = '22023';
  end if;

  select *
  into v_actor
  from crm.profiles p
  where p.id = p_actor;

  if not found or not v_actor.is_active then
    raise exception 'actor % is missing or inactive', p_actor
      using errcode = '42501';
  end if;

  perform set_config('crm.actor_id', p_actor::text, true);

  select *
  into v_lead
  from crm.leads l
  where l.id = p_lead_id
  for update;

  if not found then
    raise exception 'lead % not found', p_lead_id
      using errcode = 'P0002';
  end if;

  if v_lead.deleted_at is not null then
    raise exception 'lead % is deleted', p_lead_id
      using errcode = '55000';
  end if;

  if v_actor.role <> 'admin'
     and not exists (
       select 1
       from crm.user_branches ub
       where ub.user_id = p_actor
         and ub.branch_id = v_lead.branch_id
     ) then
    raise exception 'actor is not allocated to the lead branch'
      using errcode = '42501';
  end if;

  if v_actor.role = 'front_office'
     and v_lead.assignee_id is distinct from p_actor then
    if not (
      v_lead.status = 'open'
      and p_to = 'assigned'
      and nullif(v_payload->>'assignee_id', '') is not null
      and (v_payload->>'assignee_id')::uuid = p_actor
    ) then
      raise exception 'front-office actor does not own this lead'
        using errcode = '42501';
    end if;
  end if;

  if v_actor.role = 'doctor' and p_to <> 'visited_treated' then
    raise exception 'doctor actors may only complete their own booked appointments'
      using errcode = '42501';
  end if;

  -- A replay of an already committed command is a successful no-op.
  -- Crucially, this check happens before any side effects are emitted.
  if v_lead.status = p_to then
    return v_lead;
  end if;

  v_allowed := case v_lead.status
    when 'open'               then p_to in ('assigned', 'dropped')
    when 'assigned'           then p_to in ('open', 'appointment_booked', 'dropped')
    when 'appointment_booked' then p_to in ('visited_treated', 'missed', 'assigned', 'dropped')
    when 'visited_treated'    then p_to in ('follow_up', 'closed', 'dropped')
    when 'follow_up'          then p_to in ('appointment_booked', 'closed', 'dropped')
    when 'missed'             then p_to in ('assigned', 'dropped')
    else false
  end;

  if not v_allowed then
    raise exception 'illegal lead transition: % -> %', v_lead.status, p_to
      using errcode = '23514';
  end if;

  if p_to = 'assigned' then
    if v_lead.status = 'appointment_booked' then
      -- Cancelling a booking returns it to the same owner. A cancellation
      -- payload cannot silently reassign the lead.
      v_assignee_id := v_lead.assignee_id;

      if v_assignee_id is null then
        raise exception 'booked lead has no assignee to preserve'
          using errcode = '23514';
      end if;

      if nullif(v_payload->>'assignee_id', '') is not null
         and (v_payload->>'assignee_id')::uuid is distinct from v_assignee_id then
        raise exception 'appointment cancellation cannot change the lead assignee'
          using errcode = '23514';
      end if;
    else
      if nullif(v_payload->>'assignee_id', '') is null then
        raise exception 'assignee_id is required'
          using errcode = '22023';
      end if;

      v_assignee_id := (v_payload->>'assignee_id')::uuid;
    end if;

    select *
    into v_assignee
    from crm.profiles p
    where p.id = v_assignee_id;

    if not found or not v_assignee.is_active then
      raise exception 'assignee is missing or inactive'
        using errcode = '23514';
    end if;

    if v_assignee.role::text not in
       ('admin', 'operations', 'front_office', 'clinical_head') then
      raise exception 'profile role % cannot own leads', v_assignee.role
        using errcode = '23514';
    end if;

    if v_assignee.role <> 'admin'
       and not exists (
         select 1
         from crm.user_branches ub
         where ub.user_id = v_assignee.id
           and ub.branch_id = v_lead.branch_id
       ) then
      raise exception 'assignee is not allocated to the lead branch'
        using errcode = '23514';
    end if;

    if v_lead.status = 'appointment_booked' then
      if nullif(v_payload->>'cancelled_appointment_id', '') is null then
        raise exception 'cancelled_appointment_id is required when returning a booking to assigned'
          using errcode = '22023';
      end if;

      select *
      into v_appointment
      from crm.appointments a
      where a.id = (v_payload->>'cancelled_appointment_id')::uuid
        and a.lead_id = p_lead_id
      for update;

      if not found then
        raise exception 'appointment does not belong to lead %', p_lead_id
          using errcode = '23514';
      end if;

      if v_appointment.status <> 'scheduled' then
        raise exception 'only a scheduled appointment can be cancelled'
          using errcode = '55000';
      end if;

      -- A lead can have only one live workflow booking. Cancel every live
      -- row in case historical data contains duplicates.
      update crm.appointments
      set status = 'cancelled'
      where lead_id = p_lead_id
        and status = 'scheduled';
    end if;

    update crm.leads
    set assignee_id = v_assignee.id
    where id = p_lead_id;

    insert into crm.lead_activity (lead_id, actor_id, type, detail)
    values (
      p_lead_id,
      p_actor,
      'assignment',
      jsonb_build_object('assignee_id', v_assignee.id)
    );

  elsif p_to = 'appointment_booked' then
    if nullif(v_payload->>'scheduled_at', '') is null then
      raise exception 'scheduled_at is required'
        using errcode = '22023';
    end if;

    update crm.follow_ups
    set status = 'done',
        completed_at = now()
    where lead_id = p_lead_id
      and status = 'pending';

    insert into crm.appointments (
      lead_id,
      doctor_id,
      scheduled_at,
      duration_minutes,
      notes,
      created_by
    )
    values (
      p_lead_id,
      nullif(v_payload->>'doctor_id', '')::uuid,
      (v_payload->>'scheduled_at')::timestamptz,
      coalesce(nullif(v_payload->>'duration_minutes', '')::int, 30),
      nullif(btrim(v_payload->>'notes'), ''),
      p_actor
    )
    returning id into v_appointment_id;

    insert into crm.lead_activity (lead_id, actor_id, type, detail)
    values (
      p_lead_id,
      p_actor,
      'appointment',
      jsonb_build_object(
        'appointment_id', v_appointment_id,
        'scheduled_at', v_payload->>'scheduled_at'
      )
    );

  elsif p_to = 'visited_treated' then
    if v_lead.status = 'appointment_booked'
       and nullif(v_payload->>'appointment_id', '') is null then
      raise exception 'appointment_id is required'
        using errcode = '22023';
    end if;

    if nullif(v_payload->>'appointment_id', '') is not null then
      select *
      into v_appointment
      from crm.appointments a
      where a.id = (v_payload->>'appointment_id')::uuid
        and a.lead_id = p_lead_id
      for update;

      if not found then
        raise exception 'appointment does not belong to lead %', p_lead_id
          using errcode = '23514';
      end if;

      if v_appointment.status <> 'scheduled' then
        raise exception 'only a scheduled appointment can be completed'
          using errcode = '55000';
      end if;

      if v_actor.role = 'doctor'
         and not exists (
           select 1
           from crm.doctors d
           where d.id = v_appointment.doctor_id
             and d.profile_id = p_actor
             and d.is_active
         ) then
        raise exception 'doctor actor does not own this appointment'
          using errcode = '42501';
      end if;

      update crm.appointments
      set status = 'completed'
      where id = v_appointment.id;

      v_doctor_id := coalesce(
        v_appointment.doctor_id,
        nullif(v_payload->>'doctor_id', '')::uuid
      );
    else
      if v_actor.role = 'doctor' then
        raise exception 'doctor completion requires an owned appointment'
          using errcode = '42501';
      end if;

      v_doctor_id := nullif(v_payload->>'doctor_id', '')::uuid;
    end if;

    insert into crm.treatments (
      lead_id,
      appointment_id,
      treatment_type_id,
      doctor_id,
      cost,
      notes,
      created_by
    )
    values (
      p_lead_id,
      nullif(v_payload->>'appointment_id', '')::uuid,
      nullif(v_payload->>'treatment_type_id', '')::uuid,
      v_doctor_id,
      nullif(v_payload->>'cost', '')::numeric,
      nullif(btrim(v_payload->>'notes'), ''),
      p_actor
    );

  elsif p_to = 'missed' then
    if nullif(v_payload->>'appointment_id', '') is null then
      raise exception 'appointment_id is required'
        using errcode = '22023';
    end if;

    select *
    into v_appointment
    from crm.appointments a
    where a.id = (v_payload->>'appointment_id')::uuid
      and a.lead_id = p_lead_id
    for update;

    if not found then
      raise exception 'appointment does not belong to lead %', p_lead_id
        using errcode = '23514';
    end if;

    if v_appointment.status <> 'scheduled' then
      raise exception 'only a scheduled appointment can be marked no-show'
        using errcode = '55000';
    end if;

    update crm.appointments
    set status = 'no_show'
    where id = v_appointment.id;

  elsif p_to = 'follow_up' then
    if nullif(v_payload->>'due_at', '') is null then
      raise exception 'due_at is required'
        using errcode = '22023';
    end if;

    insert into crm.follow_ups (lead_id, due_at, reason, created_by)
    values (
      p_lead_id,
      (v_payload->>'due_at')::timestamptz,
      nullif(btrim(v_payload->>'reason'), ''),
      p_actor
    );

    insert into crm.lead_activity (lead_id, actor_id, type, detail)
    values (
      p_lead_id,
      p_actor,
      'follow_up',
      jsonb_build_object(
        'due_at', v_payload->>'due_at',
        'reason', v_payload->>'reason'
      )
    );

  elsif p_to = 'closed' then
    update crm.follow_ups
    set status = 'cancelled',
        completed_at = coalesce(completed_at, now())
    where lead_id = p_lead_id
      and status = 'pending';

  elsif p_to = 'dropped' then
    update crm.appointments
    set status = 'cancelled'
    where lead_id = p_lead_id
      and status = 'scheduled';

    update crm.follow_ups
    set status = 'cancelled',
        completed_at = coalesce(completed_at, now())
    where lead_id = p_lead_id
      and status = 'pending';

    insert into crm.lead_activity (lead_id, actor_id, type, detail)
    values (
      p_lead_id,
      p_actor,
      'note',
      jsonb_build_object('dropped_reason', v_payload->>'reason')
    );

  elsif p_to = 'open' then
    update crm.leads
    set assignee_id = null
    where id = p_lead_id;
  end if;

  update crm.leads
  set status = p_to
  where id = p_lead_id
  returning * into v_lead;

  return v_lead;
end
$function$;

-- ------------------------------------------------------------
-- Shared authorization and invoice payload validation
-- ------------------------------------------------------------

create function crm.assert_invoice_write_access(
  p_actor uuid,
  p_lead_id uuid,
  p_delete boolean default false
) returns void
language plpgsql
set search_path = ''
as $function$
declare
  v_actor crm.profiles%rowtype;
  v_lead crm.leads%rowtype;
begin
  select *
  into v_actor
  from crm.profiles p
  where p.id = p_actor;

  if not found or not v_actor.is_active then
    raise exception 'actor % is missing or inactive', p_actor
      using errcode = '42501';
  end if;

  select *
  into v_lead
  from crm.leads l
  where l.id = p_lead_id;

  if not found then
    raise exception 'lead % not found', p_lead_id
      using errcode = 'P0002';
  end if;

  if v_lead.deleted_at is not null then
    raise exception 'lead % is deleted', p_lead_id
      using errcode = '55000';
  end if;

  if p_delete and v_actor.role::text not in ('admin', 'operations') then
    raise exception 'only admin or operations may delete invoices'
      using errcode = '42501';
  end if;

  if not p_delete
     and v_actor.role::text not in
       ('admin', 'operations', 'front_office', 'clinical_head') then
    raise exception 'role % cannot mutate invoices', v_actor.role
      using errcode = '42501';
  end if;

  if v_actor.role <> 'admin'
     and not exists (
       select 1
       from crm.user_branches ub
       where ub.user_id = p_actor
         and ub.branch_id = v_lead.branch_id
     ) then
    raise exception 'actor is not allocated to the invoice branch'
      using errcode = '42501';
  end if;

  if v_actor.role = 'front_office'
     and v_lead.assignee_id is distinct from p_actor then
    raise exception 'front-office actor does not own this lead'
      using errcode = '42501';
  end if;

  return;
end
$function$;

create function crm.invoice_items_subtotal(p_items jsonb) returns numeric
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_item jsonb;
  v_description text;
  v_quantity numeric;
  v_unit_price numeric;
  v_amount numeric;
  v_subtotal numeric := 0;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'invoice items must be a JSON array'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'invoice must contain between 1 and 100 line items'
      using errcode = '22023';
  end if;

  for v_item in
    select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or jsonb_typeof(v_item->'quantity') is distinct from 'number'
       or jsonb_typeof(v_item->'unit_price') is distinct from 'number' then
      raise exception 'each invoice item must contain numeric quantity and unit_price'
        using errcode = '22023';
    end if;

    v_description := btrim(coalesce(v_item->>'description', ''));
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;

    if length(v_description) not between 1 and 500 then
      raise exception 'invoice item description must contain 1 to 500 characters'
        using errcode = '22023';
    end if;

    if v_quantity <= 0
       or v_quantity > 999999.99
       or v_quantity <> round(v_quantity, 2) then
      raise exception 'invoice item quantity is out of range'
        using errcode = '22023';
    end if;

    if v_unit_price < 0
       or v_unit_price > 99999999.99
       or v_unit_price <> round(v_unit_price, 2) then
      raise exception 'invoice item unit_price is out of range'
        using errcode = '22023';
    end if;

    v_amount := round(v_quantity * v_unit_price, 2);
    if v_amount > 9999999999.99 then
      raise exception 'invoice item amount is out of range'
        using errcode = '22003';
    end if;

    v_subtotal := v_subtotal + v_amount;
    if v_subtotal > 9999999999.99 then
      raise exception 'invoice subtotal is out of range'
        using errcode = '22003';
    end if;
  end loop;

  return v_subtotal;
end
$function$;

create function crm.guard_invoice_item_mutation() returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_invoice_id uuid;
  v_status crm.invoice_status;
  v_deleted_at timestamptz;
begin
  v_invoice_id := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;

  select i.status, i.deleted_at
  into v_status, v_deleted_at
  from crm.invoices i
  where i.id = v_invoice_id;

  if not found then
    if tg_op = 'DELETE'
       and current_setting('crm.allow_hard_delete', true) = 'on' then
      return old;
    end if;

    raise exception 'invoice % not found', v_invoice_id
      using errcode = '23503';
  end if;

  if current_setting('crm.allow_hard_delete', true) is distinct from 'on'
     and (v_status = 'paid' or v_deleted_at is not null) then
    raise exception 'items of a paid or deleted invoice are immutable'
      using errcode = '55000';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

create trigger guard_invoice_item_mutation
  before insert or update or delete on crm.invoice_items
  for each row execute function crm.guard_invoice_item_mutation();

-- ------------------------------------------------------------
-- Transactional invoice RPCs
-- ------------------------------------------------------------

create function crm.create_invoice(
  p_lead_id uuid,
  p_treatment_id uuid,
  p_tax_rate numeric,
  p_notes text,
  p_items jsonb,
  p_actor uuid
) returns crm.invoices
language plpgsql
set search_path = ''
as $function$
declare
  v_lead crm.leads%rowtype;
  v_invoice crm.invoices%rowtype;
  v_item jsonb;
  v_subtotal numeric;
  v_tax_rate numeric := coalesce(p_tax_rate, 0);
  v_tax_amount numeric;
  v_total numeric;
  v_invoice_number text;
begin
  perform crm.assert_invoice_write_access(p_actor, p_lead_id, false);

  if v_tax_rate < 0
     or v_tax_rate > 100
     or v_tax_rate <> round(v_tax_rate, 2) then
    raise exception 'tax_rate must be between 0 and 100 with at most two decimals'
      using errcode = '22023';
  end if;

  v_subtotal := crm.invoice_items_subtotal(p_items);
  v_tax_amount := round(v_subtotal * v_tax_rate / 100, 2);
  v_total := v_subtotal + v_tax_amount;

  if v_total > 9999999999.99 then
    raise exception 'invoice total is out of range'
      using errcode = '22003';
  end if;

  select *
  into v_lead
  from crm.leads l
  where l.id = p_lead_id
  for update;

  -- Number allocation is in this same transaction. Any later failure also
  -- rolls the counter increment back.
  v_invoice_number := crm.next_invoice_number(v_lead.branch_id);

  insert into crm.invoices (
    invoice_number,
    lead_id,
    treatment_id,
    status,
    subtotal,
    tax_rate,
    tax_amount,
    total,
    notes,
    created_by
  )
  values (
    v_invoice_number,
    p_lead_id,
    p_treatment_id,
    'draft',
    v_subtotal,
    v_tax_rate,
    v_tax_amount,
    v_total,
    nullif(btrim(p_notes), ''),
    p_actor
  )
  returning * into v_invoice;

  for v_item in
    select value from jsonb_array_elements(p_items)
  loop
    insert into crm.invoice_items (
      invoice_id,
      description,
      quantity,
      unit_price
    )
    values (
      v_invoice.id,
      btrim(v_item->>'description'),
      (v_item->>'quantity')::numeric,
      (v_item->>'unit_price')::numeric
    );
  end loop;

  insert into crm.lead_activity (lead_id, actor_id, type, detail)
  values (
    p_lead_id,
    p_actor,
    'invoice',
    jsonb_build_object(
      'event', 'invoice_created',
      'invoice_id', v_invoice.id,
      'invoice_number', v_invoice.invoice_number,
      'total', v_invoice.total
    )
  );

  insert into crm.audit_log (
    entity_type,
    entity_id,
    action,
    actor_id,
    new_data
  )
  values (
    'invoice',
    v_invoice.id,
    'created',
    p_actor,
    to_jsonb(v_invoice)
  );

  return v_invoice;
end
$function$;

create function crm.update_invoice(
  p_invoice_id uuid,
  p_tax_rate numeric,
  p_notes text,
  p_items jsonb,
  p_actor uuid,
  p_expected_version bigint default null
) returns crm.invoices
language plpgsql
set search_path = ''
as $function$
declare
  v_old crm.invoices%rowtype;
  v_invoice crm.invoices%rowtype;
  v_item jsonb;
  v_subtotal numeric;
  v_tax_rate numeric := coalesce(p_tax_rate, 0);
  v_tax_amount numeric;
  v_total numeric;
begin
  select *
  into v_old
  from crm.invoices i
  where i.id = p_invoice_id
  for update;

  if not found then
    raise exception 'invoice % not found', p_invoice_id
      using errcode = 'P0002';
  end if;

  if v_old.deleted_at is not null then
    raise exception 'invoice % is deleted', p_invoice_id
      using errcode = '55000';
  end if;

  perform crm.assert_invoice_write_access(p_actor, v_old.lead_id, false);

  if p_expected_version is not null
     and p_expected_version <> v_old.version then
    raise exception 'invoice % was modified by another request', p_invoice_id
      using errcode = '40001';
  end if;

  if v_old.status = 'paid' then
    raise exception 'paid invoice % cannot be edited', p_invoice_id
      using errcode = '55000';
  end if;

  if v_tax_rate < 0
     or v_tax_rate > 100
     or v_tax_rate <> round(v_tax_rate, 2) then
    raise exception 'tax_rate must be between 0 and 100 with at most two decimals'
      using errcode = '22023';
  end if;

  v_subtotal := crm.invoice_items_subtotal(p_items);
  v_tax_amount := round(v_subtotal * v_tax_rate / 100, 2);
  v_total := v_subtotal + v_tax_amount;

  if v_total > 9999999999.99 then
    raise exception 'invoice total is out of range'
      using errcode = '22003';
  end if;

  update crm.invoices
  set subtotal = v_subtotal,
      tax_rate = v_tax_rate,
      tax_amount = v_tax_amount,
      total = v_total,
      notes = nullif(btrim(p_notes), '')
  where id = p_invoice_id
  returning * into v_invoice;

  delete from crm.invoice_items
  where invoice_id = p_invoice_id;

  for v_item in
    select value from jsonb_array_elements(p_items)
  loop
    insert into crm.invoice_items (
      invoice_id,
      description,
      quantity,
      unit_price
    )
    values (
      p_invoice_id,
      btrim(v_item->>'description'),
      (v_item->>'quantity')::numeric,
      (v_item->>'unit_price')::numeric
    );
  end loop;

  insert into crm.lead_activity (lead_id, actor_id, type, detail)
  values (
    v_invoice.lead_id,
    p_actor,
    'invoice',
    jsonb_build_object(
      'event', 'invoice_updated',
      'invoice_id', v_invoice.id,
      'invoice_number', v_invoice.invoice_number,
      'total', v_invoice.total
    )
  );

  insert into crm.audit_log (
    entity_type,
    entity_id,
    action,
    actor_id,
    old_data,
    new_data
  )
  values (
    'invoice',
    v_invoice.id,
    'updated',
    p_actor,
    to_jsonb(v_old),
    to_jsonb(v_invoice)
  );

  return v_invoice;
end
$function$;

create function crm.transition_invoice_status(
  p_invoice_id uuid,
  p_to crm.invoice_status,
  p_actor uuid,
  p_expected_version bigint default null
) returns crm.invoices
language plpgsql
set search_path = ''
as $function$
declare
  v_old crm.invoices%rowtype;
  v_invoice crm.invoices%rowtype;
begin
  select *
  into v_old
  from crm.invoices i
  where i.id = p_invoice_id
  for update;

  if not found then
    raise exception 'invoice % not found', p_invoice_id
      using errcode = 'P0002';
  end if;

  if v_old.deleted_at is not null then
    raise exception 'invoice % is deleted', p_invoice_id
      using errcode = '55000';
  end if;

  perform crm.assert_invoice_write_access(p_actor, v_old.lead_id, false);

  if p_expected_version is not null
     and p_expected_version <> v_old.version then
    raise exception 'invoice % was modified by another request', p_invoice_id
      using errcode = '40001';
  end if;

  if v_old.status = p_to then
    return v_old;
  end if;

  update crm.invoices
  set status = p_to
  where id = p_invoice_id
  returning * into v_invoice;

  insert into crm.lead_activity (lead_id, actor_id, type, detail)
  values (
    v_invoice.lead_id,
    p_actor,
    'invoice',
    jsonb_build_object(
      'event', 'invoice_status_changed',
      'invoice_id', v_invoice.id,
      'invoice_number', v_invoice.invoice_number,
      'from_status', v_old.status,
      'to_status', v_invoice.status
    )
  );

  insert into crm.audit_log (
    entity_type,
    entity_id,
    action,
    actor_id,
    old_data,
    new_data
  )
  values (
    'invoice',
    v_invoice.id,
    'status_changed',
    p_actor,
    to_jsonb(v_old),
    to_jsonb(v_invoice)
  );

  return v_invoice;
end
$function$;

create function crm.delete_invoice(
  p_invoice_id uuid,
  p_actor uuid,
  p_reason text default 'Deleted by user',
  p_expected_version bigint default null
) returns crm.invoices
language plpgsql
set search_path = ''
as $function$
declare
  v_old crm.invoices%rowtype;
  v_invoice crm.invoices%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select *
  into v_old
  from crm.invoices i
  where i.id = p_invoice_id
  for update;

  if not found then
    raise exception 'invoice % not found', p_invoice_id
      using errcode = 'P0002';
  end if;

  perform crm.assert_invoice_write_access(p_actor, v_old.lead_id, true);

  if v_old.deleted_at is not null then
    return v_old;
  end if;

  if p_expected_version is not null
     and p_expected_version <> v_old.version then
    raise exception 'invoice % was modified by another request', p_invoice_id
      using errcode = '40001';
  end if;

  if length(v_reason) not between 1 and 500 then
    raise exception 'delete reason must contain 1 to 500 characters'
      using errcode = '22023';
  end if;

  if v_old.status = 'paid' then
    raise exception 'paid invoice % cannot be deleted; use a separately audited refund/credit workflow', p_invoice_id
      using errcode = '55000';
  end if;

  update crm.invoices
  set deleted_at = now(),
      deleted_by = p_actor,
      delete_reason = v_reason
  where id = p_invoice_id
  returning * into v_invoice;

  insert into crm.lead_activity (lead_id, actor_id, type, detail)
  values (
    v_invoice.lead_id,
    p_actor,
    'invoice',
    jsonb_build_object(
      'event', 'invoice_deleted',
      'invoice_id', v_invoice.id,
      'invoice_number', v_invoice.invoice_number,
      'reason', v_reason
    )
  );

  insert into crm.audit_log (
    entity_type,
    entity_id,
    action,
    actor_id,
    old_data,
    new_data
  )
  values (
    'invoice',
    v_invoice.id,
    'soft_deleted',
    p_actor,
    to_jsonb(v_old),
    to_jsonb(v_invoice)
  );

  return v_invoice;
end
$function$;

-- ------------------------------------------------------------
-- Lead soft deletion
-- ------------------------------------------------------------

create function crm.soft_delete_lead(
  p_lead_id uuid,
  p_actor uuid,
  p_reason text
) returns crm.leads
language plpgsql
set search_path = ''
as $function$
declare
  v_old crm.leads%rowtype;
  v_lead crm.leads%rowtype;
  v_actor crm.profiles%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select *
  into v_old
  from crm.leads l
  where l.id = p_lead_id
  for update;

  if not found then
    raise exception 'lead % not found', p_lead_id
      using errcode = 'P0002';
  end if;

  select *
  into v_actor
  from crm.profiles p
  where p.id = p_actor;

  if not found or not v_actor.is_active then
    raise exception 'actor % is missing or inactive', p_actor
      using errcode = '42501';
  end if;

  if v_actor.role::text not in ('admin', 'operations') then
    raise exception 'only admin or operations may delete leads'
      using errcode = '42501';
  end if;

  if v_actor.role <> 'admin'
     and not exists (
       select 1
       from crm.user_branches ub
       where ub.user_id = p_actor
         and ub.branch_id = v_old.branch_id
     ) then
    raise exception 'actor is not allocated to the lead branch'
      using errcode = '42501';
  end if;

  if v_old.deleted_at is not null then
    return v_old;
  end if;

  if length(v_reason) not between 1 and 500 then
    raise exception 'delete reason must contain 1 to 500 characters'
      using errcode = '22023';
  end if;

  update crm.appointments
  set status = 'cancelled'
  where lead_id = p_lead_id
    and status = 'scheduled';

  update crm.follow_ups
  set status = 'cancelled',
      completed_at = coalesce(completed_at, now())
  where lead_id = p_lead_id
    and status = 'pending';

  update crm.leads
  set deleted_at = now(),
      deleted_by = p_actor,
      delete_reason = v_reason
  where id = p_lead_id
  returning * into v_lead;

  insert into crm.lead_activity (lead_id, actor_id, type, detail)
  values (
    p_lead_id,
    p_actor,
    'note',
    jsonb_build_object('event', 'lead_deleted', 'reason', v_reason)
  );

  insert into crm.audit_log (
    entity_type,
    entity_id,
    action,
    actor_id,
    old_data,
    new_data
  )
  values (
    'lead',
    p_lead_id,
    'soft_deleted',
    p_actor,
    to_jsonb(v_old),
    to_jsonb(v_lead)
  );

  return v_lead;
end
$function$;

-- Reject new child records for deleted leads. Activity is exempt so the
-- deletion itself can retain a durable, user-facing timeline entry.
create or replace function crm.copy_branch_from_lead() returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_deleted_at timestamptz;
begin
  select l.branch_id, l.deleted_at
  into new.branch_id, v_deleted_at
  from crm.leads l
  where l.id = new.lead_id;

  if not found then
    raise exception 'lead % not found', new.lead_id
      using errcode = '23503';
  end if;

  if v_deleted_at is not null and tg_table_name <> 'lead_activity' then
    raise exception 'lead % is deleted', new.lead_id
      using errcode = '55000';
  end if;

  return new;
end
$function$;

-- ------------------------------------------------------------
-- Targeted indexes for live-workflow filters and reporting joins
-- ------------------------------------------------------------

create index leads_live_branch_status_created_idx
  on crm.leads (branch_id, status, created_at desc)
  where deleted_at is null;

create index leads_live_assignee_status_idx
  on crm.leads (assignee_id, status, created_at desc)
  where deleted_at is null and assignee_id is not null;

create index appointments_doctor_live_schedule_idx
  on crm.appointments (doctor_id, scheduled_at)
  where status = 'scheduled' and doctor_id is not null;

create index appointments_lead_live_idx
  on crm.appointments (lead_id, scheduled_at desc)
  where status = 'scheduled';

create index treatments_doctor_treated_at_idx
  on crm.treatments (doctor_id, treated_at desc)
  where doctor_id is not null;

create index invoices_live_branch_status_created_idx
  on crm.invoices (branch_id, status, created_at desc)
  where deleted_at is null;

create index invoices_live_lead_created_idx
  on crm.invoices (lead_id, created_at desc)
  where deleted_at is null;

create index lead_activity_branch_created_idx
  on crm.lead_activity (branch_id, created_at desc);

create index user_branches_branch_user_idx
  on crm.user_branches (branch_id, user_id);

-- ------------------------------------------------------------
-- RLS defense in depth
--
-- No anon/authenticated policies are created. The server's service_role
-- remains the sole data path and bypasses RLS, while an accidental future
-- table grant still exposes no rows to browser roles.
-- ------------------------------------------------------------

alter table crm.branches enable row level security;
alter table crm.profiles enable row level security;
alter table crm.user_branches enable row level security;
alter table crm.lead_sources enable row level security;
alter table crm.doctors enable row level security;
alter table crm.treatment_types enable row level security;
alter table crm.leads enable row level security;
alter table crm.appointments enable row level security;
alter table crm.treatments enable row level security;
alter table crm.follow_ups enable row level security;
alter table crm.invoice_counters enable row level security;
alter table crm.invoices enable row level security;
alter table crm.invoice_items enable row level security;
alter table crm.lead_activity enable row level security;
alter table crm.comments enable row level security;
alter table crm.audit_log enable row level security;

-- ------------------------------------------------------------
-- Explicit privilege lockdown
-- ------------------------------------------------------------

revoke all on schema crm from public, anon, authenticated;
grant usage on schema crm to service_role;

revoke all on all tables in schema crm from public, anon, authenticated;
revoke all on all sequences in schema crm from public, anon, authenticated;
revoke execute on all functions in schema crm from public, anon, authenticated;

grant all on all tables in schema crm to service_role;
grant all on all sequences in schema crm to service_role;
grant execute on all functions in schema crm to service_role;

alter default privileges in schema crm
  revoke all on tables from public, anon, authenticated;
alter default privileges in schema crm
  revoke all on sequences from public, anon, authenticated;
alter default privileges in schema crm
  revoke execute on functions from public, anon, authenticated;

alter default privileges in schema crm
  grant all on tables to service_role;
alter default privileges in schema crm
  grant all on sequences to service_role;
alter default privileges in schema crm
  grant execute on functions to service_role;
