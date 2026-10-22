-- Rollback-only fixtures: no real patients, appointments, or reminders changed.
begin;
select '1..1';

do $test$
declare
  v_admin uuid := 'c2800000-0000-4000-8000-000000000001';
  v_ops uuid := 'c2800000-0000-4000-8000-000000000002';
  v_front uuid := 'c2800000-0000-4000-8000-000000000003';
  v_outsider uuid := 'c2800000-0000-4000-8000-000000000004';
  v_branch uuid; v_doctor uuid; v_other_branch uuid; v_other_doctor uuid;
  v_actor uuid; v_lead uuid; v_past uuid; v_appointment uuid;
  v_legacy uuid[] := '{}'; v_index int := 0;
  v_status crm.lead_status; v_rejected boolean;
  v_sheet crm.case_sheets%rowtype;
  v_time timestamptz := '2046-01-16 23:30:00+05:30';
begin
  if not has_table_privilege('service_role','crm.follow_ups','select')
    or has_table_privilege('service_role','crm.follow_ups','insert')
    or has_table_privilege('service_role','crm.follow_ups','update')
    or has_table_privilege('service_role','crm.follow_ups','delete')
    or has_table_privilege('anon','crm.follow_ups','select')
    or has_table_privilege('authenticated','crm.follow_ups','select')
    or has_function_privilege('anon','crm.transition_lead(uuid,crm.lead_status,uuid,jsonb)','execute')
    or has_function_privilege('authenticated','crm.transition_lead(uuid,crm.lead_status,uuid,jsonb)','execute') then
    raise exception 'legacy reminder or transition privileges are unsafe';
  end if;

  insert into auth.users(id,email,raw_user_meta_data) values
    (v_admin,'booking-only-admin@example.test','{"full_name":"Booking Admin"}'),
    (v_ops,'booking-only-ops@example.test','{"full_name":"Booking Ops"}'),
    (v_front,'booking-only-front@example.test','{"full_name":"Booking Front Desk"}'),
    (v_outsider,'booking-only-outsider@example.test','{"full_name":"Other Center Ops"}');
  update crm.profiles set role='admin',is_active=true where id=v_admin;
  update crm.profiles set role='operations',is_active=true where id in(v_ops,v_outsider);
  update crm.profiles set role='front_office',is_active=true where id=v_front;
  insert into crm.branches(name,code) values('Booking Only Test','B27') returning id into v_branch;
  insert into crm.branches(name,code) values('Other Booking Only Test','C27') returning id into v_other_branch;
  insert into crm.user_branches(user_id,branch_id) values(v_ops,v_branch),(v_front,v_branch),(v_outsider,v_other_branch);
  insert into crm.doctors(branch_id,full_name) values(v_branch,'Dr. Booking Only') returning id into v_doctor;
  insert into crm.doctors(branch_id,full_name) values(v_other_branch,'Dr. Other Booking') returning id into v_other_doctor;

  -- Seed pre-retirement history as postgres, never through the app role.
  -- The trigger is re-enabled immediately, and the entire test rolls back.
  alter table crm.leads disable trigger validate_transition;
  foreach v_actor in array array[v_admin,v_ops,v_front] loop
    insert into crm.leads(branch_id,name,mobile,status,assignee_id,created_by)
      values(v_branch,'Legacy Reminder Patient','9000000028','follow_up',v_front,v_admin) returning id into v_lead;
    v_legacy := array_append(v_legacy,v_lead);
    insert into crm.follow_ups(lead_id,due_at,reason,created_by)
      values(v_lead,'2030-01-16T09:00:00Z','Historical review reminder',v_admin);
  end loop;
  alter table crm.leads enable trigger validate_transition;

  execute 'set local role service_role';
  foreach v_actor in array array[v_admin,v_ops,v_front] loop
    v_index := v_index+1;
    foreach v_status in array array['assigned','visited_treated','follow_up']::crm.lead_status[] loop
      if v_status='follow_up' then
        v_lead := v_legacy[v_index];
        v_rejected := false;
        begin perform crm.transition_lead(v_lead,'follow_up',v_actor,jsonb_build_object('due_at',v_time));
        exception when check_violation then v_rejected := true; end;
        if not v_rejected then raise exception 'legacy same-state reminder replay accepted'; end if;
      else
        insert into crm.leads(branch_id,name,mobile,status,assignee_id,created_by)
          values(v_branch,'Returning Booking Patient','9000000029',v_status,v_front,v_admin) returning id into v_lead;
      end if;
      insert into crm.appointments(lead_id,doctor_id,scheduled_at,status,notes,created_by)
        values(v_lead,v_doctor,'2020-01-16T09:00:00Z','completed','Past visit unchanged',v_admin) returning id into v_past;

      v_rejected := false;
      begin perform crm.transition_lead(v_lead,'follow_up',v_actor,jsonb_build_object('due_at',v_time));
      exception when check_violation then v_rejected := true; end;
      if not v_rejected then raise exception 'new reminder transition accepted'; end if;

      v_rejected := false;
      begin perform crm.transition_lead(v_lead,'appointment_booked',v_outsider,jsonb_build_object('scheduled_at',v_time));
      exception when insufficient_privilege then v_rejected := true; end;
      if not v_rejected then raise exception 'cross-center actor booked appointment'; end if;

      v_rejected := false;
      begin perform crm.transition_lead(v_lead,'appointment_booked',v_actor,jsonb_build_object('scheduled_at',v_time,'doctor_id',v_other_doctor));
      exception when check_violation then v_rejected := true; end;
      if not v_rejected then raise exception 'cross-center doctor booked appointment'; end if;

      perform crm.transition_lead(v_lead,'appointment_booked',v_actor,
        jsonb_build_object('scheduled_at',v_time,'doctor_id',v_doctor,'notes','Long-term clinical review'));
      select id into v_appointment from crm.appointments where lead_id=v_lead and status='scheduled';
      if v_appointment is null
        or (select count(*) from crm.appointments where lead_id=v_lead)<>2
        or (select status from crm.leads where id=v_lead)<>'appointment_booked'
        or not exists(select 1 from crm.appointments where id=v_appointment and doctor_id=v_doctor and scheduled_at=v_time
          and duration_minutes=15 and notes='Long-term clinical review' and created_by=v_actor and branch_id=v_branch)
        or not exists(select 1 from crm.appointments where id=v_past and status='completed' and scheduled_at='2020-01-16T09:00:00Z'
          and notes='Past visit unchanged')
        or not exists(select 1 from crm.lead_activity where lead_id=v_lead and type='appointment'
          and detail->>'appointment_id'=v_appointment::text) then
        raise exception 'normal booking or past visit preservation failed for % / %',v_actor,v_status;
      end if;
      -- RPC replay must not double-book; the dedicated additional-booking path
      -- remains responsible when the patient is already appointment_booked.
      perform crm.transition_lead(v_lead,'appointment_booked',v_actor,jsonb_build_object('scheduled_at',v_time));
      if (select count(*) from crm.appointments where lead_id=v_lead)<>2 then raise exception 'replay double-booked'; end if;

      perform crm.transition_lead(v_lead,'dropped',v_actor,'{"reason":"Test only"}');
      if v_status='follow_up' then
        if not exists(select 1 from crm.follow_ups where lead_id=v_lead and status='pending' and completed_at is null
          and due_at='2030-01-16T09:00:00Z' and reason='Historical review reminder') then
          raise exception 'booking/drop changed legacy reminder history'; end if;
      elsif exists(select 1 from crm.follow_ups where lead_id=v_lead) then
        raise exception 'booking created a follow-up row';
      end if;
    end loop;
  end loop;

  -- Exercise the actual visit-completion -> booking journey, not only a seeded
  -- visited status. The signed general case sheet remains tied to its visit.
  insert into crm.leads(branch_id,name,mobile,status,assignee_id,created_by)
    values(v_branch,'Clinical Return Patient','9000000031','assigned',v_front,v_admin) returning id into v_lead;
  perform crm.transition_lead(v_lead,'appointment_booked',v_admin,
    jsonb_build_object('scheduled_at',now(),'doctor_id',v_doctor));
  select id into v_past from crm.appointments where lead_id=v_lead and status='scheduled';
  select * into v_sheet from crm.finalize_clinical_visit(
    v_lead,v_past,v_doctor,now(),'General review','Examination findings',
    'Clinical review','Review at next visit','reviewed_none',true,
    '{}'::text[],null,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,v_admin
  );
  if (select status from crm.leads where id=v_lead)<>'visited_treated' then
    raise exception 'clinical completion did not mark the visit treated'; end if;
  perform crm.transition_lead(v_lead,'appointment_booked',v_admin,
    jsonb_build_object('scheduled_at',v_time,'doctor_id',v_doctor,'notes','Next review'));
  if not exists(select 1 from crm.case_sheets where id=v_sheet.id and appointment_id=v_past
      and chief_complaint='General review')
    or not exists(select 1 from crm.appointments where id=v_past and status='completed')
    or not exists(select 1 from crm.appointments where lead_id=v_lead and scheduled_at=v_time and status='scheduled')
    or exists(select 1 from crm.follow_ups where lead_id=v_lead) then
    raise exception 'booking after case sheet completion changed clinical history or created a reminder'; end if;

  v_rejected := false;
  begin insert into crm.leads(branch_id,name,mobile,status,created_by)
    values(v_branch,'Forbidden Reminder Patient','9000000030','follow_up',v_admin);
  exception when check_violation then v_rejected := true; end;
  if not v_rejected then raise exception 'new follow-up lead inserted directly'; end if;

  v_rejected := false;
  begin insert into crm.follow_ups(lead_id,due_at,created_by) values(v_lead,v_time,v_admin);
  exception when insufficient_privilege then v_rejected := true; end;
  if not v_rejected then raise exception 'service role created a reminder'; end if;
  v_rejected := false;
  begin update crm.follow_ups set status='done' where lead_id=v_legacy[1];
  exception when insufficient_privilege then v_rejected := true; end;
  if not v_rejected then raise exception 'service role updated reminder history'; end if;
end
$test$;

select 'ok 1 - all returning visits use appointments, reminders are retired, history and access checks remain';
rollback;
