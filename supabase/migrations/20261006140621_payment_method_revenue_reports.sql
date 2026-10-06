-- Return one JSON payload to avoid PostgREST row limits for a full year's receipts.
create function crm.get_report_payment_collections(
  p_actor uuid, p_from timestamptz, p_to timestamptz,
  p_branch_id uuid default null
) returns jsonb
language plpgsql stable security invoker set search_path = ''
as $function$
declare
  v_role text;
  v_result jsonb;
begin
  select role::text into v_role from crm.profiles where id = p_actor and is_active;
  if v_role is null or v_role not in ('admin', 'operations', 'clinical_head') then
    raise exception 'reports access required' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from
     or p_to - p_from > interval '367 days' then
    raise exception 'report date range is invalid' using errcode = '22023';
  end if;
  if p_branch_id is not null and v_role <> 'admin' and not exists (
    select 1 from crm.user_branches ub
    where ub.user_id = p_actor and ub.branch_id = p_branch_id
  ) then
    raise exception 'branch access required' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.day, r.method), '[]'::jsonb)
  into v_result
  from (
    select (ip.received_at at time zone 'Asia/Kolkata')::date as day,
      ip.payment_method::text as method, sum(ip.amount) as amount
    from crm.invoice_payments ip
    join crm.invoices i on i.id = ip.invoice_id
    where ip.received_at >= p_from and ip.received_at < p_to
      and i.deleted_at is null
      and (p_branch_id is null or i.branch_id = p_branch_id)
      and (v_role = 'admin' or exists (
        select 1 from crm.user_branches ub
        where ub.user_id = p_actor and ub.branch_id = i.branch_id
      ))
    group by 1, 2
  ) r;
  return v_result;
end
$function$;
revoke all on function crm.get_report_payment_collections(uuid, timestamptz, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function crm.get_report_payment_collections(uuid, timestamptz, timestamptz, uuid)
  to service_role;

create index if not exists invoice_payments_received_at_idx
  on crm.invoice_payments (received_at);
