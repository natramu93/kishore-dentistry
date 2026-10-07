-- Store immutable invoice doctor snapshots; do not invent details on legacy bills.
alter table crm.invoices add column referring_doctor_name text
  check (char_length(referring_doctor_name) <= 200);

-- Validate only new invoices so existing bills can still receive payments.
create function crm.guard_invoice_doctors() returns trigger
language plpgsql set search_path = '' as $function$
begin
  if TG_OP = 'INSERT' then
    if nullif(btrim(new.consulting_doctor_name),'') is null
       or nullif(btrim(new.referring_doctor_name),'') is null then
      raise exception 'consulting and referring doctor details are required' using errcode='22023';
    end if;
    new.consulting_doctor_name := btrim(new.consulting_doctor_name);
    new.referring_doctor_name := btrim(new.referring_doctor_name);
  elsif new.referring_doctor_name is distinct from old.referring_doctor_name then
    raise exception 'invoice doctor details are immutable' using errcode='22023';
  end if;
  return new;
end
$function$;
create trigger invoice_doctors_guard before insert or update on crm.invoices
  for each row execute function crm.guard_invoice_doctors();

drop function crm.create_patient_invoice(uuid,numeric,numeric,text,text,text,jsonb,uuid,date,text);
create function crm.create_patient_invoice(
  p_lead_id uuid, p_tax_rate numeric, p_discount_amount numeric,
  p_discount_given_by text, p_mention text, p_notes text, p_items jsonb, p_actor uuid,
  p_invoice_date date default (now() at time zone 'Asia/Kolkata')::date,
  p_consulting_doctor_name text default null,
  p_referring_doctor_name text default null
) returns crm.invoices language plpgsql set search_path = '' as $function$
declare
  v_lead crm.leads%rowtype; v_invoice crm.invoices%rowtype;
  v_subtotal numeric; v_tax numeric; v_number text; v_primary uuid;
begin
  perform crm.assert_invoice_write_access(p_actor,p_lead_id,false);
  if p_invoice_date is null or p_invoice_date not between date '0001-01-01' and date '9999-12-31'
     or char_length(coalesce(p_consulting_doctor_name,'')) > 200
     or char_length(coalesce(p_referring_doctor_name,'')) > 200
     or p_tax_rate is null or p_tax_rate < 0 or p_tax_rate > 100 or p_tax_rate <> round(p_tax_rate,2)
     or p_discount_amount is null or p_discount_amount < 0 or p_discount_amount <> round(p_discount_amount,2)
     or char_length(coalesce(p_discount_given_by,'')) > 200 or char_length(coalesce(p_mention,'')) > 1000
     or char_length(coalesce(p_notes,'')) > 4000 then
    raise exception 'invoice details are invalid' using errcode='22023';
  end if;
  v_subtotal := crm.coded_invoice_items_subtotal(p_items);
  if p_discount_amount > v_subtotal then raise exception 'discount cannot exceed the invoice subtotal' using errcode='22023'; end if;
  select (e.value->>'treatment_id')::uuid into v_primary from jsonb_array_elements(p_items) e(value)
    where e.value->>'treatment_id' is not null limit 1;
  if v_primary is not null then
    perform 1 from crm.treatments t where t.id in
      (select (e.value->>'treatment_id')::uuid from jsonb_array_elements(p_items) e where e.value->>'treatment_id' is not null)
      order by t.id for update;
  end if;
  select * into v_lead from crm.leads where id=p_lead_id for update;
  v_tax := round((v_subtotal-p_discount_amount)*p_tax_rate/100,2);
  v_number := crm.next_invoice_number(v_lead.branch_id);
  insert into crm.invoices(invoice_number,lead_id,treatment_id,status,subtotal,tax_rate,tax_amount,total,
    discount_amount,discount_given_by,mention,notes,created_by,code_enforced,invoice_date,consulting_doctor_name,referring_doctor_name)
  values(v_number,p_lead_id,v_primary,'draft',v_subtotal,p_tax_rate,v_tax,v_subtotal-p_discount_amount+v_tax,
    p_discount_amount,nullif(btrim(p_discount_given_by),''),nullif(btrim(p_mention),''),nullif(btrim(p_notes),''),
    p_actor,true,p_invoice_date,nullif(btrim(p_consulting_doctor_name),''),nullif(btrim(p_referring_doctor_name),'')) returning * into v_invoice;
  perform crm.insert_invoice_lines(v_invoice.id,p_items,true);
  perform crm.assert_coded_invoice_ready(v_invoice.id);
  insert into crm.lead_activity(lead_id,actor_id,type,detail) values(p_lead_id,p_actor,'invoice',
    jsonb_build_object('event','invoice_created','invoice_id',v_invoice.id,'invoice_number',v_number,
      'total',v_invoice.total,'invoice_date',v_invoice.invoice_date,'consulting_doctor_name',v_invoice.consulting_doctor_name,'referring_doctor_name',v_invoice.referring_doctor_name));
  insert into crm.audit_log(entity_type,entity_id,action,actor_id,new_data)
    values('invoice',v_invoice.id,'created',p_actor,to_jsonb(v_invoice));
  return v_invoice;
