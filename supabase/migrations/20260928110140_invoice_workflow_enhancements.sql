-- Allow catalog-only patient invoices and preserve discount/mention details.
alter type crm.invoice_status add value if not exists 'cancelled';
create index if not exists invoice_payments_method_received_idx
  on crm.invoice_payments (payment_method, received_at desc, invoice_id);
create index if not exists invoice_payments_received_method_idx
  on crm.invoice_payments (received_at, payment_method);

alter table crm.invoices
  add column if not exists discount_amount numeric(12,2) not null default 0
    check (discount_amount >= 0),
  add column if not exists discount_given_by text
    check (discount_given_by is null or char_length(discount_given_by) <= 200),
  add column if not exists mention text
    check (mention is null or char_length(mention) <= 1000);

alter table crm.invoices drop constraint if exists invoices_amounts_valid_check;
alter table crm.invoices add constraint invoices_amounts_valid_check
  check (subtotal >= 0 and tax_rate between 0 and 100 and tax_amount >= 0
    and discount_amount between 0 and subtotal and total >= 0
    and total = subtotal - discount_amount + tax_amount) not valid;

create or replace function crm.create_patient_invoice(
  p_lead_id uuid, p_tax_rate numeric, p_discount_amount numeric,
  p_discount_given_by text, p_mention text, p_notes text,
  p_items jsonb, p_actor uuid
) returns crm.invoices
language plpgsql set search_path = ''
as $function$
declare
  v_lead crm.leads%rowtype;
  v_invoice crm.invoices%rowtype;
  v_item jsonb;
  v_subtotal numeric;
  v_tax numeric;
  v_total numeric;
  v_number text;
  v_primary uuid;
begin
  perform crm.assert_invoice_write_access(p_actor, p_lead_id, false);
  if p_tax_rate < 0 or p_tax_rate > 100 or p_tax_rate <> round(p_tax_rate, 2)
     or p_discount_amount < 0 or p_discount_amount <> round(p_discount_amount, 2)
     or char_length(coalesce(p_discount_given_by, '')) > 200
     or char_length(coalesce(p_mention, '')) > 1000
     or char_length(coalesce(p_notes, '')) > 4000 then
    raise exception 'invoice details are invalid' using errcode = '22023';
  end if;
  v_subtotal := crm.coded_invoice_items_subtotal(p_items);
  if p_discount_amount > v_subtotal then
    raise exception 'discount cannot exceed the invoice subtotal' using errcode = '22023';
  end if;
  select (e.value->>'treatment_id')::uuid into v_primary
  from jsonb_array_elements(p_items) e(value)
  where e.value ? 'treatment_id'
  limit 1;
  perform 1 from crm.treatments t where t.id in
    (select (e.value->>'treatment_id')::uuid from jsonb_array_elements(p_items) e where e.value ? 'treatment_id')
    order by t.id for update;
  for v_item in select value from jsonb_array_elements(p_items) where value ? 'treatment_type_id' loop
    if not exists (select 1 from crm.treatment_types tt
      where tt.id = (v_item->>'treatment_type_id')::uuid and tt.is_active
        and tt.branch_id = (select branch_id from crm.leads where id = p_lead_id)) then
      raise exception 'select active treatments from the patient center catalog' using errcode = '23514';
    end if;
  end loop;
  v_tax := round((v_subtotal - p_discount_amount) * p_tax_rate / 100, 2);
  v_total := v_subtotal - p_discount_amount + v_tax;
  select * into v_lead from crm.leads where id = p_lead_id for update;
  v_number := crm.next_invoice_number(v_lead.branch_id);
  insert into crm.invoices(invoice_number, lead_id, treatment_id, status, subtotal, tax_rate,
      tax_amount, total, discount_amount, discount_given_by, mention, notes, created_by, code_enforced)
    values(v_number, p_lead_id, v_primary, 'draft', v_subtotal, p_tax_rate,
      v_tax, v_total, p_discount_amount, nullif(btrim(p_discount_given_by), ''),
      nullif(btrim(p_mention), ''), nullif(btrim(p_notes), ''), p_actor, true)
    returning * into v_invoice;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if v_item ? 'treatment_id' then
      insert into crm.invoice_items(invoice_id, treatment_id, description, quantity, unit_price)
        values(v_invoice.id, (v_item->>'treatment_id')::uuid, 'Derived from treatment',
          (v_item->>'quantity')::numeric, (v_item->>'unit_price')::numeric);
    else
      insert into crm.invoice_items(invoice_id, treatment_type_id, description, quantity, unit_price)
        values(v_invoice.id, (v_item->>'treatment_type_id')::uuid, 'Selected treatment',
          (v_item->>'quantity')::numeric, (v_item->>'unit_price')::numeric);
    end if;
  end loop;
  insert into crm.lead_activity(lead_id, actor_id, type, detail)
    values(p_lead_id, p_actor, 'invoice', jsonb_build_object('event','invoice_created',
      'invoice_id',v_invoice.id,'invoice_number',v_invoice.invoice_number,'total',v_invoice.total,'code_enforced',true));
  insert into crm.audit_log(entity_type, entity_id, action, actor_id, new_data)
    values('invoice',v_invoice.id,'created',p_actor,to_jsonb(v_invoice));
  return v_invoice;
