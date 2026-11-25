set local lock_timeout='5s';
set local statement_timeout='30s';

-- Add invoice numbers to the same search used by the list, export and receipt details.
-- Keep existing filters, access rules and function grants intact.
create or replace function crm.finance_invoice_scope(p_actor uuid,p_filters jsonb,p_basis text)
returns setof crm.invoices language plpgsql stable security invoker set search_path='' as $function$
declare
  v_role text; v_from date; v_to date; v_start timestamptz; v_end timestamptz;
  v_branch uuid; v_patient uuid; v_doctor uuid; v_doctor_row crm.doctors%rowtype;
  v_search text; v_phone text; v_status text; v_method text; v_due boolean;
begin
  select role::text into v_role from crm.profiles where id=p_actor and is_active;
  if v_role is null or v_role not in ('admin','operations','front_office','clinical_head') then
    raise exception 'invoice access required' using errcode='42501';
  end if;
  if p_basis not in ('activity','invoice','receipt') or jsonb_typeof(p_filters) is distinct from 'object' then
    raise exception 'invalid financial filters' using errcode='22023';
  end if;
  v_from:=(p_filters->>'from')::date; v_to:=(p_filters->>'to')::date;
  if (v_from is not null and (not isfinite(v_from) or v_from<date '0001-01-01' or v_from>date '9999-12-30'))
    or (v_to is not null and (not isfinite(v_to) or v_to<date '0001-01-01' or v_to>date '9999-12-30'))
    or v_from>v_to then raise exception 'invalid financial date range' using errcode='22023'; end if;
  v_start:=v_from::timestamp at time zone 'Asia/Kolkata';
  v_end:=(v_to+1)::timestamp at time zone 'Asia/Kolkata';
  v_branch:=(p_filters->>'branch')::uuid; v_patient:=(p_filters->>'patient')::uuid;
  v_doctor:=(p_filters->>'doctor')::uuid;
  v_search:=nullif(btrim(p_filters->>'search'),'');
  v_phone:=nullif(regexp_replace(coalesce(v_search,''),'[^0-9]','','g'),'');
  v_status:=p_filters->>'status'; v_method:=p_filters->>'method'; v_due:=coalesce((p_filters->>'due')::boolean,false);
  if length(v_search)>120 or (v_status is not null and v_status not in ('draft','sent','paid','cancelled'))
     or (v_method is not null and v_method not in ('cash','upi','card','neft')) then
    raise exception 'invalid invoice filters' using errcode='22023';
  end if;
  if v_branch is not null and v_role<>'admin' and not exists(
    select 1 from crm.user_branches where user_id=p_actor and branch_id=v_branch
  ) then raise exception 'branch access required' using errcode='42501'; end if;
  if v_doctor is not null then
    select * into v_doctor_row from crm.doctors where id=v_doctor and is_active;
    if not found or (v_branch is not null and v_branch<>v_doctor_row.branch_id)
      or (v_role<>'admin' and not exists(select 1 from crm.user_branches where user_id=p_actor and branch_id=v_doctor_row.branch_id)) then
      raise exception 'doctor branch access required' using errcode='42501';
    end if;
  end if;
  return query select i.* from crm.invoices i join crm.leads l on l.id=i.lead_id and l.branch_id=i.branch_id
    left join crm.treatments t on t.id=i.treatment_id and t.branch_id=i.branch_id
    left join crm.doctors d on d.id=t.doctor_id and d.branch_id=i.branch_id
    where i.deleted_at is null
      and (v_branch is null or i.branch_id=v_branch) and (v_patient is null or i.lead_id=v_patient)
      and (v_role='admin' or exists(select 1 from crm.user_branches where user_id=p_actor and branch_id=i.branch_id))
      and (v_role<>'front_office' or l.assignee_id=p_actor or l.assignee_id is null)
      and ((v_status is null and i.status<>'cancelled') or i.status::text=v_status)
      and (v_search is null or strpos(lower(i.invoice_number),lower(v_search))>0
        or strpos(lower(l.name),lower(v_search))>0 or strpos(l.mobile,v_search)>0
        or (v_search ~ '^[+0-9 .-]+$' and v_phone is not null and strpos(regexp_replace(l.mobile,'[^0-9]','','g'),v_phone)>0))
      and (v_doctor is null or (i.branch_id=v_doctor_row.branch_id and
        lower(btrim(coalesce(nullif(btrim(i.consulting_doctor_name),''),d.full_name,'Doctor not specified')))=lower(btrim(v_doctor_row.full_name))))
      and (not v_due or (i.status not in ('paid','cancelled') and i.total>
        (select coalesce(sum(p.amount),0) from crm.invoice_payments p where p.invoice_id=i.id)))
      and (v_method is null or exists(select 1 from crm.invoice_payments p where p.invoice_id=i.id
        and p.payment_method::text=v_method and (v_start is null or p.received_at>=v_start) and (v_end is null or p.received_at<v_end)))
      and (p_basis='receipt' or
        ((v_from is null or i.billing_date>=v_from) and (v_to is null or i.billing_date<=v_to))
        or (p_basis='activity' and exists(select 1 from crm.invoice_payments p where p.invoice_id=i.id
          and (v_start is null or p.received_at>=v_start) and (v_end is null or p.received_at<v_end))));
end
$function$;