end
$function$;
revoke all on function crm.create_patient_invoice(uuid,numeric,numeric,text,text,text,jsonb,uuid,date,text,text) from public,anon,authenticated;
grant execute on function crm.create_patient_invoice(uuid,numeric,numeric,text,text,text,jsonb,uuid,date,text,text) to service_role;

drop function crm.create_consultation_invoice(uuid,numeric,text,uuid);
create or replace function crm.create_consultation_invoice(
  p_lead_id uuid,
  p_amount numeric,
  p_notes text,
  p_actor uuid,
  p_consulting_doctor_name text,
  p_referring_doctor_name text
) returns crm.invoices
language plpgsql
set search_path = ''
as $function$
declare
  v_lead crm.leads%rowtype;
  v_invoice crm.invoices%rowtype;
  v_number text;
  v_amount numeric := round(coalesce(p_amount, 0), 2);
begin
  perform crm.assert_invoice_write_access(p_actor, p_lead_id, false);
  if v_amount <= 0 or v_amount > 99999999.99 or v_amount <> round(v_amount, 2) then
    raise exception 'consultation amount must be greater than zero and have at most two decimals'
      using errcode = '22023';
  end if;
  if p_notes is not null and char_length(p_notes) > 4000 then
    raise exception 'invoice notes are too long' using errcode = '22023';
  end if;

  select * into v_lead from crm.leads where id = p_lead_id for update;
  if not found then
    raise exception 'lead % not found', p_lead_id using errcode = 'P0002';
  end if;
  v_number := crm.next_invoice_number(v_lead.branch_id);

  perform set_config('crm.allow_adhoc_invoice', 'on', true);
  insert into crm.invoices(
    invoice_number, lead_id, treatment_id, status, subtotal, tax_rate,
    tax_amount, total, notes, created_by, code_enforced, invoice_kind, consulting_doctor_name, referring_doctor_name
  ) values (
    v_number, p_lead_id, null, 'draft', v_amount, 0,
    0, v_amount, nullif(btrim(p_notes), ''), p_actor, false, 'consultation', btrim(p_consulting_doctor_name), btrim(p_referring_doctor_name)
  ) returning * into v_invoice;

  insert into crm.invoice_items(invoice_id, description, quantity, unit_price)
  values (v_invoice.id, 'Consultation', 1, v_amount);
  perform set_config('crm.allow_adhoc_invoice', 'off', true);

  insert into crm.lead_activity(lead_id, actor_id, type, detail)
  values (
    p_lead_id, p_actor, 'invoice',
    jsonb_build_object(
      'event', 'consultation_invoice_created',
      'invoice_id', v_invoice.id,
      'invoice_number', v_invoice.invoice_number,
      'total', v_invoice.total,
      'invoice_kind', 'consultation'
    )
  );
  insert into crm.audit_log(entity_type, entity_id, action, actor_id, new_data)
  values ('invoice', v_invoice.id, 'created', p_actor, to_jsonb(v_invoice));
  return v_invoice;
end
$function$;
revoke all on function crm.create_consultation_invoice(uuid,numeric,text,uuid,text,text) from public,anon,authenticated;
grant execute on function crm.create_consultation_invoice(uuid,numeric,text,uuid,text,text) to service_role;
revoke all on function crm.guard_invoice_doctors() from public,anon,authenticated;