end
$function$;

create or replace function crm.assert_coded_invoice_ready(p_invoice_id uuid) returns void
language plpgsql set search_path = ''
as $function$
declare v_invoice crm.invoices%rowtype;
begin
  select * into v_invoice from crm.invoices where id = p_invoice_id;
  if not found or not v_invoice.code_enforced then return; end if;
  if exists (
    select 1 from crm.invoice_items ii
    left join crm.treatments t on t.id = ii.treatment_id
    left join crm.case_sheets c on c.id = t.case_sheet_id
    left join crm.treatment_types tt on tt.id = ii.treatment_type_id
    where ii.invoice_id = p_invoice_id and (
      (ii.treatment_id is not null and (
        t.id is null or t.lead_id <> v_invoice.lead_id or t.branch_id <> v_invoice.branch_id
        or t.clinical_status is distinct from 'completed' or t.performed_at is null or c.finalized_at is null
        or ii.treatment_code is distinct from t.treatment_code or ii.case_sheet_id is distinct from t.case_sheet_id
      )) or (ii.treatment_id is null and (ii.treatment_type_id is null or tt.id is null
        or not tt.is_active or tt.branch_id <> v_invoice.branch_id))
    )
  ) or v_invoice.subtotal is distinct from (
    select coalesce(sum(ii.amount),0) from crm.invoice_items ii where ii.invoice_id = p_invoice_id
  ) then
    raise exception 'invoice requires valid clinical or treatment-catalog lines' using errcode = '23514';
  end if;
end
$function$;

create or replace function crm.cancel_invoice(p_invoice_id uuid, p_actor uuid, p_reason text)
returns crm.invoices
language plpgsql set search_path = ''
as $function$
declare v_old crm.invoices%rowtype; v_new crm.invoices%rowtype; v_role text;
begin
  select role::text into v_role from crm.profiles where id = p_actor and is_active;
  if v_role is distinct from 'admin' then
    raise exception 'admin access required to cancel an invoice' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null or char_length(p_reason) > 1000 then
    raise exception 'a cancellation reason is required' using errcode = '22023';
  end if;
  select * into v_old from crm.invoices where id = p_invoice_id for update;
  if not found or v_old.deleted_at is not null then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if v_old.status = 'paid' or exists(select 1 from crm.invoice_payments p where p.invoice_id = p_invoice_id) then
    raise exception 'an invoice with receipts cannot be cancelled; reverse/refund the receipts first' using errcode = '55000';
  end if;
  if v_old.status = 'cancelled' then return v_old; end if;
  update crm.invoices set status = 'cancelled', notes = concat_ws(E'\n', notes, 'Cancellation: ' || btrim(p_reason))
    where id = p_invoice_id returning * into v_new;
  insert into crm.lead_activity(lead_id, actor_id, type, detail) values(v_new.lead_id,p_actor,'invoice',
    jsonb_build_object('event','invoice_cancelled','invoice_id',v_new.id,'invoice_number',v_new.invoice_number,'reason',btrim(p_reason)));
  insert into crm.audit_log(entity_type,entity_id,action,actor_id,old_data,new_data)
    values('invoice',v_new.id,'cancelled',p_actor,to_jsonb(v_old),to_jsonb(v_new));
  return v_new;
