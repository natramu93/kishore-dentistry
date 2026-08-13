-- ============================================================
-- 20260726070823_report_aggregates.sql
--
-- Aggregate report facts in PostgreSQL so report size is bounded by the
-- number of groups rather than the number of clinical records. The function
-- derives role and branch scope from the authenticated application actor and
-- is callable only by the server-side service role. The same migration moves
-- business and doctor dashboard summaries out of application memory.
-- ============================================================

-- A short-lived production hotfix used these same argument signatures with
-- weaker definitions, including a different get_business_dashboard return
-- type. PostgreSQL cannot change a table-returning function's OUT types with
-- CREATE OR REPLACE, so remove the exact signatures before recreating them.
drop function if exists crm.get_report_aggregates(uuid, timestamptz, timestamptz, uuid, uuid);
drop function if exists crm.get_business_dashboard(uuid, timestamptz, timestamptz);
drop function if exists crm.get_doctor_dashboard(uuid, timestamptz, timestamptz);

create or replace function crm.get_report_aggregates(
  p_actor uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_branch_id uuid default null,
  p_doctor_id uuid default null
)
returns table (
  by_doctor jsonb,
  by_center jsonb,
  by_day jsonb,
  by_treatment jsonb,
  totals jsonb
)
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_actor_role text;
  v_doctor_branch_id uuid;
