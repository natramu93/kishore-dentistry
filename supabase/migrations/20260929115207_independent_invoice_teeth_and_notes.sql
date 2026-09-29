-- A catalog invoice describes charges independently of the clinical record.
-- Tooth selection here must never create/complete a treatment or case sheet.
alter table crm.invoice_items add column line_note text
  check (line_note is null or char_length(line_note) <= 1000);

-- SELECT ... FOR UPDATE needs UPDATE on at least one column. Grant only the
-- immutable identifier, never clinical columns. The unconditional trigger also
-- protects legacy rows and cannot be bypassed by the amendment session setting.
create function crm.prevent_treatment_identity_change() returns trigger
language plpgsql set search_path = ''
as $function$
begin
  if new.id is distinct from old.id then
    raise exception 'treatment identity is immutable' using errcode = '55000';
  end if;
  return new;
end
$function$;
create trigger a_prevent_treatment_identity_change before update of id on crm.treatments
  for each row execute function crm.prevent_treatment_identity_change();
revoke all on function crm.prevent_treatment_identity_change() from public, anon, authenticated;
grant update(id) on crm.treatments to service_role;

create function crm.invoice_line_teeth(p_item jsonb) returns text[]
language plpgsql immutable set search_path = ''
as $function$
declare v_teeth text[];
begin
  if not p_item ? 'tooth_numbers' then return array[]::text[]; end if;
  if jsonb_typeof(p_item->'tooth_numbers') is distinct from 'array'
     or jsonb_array_length(p_item->'tooth_numbers') > 52 then
    raise exception 'invoice teeth must be a list of up to 52 teeth' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_item->'tooth_numbers') t(value)
    where jsonb_typeof(t.value) is distinct from 'string') then
    raise exception 'invoice tooth numbers must be strings' using errcode = '22023';
  end if;
  select coalesce(array_agg(t.value order by t.position), array[]::text[]) into v_teeth
    from jsonb_array_elements_text(p_item->'tooth_numbers') with ordinality t(value, position);
  if cardinality(v_teeth) <> (select count(distinct t) from unnest(v_teeth) t)
     or exists (select 1 from unnest(v_teeth) t
       where t !~ '^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$') then
    raise exception 'select valid, distinct Indian-standard tooth numbers' using errcode = '22023';
  end if;
  return v_teeth;
end
$function$;

create or replace function crm.populate_coded_invoice_item() returns trigger
language plpgsql set search_path = ''
as $function$
declare
  v_invoice crm.invoices%rowtype;
  v_treatment crm.treatments%rowtype;
  v_catalog crm.treatment_types%rowtype;
