-- Operations-created leads are owned by the Operations user who entered them.
-- Front Office intake remains self-assigned; branch-scoped validation and the
-- lead creation transaction are otherwise unchanged.

create or replace function crm.create_lead(
  p_branch_id uuid,
  p_name text,
  p_mobile text,
  p_email text,
  p_source_id uuid,
  p_interest_id uuid,
  p_age integer,
  p_dob date,
  p_notes text,
  p_actor uuid
) returns crm.leads
language plpgsql
set search_path = ''
as $function$
declare
  v_actor crm.profiles%rowtype;
  v_lead crm.leads%rowtype;
  v_assignee_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_mobile text := btrim(coalesce(p_mobile, ''));
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  select *
  into v_actor
  from crm.profiles p
  where p.id = p_actor
  for share;

  if not found or not v_actor.is_active then
    raise exception 'actor % is missing or inactive', p_actor
      using errcode = '42501';
  end if;

  if v_actor.role::text not in
     ('admin', 'operations', 'front_office', 'clinical_head') then
    raise exception 'profile role % cannot create leads', v_actor.role
      using errcode = '42501';
  end if;

  perform 1
  from crm.branches b
  where b.id = p_branch_id
    and b.is_active
  for share;

  if not found then
    raise exception 'branch % is missing or inactive', p_branch_id
      using errcode = '22023';
  end if;

  if v_actor.role::text <> 'admin' then
    perform 1
    from crm.user_branches ub
    where ub.user_id = p_actor
      and ub.branch_id = p_branch_id
    for share;

    if not found then
      raise exception 'actor is not allocated to the lead branch'
        using errcode = '42501';
    end if;
  end if;

  if length(v_name) not between 1 and 200 then
    raise exception 'lead name must contain 1 to 200 characters'
      using errcode = '22023';
  end if;

  if length(v_mobile) not between 7 and 32 then
    raise exception 'lead mobile must contain 7 to 32 characters'
      using errcode = '22023';
  end if;

  if v_email is not null
     and (
       length(v_email) > 254
       or position('@' in v_email) <= 1
       or position('@' in v_email) = length(v_email)
     ) then
    raise exception 'lead email is invalid'
      using errcode = '22023';
  end if;

  if p_age is not null and p_age not between 0 and 120 then
    raise exception 'lead age must be between 0 and 120'
      using errcode = '22023';
  end if;

  if p_dob is not null and p_dob > current_date then
    raise exception 'lead date of birth cannot be in the future'
      using errcode = '22023';
  end if;

  if v_notes is not null and length(v_notes) > 4000 then
    raise exception 'lead notes cannot exceed 4000 characters'
      using errcode = '22023';
  end if;

  if p_source_id is not null then
    perform 1
    from crm.lead_sources s
    where s.id = p_source_id
      and s.is_active
    for share;

    if not found then
      raise exception 'lead source % is missing or inactive', p_source_id
        using errcode = '22023';
    end if;
  end if;

  if p_interest_id is not null then
    perform 1
    from crm.treatment_types t
    where t.id = p_interest_id
      and t.is_active
    for share;

    if not found then
      raise exception 'treatment type % is missing or inactive', p_interest_id
        using errcode = '22023';
    end if;
  end if;

  if v_actor.role::text in ('front_office', 'operations') then
    v_assignee_id := p_actor;
  end if;

  insert into crm.leads (
    branch_id,
    name,
    mobile,
    email,
    source_id,
    interest_id,
    age,
    dob,
    notes,
    assignee_id,
    created_by
  )
  values (
    p_branch_id,
    v_name,
    v_mobile,
    v_email,
    p_source_id,
    p_interest_id,
    p_age,
    p_dob,
    v_notes,
    v_assignee_id,
    p_actor
  )
  returning * into v_lead;

  insert into crm.lead_activity (
    lead_id,
    actor_id,
    type,
    detail
  )
  values (
    v_lead.id,
    p_actor,
    'note',
    jsonb_build_object(
      'event', 'lead_created',
      'assigned_to', v_assignee_id
    )
  );

  return v_lead;
end
$function$;

comment on function crm.create_lead(
  uuid, text, text, text, uuid, uuid, integer, date, text, uuid
) is 'Creates a branch-scoped lead, automatically assigning Front Office and Operations intake to the user who entered it.';