begin
  if p_actor is null then
    raise exception 'report actor is required'
      using errcode = '42501';
  end if;

  select p.role::text
  into v_actor_role
  from crm.profiles p
  where p.id = p_actor
    and p.is_active;

  if not found then
    raise exception 'report actor is missing or inactive'
      using errcode = '42501';
  end if;

  if v_actor_role not in ('admin', 'operations', 'clinical_head') then
    raise exception 'actor does not have report access'
      using errcode = '42501';
  end if;

  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'report end must be after report start'
      using errcode = '22023';
  end if;

  if p_to - p_from > interval '366 days' then
    raise exception 'report range cannot exceed 366 days'
      using errcode = '22023';
  end if;

  if p_branch_id is not null
     and v_actor_role <> 'admin'
     and not exists (
       select 1
       from crm.user_branches ub
       where ub.user_id = p_actor
         and ub.branch_id = p_branch_id
     ) then
    raise exception 'actor is not allocated to the selected branch'
      using errcode = '42501';
  end if;

  if p_doctor_id is not null then
    select d.branch_id
    into v_doctor_branch_id
    from crm.doctors d
    where d.id = p_doctor_id
      and d.is_active;

    if not found then
      raise exception 'selected doctor is missing or inactive'
        using errcode = '22023';
    end if;

    if v_actor_role <> 'admin'
       and not exists (
         select 1
         from crm.user_branches ub
         where ub.user_id = p_actor
           and ub.branch_id = v_doctor_branch_id
       ) then
      raise exception 'actor is not allocated to the doctor branch'
        using errcode = '42501';
    end if;

    if p_branch_id is not null and p_branch_id <> v_doctor_branch_id then
      raise exception 'selected doctor does not belong to the selected branch'
        using errcode = '22023';
    end if;
  end if;

  return query
  with
  actor_branches as materialized (
    select ub.branch_id
    from crm.user_branches ub
    where ub.user_id = p_actor
  ),
  scoped_appointments as materialized (
    select
      a.id,
      a.lead_id,
      a.branch_id,
      a.doctor_id,
      a.scheduled_at
    from crm.appointments a
    where a.scheduled_at >= p_from
      and a.scheduled_at < p_to
      and (v_actor_role = 'admin' or a.branch_id in (select ab.branch_id from actor_branches ab))
      and (p_branch_id is null or a.branch_id = p_branch_id)
      and (p_doctor_id is null or a.doctor_id = p_doctor_id)
  ),
  scoped_treatments as materialized (
    select
      t.id,
      t.lead_id,
      t.branch_id,
      t.appointment_id,
      t.treatment_type_id,
      t.doctor_id,
      t.cost,
      t.treated_at
    from crm.treatments t
    where t.treated_at >= p_from
      and t.treated_at < p_to
      and (v_actor_role = 'admin' or t.branch_id in (select ab.branch_id from actor_branches ab))
      and (p_branch_id is null or t.branch_id = p_branch_id)
      and (p_doctor_id is null or t.doctor_id = p_doctor_id)
  ),
  lead_doctors as materialized (
    select a.lead_id, a.doctor_id
    from scoped_appointments a
    where a.doctor_id is not null
    union
    select t.lead_id, t.doctor_id
    from scoped_treatments t
    where t.doctor_id is not null
  ),
  scoped_leads as materialized (
    select
      l.id,
      l.branch_id,
      l.created_at
    from crm.leads l
    where l.deleted_at is null
      and l.created_at >= p_from
      and l.created_at < p_to
      and (v_actor_role = 'admin' or l.branch_id in (select ab.branch_id from actor_branches ab))
      and (p_branch_id is null or l.branch_id = p_branch_id)
      and (
        p_doctor_id is null
        or exists (
          select 1
          from lead_doctors ld
          where ld.lead_id = l.id
        )
      )
  ),
  scoped_follow_ups as materialized (
    select
      f.id,
      f.lead_id,
      f.branch_id,
      f.due_at
    from crm.follow_ups f
    where f.due_at >= p_from
      and f.due_at < p_to
      and (v_actor_role = 'admin' or f.branch_id in (select ab.branch_id from actor_branches ab))
      and (p_branch_id is null or f.branch_id = p_branch_id)
      and (
        p_doctor_id is null
        or exists (
          select 1
          from lead_doctors ld
          where ld.lead_id = f.lead_id
        )
      )
  ),
  doctor_keys as (
    select ld.doctor_id
    from lead_doctors ld
    group by ld.doctor_id
  ),
  doctor_appointment_metrics as (
    select
      a.doctor_id,
      count(*)::bigint as appointments
    from scoped_appointments a
    where a.doctor_id is not null
    group by a.doctor_id
  ),
  doctor_treatment_metrics as (
    select
      t.doctor_id,
      coalesce(sum(t.cost), 0::numeric) as revenue
    from scoped_treatments t
    where t.doctor_id is not null
    group by t.doctor_id
  ),
  doctor_lead_metrics as (
    select
      ld.doctor_id,
      count(*)::bigint as leads
    from lead_doctors ld
    group by ld.doctor_id
  ),
  doctor_follow_up_metrics as (
    select
      ld.doctor_id,
      count(f.id)::bigint as follow_ups
    from lead_doctors ld
    join scoped_follow_ups f on f.lead_id = ld.lead_id
    group by ld.doctor_id
  ),
  doctor_rows as (
    select
      'doctor'::text as dimension,
      dk.doctor_id::text as row_key,
      coalesce(d.full_name, 'Unknown')::text as row_label,
      coalesce(dlm.leads, 0::bigint) as leads,
      coalesce(dam.appointments, 0::bigint) as appointments,
      coalesce(dfm.follow_ups, 0::bigint) as follow_ups,
      coalesce(dtm.revenue, 0::numeric) as revenue
    from doctor_keys dk
    left join crm.doctors d on d.id = dk.doctor_id
    left join doctor_lead_metrics dlm on dlm.doctor_id = dk.doctor_id
    left join doctor_appointment_metrics dam on dam.doctor_id = dk.doctor_id
    left join doctor_follow_up_metrics dfm on dfm.doctor_id = dk.doctor_id
    left join doctor_treatment_metrics dtm on dtm.doctor_id = dk.doctor_id
  ),
  center_events as (
    select l.branch_id, 1::bigint as leads, 0::bigint as appointments, 0::bigint as follow_ups, 0::numeric as revenue
    from scoped_leads l
    union all
    select a.branch_id, 0::bigint, 1::bigint, 0::bigint, 0::numeric
    from scoped_appointments a
    union all
    select f.branch_id, 0::bigint, 0::bigint, 1::bigint, 0::numeric
    from scoped_follow_ups f
    union all
    select t.branch_id, 0::bigint, 0::bigint, 0::bigint, coalesce(t.cost, 0::numeric)
    from scoped_treatments t
  ),
  center_metrics as (
    select
      ce.branch_id,
      sum(ce.leads)::bigint as leads,
      sum(ce.appointments)::bigint as appointments,
      sum(ce.follow_ups)::bigint as follow_ups,
      sum(ce.revenue) as revenue
    from center_events ce
    group by ce.branch_id
  ),
  center_rows as (
    select
      'center'::text as dimension,
      cm.branch_id::text as row_key,
      coalesce(b.name, 'Unknown')::text as row_label,
      cm.leads,
      cm.appointments,
      cm.follow_ups,
      cm.revenue
    from center_metrics cm
    left join crm.branches b on b.id = cm.branch_id
  ),
  day_events as (
    select
      (l.created_at at time zone 'Asia/Kolkata')::date as clinic_day,
      1::bigint as leads,
      0::bigint as appointments,
      0::bigint as follow_ups,
      0::numeric as revenue
    from scoped_leads l
    union all
    select
      (a.scheduled_at at time zone 'Asia/Kolkata')::date,
      0::bigint,
      1::bigint,
      0::bigint,
      0::numeric
    from scoped_appointments a
    union all
    select
      (f.due_at at time zone 'Asia/Kolkata')::date,
      0::bigint,
      0::bigint,
      1::bigint,
      0::numeric
    from scoped_follow_ups f
    union all
    select
      (t.treated_at at time zone 'Asia/Kolkata')::date,
      0::bigint,
      0::bigint,
      0::bigint,
      coalesce(t.cost, 0::numeric)
    from scoped_treatments t
  ),
  day_metrics as (
    select
      de.clinic_day,
      sum(de.leads)::bigint as leads,
      sum(de.appointments)::bigint as appointments,
      sum(de.follow_ups)::bigint as follow_ups,
      sum(de.revenue) as revenue
    from day_events de
    group by de.clinic_day
  ),
  day_rows as (
    select
      'day'::text as dimension,
      dm.clinic_day::text as row_key,
      to_char(dm.clinic_day, 'FMDD Mon')::text as row_label,
      dm.leads,
      dm.appointments,
      dm.follow_ups,
      dm.revenue
    from day_metrics dm
  ),
  treatment_rows as (
    select
      'treatment'::text as dimension,
      t.treatment_type_id::text as row_key,
      coalesce(tt.name, 'Unknown')::text as row_label,
      count(distinct t.lead_id)::bigint as leads,
      count(*) filter (
        where t.appointment_id is not null
          and exists (
            select 1
            from scoped_appointments a
            where a.id = t.appointment_id
          )
      )::bigint as appointments,
      0::bigint as follow_ups,
      coalesce(sum(t.cost), 0::numeric) as revenue
    from scoped_treatments t
    left join crm.treatment_types tt on tt.id = t.treatment_type_id
    where t.treatment_type_id is not null
    group by t.treatment_type_id, tt.name
  ),
  total_rows as (
    select
      'total'::text as dimension,
      'total'::text as row_key,
      'Total'::text as row_label,
      (select count(*)::bigint from scoped_leads) as leads,
      (select count(*)::bigint from scoped_appointments) as appointments,
      (select count(*)::bigint from scoped_follow_ups) as follow_ups,
      (select coalesce(sum(t.cost), 0::numeric) from scoped_treatments t) as revenue
  )
  select
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'key', dr.row_key,
            'label', dr.row_label,
            'leads', dr.leads,
            'appointments', dr.appointments,
            'followUps', dr.follow_ups,
            'revenue', dr.revenue
          )
          order by dr.revenue desc, dr.appointments desc, dr.row_label asc
        )
        from doctor_rows dr
      ),
      '[]'::jsonb
    ) as by_doctor,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'key', cr.row_key,
            'label', cr.row_label,
            'leads', cr.leads,
            'appointments', cr.appointments,
            'followUps', cr.follow_ups,
            'revenue', cr.revenue
          )
          order by cr.revenue desc, cr.appointments desc, cr.row_label asc
        )
        from center_rows cr
      ),
      '[]'::jsonb
    ) as by_center,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'key', dr.row_key,
            'label', dr.row_label,
            'leads', dr.leads,
            'appointments', dr.appointments,
            'followUps', dr.follow_ups,
            'revenue', dr.revenue
          )
          order by dr.row_key asc
        )
        from day_rows dr
      ),
      '[]'::jsonb
    ) as by_day,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'key', tr.row_key,
            'label', tr.row_label,
            'leads', tr.leads,
            'appointments', tr.appointments,
            'followUps', tr.follow_ups,
            'revenue', tr.revenue
          )
          order by tr.revenue desc, tr.appointments desc, tr.row_label asc
        )
        from treatment_rows tr
      ),
      '[]'::jsonb
    ) as by_treatment,
    (
      select jsonb_build_object(
        'leads', tr.leads,
        'appointments', tr.appointments,
        'followUps', tr.follow_ups,
        'revenue', tr.revenue
      )
      from total_rows tr
    ) as totals;