begin
  select * into v_invoice from crm.invoices where id = new.invoice_id;
  if not found then return new; end if;
  new.active_billing := case
    when current_user = 'postgres' and current_setting('crm.archiving_invoice', true) = new.invoice_id::text then false
    else v_invoice.deleted_at is null and v_invoice.status <> 'cancelled'
  end;
  new.line_note := nullif(btrim(new.line_note), '');
  -- Archiving updates only active_billing. Preserve the historical snapshot even
  -- when an administrator has since retired the treatment from the catalog.
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'active_billing') = (to_jsonb(old) - 'active_billing') then
    return new;
  end if;
  if not v_invoice.code_enforced then return new; end if;
  if new.treatment_type_id is not null then
    if new.treatment_id is not null then
      raise exception 'catalog invoice lines cannot also reference a case-sheet treatment' using errcode = '23514';
    end if;
    select * into v_catalog from crm.treatment_types where id = new.treatment_type_id;
    if not found or not v_catalog.is_active or v_catalog.branch_id is distinct from v_invoice.branch_id then
      raise exception 'select an active treatment from the patient center catalog' using errcode = '23514';
    end if;
    new.tooth_numbers := crm.invoice_line_teeth(jsonb_build_object('tooth_numbers', coalesce(new.tooth_numbers, array[]::text[])));
    new.tooth_number := new.tooth_numbers[1];
    new.site_scope := case cardinality(new.tooth_numbers)
      when 0 then 'not_applicable' when 1 then 'tooth' else 'multi_tooth' end;
    if tg_op = 'UPDATE' and new.treatment_type_id is not distinct from old.treatment_type_id
       and new.invoice_id is not distinct from old.invoice_id then
      new.description := old.description;
      new.treatment_name := old.treatment_name;
      new.treatment_category := old.treatment_category;
    else
      new.description := v_catalog.name;
      new.treatment_name := v_catalog.name;
      new.treatment_category := v_catalog.category;
    end if;
    new.treatment_code := null;
    new.case_sheet_id := null;
    new.site_detail := null;
    new.surfaces := null;
    return new;
  end if;
  if new.treatment_id is null then
    raise exception 'invoice line must reference a clinical or catalog treatment' using errcode = '23514';
  end if;
  select * into v_treatment from crm.treatments where id = new.treatment_id;
  if not found or v_treatment.lead_id is distinct from v_invoice.lead_id
     or v_treatment.branch_id is distinct from v_invoice.branch_id
     or v_treatment.clinical_status is distinct from 'completed'
     or v_treatment.treatment_code is null or v_treatment.case_sheet_id is null
     or v_treatment.performed_at is null then
    raise exception 'linked clinical invoice line must be a completed coded treatment for this patient' using errcode = '23514';
  end if;
  if not exists (select 1 from crm.case_sheets c where c.id = v_treatment.case_sheet_id and c.finalized_at is not null) then
    raise exception 'invoice treatment case sheet is not finalized' using errcode = '23514';
  end if;
  if new.quantity is distinct from v_treatment.quantity then
    raise exception 'linked invoice quantity must match the signed treatment quantity' using errcode = '23514';
  end if;
  -- Clinical snapshots are authoritative for old linked invoices. Catalog lines
  -- remain independent and can have freely selected billing quantity and teeth.
  new.description := '[' || v_treatment.treatment_code || '] ' || v_treatment.treatment_name || case v_treatment.site_scope
    when 'arch' then ' - ' || initcap(v_treatment.site_detail) || ' arch'
    when 'quadrant' then ' - ' || initcap(replace(v_treatment.site_detail, '_', ' ')) || ' quadrant'
    when 'full_mouth' then ' - Full mouth'
    else '' end;
  new.treatment_code := v_treatment.treatment_code;
  new.treatment_name := v_treatment.treatment_name;
  new.treatment_category := v_treatment.treatment_category;
  new.case_sheet_id := v_treatment.case_sheet_id;
  new.tooth_number := v_treatment.tooth_number;
  new.tooth_numbers := v_treatment.tooth_numbers;
  new.site_scope := v_treatment.site_scope;
  new.site_detail := v_treatment.site_detail;
  new.surfaces := v_treatment.surfaces;
  return new;
end
$function$;

create or replace function crm.assert_coded_invoice_ready(p_invoice_id uuid) returns void
language plpgsql set search_path = ''
as $function$
declare v_invoice crm.invoices%rowtype;
begin
  select * into v_invoice from crm.invoices where id = p_invoice_id;
  if not found or not v_invoice.code_enforced then return; end if;
  if not exists (select 1 from crm.invoice_items where invoice_id=p_invoice_id)
     or exists (
    select 1 from crm.invoice_items ii
    left join crm.treatments t on t.id=ii.treatment_id
    left join crm.case_sheets c on c.id=t.case_sheet_id
    left join crm.treatment_types tt on tt.id=ii.treatment_type_id
    where ii.invoice_id=p_invoice_id and (
      (ii.treatment_id is not null and (t.id is null or t.lead_id<>v_invoice.lead_id or t.branch_id<>v_invoice.branch_id
        or t.clinical_status is distinct from 'completed' or t.performed_at is null or c.finalized_at is null
        or ii.treatment_code is distinct from t.treatment_code or ii.case_sheet_id is distinct from t.case_sheet_id))
      or (ii.treatment_id is null and (tt.id is null or tt.branch_id<>v_invoice.branch_id or ii.treatment_name is null))
    )) or v_invoice.subtotal is distinct from (select coalesce(sum(amount),0) from crm.invoice_items where invoice_id=p_invoice_id) then
    raise exception 'invoice requires valid clinical or treatment-catalog lines' using errcode='23514';
  end if;
end
$function$;

-- Internal helper shared by create and edit so no path drops teeth or notes.
create function crm.insert_invoice_lines(p_invoice_id uuid, p_items jsonb, p_coded boolean) returns void
language plpgsql set search_path = ''
as $function$
declare v_item jsonb; v_teeth text[];
begin
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_teeth := crm.invoice_line_teeth(v_item);
    if (v_item ? 'line_note' and jsonb_typeof(v_item->'line_note') not in ('string', 'null'))
       or char_length(coalesce(v_item->>'line_note', '')) > 1000 then
      raise exception 'invoice line note must be text up to 1000 characters' using errcode = '22023';
    end if;
    insert into crm.invoice_items(invoice_id, treatment_id, treatment_type_id, description,
        quantity, unit_price, tooth_numbers, line_note)
      values(p_invoice_id,
        case when p_coded then (v_item->>'treatment_id')::uuid end,
        case when p_coded then (v_item->>'treatment_type_id')::uuid end,
        case when p_coded then 'Selected treatment' else btrim(v_item->>'description') end,
        (v_item->>'quantity')::numeric, (v_item->>'unit_price')::numeric,
        v_teeth, nullif(btrim(v_item->>'line_note'), ''));
  end loop;
