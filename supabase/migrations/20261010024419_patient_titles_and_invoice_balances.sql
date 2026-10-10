-- Patient demographics remain optional for existing intake/webhook clients.
alter table crm.leads
  add column title text check (title in ('Mr','Ms','Mrs','Baby','Master')),
  add column gender text check (gender in ('male','female','other'));

create function crm.patient_name_title_case(p_name text) returns text
language sql immutable set search_path='' as $function$
  select coalesce(string_agg(upper(left(part,1)) || lower(substr(part,2)), ' ' order by position), '')
  from regexp_split_to_table(btrim(p_name), '[[:space:]]+') with ordinality as words(part,position)
  where part <> '';
$function$;
create function crm.normalize_patient_identity() returns trigger
language plpgsql set search_path='' as $function$
begin
  new.title := nullif(btrim(new.title),'');
  new.gender := nullif(btrim(new.gender),'');
  if TG_OP='INSERT' or new.name is distinct from old.name then
    new.name := crm.patient_name_title_case(new.name);
  end if;
  -- Only suggest a gender when absent. Explicit corrections always take priority.
  if new.gender is null and (TG_OP='INSERT' or new.title is distinct from old.title) then
    new.gender := case when new.title in ('Mr','Master') then 'male'
                       when new.title in ('Ms','Mrs') then 'female' else null end;
  end if;
  return new;
end
$function$;
create trigger lead_patient_identity before insert or update of name,title,gender on crm.leads
  for each row execute function crm.normalize_patient_identity();
revoke all on function crm.normalize_patient_identity(),crm.patient_name_title_case(text) from public,anon,authenticated;
grant execute on function crm.patient_name_title_case(text) to service_role;

-- Replace rather than overload, so named/default RPC calls remain unambiguous.
-- Calls with the original ten arguments continue to work through defaults.
drop function crm.create_lead(uuid,text,text,text,uuid,uuid,integer,date,text,uuid);
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
  p_actor uuid,
  p_title text default null,
  p_gender text default null
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
    title,
    gender,
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
    p_title,
    p_gender,
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


revoke all on function crm.create_lead(uuid,text,text,text,uuid,uuid,integer,date,text,uuid,text,text) from public,anon,authenticated;
grant execute on function crm.create_lead(uuid,text,text,text,uuid,uuid,integer,date,text,uuid,text,text) to service_role;

-- Read-only patient ledger: never roll old debts into new invoice charges.
-- No page-size caps; void/archived invoices contribute zero and historic paid
-- invoices without receipts remain settled.
create function crm.get_invoice_patient_balance(p_invoice_id uuid,p_actor uuid)
returns table(amount_paid numeric,invoice_due numeric,earlier_due numeric,later_due numeric,overall_due numeric,earlier_invoice_count bigint)
language plpgsql stable security invoker set search_path='' as $function$
declare v_actor crm.profiles%rowtype; v_lead crm.leads%rowtype; v_invoice crm.invoices%rowtype;
begin
  select * into v_actor from crm.profiles where id=p_actor and is_active;
  if not found or v_actor.role::text not in ('admin','operations','front_office','clinical_head') then
    raise exception 'invoice access required' using errcode='42501';
  end if;
  select * into v_invoice from crm.invoices where id=p_invoice_id and deleted_at is null;
  if not found then raise exception 'invoice not found' using errcode='P0002'; end if;
  select * into v_lead from crm.leads where id=v_invoice.lead_id and deleted_at is null;
  if not found or v_invoice.branch_id is distinct from v_lead.branch_id then
    raise exception 'patient not found' using errcode='P0002';
  end if;
  if v_actor.role<>'admin' and not exists(select 1 from crm.user_branches where user_id=p_actor and branch_id=v_lead.branch_id) then
    raise exception 'no access to this patient center' using errcode='42501';
  end if;
  if v_actor.role='front_office' and v_lead.assignee_id is not null and v_lead.assignee_id<>p_actor then
    raise exception 'no access to this patient' using errcode='42501';
  end if;
  return query
    with balances as (
      select i.id,i.created_at,
        case when i.status='paid' and receipts.receipt_count=0 then i.total else receipts.received end as received,
        case when i.status='cancelled' then 0
          when i.status='paid' and receipts.receipt_count=0 then 0
          else greatest(0,i.total-receipts.received) end as due
      from crm.invoices i
      cross join lateral (
        select count(*) as receipt_count,coalesce(sum(p.amount),0) as received
        from crm.invoice_payments p where p.invoice_id=i.id
      ) receipts
      where i.lead_id=v_invoice.lead_id and i.branch_id=v_invoice.branch_id and i.deleted_at is null
    )
    select coalesce(max(b.received) filter(where b.id=p_invoice_id),0),
      coalesce(max(b.due) filter(where b.id=p_invoice_id),0),
      coalesce(sum(b.due) filter(where (b.created_at,b.id)<(v_invoice.created_at,v_invoice.id)),0),
      coalesce(sum(b.due) filter(where (b.created_at,b.id)>(v_invoice.created_at,v_invoice.id)),0),
      coalesce(sum(b.due),0),
      count(*) filter(where b.due>0 and (b.created_at,b.id)<(v_invoice.created_at,v_invoice.id))
    from balances b;
end
$function$;
revoke all on function crm.get_invoice_patient_balance(uuid,uuid) from public,anon,authenticated;
grant execute on function crm.get_invoice_patient_balance(uuid,uuid) to service_role;
notify pgrst,'reload schema';
