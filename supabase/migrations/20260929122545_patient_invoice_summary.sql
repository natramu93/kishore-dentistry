-- Exact patient totals are independent of the visible invoice-history page.
-- Keep cancelled invoices in history, but never treat their charges as debt.
create function crm.get_patient_invoice_summary(p_lead_id uuid, p_actor uuid)
returns table(invoice_count bigint, total_invoiced numeric, amount_paid numeric, balance_due numeric)
language plpgsql stable security invoker set search_path = ''
as $function$
declare v_actor crm.profiles%rowtype; v_lead crm.leads%rowtype;
begin
  select * into v_actor from crm.profiles where id=p_actor and is_active;
  if not found or v_actor.role::text not in ('admin','operations','front_office','clinical_head') then
    raise exception 'invoice access required' using errcode='42501';
  end if;
  select * into v_lead from crm.leads where id=p_lead_id and deleted_at is null;
  if not found then raise exception 'patient not found' using errcode='P0002'; end if;
  if v_actor.role <> 'admin' and not exists (
    select 1 from crm.user_branches where user_id=p_actor and branch_id=v_lead.branch_id
  ) then raise exception 'no access to this patient center' using errcode='42501'; end if;
  if v_actor.role='front_office' and v_lead.assignee_id is not null and v_lead.assignee_id<>p_actor then
    raise exception 'no access to this patient' using errcode='42501';
  end if;
  return query
    with balances as (
      select i.total,
        case when i.status='paid' and receipts.receipt_count=0 then i.total
          else receipts.received end as received
      from crm.invoices i
      cross join lateral (
        select count(*) as receipt_count, coalesce(sum(p.amount),0) as received
        from crm.invoice_payments p where p.invoice_id=i.id
      ) receipts
      where i.lead_id=p_lead_id and i.branch_id=v_lead.branch_id
        and i.deleted_at is null and i.status<>'cancelled'
    )
    select count(*), coalesce(sum(b.total),0), coalesce(sum(b.received),0),
      coalesce(sum(greatest(0,b.total-b.received)),0) from balances b;
end
$function$;
revoke all on function crm.get_patient_invoice_summary(uuid,uuid) from public,anon,authenticated;
grant execute on function crm.get_patient_invoice_summary(uuid,uuid) to service_role;
notify pgrst, 'reload schema';
