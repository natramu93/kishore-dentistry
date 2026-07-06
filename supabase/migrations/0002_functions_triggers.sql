-- ============================================================
-- 0002_functions_triggers.sql — triggers, transition rules, RPCs
-- ============================================================

-- ------------------------------------------------------------
-- updated_at maintenance
-- ------------------------------------------------------------
create function crm.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger set_updated_at before update on crm.branches      for each row execute function crm.set_updated_at();
create trigger set_updated_at before update on crm.profiles      for each row execute function crm.set_updated_at();
create trigger set_updated_at before update on crm.doctors       for each row execute function crm.set_updated_at();
create trigger set_updated_at before update on crm.leads         for each row execute function crm.set_updated_at();
create trigger set_updated_at before update on crm.appointments  for each row execute function crm.set_updated_at();
create trigger set_updated_at before update on crm.invoices      for each row execute function crm.set_updated_at();
create trigger set_updated_at before update on crm.comments      for each row execute function crm.set_updated_at();

-- ------------------------------------------------------------
-- Profile auto-creation on auth signup
-- ------------------------------------------------------------
create function crm.handle_new_user() returns trigger
language plpgsql security definer set search_path = crm, public as $$
begin
  insert into crm.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function crm.handle_new_user();

-- ------------------------------------------------------------
-- Denormalized branch_id: always copied from the parent lead
-- ------------------------------------------------------------
create function crm.copy_branch_from_lead() returns trigger
language plpgsql as $$
begin
  select branch_id into new.branch_id from crm.leads where id = new.lead_id;
  if new.branch_id is null then
    raise exception 'lead % not found', new.lead_id;
  end if;
  return new;
end $$;

create trigger copy_branch before insert on crm.appointments  for each row execute function crm.copy_branch_from_lead();
create trigger copy_branch before insert on crm.treatments    for each row execute function crm.copy_branch_from_lead();
create trigger copy_branch before insert on crm.follow_ups    for each row execute function crm.copy_branch_from_lead();
create trigger copy_branch before insert on crm.invoices      for each row execute function crm.copy_branch_from_lead();
create trigger copy_branch before insert on crm.lead_activity for each row execute function crm.copy_branch_from_lead();
create trigger copy_branch before insert on crm.comments      for each row execute function crm.copy_branch_from_lead();

-- ------------------------------------------------------------
-- Lead status transition validation (defense in depth — the app
-- layer enforces the same map in src/lib/leads/transitions.ts)
-- ------------------------------------------------------------
create function crm.validate_lead_transition() returns trigger
language plpgsql as $$
declare
  allowed boolean;
begin
  if old.status = new.status then
    return new;
  end if;

  allowed := case old.status
    when 'open'               then new.status in ('assigned','dropped')
    when 'assigned'           then new.status in ('open','appointment_booked','dropped')
    when 'appointment_booked' then new.status in ('visited_treated','missed','assigned','dropped')
    when 'visited_treated'    then new.status in ('follow_up','closed','dropped')
    when 'follow_up'          then new.status in ('appointment_booked','closed','dropped')
    when 'missed'             then new.status in ('assigned','dropped')
    else false  -- closed / dropped are terminal
  end;

  if not allowed then
    raise exception 'illegal lead transition: % -> %', old.status, new.status;
  end if;

  new.status_changed_at = now();
  return new;
end $$;

create trigger validate_transition before update of status on crm.leads
  for each row execute function crm.validate_lead_transition();

-- Activity log for status changes. The acting user is passed by the app
-- through a transaction-local setting (see crm.transition_lead).
create function crm.log_status_change() returns trigger
language plpgsql as $$
begin
  if old.status is distinct from new.status then
    insert into crm.lead_activity (lead_id, actor_id, type, from_status, to_status)
    values (new.id, nullif(current_setting('crm.actor_id', true), '')::uuid,
            'status_change', old.status, new.status);
  end if;
  return new;
end $$;

create trigger log_status_change after update of status on crm.leads
  for each row execute function crm.log_status_change();

-- ------------------------------------------------------------
-- Invoice numbering: {branch.code}-{year}-{seq}, gap-free per branch
-- ------------------------------------------------------------
create function crm.next_invoice_number(p_branch_id uuid) returns text
language plpgsql as $$
declare
  v_code text;
  v_year int := extract(year from now() at time zone 'Asia/Kolkata')::int;
  v_no int;
begin
  select code into v_code from crm.branches where id = p_branch_id;
  if v_code is null then
    raise exception 'branch % not found', p_branch_id;
  end if;

  insert into crm.invoice_counters (branch_id, year, last_no)
  values (p_branch_id, v_year, 1)
  on conflict (branch_id, year)
  do update set last_no = crm.invoice_counters.last_no + 1
  returning last_no into v_no;

  return v_code || '-' || v_year || '-' || lpad(v_no::text, 4, '0');
