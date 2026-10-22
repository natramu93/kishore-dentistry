-- All visits use the normal appointment workflow. Legacy reminder rows and
-- statuses remain readable; this migration neither deletes history nor
-- creates appointments from old reminders.
create or replace function crm.validate_lead_transition()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  allowed boolean;
begin
  if tg_op = 'INSERT' then
    if new.status = 'follow_up' then
      raise exception 'Follow-up scheduling has been retired. Use Book appointment.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status = new.status then return new; end if;
  allowed := case old.status
    when 'open' then new.status in ('assigned', 'dropped')
    when 'assigned' then new.status in ('open', 'appointment_booked', 'dropped')
    when 'appointment_booked' then new.status in ('visited_treated', 'missed', 'assigned', 'dropped')
    when 'visited_treated' then new.status in ('appointment_booked', 'dropped')
    when 'follow_up' then new.status in ('appointment_booked', 'dropped')
    when 'missed' then new.status in ('assigned', 'dropped')
    else false
  end;
  if not allowed then
    raise exception 'illegal lead transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;
  new.status_changed_at := now();
  return new;
end
$function$;

drop trigger validate_transition on crm.leads;
create trigger validate_transition
  before insert or update of status on crm.leads
  for each row execute function crm.validate_lead_transition();

-- Preserve every existing authorization and appointment/clinical integrity
-- check in the RPC; only the retired reminder branches are removed.
CREATE OR REPLACE FUNCTION crm.transition_lead(p_lead_id uuid, p_to crm.lead_status, p_actor uuid, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS crm.leads
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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

  if p_to = 'follow_up' then
    raise exception 'Follow-up scheduling has been retired. Use Book appointment.'
      using errcode = '23514';
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
    when 'visited_treated'    then p_to in ('appointment_booked', 'dropped')
    when 'follow_up'          then p_to in ('appointment_booked', 'dropped')
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
      coalesce(nullif(v_payload->>'duration_minutes', '')::int, 15),
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

  elsif p_to = 'dropped' then
    update crm.appointments
    set status = 'cancelled'
    where lead_id = p_lead_id
      and status = 'scheduled';

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

-- The application may read old reminders, but cannot create, complete, cancel,
-- or delete them. Booking/drop actions no longer mutate these historical rows.
revoke all on crm.follow_ups from public, anon, authenticated, service_role;
grant select on crm.follow_ups to service_role;
revoke all on function crm.validate_lead_transition() from public, anon, authenticated;
revoke all on function crm.transition_lead(uuid, crm.lead_status, uuid, jsonb) from public, anon, authenticated;
grant execute on function crm.transition_lead(uuid, crm.lead_status, uuid, jsonb) to service_role;
