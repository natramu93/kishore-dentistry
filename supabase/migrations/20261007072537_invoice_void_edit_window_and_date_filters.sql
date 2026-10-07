-- Preserve existing invoice status/report contracts while exposing a clear void workflow.
alter table crm.invoices
  add column billing_date date generated always as
    (coalesce(invoice_date,(coalesce(issued_at,created_at) at time zone 'Asia/Kolkata')::date)) stored,
  add column void_reason text check (char_length(void_reason) between 1 and 1000),
  add column voided_at timestamptz,
  add column voided_by uuid references crm.profiles(id);
create index invoices_billing_date_active_idx on crm.invoices(billing_date,branch_id,created_at desc)
  where deleted_at is null;

create or replace function crm.update_invoice(
  p_invoice_id uuid, p_tax_rate numeric, p_notes text, p_items jsonb,
  p_actor uuid, p_expected_version bigint default null,
  p_discount_amount numeric default null, p_discount_given_by text default null, p_mention text default null
) returns crm.invoices
language plpgsql set search_path = ''
as $function$
declare
  v_old crm.invoices%rowtype; v_invoice crm.invoices%rowtype;
  v_subtotal numeric; v_tax numeric; v_discount numeric;
  v_item jsonb; v_line_id uuid; v_keep uuid[] := array[]::uuid[]; v_old_items jsonb;
