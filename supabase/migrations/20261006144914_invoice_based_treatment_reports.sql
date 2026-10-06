create function crm.get_report_invoice_values(
  p_actor uuid, p_from timestamptz, p_to timestamptz,
  p_branch_id uuid default null, p_doctor_id uuid default null
) returns jsonb
language plpgsql stable security invoker set search_path = ''
as $function$
declare
  v_role text; v_doctor crm.doctors%rowtype; v_result jsonb;
begin
  select role::text into v_role from crm.profiles where id=p_actor and is_active;
  if v_role is null or v_role not in ('admin','operations','clinical_head') then
    raise exception 'reports access required' using errcode='42501';
  end if;
  if p_from is null or p_to is null or p_to<=p_from or p_to-p_from>interval '367 days' then
    raise exception 'report date range is invalid' using errcode='22023';
  end if;
  if p_branch_id is not null and v_role<>'admin' and not exists(
    select 1 from crm.user_branches where user_id=p_actor and branch_id=p_branch_id
  ) then raise exception 'branch access required' using errcode='42501'; end if;
  if p_doctor_id is not null then
    select * into v_doctor from crm.doctors where id=p_doctor_id and is_active;
    if not found then raise exception 'doctor not found' using errcode='22023'; end if;
    if (p_branch_id is not null and p_branch_id<>v_doctor.branch_id) or
      (v_role<>'admin' and not exists(select 1 from crm.user_branches where user_id=p_actor and branch_id=v_doctor.branch_id)) then
      raise exception 'doctor branch access required' using errcode='42501';
    end if;
  end if;

  with invoice_scope as materialized (
    select i.*, b.name as center,
      coalesce(i.invoice_date,(coalesce(i.issued_at,i.created_at) at time zone 'Asia/Kolkata')::date) as bill_day,
      coalesce(nullif(btrim(i.consulting_doctor_name),''),d.full_name,'Doctor not specified') as doctor
    from crm.invoices i
    join crm.branches b on b.id=i.branch_id
    left join crm.treatments t on t.id=i.treatment_id and t.branch_id=i.branch_id
    left join crm.doctors d on d.id=t.doctor_id and d.branch_id=i.branch_id
    where i.deleted_at is null and i.status<>'cancelled'
      and (p_branch_id is null or i.branch_id=p_branch_id)
      and (v_role='admin' or exists(select 1 from crm.user_branches ub where ub.user_id=p_actor and ub.branch_id=i.branch_id))
  ), scoped as materialized (
    select * from invoice_scope i
    where (i.bill_day::timestamp at time zone 'Asia/Kolkata')>=p_from
      and (i.bill_day::timestamp at time zone 'Asia/Kolkata')<p_to
      and (p_doctor_id is null or (i.branch_id=v_doctor.branch_id and lower(btrim(i.doctor))=lower(btrim(v_doctor.full_name))))
  ), lines as materialized (
    select i.id as invoice_id, ii.amount,
      coalesce(nullif(btrim(ii.treatment_category),''),nullif(btrim(tt.category),''),
        case when i.invoice_kind='consultation' then 'Consultation' else 'Uncategorized' end) as category,
      coalesce(nullif(btrim(ii.treatment_name),''),tt.name,nullif(btrim(ii.description),''),'Unspecified treatment') as treatment
    from scoped i join crm.invoice_items ii on ii.invoice_id=i.id
    left join crm.treatment_types tt on tt.id=ii.treatment_type_id and tt.branch_id=i.branch_id
  ), groups as (
    select 'doctor' as dimension, branch_id::text||':'||lower(btrim(doctor)) as key,
      min(doctor)||' · '||center as label, count(*) as invoices, sum(subtotal) as value from scoped group by branch_id,lower(btrim(doctor)),center
    union all
    select 'center',branch_id::text,center,count(*),sum(subtotal) from scoped group by branch_id,center
    union all
    select 'day',bill_day::text,bill_day::text,count(*),sum(subtotal) from scoped group by bill_day
    union all
    select 'month',to_char(bill_day,'YYYY-MM'),to_char(bill_day,'YYYY-MM'),count(*),sum(subtotal) from scoped group by to_char(bill_day,'YYYY-MM')
    union all
    select 'category',category,category,count(distinct invoice_id),sum(amount) from lines group by category
    union all
    select 'treatment',treatment,treatment,count(distinct invoice_id),sum(amount) from lines group by treatment
  )
  select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(to_jsonb(g) order by dimension,key) from groups g),'[]'::jsonb),
    'subtotal',coalesce(sum(subtotal),0),'discounts',coalesce(sum(discount_amount),0),
    'tax',coalesce(sum(tax_amount),0),'net',coalesce(sum(total),0), 'invoices',count(*)
  ) into v_result from scoped;
  return v_result;
end
$function$;
revoke all on function crm.get_report_invoice_values(uuid,timestamptz,timestamptz,uuid,uuid) from public,anon,authenticated;
grant execute on function crm.get_report_invoice_values(uuid,timestamptz,timestamptz,uuid,uuid) to service_role;
