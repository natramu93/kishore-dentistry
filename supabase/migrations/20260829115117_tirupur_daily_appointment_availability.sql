-- Branch-scoped appointment hours. A branch with no rows keeps the legacy
-- unrestricted behavior; once any rows exist, omitted weekdays are closed.
create table crm.branch_business_hours (
  branch_id uuid not null references crm.branches(id) on delete cascade,
  iso_weekday smallint not null,
  opens_at time without time zone not null,
  closes_at time without time zone not null,
  primary key (branch_id, iso_weekday),
  constraint branch_business_hours_weekday_check
    check (iso_weekday between 1 and 7),
  constraint branch_business_hours_range_check
    check (opens_at < closes_at)
);

alter table crm.branch_business_hours enable row level security;
revoke all on crm.branch_business_hours from anon, authenticated, service_role;
grant select on crm.branch_business_hours to service_role;

insert into crm.branch_business_hours (
  branch_id,
  iso_weekday,
  opens_at,
  closes_at
)
select
  b.id,
  weekday.iso_weekday,
  time '09:00',
  time '19:30'
from crm.branches b
cross join pg_catalog.generate_series(1, 7) as weekday(iso_weekday)
where b.code = 'TUP'
on conflict (branch_id, iso_weekday) do update
set opens_at = excluded.opens_at,
    closes_at = excluded.closes_at;

create function crm.validate_appointment_availability() returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_timezone text;
  v_local_start timestamp without time zone;
  v_local_end timestamp without time zone;
  v_opens_at time without time zone;
  v_closes_at time without time zone;
begin
  if new.status <> 'scheduled' then
    return new;
  end if;

  select b.timezone
  into v_timezone
  from crm.branches b
  where b.id = new.branch_id;

  -- The existing appointment-integrity trigger reports an invalid branch.
  if not found then
    return new;
  end if;

  -- Availability is opt-in per branch so existing branches without a
  -- configured schedule keep their established behavior.
  if not exists (
    select 1
    from crm.branch_business_hours h
    where h.branch_id = new.branch_id
  ) then
    return new;
  end if;

  v_local_start := new.scheduled_at at time zone v_timezone;
  v_local_end := (
    new.scheduled_at
      + pg_catalog.make_interval(mins => new.duration_minutes)
  ) at time zone v_timezone;

  select h.opens_at, h.closes_at
  into v_opens_at, v_closes_at
  from crm.branch_business_hours h
  where h.branch_id = new.branch_id
    and h.iso_weekday = pg_catalog.date_part('isodow', v_local_start)::smallint;

  if not found then
    raise exception 'The clinic is closed on the selected day'
      using errcode = '23514';
  end if;

  if v_local_start::time < v_opens_at
     or v_local_end::date <> v_local_start::date
     or v_local_end::time > v_closes_at then
    raise exception 'Appointments are available every day, including Saturday and Sunday, from 9:00 AM to 7:30 PM IST and must finish by 7:30 PM'
      using errcode = '23514';
  end if;

  return new;
end
$function$;

revoke all on function crm.validate_appointment_availability()
  from public, anon, authenticated;

create trigger validate_appointment_availability
  before insert or update of branch_id, scheduled_at, duration_minutes, status
  on crm.appointments
  for each row execute function crm.validate_appointment_availability();

-- CREATE TRIGGER takes a SHARE ROW EXCLUSIVE lock for this migration
-- transaction. Run the guard afterward so no concurrent booking can commit
-- between the audit and trigger installation.
do $migration_guard$
begin
  if exists (
    select 1
    from crm.appointments a
    join crm.branches b on b.id = a.branch_id
    cross join lateral (
      select
        a.scheduled_at at time zone b.timezone as local_start,
        (
          a.scheduled_at
            + pg_catalog.make_interval(mins => a.duration_minutes)
        ) at time zone b.timezone as local_end
    ) local_time
    left join crm.branch_business_hours h
      on h.branch_id = a.branch_id
     and h.iso_weekday = pg_catalog.date_part(
       'isodow', local_time.local_start
     )::smallint
    where a.status = 'scheduled'
      and exists (
        select 1
        from crm.branch_business_hours configured
        where configured.branch_id = a.branch_id
      )
      and (
        h.branch_id is null
        or local_time.local_start::time < h.opens_at
        or local_time.local_end::date <> local_time.local_start::date
        or local_time.local_end::time > h.closes_at
      )
  ) then
    raise exception 'Existing scheduled appointments fall outside configured branch business hours'
      using errcode = '23514';
  end if;
end
$migration_guard$;