begin
  select * into v_old from crm.invoices where id = p_invoice_id for update;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  perform crm.assert_invoice_write_access(p_actor, v_old.lead_id, false);
  if clock_timestamp() >= v_old.created_at + interval '24 hours' then
    raise exception 'invoices can only be edited within 24 hours of creation' using errcode='55000';
  end if;
  if v_old.deleted_at is not null or v_old.status in ('paid', 'cancelled') then
    raise exception 'paid, cancelled or archived invoices cannot be edited' using errcode = '55000';
  end if;
  if exists (select 1 from crm.invoice_payments where invoice_id=p_invoice_id) then
    raise exception 'an invoice with recorded payments cannot be edited; original charges are preserved' using errcode='55000';
  end if;
  select coalesce(jsonb_agg(to_jsonb(ii)), '[]'::jsonb) into v_old_items from crm.invoice_items ii where ii.invoice_id=p_invoice_id;
  if p_expected_version is not null and p_expected_version <> v_old.version then
    raise exception 'invoice was modified by another request' using errcode = '40001';
  end if;
  v_discount := coalesce(p_discount_amount, v_old.discount_amount);
  if p_tax_rate is null or p_tax_rate < 0 or p_tax_rate > 100 or p_tax_rate <> round(p_tax_rate, 2)
     or v_discount < 0 or v_discount <> round(v_discount, 2)
     or char_length(coalesce(p_discount_given_by, '')) > 200
     or char_length(coalesce(p_mention, '')) > 1000 or char_length(coalesce(p_notes, '')) > 4000 then
    raise exception 'invoice details are invalid' using errcode = '22023';
  end if;
  if v_old.code_enforced then
    v_subtotal := crm.coded_invoice_items_subtotal(p_items);
    -- Existing clinical links stay intact; independent invoices have no primary.
    if v_old.treatment_id is not null and not exists
      (select 1 from jsonb_array_elements(p_items) e where e.value->>'treatment_id' = v_old.treatment_id::text) then
      raise exception 'the original clinical treatment must remain on this invoice' using errcode = '23514';
    end if;
    if exists (select 1 from jsonb_array_elements(p_items) e where e.value->>'treatment_id' is not null) then
      perform 1 from crm.treatments t where t.id in
        (select (e.value->>'treatment_id')::uuid from jsonb_array_elements(p_items) e where e.value->>'treatment_id' is not null)
        order by t.id for update;
    end if;
  else
    v_subtotal := crm.invoice_items_subtotal(p_items);
  end if;
  if v_discount > v_subtotal then raise exception 'discount cannot exceed invoice subtotal' using errcode = '22023'; end if;
  v_tax := round((v_subtotal - v_discount) * p_tax_rate / 100, 2);
  -- The existing receipt guard rejects financial changes once payment is recorded.
  update crm.invoices set subtotal = v_subtotal, tax_rate = p_tax_rate, tax_amount = v_tax,
    total = v_subtotal - v_discount + v_tax, discount_amount = v_discount,
    discount_given_by = case when p_discount_amount is null then v_old.discount_given_by else nullif(btrim(p_discount_given_by), '') end,
    mention = case when p_discount_amount is null then v_old.mention else nullif(btrim(p_mention), '') end,
    notes = nullif(btrim(p_notes), '') where id = p_invoice_id returning * into v_invoice;
  -- Compatibility clients omit line IDs. Remove only replaced/removed lines
  -- before inserting, while new clients preserve stable invoice snapshots.
  delete from crm.invoice_items ii where ii.invoice_id=p_invoice_id and not exists
    (select 1 from jsonb_array_elements(p_items) e where e.value->>'invoice_item_id'=ii.id::text);
  for v_item in select value from jsonb_array_elements(p_items) loop
    if (v_item ? 'line_note' and jsonb_typeof(v_item->'line_note') not in ('string','null'))
       or char_length(coalesce(v_item->>'line_note','')) > 1000 then
      raise exception 'invoice line note must be text up to 1000 characters' using errcode='22023';
    end if;
    v_line_id := (v_item->>'invoice_item_id')::uuid;
    if v_line_id is not null then
      if v_line_id=any(v_keep) then raise exception 'invoice line appears more than once' using errcode='22023'; end if;
      update crm.invoice_items set
        treatment_id=case when v_old.code_enforced then (v_item->>'treatment_id')::uuid end,
        treatment_type_id=case when v_old.code_enforced then (v_item->>'treatment_type_id')::uuid end,
        quantity=(v_item->>'quantity')::numeric, unit_price=(v_item->>'unit_price')::numeric,
        tooth_numbers=crm.invoice_line_teeth(v_item),line_note=nullif(btrim(v_item->>'line_note'),'')
        where id=v_line_id and invoice_id=p_invoice_id;
      if not found then raise exception 'invoice line does not belong to this invoice' using errcode='22023'; end if;
    else
      insert into crm.invoice_items(invoice_id,treatment_id,treatment_type_id,description,quantity,unit_price,tooth_numbers,line_note)
        values(p_invoice_id,
          case when v_old.code_enforced then (v_item->>'treatment_id')::uuid end,
          case when v_old.code_enforced then (v_item->>'treatment_type_id')::uuid end,
          case when v_old.code_enforced then 'Selected treatment' else btrim(v_item->>'description') end,
          (v_item->>'quantity')::numeric,(v_item->>'unit_price')::numeric,
          crm.invoice_line_teeth(v_item),nullif(btrim(v_item->>'line_note'),'')) returning id into v_line_id;
    end if;
    v_keep := array_append(v_keep,v_line_id);
  end loop;
  delete from crm.invoice_items where invoice_id=p_invoice_id and not (id=any(v_keep));
  if v_old.code_enforced then perform crm.assert_coded_invoice_ready(p_invoice_id); end if;
  insert into crm.lead_activity(lead_id,actor_id,type,detail)
    values(v_invoice.lead_id,p_actor,'invoice',jsonb_build_object('event','invoice_updated','invoice_id',v_invoice.id,'invoice_number',v_invoice.invoice_number,'total',v_invoice.total));
  insert into crm.audit_log(entity_type,entity_id,action,actor_id,old_data,new_data)
    values('invoice',v_invoice.id,'updated',p_actor,to_jsonb(v_old)||jsonb_build_object('items',v_old_items),
      to_jsonb(v_invoice)||jsonb_build_object('items',(select jsonb_agg(to_jsonb(ii)) from crm.invoice_items ii where ii.invoice_id=p_invoice_id)));
  return v_invoice;
end
$function$;

