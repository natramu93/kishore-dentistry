-- ============================================================
-- 0008_dashboard_report_rpcs.sql
-- Aggregation RPCs the app's data layer calls. Each one derives the
-- actor's role/branch scope INSIDE the database from p_actor, so the
-- app receives only grouped, patient-safe aggregates.
-- ============================================================

-- ---------- Doctor dashboard ----------
create or replace function crm.get_doctor_dashboard(
  p_actor uuid,
  p_day_start timestamptz,
  p_day_end timestamptz
) returns table(
  todays_appointments bigint,
  week_appointments bigint,
  patients_treated bigint,
  revenue_generated numeric
)
language plpgsql stable
set search_path = crm, public
as $$
declare
  v_doctor_id uuid;
begin
  select d.id into v_doctor_id
  from crm.doctors d
  join crm.profiles p on p.id = d.profile_id
  where d.profile_id = p_actor and p.is_active and p.role = 'doctor';

  if v_doctor_id is null then
    return query select 0::bigint, 0::bigint, 0::bigint, 0::numeric;
    return;
  end if;

  return query select
    (select count(*) from crm.appointments a
      where a.doctor_id = v_doctor_id and a.status = 'scheduled'
        and a.scheduled_at >= p_day_start and a.scheduled_at < p_day_end),
    (select count(*) from crm.appointments a
      where a.doctor_id = v_doctor_id and a.status = 'scheduled'
        and a.scheduled_at >= p_day_start
        and a.scheduled_at < p_day_start + interval '7 days'),
    (select count(distinct t.lead_id) from crm.treatments t
      where t.doctor_id = v_doctor_id),
    (select coalesce(sum(t.cost), 0) from crm.treatments t
      where t.doctor_id = v_doctor_id);
end $$;

-- ---------- Business dashboard ----------
create or replace function crm.get_business_dashboard(
  p_actor uuid,
  p_day_start timestamptz,
  p_day_end timestamptz
) returns table(metric text, row_key text, row_label text, value numeric)
language plpgsql stable
set search_path = crm, public
as $$
declare
  v_role crm.user_role;
  v_branches uuid[];
begin
  select p.role into v_role from crm.profiles p where p.id = p_actor and p.is_active;
  if v_role is null or v_role not in ('admin','operations','front_office','clinical_head') then
    raise exception 'business dashboard access denied';
  end if;

  if v_role = 'admin' then
    v_branches := null;
  else
    select coalesce(array_agg(ub.branch_id), array[]::uuid[])
      into v_branches from crm.user_branches ub where ub.user_id = p_actor;
  end if;

  return query
  with scoped_leads as (
    select l.id, l.status, l.branch_id, l.source_id, l.interest_id
    from crm.leads l
    where (v_branches is null or l.branch_id = any(v_branches))
      and (v_role <> 'front_office' or l.assignee_id = p_actor or l.assignee_id is null)
  ),
  rows_union as (
    select 1 as prio, 0::bigint as rnk,
      'summary'::text as m, 'total_leads'::text as k, 'Total leads'::text as lbl,
      (select count(*) from scoped_leads)::numeric as v
    union all
    select 1, 1, 'summary', 'todays_appointments', 'Appointments today',
      (select count(*) from crm.appointments a
        where a.status = 'scheduled'
          and a.scheduled_at >= p_day_start and a.scheduled_at < p_day_end
          and (v_branches is null or a.branch_id = any(v_branches)))::numeric
    union all
    select 1, 2, 'summary', 'due_follow_ups', 'Follow-ups due',
      (select count(*) from crm.follow_ups fu
        where fu.status = 'pending' and fu.due_at < p_day_end
          and (v_branches is null or fu.branch_id = any(v_branches)))::numeric
    union all
    select 2, 0, 'status', s.status::text, s.status::text, s.cnt::numeric
    from (select sl.status, count(*) cnt from scoped_leads sl group by sl.status) s
    union all
    select 3, row_number() over (order by b.cnt desc), 'branch', b.id::text, b.name, b.cnt::numeric
    from (
      select br.id, br.name, count(*) cnt
      from scoped_leads sl join crm.branches br on br.id = sl.branch_id
      group by br.id, br.name
    ) b
    union all
    select 4, row_number() over (order by s.cnt desc), 'source',
      coalesce(s.id::text, 'unknown'), coalesce(s.name, 'Unknown'), s.cnt::numeric
    from (
      select ls.id, ls.name, count(*) cnt
      from scoped_leads sl left join crm.lead_sources ls on ls.id = sl.source_id
      group by ls.id, ls.name
    ) s
    union all
    select 5, t.rnk, 'interest', t.id::text, t.name, t.cnt::numeric
    from (
      select tt.id, tt.name, count(*) cnt,
        row_number() over (order by count(*) desc) rnk
      from scoped_leads sl join crm.treatment_types tt on tt.id = sl.interest_id
      group by tt.id, tt.name
    ) t
    where t.rnk <= 6
  )
  select ru.m, ru.k, ru.lbl, ru.v from rows_union ru order by ru.prio, ru.rnk;
