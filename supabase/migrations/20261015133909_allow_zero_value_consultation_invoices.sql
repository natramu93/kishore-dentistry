-- Catalog invoices already allow zero-priced lines and fully discounted totals.
-- Keep the legacy consultation shortcut consistent without creating fake receipts
-- or changing the edit/void rules for existing invoices.
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
  v_amount numeric := p_amount;
begin
  perform crm.assert_invoice_write_access(p_actor, p_lead_id, false);
  if v_amount is null or v_amount < 0 or v_amount > 99999999.99 or v_amount <> round(v_amount, 2) then
    raise exception 'consultation amount must be zero or greater and have at most two decimals'
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