end
$function$;

comment on function crm.get_report_aggregates(uuid, timestamptz, timestamptz, uuid, uuid)
is 'Returns branch-authorized, clinic-time report aggregates without exposing patient-level rows.';

create or replace function crm.get_business_dashboard(
  p_actor uuid,
  p_day_start timestamptz,
  p_day_end timestamptz
)
returns table (
  metric text,
  row_key text,
  row_label text,
  value bigint
)
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_actor_role text;
begin
  select p.role::text
  into v_actor_role
  from crm.profiles p
  where p.id = p_actor
    and p.is_active;

  if not found then
    raise exception 'dashboard actor is missing or inactive'
      using errcode = '42501';
  end if;

  if v_actor_role not in ('admin', 'operations', 'front_office', 'clinical_head') then
    raise exception 'actor does not have business dashboard access'
      using errcode = '42501';
  end if;

  if p_day_start is null or p_day_end is null or p_day_end <= p_day_start then
    raise exception 'dashboard day range is invalid'
      using errcode = '22023';
  end if;

  if p_day_end - p_day_start > interval '2 days' then
    raise exception 'dashboard day range is too large'
      using errcode = '22023';
  end if;

  return query
  with
  actor_branches as materialized (
    select ub.branch_id
    from crm.user_branches ub
    where ub.user_id = p_actor
  ),
  visible_leads as materialized (
    select
      l.id,
      l.status,
      l.branch_id,
      l.source_id,
      l.interest_id
    from crm.leads l
    where l.deleted_at is null
      and (
        v_actor_role = 'admin'
        or l.branch_id in (select ab.branch_id from actor_branches ab)
      )
      and (
        v_actor_role <> 'front_office'
        or l.assignee_id = p_actor
        or l.assignee_id is null
      )
  ),
  status_rows as (
    select
      'status'::text as metric,
      vl.status::text as row_key,
      vl.status::text as row_label,
      count(*)::bigint as value
    from visible_leads vl
    group by vl.status
  ),
  branch_rows as (
    select
      'branch'::text as metric,
      vl.branch_id::text as row_key,
      coalesce(b.name, '—')::text as row_label,
      count(*)::bigint as value
    from visible_leads vl
    left join crm.branches b on b.id = vl.branch_id
    group by vl.branch_id, b.name
  ),
  source_rows as (
    select
      'source'::text as metric,
      coalesce(vl.source_id::text, 'unknown') as row_key,
      coalesce(ls.name, 'Unknown')::text as row_label,
      count(*)::bigint as value
    from visible_leads vl
    left join crm.lead_sources ls on ls.id = vl.source_id
    group by vl.source_id, ls.name
  ),
  interest_rows as (
    select
      'interest'::text as metric,
      vl.interest_id::text as row_key,
      coalesce(tt.name, 'Unknown')::text as row_label,
      count(*)::bigint as value
    from visible_leads vl
    left join crm.treatment_types tt on tt.id = vl.interest_id
    where vl.interest_id is not null
    group by vl.interest_id, tt.name
    order by count(*) desc, coalesce(tt.name, 'Unknown') asc
    limit 6
  ),
  todays_appointments as (
    select count(*)::bigint as value
    from crm.appointments a
    join crm.leads l on l.id = a.lead_id
    where a.scheduled_at >= p_day_start
      and a.scheduled_at < p_day_end
      and a.status = 'scheduled'
      and (
        v_actor_role = 'admin'
        or a.branch_id in (select ab.branch_id from actor_branches ab)
      )
      and (
        v_actor_role <> 'front_office'
        or l.assignee_id = p_actor
        or l.assignee_id is null
      )
  ),
  due_follow_ups as (
    select count(*)::bigint as value
    from crm.follow_ups f
    join crm.leads l on l.id = f.lead_id
    where f.status = 'pending'
      and f.due_at < p_day_end
      and (
        v_actor_role = 'admin'
        or f.branch_id in (select ab.branch_id from actor_branches ab)
      )
      and (
        v_actor_role <> 'front_office'
        or l.assignee_id = p_actor
        or l.assignee_id is null
      )
  ),
  summary_rows as (
    select
      'summary'::text as metric,
      'total_leads'::text as row_key,
      'Total leads'::text as row_label,
      (select count(*)::bigint from visible_leads) as value
    union all
    select
      'summary'::text,
      'todays_appointments'::text,
      'Today''s appointments'::text,
      ta.value
    from todays_appointments ta
    union all
    select
      'summary'::text,
      'due_follow_ups'::text,
      'Due follow-ups'::text,
      df.value
    from due_follow_ups df
  ),
  dashboard_rows as (
    select * from status_rows
    union all
    select * from branch_rows
    union all
    select * from source_rows
    union all
    select * from interest_rows
    union all
    select * from summary_rows
  )
  select
    dr.metric,
    dr.row_key,
    dr.row_label,
    dr.value
  from dashboard_rows dr
  order by
    case dr.metric
      when 'status' then 1
      when 'branch' then 2
      when 'source' then 3
      when 'interest' then 4
      else 5
    end,
    case when dr.metric in ('branch', 'source', 'interest') then dr.value end desc,
    dr.row_label asc;
