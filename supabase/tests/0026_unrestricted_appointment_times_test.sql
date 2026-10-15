-- Synthetic fixtures only; no production appointments or schedules are changed.
begin;
select '1..1';
do $test$
declare
  v_admin uuid := 'c2700000-0000-4000-8000-000000000001';
  v_front uuid := 'c2700000-0000-4000-8000-000000000002';
  v_branch uuid; v_other_branch uuid; v_doctor uuid; v_other_doctor uuid;
  v_lead uuid; v_appointment uuid; v_time timestamptz; v_rejected boolean;
begin
  if exists(select 1 from pg_trigger where tgrelid='crm.appointments'::regclass and tgname='validate_appointment_availability')
    or to_regprocedure('crm.validate_appointment_availability()') is not null then
    raise exception 'legacy appointment-hours enforcement remains installed'; end if;
  insert into auth.users(id,email,raw_user_meta_data) values
    (v_admin,'anytime-admin@example.test','{"full_name":"Anytime Admin"}'),
    (v_front,'anytime-front@example.test','{"full_name":"Anytime Front Desk"}');
  update crm.profiles set role='admin',is_active=true where id=v_admin;
  update crm.profiles set role='front_office',is_active=true where id=v_front;
  insert into crm.branches(name,code) values('Anytime Test Center','I26') returning id into v_branch;
  insert into crm.branches(name,code) values('Other Anytime Test Center','J26') returning id into v_other_branch;
  insert into crm.user_branches(user_id,branch_id) values(v_front,v_branch);
  insert into crm.doctors(branch_id,full_name,is_active) values(v_branch,'Dr. Anytime',true) returning id into v_doctor;
  insert into crm.doctors(branch_id,full_name,is_active) values(v_other_branch,'Dr. Other Center',true) returning id into v_other_doctor;

  -- Production may retain descriptive hours from the retired availability feature.
  -- Monday-only hours must not block Sunday or late-night bookings.
  if to_regclass('crm.branch_business_hours') is not null then
    execute 'insert into crm.branch_business_hours(branch_id,iso_weekday,opens_at,closes_at) values($1,1,''09:00'',''19:30'')'
      using v_branch;
  end if;
  execute 'set local role service_role';
  foreach v_time in array array[
    '2026-10-18 00:00:00+05:30'::timestamptz,
    '2026-10-18 07:15:00+05:30'::timestamptz,
    '2026-10-18 19:30:00+05:30'::timestamptz,
    '2026-10-18 23:59:00+05:30'::timestamptz
  ] loop
    insert into crm.leads(branch_id,name,mobile,status,assignee_id,created_by)
      values(v_branch,'Anytime Test Patient','9000000026','assigned',v_front,v_admin) returning id into v_lead;
    perform crm.transition_lead(v_lead,'appointment_booked',v_front,
      jsonb_build_object('scheduled_at',v_time,'doctor_id',v_doctor));
    select id into v_appointment from crm.appointments where lead_id=v_lead and scheduled_at=v_time;
    if v_appointment is null then raise exception 'out-of-hours booking rejected: %',v_time; end if;
    update crm.appointments set scheduled_at='2026-10-18 23:59:00+05:30' where id=v_appointment;
    if not exists(select 1 from crm.appointments where id=v_appointment and scheduled_at='2026-10-18 23:59:00+05:30') then
      raise exception 'out-of-hours rescheduling rejected'; end if;
    insert into crm.appointments(lead_id,doctor_id,scheduled_at,created_by)
      values(v_lead,v_doctor,v_time,v_front);
  end loop;

  -- Removing time restrictions must not bypass doctor/branch integrity.
  v_rejected:=false;
  begin update crm.appointments set doctor_id=v_other_doctor where id=v_appointment;
  exception when check_violation then v_rejected:=true; end;
  if not v_rejected then raise exception 'cross-center doctor accepted'; end if;
  update crm.doctors set is_active=false where id=v_doctor;
  v_rejected:=false;
  begin insert into crm.appointments(lead_id,doctor_id,scheduled_at,created_by) values(v_lead,v_doctor,v_time,v_front);
  exception when object_not_in_prerequisite_state then v_rejected:=true; end;
  if not v_rejected then raise exception 'inactive doctor accepted'; end if;
  insert into crm.leads(branch_id,name,mobile,status,assignee_id,created_by)
    values(v_branch,'Invalid Date Test Patient','9000000027','assigned',v_front,v_admin) returning id into v_lead;
  v_rejected:=false;
  begin perform crm.transition_lead(v_lead,'appointment_booked',v_front,jsonb_build_object('scheduled_at','invalid date'));
  exception when invalid_datetime_format or invalid_parameter_value then v_rejected:=true; end;
  if not v_rejected then raise exception 'invalid date accepted'; end if;
end
$test$;
select 'ok 1 - all appointment times work while branch, doctor and date checks remain';
rollback;
