-- Allow itemized invoice charges from the managed treatment catalog in addition
-- to the mandatory coded case-sheet treatment line.
alter table crm.invoice_items
  add column treatment_type_id uuid references crm.treatment_types(id) on delete restrict;
create index invoice_items_treatment_type_id_idx
  on crm.invoice_items (treatment_type_id)
  where treatment_type_id is not null;

create or replace function crm.coded_invoice_items_subtotal(p_items jsonb) returns numeric
language plpgsql immutable set search_path = ''
as $function$
declare
  v_item jsonb;
  v_quantity numeric;
  v_price numeric;
  v_subtotal numeric := 0;
  v_treatment_ids uuid[] := array[]::uuid[];
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'invoice requires between 1 and 100 line items' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item->'quantity') <> 'number'
       or jsonb_typeof(v_item->'unit_price') <> 'number'
       or not (jsonb_typeof(v_item->'treatment_id') = 'string'
          or jsonb_typeof(v_item->'treatment_type_id') = 'string') then
      raise exception 'each invoice line requires a coded treatment or catalog treatment, quantity, and unit price' using errcode = '22023';
    end if;
    if jsonb_typeof(v_item->'treatment_id') = 'string' then
      if jsonb_typeof(v_item->'treatment_type_id') = 'string' then
        raise exception 'invoice line cannot combine a case-sheet treatment and a catalog-only treatment' using errcode = '22023';
      end if;
      v_treatment_ids := array_append(v_treatment_ids, (v_item->>'treatment_id')::uuid);
    end if;
    v_quantity := (v_item->>'quantity')::numeric;
    v_price := (v_item->>'unit_price')::numeric;
    if v_quantity <= 0 or v_quantity > 999999.99 or v_quantity <> round(v_quantity,2)
       or v_price < 0 or v_price > 99999999.99 or v_price <> round(v_price,2) then
      raise exception 'invoice quantity or unit price is invalid' using errcode = '22023';
    end if;
    v_subtotal := v_subtotal + round(v_quantity * v_price, 2);
    if v_subtotal > 9999999999.99 then raise exception 'invoice subtotal is out of range' using errcode = '22003'; end if;
  end loop;
  if cardinality(v_treatment_ids) <> cardinality(array(select distinct unnest(v_treatment_ids))) then
    raise exception 'a completed case-sheet treatment can appear only once on an invoice' using errcode = '23505';
  end if;
  return v_subtotal;
end
$function$;

create or replace function crm.populate_coded_invoice_item() returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_invoice crm.invoices%rowtype;
  v_treatment crm.treatments%rowtype;
  v_catalog crm.treatment_types%rowtype;
  v_site text;