end
$function$;

comment on function crm.get_business_dashboard(uuid, timestamptz, timestamptz)
is 'Returns branch- and assignment-scoped business dashboard aggregates without lead-level rows.';

create or replace function crm.get_doctor_dashboard(
  p_actor uuid,
  p_day_start timestamptz,
  p_day_end timestamptz
)
returns table (
  todays_appointments bigint,
  week_appointments bigint,
  patients_treated bigint,
  revenue_generated numeric
)
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_doctor_id uuid;
  v_actor_role text;
begin
  select p.role::text
  into v_actor_role
  from crm.profiles p
  where p.id = p_actor
    and p.is_active;

  if not found or v_actor_role <> 'doctor' then
    raise exception 'actor does not have doctor dashboard access'
      using errcode = '42501';
  end if;

  if p_day_start is null or p_day_end is null or p_day_end <= p_day_start then
    raise exception 'dashboard day range is invalid'
      using errcode = '22023';
  end if;

  if p_day_end - p_day_start > interval '2 days' then
    raise exception 'dashboard day range is too large'
      using errcode = '22023';
  end if;

  select d.id
  into v_doctor_id
  from crm.doctors d
  where d.profile_id = p_actor;

  return query
  select
    (
      select count(*)::bigint
      from crm.appointments a
      where a.doctor_id = v_doctor_id
        and a.status = 'scheduled'
        and a.scheduled_at >= p_day_start
        and a.scheduled_at < p_day_end
    ) as todays_appointments,
    (
      select count(*)::bigint
      from crm.appointments a
      where a.doctor_id = v_doctor_id
        and a.status = 'scheduled'
        and a.scheduled_at >= p_day_start
        and a.scheduled_at < p_day_start + interval '7 days'
    ) as week_appointments,
    (
      select count(distinct t.lead_id)::bigint
      from crm.treatments t
      where t.doctor_id = v_doctor_id
    ) as patients_treated,
    (
      select coalesce(sum(t.cost), 0::numeric)
      from crm.treatments t
      where t.doctor_id = v_doctor_id
    ) as revenue_generated;