end
$function$;

create or replace function crm.create_patient_invoice(
  p_lead_id uuid, p_tax_rate numeric, p_discount_amount numeric,
  p_discount_given_by text, p_mention text, p_notes text,
  p_items jsonb, p_actor uuid
) returns crm.invoices
language plpgsql set search_path = ''
as $function$
declare
  v_lead crm.leads%rowtype; v_invoice crm.invoices%rowtype;
  v_subtotal numeric; v_tax numeric; v_number text; v_primary uuid;
begin
  perform crm.assert_invoice_write_access(p_actor, p_lead_id, false);
  if p_tax_rate is null or p_tax_rate < 0 or p_tax_rate > 100 or p_tax_rate <> round(p_tax_rate, 2)
     or p_discount_amount is null or p_discount_amount < 0 or p_discount_amount <> round(p_discount_amount, 2)
     or char_length(coalesce(p_discount_given_by, '')) > 200
     or char_length(coalesce(p_mention, '')) > 1000 or char_length(coalesce(p_notes, '')) > 4000 then
    raise exception 'invoice details are invalid' using errcode = '22023';
  end if;
  v_subtotal := crm.coded_invoice_items_subtotal(p_items);
  if p_discount_amount > v_subtotal then
    raise exception 'discount cannot exceed the invoice subtotal' using errcode = '22023';
  end if;
  select (e.value->>'treatment_id')::uuid into v_primary
    from jsonb_array_elements(p_items) e(value) where e.value->>'treatment_id' is not null limit 1;
  if v_primary is not null then
    perform 1 from crm.treatments t where t.id in
      (select (e.value->>'treatment_id')::uuid from jsonb_array_elements(p_items) e where e.value->>'treatment_id' is not null)
      order by t.id for update;
  end if;
  select * into v_lead from crm.leads where id = p_lead_id for update;
  v_tax := round((v_subtotal - p_discount_amount) * p_tax_rate / 100, 2);
  v_number := crm.next_invoice_number(v_lead.branch_id);
  insert into crm.invoices(invoice_number, lead_id, treatment_id, status, subtotal, tax_rate,
      tax_amount, total, discount_amount, discount_given_by, mention, notes, created_by, code_enforced)
    values(v_number, p_lead_id, v_primary, 'draft', v_subtotal, p_tax_rate,
      v_tax, v_subtotal - p_discount_amount + v_tax, p_discount_amount, nullif(btrim(p_discount_given_by), ''),
      nullif(btrim(p_mention), ''), nullif(btrim(p_notes), ''), p_actor, true)
    returning * into v_invoice;
  perform crm.insert_invoice_lines(v_invoice.id, p_items, true);
  perform crm.assert_coded_invoice_ready(v_invoice.id);
  insert into crm.lead_activity(lead_id, actor_id, type, detail)
    values(p_lead_id, p_actor, 'invoice', jsonb_build_object('event','invoice_created',
      'invoice_id',v_invoice.id,'invoice_number',v_invoice.invoice_number,'total',v_invoice.total,'code_enforced',true));
  insert into crm.audit_log(entity_type, entity_id, action, actor_id, new_data)
    values('invoice',v_invoice.id,'created',p_actor,to_jsonb(v_invoice));
  return v_invoice;
end
$function$;