drop function crm.cancel_invoice(uuid,uuid,text);
create or replace function crm.cancel_invoice(p_invoice_id uuid,p_actor uuid,p_reason text,p_expected_version bigint default null) returns crm.invoices
language plpgsql set search_path = ''
as $function$
declare v_old crm.invoices%rowtype; v_new crm.invoices%rowtype;
begin
  if not exists (select 1 from crm.profiles where id=p_actor and role='admin' and is_active) then
    raise exception 'only an admin can cancel invoices' using errcode='42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'cancellation reason is required' using errcode='22023';
  end if;
  select * into v_old from crm.invoices where id=p_invoice_id and deleted_at is null for update;
  if not found then raise exception 'invoice not found' using errcode='P0002'; end if;
  if p_expected_version is not null and p_expected_version <> v_old.version then
    raise exception 'invoice changed; refresh before voiding' using errcode='40001';
  end if;
  if v_old.status in ('paid','cancelled') or exists (select 1 from crm.invoice_payments where invoice_id=p_invoice_id) then
    raise exception 'only unpaid active invoices can be cancelled' using errcode='55000';
  end if;
  perform set_config('crm.cancelling_invoice',p_invoice_id::text,true);
  update crm.invoices set status='cancelled',void_reason=btrim(p_reason),voided_at=clock_timestamp(),voided_by=p_actor,notes=concat_ws(E'\n',notes,'Voided: '||btrim(p_reason))
    where id=p_invoice_id returning * into v_new;
  perform set_config('crm.cancelling_invoice','',true);
  insert into crm.audit_log(entity_type,entity_id,action,actor_id,old_data,new_data)
    values('invoice',p_invoice_id,'cancelled',p_actor,to_jsonb(v_old),to_jsonb(v_new));
  insert into crm.lead_activity(lead_id,actor_id,type,detail) values(v_old.lead_id,p_actor,'invoice',
    jsonb_build_object('event','invoice_cancelled','invoice_id',p_invoice_id,'reason',btrim(p_reason)));
  return v_new;
end
$function$;
revoke all on function crm.cancel_invoice(uuid,uuid,text,bigint) from public,anon,authenticated;
grant execute on function crm.cancel_invoice(uuid,uuid,text,bigint) to service_role;

-- Guard direct writes too. Payment/status updates remain available after 24 hours.
create function crm.guard_invoice_edit_window() returns trigger
language plpgsql set search_path='' as $function$
begin
  if row(new.void_reason,new.voided_at,new.voided_by) is distinct from row(old.void_reason,old.voided_at,old.voided_by)
     and (current_setting('crm.cancelling_invoice',true) is distinct from old.id::text or new.status<>'cancelled') then
    raise exception 'use the admin void workflow' using errcode='55000';
  end if;
  if clock_timestamp() >= old.created_at + interval '24 hours'
     and current_setting('crm.cancelling_invoice',true) is distinct from old.id::text
     and row(new.subtotal,new.tax_rate,new.tax_amount,new.total,new.discount_amount,new.discount_given_by,new.mention,new.notes)
       is distinct from row(old.subtotal,old.tax_rate,old.tax_amount,old.total,old.discount_amount,old.discount_given_by,old.mention,old.notes) then
    raise exception 'invoices can only be edited within 24 hours of creation' using errcode='55000';
  end if;
  return new;
end
$function$;
create trigger invoice_edit_window_guard before update on crm.invoices
  for each row execute function crm.guard_invoice_edit_window();

create function crm.guard_invoice_line_edit_window() returns trigger
language plpgsql set search_path='' as $function$
declare v_id uuid; v_created timestamptz; v_changed boolean;
begin
  if TG_OP='DELETE' then v_id:=old.invoice_id; v_changed:=true;
  elsif TG_OP='INSERT' then v_id:=new.invoice_id; v_changed:=true;
  else
    v_id:=old.invoice_id;
    v_changed:=row(new.invoice_id,new.description,new.quantity,new.unit_price,new.treatment_id,new.treatment_type_id,new.tooth_numbers,new.line_note)
      is distinct from row(old.invoice_id,old.description,old.quantity,old.unit_price,old.treatment_id,old.treatment_type_id,old.tooth_numbers,old.line_note);
  end if;
  -- Parent-row locking serializes line edits with payment recording and voiding.
  select created_at into v_created from crm.invoices where id=v_id for update;
  if v_changed and clock_timestamp() >= v_created + interval '24 hours' then
    raise exception 'invoices can only be edited within 24 hours of creation' using errcode='55000';
  end if;
  if TG_OP='DELETE' then return old; end if;
  return new;
end
$function$;
create trigger invoice_line_edit_window_guard before insert or update or delete on crm.invoice_items
  for each row execute function crm.guard_invoice_line_edit_window();
revoke all on function crm.guard_invoice_edit_window(),crm.guard_invoice_line_edit_window() from public,anon,authenticated;
notify pgrst,'reload schema';