end
$function$;

comment on function crm.get_doctor_dashboard(uuid, timestamptz, timestamptz)
is 'Returns an authenticated doctor''s schedule and lifetime treatment aggregates.';

create index treatments_report_branch_time_doctor_idx
  on crm.treatments (branch_id, treated_at, doctor_id);

create index follow_ups_report_branch_due_idx
  on crm.follow_ups (branch_id, due_at);

create index appointments_report_doctor_time_idx
  on crm.appointments (doctor_id, scheduled_at)
  where doctor_id is not null;

create index leads_live_report_branch_created_idx
  on crm.leads (branch_id, created_at)
  where deleted_at is null;

create index leads_live_dashboard_branch_assignee_idx
  on crm.leads (branch_id, assignee_id)
  where deleted_at is null;

create index treatments_doctor_dashboard_idx
  on crm.treatments (doctor_id)
  include (lead_id, cost)
  where doctor_id is not null;

revoke execute on function crm.get_report_aggregates(
  uuid,
  timestamptz,
  timestamptz,
  uuid,
  uuid
) from public, anon, authenticated;

grant execute on function crm.get_report_aggregates(
  uuid,
  timestamptz,
  timestamptz,
  uuid,
  uuid
) to service_role;

revoke execute on function crm.get_business_dashboard(
  uuid,
  timestamptz,
  timestamptz
) from public, anon, authenticated;

grant execute on function crm.get_business_dashboard(
  uuid,
  timestamptz,
  timestamptz
) to service_role;

revoke execute on function crm.get_doctor_dashboard(
  uuid,
  timestamptz,
  timestamptz
) from public, anon, authenticated;

grant execute on function crm.get_doctor_dashboard(
  uuid,
  timestamptz,
  timestamptz
) to service_role;