end $$;

-- ---------- Report aggregates ----------
create or replace function crm.get_report_aggregates(
  p_actor uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_branch_id uuid default null,
  p_doctor_id uuid default null
) returns table(
  by_doctor jsonb,
  by_center jsonb,
  by_day jsonb,
  by_treatment jsonb,
  totals jsonb
)
language plpgsql stable
set search_path = crm, public
as $$
declare
  v_role crm.user_role;
  v_branches uuid[];
begin
  select p.role into v_role from crm.profiles p where p.id = p_actor and p.is_active;
  if v_role is null or v_role not in ('admin','operations','clinical_head') then
    raise exception 'reports access denied';
  end if;

  if v_role = 'admin' then
    v_branches := null;
  else
    select coalesce(array_agg(ub.branch_id), array[]::uuid[])
      into v_branches from crm.user_branches ub where ub.user_id = p_actor;
  end if;

  return query
  with f_appts as (
    select a.id, a.branch_id, a.doctor_id, a.lead_id, a.scheduled_at
    from crm.appointments a
    where a.scheduled_at >= p_from and a.scheduled_at < p_to
      and (v_branches is null or a.branch_id = any(v_branches))
      and (p_branch_id is null or a.branch_id = p_branch_id)
      and (p_doctor_id is null or a.doctor_id = p_doctor_id)
  ),
  f_treats as (
    select t.id, t.branch_id, t.doctor_id, t.lead_id, t.treatment_type_id,
           t.appointment_id, coalesce(t.cost, 0) as cost, t.treated_at
    from crm.treatments t
    where t.treated_at >= p_from and t.treated_at < p_to
      and (v_branches is null or t.branch_id = any(v_branches))
      and (p_branch_id is null or t.branch_id = p_branch_id)
      and (p_doctor_id is null or t.doctor_id = p_doctor_id)
  ),
  doc_patients as (
    select distinct x.doctor_id, x.lead_id from (
      select a.doctor_id, a.lead_id from f_appts a where a.doctor_id is not null
      union all
      select t.doctor_id, t.lead_id from f_treats t where t.doctor_id is not null
    ) x
  ),
  f_leads as (
    select l.id, l.branch_id, l.created_at
    from crm.leads l
    where l.created_at >= p_from and l.created_at < p_to
      and (v_branches is null or l.branch_id = any(v_branches))
      and (p_branch_id is null or l.branch_id = p_branch_id)
      and (p_doctor_id is null or l.id in (select dp.lead_id from doc_patients dp))
  ),
  f_fus as (
    select fu.id, fu.branch_id, fu.lead_id, fu.due_at
    from crm.follow_ups fu
    where fu.due_at >= p_from and fu.due_at < p_to
      and (v_branches is null or fu.branch_id = any(v_branches))
      and (p_branch_id is null or fu.branch_id = p_branch_id)
      and (p_doctor_id is null or fu.lead_id in (select dp.lead_id from doc_patients dp))
  ),
  doc_rows as (
    select
      dp.doctor_id as key,
      d.full_name as label,
      (select count(distinct dp2.lead_id) from doc_patients dp2 where dp2.doctor_id = dp.doctor_id) as leads,
      (select count(*) from f_appts a where a.doctor_id = dp.doctor_id) as appointments,
      (select count(*) from f_fus fu
        where fu.lead_id in (select dp3.lead_id from doc_patients dp3 where dp3.doctor_id = dp.doctor_id)) as follow_ups,
      (select coalesce(sum(t.cost), 0) from f_treats t where t.doctor_id = dp.doctor_id) as revenue
    from (select distinct dp0.doctor_id from doc_patients dp0) dp
    join crm.doctors d on d.id = dp.doctor_id
  ),
  center_rows as (
    select
      b.id as key,
      b.name as label,
      (select count(*) from f_leads l where l.branch_id = b.id) as leads,
      (select count(*) from f_appts a where a.branch_id = b.id) as appointments,
      (select count(*) from f_fus fu where fu.branch_id = b.id) as follow_ups,
      (select coalesce(sum(t.cost), 0) from f_treats t where t.branch_id = b.id) as revenue
    from crm.branches b
    where b.id in (
      select l.branch_id from f_leads l
      union select a.branch_id from f_appts a
      union select fu.branch_id from f_fus fu
      union select t.branch_id from f_treats t
    )
  ),
  day_rows as (
    select
      u.key,
      max(u.label) as label,
      sum(u.leads) as leads,
      sum(u.appts) as appointments,
      sum(u.fus) as follow_ups,
      sum(u.rev) as revenue
    from (
      select to_char(l.created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as key,
             to_char(l.created_at at time zone 'Asia/Kolkata', 'FMDD Mon') as label,
             1 as leads, 0 as appts, 0 as fus, 0::numeric as rev
      from f_leads l
      union all
      select to_char(a.scheduled_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD'),
             to_char(a.scheduled_at at time zone 'Asia/Kolkata', 'FMDD Mon'),
             0, 1, 0, 0::numeric
      from f_appts a
      union all
      select to_char(fu.due_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD'),
             to_char(fu.due_at at time zone 'Asia/Kolkata', 'FMDD Mon'),
             0, 0, 1, 0::numeric
      from f_fus fu
      union all
      select to_char(t.treated_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD'),
             to_char(t.treated_at at time zone 'Asia/Kolkata', 'FMDD Mon'),
             0, 0, 0, t.cost
      from f_treats t
    ) u
    group by u.key
  ),
  treatment_rows as (
    select
      tt.id as key,
      tt.name as label,
      (select count(distinct t.lead_id) from f_treats t where t.treatment_type_id = tt.id) as leads,
      (select count(*) from f_treats t where t.treatment_type_id = tt.id and t.appointment_id is not null) as appointments,
      0 as follow_ups,
      (select coalesce(sum(t.cost), 0) from f_treats t where t.treatment_type_id = tt.id) as revenue
    from crm.treatment_types tt
    where tt.id in (select t.treatment_type_id from f_treats t where t.treatment_type_id is not null)
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object(
        'key', r.key, 'label', r.label, 'leads', r.leads,
        'appointments', r.appointments, 'followUps', r.follow_ups, 'revenue', r.revenue)
      order by r.revenue desc, r.appointments desc) from doc_rows r), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object(
        'key', r.key, 'label', r.label, 'leads', r.leads,
        'appointments', r.appointments, 'followUps', r.follow_ups, 'revenue', r.revenue)
      order by r.revenue desc, r.appointments desc) from center_rows r), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object(
        'key', r.key, 'label', r.label, 'leads', r.leads,
        'appointments', r.appointments, 'followUps', r.follow_ups, 'revenue', r.revenue)
      order by r.key) from day_rows r), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object(
        'key', r.key, 'label', r.label, 'leads', r.leads,
        'appointments', r.appointments, 'followUps', r.follow_ups, 'revenue', r.revenue)
      order by r.revenue desc, r.appointments desc) from treatment_rows r), '[]'::jsonb),
    jsonb_build_object(
      'leads', (select count(*) from f_leads),
      'appointments', (select count(*) from f_appts),
      'followUps', (select count(*) from f_fus),
      'revenue', (select coalesce(sum(t.cost), 0) from f_treats t)
    );
end $$;