drop function crm.update_invoice(uuid,numeric,text,jsonb,uuid,bigint);
create function crm.update_invoice(
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

revoke all on function crm.invoice_line_teeth(jsonb), crm.insert_invoice_lines(uuid,jsonb,boolean),
  crm.update_invoice(uuid,numeric,text,jsonb,uuid,bigint,numeric,text,text)
  from public, anon, authenticated;
grant execute on function crm.invoice_line_teeth(jsonb), crm.insert_invoice_lines(uuid,jsonb,boolean),
  crm.update_invoice(uuid,numeric,text,jsonb,uuid,bigint,numeric,text,text),
  crm.coded_invoice_items_subtotal(jsonb), crm.assert_coded_invoice_ready(uuid) to service_role;

-- Complete the cancellation workflow: the older transition trigger predates
-- the cancelled status and otherwise rejects the admin cancellation RPC.
create or replace function crm.validate_invoice_update() returns trigger
language plpgsql set search_path = ''
as $function$
declare v_allowed boolean;
begin
  if old.deleted_at is not null then raise exception 'deleted invoice is immutable' using errcode='55000'; end if;
  if row(new.id,new.invoice_number,new.lead_id,new.branch_id,new.treatment_id,new.created_by,new.created_at)
    is distinct from row(old.id,old.invoice_number,old.lead_id,old.branch_id,old.treatment_id,old.created_by,old.created_at) then
    raise exception 'invoice identity fields are immutable' using errcode='55000';
  end if;
  if old.status in ('paid','cancelled') and
    row(new.subtotal,new.tax_rate,new.tax_amount,new.total,new.discount_amount,new.discount_given_by,new.mention,new.issued_at,new.notes)
    is distinct from row(old.subtotal,old.tax_rate,old.tax_amount,old.total,old.discount_amount,old.discount_given_by,old.mention,old.issued_at,old.notes) then
    raise exception 'paid or cancelled invoice details are immutable' using errcode='55000';
  end if;
  if new.status is distinct from old.status then
    v_allowed := case old.status
      when 'draft' then new.status in ('sent','paid','cancelled')
      when 'sent' then new.status in ('paid','cancelled') else false end;
    if not v_allowed then raise exception 'illegal invoice transition: % -> %',old.status,new.status using errcode='23514'; end if;
    if new.status='cancelled' and (
      current_setting('crm.cancelling_invoice',true) is distinct from old.id::text
      or exists (select 1 from crm.invoice_payments where invoice_id=old.id)) then
      raise exception 'use the admin cancellation workflow for an unpaid invoice' using errcode='55000';
    end if;
    if new.status in ('sent','paid') then new.issued_at := coalesce(old.issued_at,new.issued_at,now()); end if;
    if new.status='paid' then new.paid_at := coalesce(old.paid_at,now()); end if;
  end if;
  return new;
end
$function$;

create or replace function crm.cancel_invoice(p_invoice_id uuid,p_actor uuid,p_reason text) returns crm.invoices
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
  if v_old.status in ('paid','cancelled') or exists (select 1 from crm.invoice_payments where invoice_id=p_invoice_id) then
    raise exception 'only unpaid active invoices can be cancelled' using errcode='55000';
  end if;
  perform set_config('crm.cancelling_invoice',p_invoice_id::text,true);
  update crm.invoices set status='cancelled',notes=concat_ws(E'\n',notes,'Cancellation: '||btrim(p_reason))
    where id=p_invoice_id returning * into v_new;
  perform set_config('crm.cancelling_invoice','',true);
  insert into crm.audit_log(entity_type,entity_id,action,actor_id,old_data,new_data)
    values('invoice',p_invoice_id,'cancelled',p_actor,to_jsonb(v_old),to_jsonb(v_new));
  insert into crm.lead_activity(lead_id,actor_id,type,detail) values(v_old.lead_id,p_actor,'invoice',
    jsonb_build_object('event','invoice_cancelled','invoice_id',p_invoice_id,'reason',btrim(p_reason)));
  return v_new;
end
$function$;

create function crm.guard_invoice_payment_state() returns trigger
language plpgsql set search_path = ''
as $function$
declare v_invoice crm.invoices%rowtype;
begin
  select * into v_invoice from crm.invoices where id=new.invoice_id for update;
  if not found or v_invoice.deleted_at is not null or v_invoice.status in ('paid','cancelled') then
    raise exception 'paid, cancelled or archived invoices cannot accept payments' using errcode='55000';
  end if;
  return new;
end
$function$;
create trigger guard_invoice_payment_state before insert on crm.invoice_payments
  for each row execute function crm.guard_invoice_payment_state();
revoke all on function crm.guard_invoice_payment_state() from public,anon,authenticated;

create or replace function crm.sync_invoice_item_billing_state() returns trigger
language plpgsql security definer set search_path = ''
as $function$
begin
  if (old.deleted_at is null and new.deleted_at is not null)
     or (old.status <> 'cancelled' and new.status = 'cancelled') then
    perform set_config('crm.archiving_invoice',new.id::text,true);
    update crm.invoice_items set active_billing=false where invoice_id=new.id;
    perform set_config('crm.archiving_invoice','',true);
  end if;
  return new;
end
$function$;
drop trigger sync_invoice_item_billing_state on crm.invoices;
create trigger sync_invoice_item_billing_state before update of deleted_at,status on crm.invoices
  for each row execute function crm.sync_invoice_item_billing_state();
-- Release billing references on any previously cancelled invoices as well.
update crm.invoice_items ii set active_billing=false from crm.invoices i
  where ii.invoice_id=i.id and i.status='cancelled' and ii.active_billing;
notify pgrst, 'reload schema';