begin
  select * into v_invoice from crm.invoices where id = new.invoice_id;
  if not found then return new; end if;
  new.active_billing := case
    when current_user = 'postgres' and current_setting('crm.archiving_invoice', true) = new.invoice_id::text then false
    else v_invoice.deleted_at is null
  end;
  if not v_invoice.code_enforced then return new; end if;

  if new.treatment_type_id is not null then
    if new.treatment_id is not null then
      raise exception 'catalog invoice lines cannot also reference a case-sheet treatment' using errcode = '23514';
    end if;
    select * into v_catalog from crm.treatment_types where id = new.treatment_type_id;
    if not found or not v_catalog.is_active then
      raise exception 'select an active treatment from the treatment catalog' using errcode = '23514';
    end if;
    new.description := v_catalog.name;
    new.treatment_name := v_catalog.name;
    new.treatment_category := v_catalog.category;
    new.treatment_code := null;
    new.case_sheet_id := null;
    new.tooth_number := null;
    new.site_scope := null;
    new.site_detail := null;
    new.surfaces := null;
    return new;
  end if;

  if new.treatment_id is null then
    raise exception 'invoice line must reference a completed coded treatment or catalog treatment' using errcode = '23514';
  end if;
  select * into v_treatment from crm.treatments where id = new.treatment_id;
  if not found or v_treatment.lead_id is distinct from v_invoice.lead_id
     or v_treatment.branch_id is distinct from v_invoice.branch_id
     or v_treatment.clinical_status is distinct from 'completed'
     or v_treatment.treatment_code is null or v_treatment.case_sheet_id is null
     or v_treatment.performed_at is null then
    raise exception 'invoice treatment must be a completed coded line for the same patient and branch' using errcode = '23514';
  end if;
  if not exists (select 1 from crm.case_sheets c where c.id = v_treatment.case_sheet_id and c.finalized_at is not null) then
    raise exception 'invoice treatment case sheet is not finalized' using errcode = '23514';
  end if;
  if new.quantity is distinct from v_treatment.quantity then
    raise exception 'invoice quantity must match the signed treatment quantity' using errcode = '23514';
  end if;
  v_site := case v_treatment.site_scope
    when 'tooth' then ' - Tooth ' || v_treatment.tooth_number
    when 'arch' then ' - ' || initcap(v_treatment.site_detail) || ' arch'
    when 'quadrant' then ' - ' || initcap(replace(v_treatment.site_detail, '_', ' '))
    when 'full_mouth' then ' - Full mouth'
    else ''
  end;
  new.description := '[' || v_treatment.treatment_code || '] ' || v_treatment.treatment_name || v_site;
  new.treatment_code := v_treatment.treatment_code;
  new.treatment_name := v_treatment.treatment_name;
  new.treatment_category := v_treatment.treatment_category;
  new.case_sheet_id := v_treatment.case_sheet_id;
  new.tooth_number := v_treatment.tooth_number;
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
  if not exists (
       select 1 from crm.invoice_items ii where ii.invoice_id = p_invoice_id
         and ii.treatment_id = v_invoice.treatment_id
     )
     or exists (
       select 1 from crm.invoice_items ii
       left join crm.treatments t on t.id = ii.treatment_id
       left join crm.case_sheets c on c.id = t.case_sheet_id
       left join crm.treatment_types tt on tt.id = ii.treatment_type_id
       where ii.invoice_id = p_invoice_id and (
         (ii.treatment_id is not null and (
           t.id is null or t.lead_id <> v_invoice.lead_id or t.branch_id <> v_invoice.branch_id
           or t.clinical_status is distinct from 'completed' or t.performed_at is null or c.finalized_at is null
           or ii.treatment_code is distinct from t.treatment_code
           or ii.treatment_name is distinct from t.treatment_name
           or ii.case_sheet_id is distinct from t.case_sheet_id
         ))
         or (ii.treatment_id is null and (ii.treatment_type_id is null or tt.id is null
           or ii.treatment_name is distinct from ii.description))
       )
     )
     or v_invoice.subtotal is distinct from (select coalesce(sum(ii.amount),0) from crm.invoice_items ii where ii.invoice_id = p_invoice_id) then
    raise exception 'code-enforced invoice requires valid coded clinical and treatment-catalog lines' using errcode = '23514';
  end if;
end
$function$;

create or replace function crm.create_invoice(
  p_lead_id uuid, p_treatment_id uuid, p_tax_rate numeric, p_notes text,
  p_items jsonb, p_actor uuid
) returns crm.invoices
language plpgsql set search_path = ''
as $function$
declare
  v_lead crm.leads%rowtype; v_invoice crm.invoices%rowtype; v_item jsonb;
  v_subtotal numeric; v_tax_rate numeric := coalesce(p_tax_rate,0);
  v_tax_amount numeric; v_total numeric; v_number text; v_primary uuid;
  v_catalog crm.treatment_types%rowtype;