end
$function$;

revoke all on function crm.create_patient_invoice(uuid,numeric,numeric,text,text,text,jsonb,uuid),
  crm.cancel_invoice(uuid,uuid,text) from public, anon, authenticated;
grant execute on function crm.create_patient_invoice(uuid,numeric,numeric,text,text,text,jsonb,uuid),
  crm.cancel_invoice(uuid,uuid,text) to service_role;

create or replace function crm.get_daily_payment_collections(p_actor uuid, p_day_start timestamptz, p_day_end timestamptz)
returns table(payment_method text, amount numeric)
language plpgsql stable set search_path = ''
as $function$
declare v_role text;
begin
  select role::text into v_role from crm.profiles where id = p_actor and is_active;
  if v_role not in ('admin','operations','front_office','clinical_head') then
    raise exception 'dashboard access required' using errcode = '42501';
  end if;
  if p_day_start is null or p_day_end is null or p_day_end <= p_day_start
     or p_day_end - p_day_start > interval '2 days' then
    raise exception 'dashboard day range is invalid' using errcode = '22023';
  end if;
  return query
  select ip.payment_method::text, coalesce(sum(ip.amount),0)::numeric
  from crm.invoice_payments ip
  join crm.invoices i on i.id = ip.invoice_id
  join crm.leads l on l.id = i.lead_id
  where ip.received_at >= p_day_start and ip.received_at < p_day_end
    and i.deleted_at is null
    and (v_role = 'admin' or i.branch_id in (select ub.branch_id from crm.user_branches ub where ub.user_id = p_actor))
    and (v_role <> 'front_office' or l.assignee_id = p_actor or l.assignee_id is null)
  group by ip.payment_method;
end
$function$;
revoke all on function crm.get_daily_payment_collections(uuid,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function crm.get_daily_payment_collections(uuid,timestamptz,timestamptz) to service_role;

create or replace function crm.get_report_collections(p_actor uuid, p_from timestamptz, p_to timestamptz, p_branch_id uuid default null)
returns table(clinic_day date, amount numeric)
language plpgsql stable set search_path = ''
as $function$
declare v_role text;
begin
  select role::text into v_role from crm.profiles where id = p_actor and is_active;
  if v_role not in ('admin','operations','clinical_head') then
    raise exception 'reports access required' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '367 days' then
    raise exception 'report date range is invalid' using errcode = '22023';
  end if;
  if p_branch_id is not null and v_role <> 'admin'
     and not exists(select 1 from crm.user_branches ub where ub.user_id = p_actor and ub.branch_id = p_branch_id) then
    raise exception 'branch access required' using errcode = '42501';
  end if;
  return query
  select (ip.received_at at time zone 'Asia/Kolkata')::date,
         coalesce(sum(ip.amount),0)::numeric
  from crm.invoice_payments ip
  join crm.invoices i on i.id = ip.invoice_id
  join crm.leads l on l.id = i.lead_id
  where ip.received_at >= p_from and ip.received_at < p_to
    and i.deleted_at is null
    and (p_branch_id is null or i.branch_id = p_branch_id)
    and (v_role = 'admin' or i.branch_id in (select ub.branch_id from crm.user_branches ub where ub.user_id = p_actor))
  group by (ip.received_at at time zone 'Asia/Kolkata')::date
  order by 1;
end
$function$;
revoke all on function crm.get_report_collections(uuid,timestamptz,timestamptz,uuid) from public, anon, authenticated;
grant execute on function crm.get_report_collections(uuid,timestamptz,timestamptz,uuid) to service_role;