end $$;

-- ------------------------------------------------------------
-- Atomic lead transition with stage side effects.
-- The app authorizes BEFORE calling this; the RPC guarantees the
-- compound write is atomic and the transition map is respected.
-- ------------------------------------------------------------
create function crm.transition_lead(
  p_lead_id uuid,
  p_to crm.lead_status,
  p_actor uuid,
  p_payload jsonb default '{}'
) returns crm.leads
language plpgsql as $$
declare
  v_lead crm.leads;
  v_appt_id uuid;
begin
  perform set_config('crm.actor_id', coalesce(p_actor::text, ''), true);

  select * into v_lead from crm.leads where id = p_lead_id for update;
  if v_lead.id is null then
    raise exception 'lead % not found', p_lead_id;
  end if;

  -- Stage side effects (before the status update so triggers see final state)
  if p_to = 'assigned' then
    update crm.leads set assignee_id = (p_payload->>'assignee_id')::uuid where id = p_lead_id;
    insert into crm.lead_activity (lead_id, actor_id, type, detail)
    values (p_lead_id, p_actor, 'assignment', jsonb_build_object('assignee_id', p_payload->>'assignee_id'));

  elsif p_to = 'appointment_booked' then
    -- close any pending follow-up being converted into a booking
    update crm.follow_ups set status = 'done', completed_at = now()
    where lead_id = p_lead_id and status = 'pending';

    insert into crm.appointments (lead_id, doctor_id, scheduled_at, duration_minutes, notes, created_by)
    values (p_lead_id,
            nullif(p_payload->>'doctor_id','')::uuid,
            (p_payload->>'scheduled_at')::timestamptz,
            coalesce((p_payload->>'duration_minutes')::int, 30),
            p_payload->>'notes',
            p_actor)
    returning id into v_appt_id;
    insert into crm.lead_activity (lead_id, actor_id, type, detail)
    values (p_lead_id, p_actor, 'appointment', jsonb_build_object('appointment_id', v_appt_id, 'scheduled_at', p_payload->>'scheduled_at'));

  elsif p_to = 'visited_treated' then
    -- mark the appointment completed and record the treatment
    if p_payload ? 'appointment_id' then
      update crm.appointments set status = 'completed'
      where id = (p_payload->>'appointment_id')::uuid and lead_id = p_lead_id;
    end if;
    insert into crm.treatments (lead_id, appointment_id, treatment_type_id, doctor_id, cost, notes, created_by)
    values (p_lead_id,
            nullif(p_payload->>'appointment_id','')::uuid,
            nullif(p_payload->>'treatment_type_id','')::uuid,
            nullif(p_payload->>'doctor_id','')::uuid,
            nullif(p_payload->>'cost','')::numeric,
            p_payload->>'notes',
            p_actor);

  elsif p_to = 'missed' then
    if p_payload ? 'appointment_id' then
      update crm.appointments set status = 'no_show'
      where id = (p_payload->>'appointment_id')::uuid and lead_id = p_lead_id;
    end if;

  elsif p_to = 'follow_up' then
    insert into crm.follow_ups (lead_id, due_at, reason, created_by)
    values (p_lead_id, (p_payload->>'due_at')::timestamptz, p_payload->>'reason', p_actor);
    insert into crm.lead_activity (lead_id, actor_id, type, detail)
    values (p_lead_id, p_actor, 'follow_up', jsonb_build_object('due_at', p_payload->>'due_at', 'reason', p_payload->>'reason'));

  elsif p_to = 'closed' then
    update crm.follow_ups set status = 'cancelled'
    where lead_id = p_lead_id and status = 'pending';

  elsif p_to = 'dropped' then
    if p_payload ? 'appointment_id' then
      update crm.appointments set status = 'cancelled'
      where id = (p_payload->>'appointment_id')::uuid and lead_id = p_lead_id;
    end if;
    update crm.follow_ups set status = 'cancelled'
    where lead_id = p_lead_id and status = 'pending';
    insert into crm.lead_activity (lead_id, actor_id, type, detail)
    values (p_lead_id, p_actor, 'note', jsonb_build_object('dropped_reason', p_payload->>'reason'));

  elsif p_to = 'open' then
    update crm.leads set assignee_id = null where id = p_lead_id;
  end if;

  -- cancelling an appointment sends the lead back to 'assigned'
  if p_to = 'assigned' and (p_payload ? 'cancelled_appointment_id') then
    update crm.appointments set status = 'cancelled'
    where id = (p_payload->>'cancelled_appointment_id')::uuid and lead_id = p_lead_id;
  end if;

  update crm.leads set status = p_to where id = p_lead_id
  returning * into v_lead;

  return v_lead;
end $$;
