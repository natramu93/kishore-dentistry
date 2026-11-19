set local lock_timeout='5s';
set local statement_timeout='30s';

-- All invoice-list totals and drilldowns share this authoritative access scope.
-- Invoice dates and effective receipt dates are independent clinic-local days.
create function crm.finance_invoice_scope(p_actor uuid,p_filters jsonb,p_basis text)
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
      and (v_search is null or strpos(lower(l.name),lower(v_search))>0 or strpos(l.mobile,v_search)>0
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
revoke all on function crm.finance_invoice_scope(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function crm.finance_invoice_scope(uuid,jsonb,text) to service_role;

create function crm.get_invoice_activity(p_actor uuid,p_filters jsonb,p_page integer,p_page_size integer,p_sort text,p_desc boolean)
returns jsonb language plpgsql stable security invoker set search_path='' as $function$
declare v_result jsonb;
begin
  if p_page is null or p_page not between 1 and 100000 or p_page_size is null or p_page_size not between 1 and 100
    or p_sort is null or p_sort not in ('created','number','patient','center','date','total','paid','due','received','status') or p_desc is null then
    raise exception 'invalid invoice page or sort' using errcode='22023';
  end if;
  with scoped as materialized (select * from crm.finance_invoice_scope(p_actor,p_filters,'activity')),
  receipts as materialized (
    select p.* from crm.invoice_payments p join scoped i on i.id=p.invoice_id
    where i.status<>'cancelled'
      and (p_filters->>'from' is null or p.received_at>=((p_filters->>'from')::date::timestamp at time zone 'Asia/Kolkata'))
      and (p_filters->>'to' is null or p.received_at<(((p_filters->>'to')::date+1)::timestamp at time zone 'Asia/Kolkata'))
      and (p_filters->>'method' is null or p.payment_method::text=p_filters->>'method')
  ), invoice_values as (
    select i.*,l.name as patient_name,b.name as center,
      case when i.status='cancelled' then 0 when i.status='paid' and paid.n=0 then i.total else paid.amount end as amount_paid,
      case when i.status in ('cancelled','paid') then 0 else greatest(0,i.total-paid.amount) end as balance_due,
      coalesce((select sum(p.amount) from receipts p where p.invoice_id=i.id),0) as received_in_range,
      jsonb_build_object('id',l.id,'name',l.name,'title',l.title,'mobile',l.mobile,'email',l.email,'assignee_id',l.assignee_id) as lead,
      jsonb_build_object('name',b.name,'code',b.code,'address',b.address,'phone',b.phone,
        'company_name',b.company_name,'invoice_email',b.invoice_email,'gst_number',b.gst_number) as branch
    from scoped i join crm.leads l on l.id=i.lead_id join crm.branches b on b.id=i.branch_id
    cross join lateral(select count(*) n,coalesce(sum(p.amount),0) amount from crm.invoice_payments p where p.invoice_id=i.id) paid
  ), ranked as (
    select v.*,row_number() over(order by
      case when p_sort='created' and not p_desc then created_at end asc,
      case when p_sort='created' and p_desc then created_at end desc,
      case when p_sort='date' and not p_desc then billing_date end asc,
      case when p_sort='date' and p_desc then billing_date end desc,
      case when not p_desc then case p_sort when 'number' then invoice_number when 'patient' then lower(patient_name) when 'center' then lower(center) when 'status' then status::text end end asc,
      case when p_desc then case p_sort when 'number' then invoice_number when 'patient' then lower(patient_name) when 'center' then lower(center) when 'status' then status::text end end desc,
      case when not p_desc then case p_sort when 'total' then case when status='cancelled' then 0 else total end when 'paid' then amount_paid when 'due' then balance_due when 'received' then received_in_range end end asc,
      case when p_desc then case p_sort when 'total' then case when status='cancelled' then 0 else total end when 'paid' then amount_paid when 'due' then balance_due when 'received' then received_in_range end end desc,
      id) as ordinal from invoice_values v
  ), page as (select * from ranked order by ordinal offset ((p_page-1)*p_page_size) limit p_page_size)
  select jsonb_build_object('total',(select count(*) from scoped),
    'collections',jsonb_build_object(
      'upi',coalesce((select sum(amount) from receipts where payment_method='upi'),0),
      'cash',coalesce((select sum(amount) from receipts where payment_method='cash'),0),
      'card',coalesce((select sum(amount) from receipts where payment_method='card'),0),
      'neft',coalesce((select sum(amount) from receipts where payment_method='neft'),0),
      'amount',coalesce((select sum(amount) from receipts),0)),
    'invoices',coalesce((select jsonb_agg(to_jsonb(p)-'ordinal' order by ordinal) from page p),'[]'::jsonb)) into v_result;
  return v_result;
end
$function$;
revoke all on function crm.get_invoice_activity(uuid,jsonb,integer,integer,text,boolean) from public,anon,authenticated;
grant execute on function crm.get_invoice_activity(uuid,jsonb,integer,integer,text,boolean) to service_role;

create function crm.get_finance_details(p_actor uuid,p_filters jsonb,p_source text,p_metric text,p_page integer,p_page_size integer)
returns jsonb language plpgsql stable security invoker set search_path='' as $function$
declare v_result jsonb; v_basis text;
begin
  if p_source is null or p_source not in ('invoices','reports') or p_metric is null or p_metric not in ('receipts','subtotal','discounts','tax','net')
    or p_page is null or p_page not between 1 and 100000 or p_page_size is null or p_page_size not between 1 and 100 then
    raise exception 'invalid finance detail request' using errcode='22023';
  end if;
  if p_source='reports' and not exists(select 1 from crm.profiles where id=p_actor and is_active and role in ('admin','operations','clinical_head')) then
    raise exception 'reports access required' using errcode='42501';
  end if;
  -- Report receipt cards intentionally ignore the doctor filter, like their total.
  if p_source='reports' and p_metric='receipts' then p_filters:=p_filters-'doctor'; end if;
  v_basis:=case when p_source='invoices' then 'activity' when p_metric='receipts' then 'receipt' else 'invoice' end;
  with scoped as materialized (
    select i.*,l.title,l.name as patient_name,b.name as center from crm.finance_invoice_scope(p_actor,p_filters,v_basis) i
    join crm.leads l on l.id=i.lead_id join crm.branches b on b.id=i.branch_id
    where i.status<>'cancelled' and (p_metric='receipts' or i.invoice_kind<>'opening_balance')
  ), details as (
    select p.id::text as id,i.id as invoice_id,i.lead_id as patient_id,i.invoice_number,
      concat_ws(' ',nullif(i.title,''),i.patient_name) as patient_name,i.center,
      (p.received_at at time zone 'Asia/Kolkata')::date as date,i.billing_date as invoice_date,
      'Payment receipt'::text as description,p.payment_method::text as method,p.reference,p.amount
    from scoped i join crm.invoice_payments p on p.invoice_id=i.id
    where p_metric='receipts'
      and (p_filters->>'from' is null or p.received_at>=((p_filters->>'from')::date::timestamp at time zone 'Asia/Kolkata'))
      and (p_filters->>'to' is null or p.received_at<(((p_filters->>'to')::date+1)::timestamp at time zone 'Asia/Kolkata'))
      and (p_filters->>'method' is null or p.payment_method::text=p_filters->>'method')
    union all
    select ii.id::text,i.id,i.lead_id,i.invoice_number,concat_ws(' ',nullif(i.title,''),i.patient_name),i.center,
      i.billing_date,i.billing_date,ii.description,null::text,null::text,ii.amount
    from scoped i join crm.invoice_items ii on ii.invoice_id=i.id where p_metric in ('subtotal','net')
    union all
    select i.id::text||':adjustment',i.id,i.lead_id,i.invoice_number,concat_ws(' ',nullif(i.title,''),i.patient_name),i.center,
      i.billing_date,i.billing_date,'Invoice subtotal adjustment',null::text,null::text,
      i.subtotal-(select coalesce(sum(ii.amount),0) from crm.invoice_items ii where ii.invoice_id=i.id)
    from scoped i where p_metric in ('subtotal','net') and i.subtotal<>(select coalesce(sum(ii.amount),0) from crm.invoice_items ii where ii.invoice_id=i.id)
    union all
    select i.id::text||':discount',i.id,i.lead_id,i.invoice_number,concat_ws(' ',nullif(i.title,''),i.patient_name),i.center,
      i.billing_date,i.billing_date,'Invoice discount',null::text,null::text,
      case when p_metric='net' then -i.discount_amount else i.discount_amount end
    from scoped i where p_metric in ('discounts','net') and i.discount_amount<>0
    union all
    select i.id::text||':tax',i.id,i.lead_id,i.invoice_number,concat_ws(' ',nullif(i.title,''),i.patient_name),i.center,
      i.billing_date,i.billing_date,'Invoice tax',null::text,null::text,i.tax_amount
    from scoped i where p_metric in ('tax','net') and i.tax_amount<>0
  ), page as (select * from details order by date desc,invoice_number,id offset ((p_page-1)*p_page_size) limit p_page_size)
  select jsonb_build_object('total',(select count(*) from details),'amount',coalesce((select sum(amount) from details),0),
    'rows',coalesce((select jsonb_agg(to_jsonb(p) order by date desc,invoice_number,id) from page p),'[]'::jsonb)) into v_result;
  return v_result;
end
$function$;
revoke all on function crm.get_finance_details(uuid,jsonb,text,text,integer,integer) from public,anon,authenticated;
grant execute on function crm.get_finance_details(uuid,jsonb,text,text,integer,integer) to service_role;

notify pgrst,'reload schema';