begin
  perform crm.assert_invoice_write_access(p_actor,p_lead_id,false);
  if v_tax_rate < 0 or v_tax_rate > 100 or v_tax_rate <> round(v_tax_rate,2) then
    raise exception 'tax_rate must be between 0 and 100 with at most two decimals' using errcode = '22023';
  end if;
  if ((current_user = 'postgres' and current_setting('crm.allow_legacy_test_records', true) = 'on')
      or (not crm.coded_dental_enforcement_enabled() and not exists (
        select 1 from jsonb_array_elements(p_items) e where e.value ? 'treatment_id'
      ))) then
    v_subtotal := crm.invoice_items_subtotal(p_items);
    v_tax_amount := round(v_subtotal*v_tax_rate/100,2); v_total := v_subtotal+v_tax_amount;
    select * into v_lead from crm.leads where id=p_lead_id for update;
    v_number := crm.next_invoice_number(v_lead.branch_id);
    insert into crm.invoices(invoice_number,lead_id,treatment_id,status,subtotal,tax_rate,tax_amount,total,notes,created_by,code_enforced)
    values(v_number,p_lead_id,p_treatment_id,'draft',v_subtotal,v_tax_rate,v_tax_amount,v_total,nullif(btrim(p_notes),''),p_actor,false)
    returning * into v_invoice;
    for v_item in select value from jsonb_array_elements(p_items) loop
      insert into crm.invoice_items(invoice_id,description,quantity,unit_price)
      values(v_invoice.id,btrim(v_item->>'description'),(v_item->>'quantity')::numeric,(v_item->>'unit_price')::numeric);
    end loop;
    insert into crm.lead_activity(lead_id,actor_id,type,detail) values(p_lead_id,p_actor,'invoice',jsonb_build_object('event','invoice_created','invoice_id',v_invoice.id,'invoice_number',v_invoice.invoice_number,'total',v_invoice.total,'code_enforced',false));
    insert into crm.audit_log(entity_type,entity_id,action,actor_id,new_data) values('invoice',v_invoice.id,'created',p_actor,to_jsonb(v_invoice));
    return v_invoice;
  end if;

  v_subtotal := crm.coded_invoice_items_subtotal(p_items);
  v_primary := coalesce(p_treatment_id,(p_items->0->>'treatment_id')::uuid);
  if not exists (select 1 from jsonb_array_elements(p_items) e where e.value->>'treatment_id' = v_primary::text) then
    raise exception 'primary treatment must be included in invoice items' using errcode = '23514';
  end if;
  perform 1 from crm.treatments t where t.id in
    (select (e.value->>'treatment_id')::uuid from jsonb_array_elements(p_items)e where e.value ? 'treatment_id')
    order by t.id for update;
  for v_item in select value from jsonb_array_elements(p_items) where value ? 'treatment_type_id' loop
    select * into v_catalog from crm.treatment_types where id=(v_item->>'treatment_type_id')::uuid and is_active for share;
    if not found then raise exception 'select an active treatment from the treatment catalog' using errcode='23514'; end if;
  end loop;
  v_tax_amount := round(v_subtotal*v_tax_rate/100,2); v_total := v_subtotal+v_tax_amount;
  select * into v_lead from crm.leads where id=p_lead_id for update;
  v_number := crm.next_invoice_number(v_lead.branch_id);
  insert into crm.invoices(invoice_number,lead_id,treatment_id,status,subtotal,tax_rate,tax_amount,total,notes,created_by,code_enforced)
  values(v_number,p_lead_id,v_primary,'draft',v_subtotal,v_tax_rate,v_tax_amount,v_total,nullif(btrim(p_notes),''),p_actor,true)
  returning * into v_invoice;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if v_item ? 'treatment_id' then
      insert into crm.invoice_items(invoice_id,treatment_id,description,quantity,unit_price)
      values(v_invoice.id,(v_item->>'treatment_id')::uuid,'Derived from treatment',(v_item->>'quantity')::numeric,(v_item->>'unit_price')::numeric);
    else
      insert into crm.invoice_items(invoice_id,treatment_type_id,description,quantity,unit_price)
      values(v_invoice.id,(v_item->>'treatment_type_id')::uuid,'Selected treatment',(v_item->>'quantity')::numeric,(v_item->>'unit_price')::numeric);
    end if;
  end loop;
  perform crm.assert_coded_invoice_ready(v_invoice.id);
  insert into crm.lead_activity(lead_id,actor_id,type,detail) values(p_lead_id,p_actor,'invoice',jsonb_build_object('event','invoice_created','invoice_id',v_invoice.id,'invoice_number',v_invoice.invoice_number,'total',v_invoice.total,'code_enforced',true));
  insert into crm.audit_log(entity_type,entity_id,action,actor_id,new_data) values('invoice',v_invoice.id,'created',p_actor,to_jsonb(v_invoice));
  return v_invoice;
end
$function$;

create or replace function crm.update_invoice(
  p_invoice_id uuid, p_tax_rate numeric, p_notes text, p_items jsonb,
  p_actor uuid, p_expected_version bigint default null
) returns crm.invoices
language plpgsql set search_path = ''
as $function$
declare
  v_old crm.invoices%rowtype; v_invoice crm.invoices%rowtype; v_item jsonb;
  v_subtotal numeric; v_tax_rate numeric := coalesce(p_tax_rate,0); v_tax_amount numeric; v_total numeric;
  v_catalog crm.treatment_types%rowtype;
begin
  select * into v_old from crm.invoices where id=p_invoice_id for update;
  if not found then raise exception 'invoice % not found',p_invoice_id using errcode='P0002'; end if;
  if v_old.deleted_at is not null then raise exception 'invoice % is deleted',p_invoice_id using errcode='55000'; end if;
  perform crm.assert_invoice_write_access(p_actor,v_old.lead_id,false);
  if p_expected_version is not null and p_expected_version<>v_old.version then raise exception 'invoice % was modified by another request',p_invoice_id using errcode='40001'; end if;
  if v_old.status='paid' then raise exception 'paid invoice % cannot be edited',p_invoice_id using errcode='55000'; end if;
  if v_tax_rate<0 or v_tax_rate>100 or v_tax_rate<>round(v_tax_rate,2) then raise exception 'tax_rate must be between 0 and 100 with at most two decimals' using errcode='22023'; end if;
  if v_old.code_enforced then
    v_subtotal := crm.coded_invoice_items_subtotal(p_items);
    if not exists (select 1 from jsonb_array_elements(p_items)e where e.value->>'treatment_id'=v_old.treatment_id::text) then
      raise exception 'primary treatment must remain on a code-enforced invoice' using errcode='23514';
    end if;
    perform 1 from crm.treatments t where t.id in
      (select (e.value->>'treatment_id')::uuid from jsonb_array_elements(p_items)e where e.value ? 'treatment_id') order by t.id for update;
    for v_item in select value from jsonb_array_elements(p_items) where value ? 'treatment_type_id' loop
      select * into v_catalog from crm.treatment_types where id=(v_item->>'treatment_type_id')::uuid and is_active for share;
      if not found then raise exception 'select an active treatment from the treatment catalog' using errcode='23514'; end if;
    end loop;
  else
    v_subtotal := crm.invoice_items_subtotal(p_items);
  end if;
  v_tax_amount:=round(v_subtotal*v_tax_rate/100,2); v_total:=v_subtotal+v_tax_amount;
  update crm.invoices set subtotal=v_subtotal,tax_rate=v_tax_rate,tax_amount=v_tax_amount,total=v_total,notes=nullif(btrim(p_notes),'') where id=p_invoice_id returning * into v_invoice;
  delete from crm.invoice_items where invoice_id=p_invoice_id;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if v_old.code_enforced and v_item ? 'treatment_type_id' then
      insert into crm.invoice_items(invoice_id,treatment_type_id,description,quantity,unit_price)
      values(p_invoice_id,(v_item->>'treatment_type_id')::uuid,'Selected treatment',(v_item->>'quantity')::numeric,(v_item->>'unit_price')::numeric);
    elsif v_old.code_enforced then
      insert into crm.invoice_items(invoice_id,treatment_id,description,quantity,unit_price)
      values(p_invoice_id,(v_item->>'treatment_id')::uuid,'Derived from treatment',(v_item->>'quantity')::numeric,(v_item->>'unit_price')::numeric);
    else
      insert into crm.invoice_items(invoice_id,description,quantity,unit_price)
      values(p_invoice_id,btrim(v_item->>'description'),(v_item->>'quantity')::numeric,(v_item->>'unit_price')::numeric);
    end if;
  end loop;
  if v_old.code_enforced then perform crm.assert_coded_invoice_ready(p_invoice_id); end if;
  insert into crm.lead_activity(lead_id,actor_id,type,detail) values(v_invoice.lead_id,p_actor,'invoice',jsonb_build_object('event','invoice_updated','invoice_id',v_invoice.id,'invoice_number',v_invoice.invoice_number,'total',v_invoice.total));
  insert into crm.audit_log(entity_type,entity_id,action,actor_id,old_data,new_data) values('invoice',v_invoice.id,'updated',p_actor,to_jsonb(v_old),to_jsonb(v_invoice));
  return v_invoice;
end
$function$;

revoke execute on function crm.coded_invoice_items_subtotal(jsonb), crm.assert_coded_invoice_ready(uuid), crm.populate_coded_invoice_item()
  from public, anon, authenticated, service_role;
grant execute on function crm.create_invoice(uuid,uuid,numeric,text,jsonb,uuid), crm.update_invoice(uuid,numeric,text,jsonb,uuid,bigint)
  to service_role;
