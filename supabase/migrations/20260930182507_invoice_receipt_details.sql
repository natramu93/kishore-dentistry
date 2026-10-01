-- Invoice business date is independent of the immutable creation/audit time.
alter table crm.invoices
  add column invoice_date date,
  add column consulting_doctor_name text check (char_length(consulting_doctor_name) <= 200);
alter table crm.invoices alter column invoice_date set default (now() at time zone 'Asia/Kolkata')::date;
-- Older invoices retain their historical issued/creation-date display fallback.
alter table crm.invoices add constraint invoice_date_valid check (invoice_date between date '0001-01-01' and date '9999-12-31');

drop function crm.create_patient_invoice(uuid,numeric,numeric,text,text,text,jsonb,uuid);
create function crm.create_patient_invoice(
  p_lead_id uuid, p_tax_rate numeric, p_discount_amount numeric,
  p_discount_given_by text, p_mention text, p_notes text, p_items jsonb, p_actor uuid,
  p_invoice_date date default (now() at time zone 'Asia/Kolkata')::date,
  p_consulting_doctor_name text default null
) returns crm.invoices language plpgsql set search_path = '' as $function$
declare
  v_lead crm.leads%rowtype; v_invoice crm.invoices%rowtype;
  v_subtotal numeric; v_tax numeric; v_number text; v_primary uuid;
begin
  perform crm.assert_invoice_write_access(p_actor,p_lead_id,false);
  if p_invoice_date is null or p_invoice_date not between date '0001-01-01' and date '9999-12-31'
     or char_length(coalesce(p_consulting_doctor_name,'')) > 200
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
    discount_amount,discount_given_by,mention,notes,created_by,code_enforced,invoice_date,consulting_doctor_name)
  values(v_number,p_lead_id,v_primary,'draft',v_subtotal,p_tax_rate,v_tax,v_subtotal-p_discount_amount+v_tax,
    p_discount_amount,nullif(btrim(p_discount_given_by),''),nullif(btrim(p_mention),''),nullif(btrim(p_notes),''),
    p_actor,true,p_invoice_date,nullif(btrim(p_consulting_doctor_name),'')) returning * into v_invoice;
  perform crm.insert_invoice_lines(v_invoice.id,p_items,true);
  perform crm.assert_coded_invoice_ready(v_invoice.id);
  insert into crm.lead_activity(lead_id,actor_id,type,detail) values(p_lead_id,p_actor,'invoice',
    jsonb_build_object('event','invoice_created','invoice_id',v_invoice.id,'invoice_number',v_number,
      'total',v_invoice.total,'invoice_date',v_invoice.invoice_date,'consulting_doctor_name',v_invoice.consulting_doctor_name));
  insert into crm.audit_log(entity_type,entity_id,action,actor_id,new_data)
    values('invoice',v_invoice.id,'created',p_actor,to_jsonb(v_invoice));
  return v_invoice;
end
$function$;
revoke all on function crm.create_patient_invoice(uuid,numeric,numeric,text,text,text,jsonb,uuid,date,text) from public,anon,authenticated;
grant execute on function crm.create_patient_invoice(uuid,numeric,numeric,text,text,text,jsonb,uuid,date,text) to service_role;

alter table crm.invoice_payments
  add column version bigint not null default 1 check (version > 0),
  add column batch_key uuid,
  add column batch_line integer,
  add constraint invoice_payment_batch_pair check ((batch_key is null and batch_line is null) or (batch_key is not null and batch_line is not null and batch_line between 1 and 10));
create unique index invoice_payment_batch_line_idx on crm.invoice_payments(batch_key,batch_line) where batch_key is not null;
grant update(amount,payment_method,reference,version) on crm.invoice_payments to service_role;

create function crm.guard_invoice_receipt_update() returns trigger language plpgsql set search_path='' as $function$
begin
  if current_setting('crm.updating_invoice_payment',true) is distinct from old.id::text then
    raise exception 'use the audited receipt correction workflow' using errcode='55000';
  end if;
  if (to_jsonb(new)-array['amount','payment_method','reference','version'])
      is distinct from (to_jsonb(old)-array['amount','payment_method','reference','version'])
    or new.version<>old.version+1 then
    raise exception 'receipt identity and history are immutable' using errcode='55000';
  end if;
  return new;
end
$function$;
create trigger guard_invoice_receipt_update before update on crm.invoice_payments
  for each row execute function crm.guard_invoice_receipt_update();
revoke all on function crm.guard_invoice_receipt_update() from public,anon,authenticated;

-- Atomic split receipts, with a stable request key to prevent duplicate retries.
create function crm.record_invoice_payment_batch(p_invoice_id uuid,p_receipts jsonb,p_request_key uuid,p_actor uuid)
returns setof crm.invoice_payments language plpgsql set search_path = '' as $function$
declare
  v_invoice crm.invoices%rowtype; v_payment crm.invoice_payments%rowtype;
  v_item jsonb; v_clean jsonb := '[]'::jsonb; v_existing jsonb;
  v_total numeric := 0; v_paid numeric; v_amount numeric; v_line integer := 0;
begin
  select * into v_invoice from crm.invoices where id=p_invoice_id for update;
  if not found or v_invoice.deleted_at is not null then raise exception 'invoice not found' using errcode='P0002'; end if;
  perform crm.assert_invoice_write_access(p_actor,v_invoice.lead_id,false);
  if p_request_key is null or jsonb_typeof(p_receipts) is distinct from 'array'
    or jsonb_array_length(p_receipts) not between 1 and 10 then raise exception 'provide between one and ten payments' using errcode='22023'; end if;
  for v_item in select value from jsonb_array_elements(p_receipts) loop
    if jsonb_typeof(v_item) is distinct from 'object' or jsonb_typeof(v_item->'amount') is distinct from 'number'
      or coalesce(v_item->>'method','') not in ('upi','card','cash','neft')
      or (v_item ? 'reference' and jsonb_typeof(v_item->'reference') not in ('string','null'))
      or (v_item ? 'notes' and jsonb_typeof(v_item->'notes') not in ('string','null'))
      or char_length(coalesce(v_item->>'reference','')) > 120 or char_length(coalesce(v_item->>'notes','')) > 1000 then
      raise exception 'payment details are invalid' using errcode='22023';
    end if;
    v_amount := (v_item->>'amount')::numeric;
    if v_amount <= 0 or v_amount > 9999999999.99 or v_amount <> round(v_amount,2) then
      raise exception 'payment amount must be positive with at most two decimals' using errcode='22023';
    end if;
    v_total := v_total + v_amount;
    v_clean := v_clean || jsonb_build_array(jsonb_build_object('amount',v_amount,'method',v_item->>'method',
      'reference',nullif(btrim(v_item->>'reference'),''),'notes',nullif(btrim(v_item->>'notes'),'')));
  end loop;
  if exists(select 1 from crm.invoice_payments where batch_key=p_request_key) then
    select jsonb_agg(jsonb_build_object('amount',amount,'method',payment_method,'reference',reference,'notes',notes) order by batch_line)
      into v_existing from crm.invoice_payments where batch_key=p_request_key and invoice_id=p_invoice_id;
    if v_existing is distinct from v_clean then raise exception 'payment request was already used with different details' using errcode='22023'; end if;
    return query select * from crm.invoice_payments where batch_key=p_request_key and invoice_id=p_invoice_id order by batch_line;
    return;
  end if;
  if v_invoice.status in ('paid','cancelled') or (not v_invoice.code_enforced and v_invoice.invoice_kind <> 'consultation') then
    raise exception 'this invoice cannot accept payments' using errcode='55000';
  end if;
  select coalesce(sum(amount),0) into v_paid from crm.invoice_payments where invoice_id=p_invoice_id;
  if v_total > v_invoice.total-v_paid then raise exception 'payment exceeds the outstanding invoice balance' using errcode='22023'; end if;
  for v_item in select value from jsonb_array_elements(v_clean) loop
    v_line := v_line+1;
    insert into crm.invoice_payments(invoice_id,amount,payment_method,reference,notes,created_by,batch_key,batch_line)
      values(p_invoice_id,(v_item->>'amount')::numeric,(v_item->>'method')::crm.invoice_payment_method,
        v_item->>'reference',v_item->>'notes',p_actor,p_request_key,v_line) returning * into v_payment;
    insert into crm.audit_log(entity_type,entity_id,action,actor_id,new_data)
      values('invoice_payment',v_payment.id,'created',p_actor,to_jsonb(v_payment));
    return next v_payment;
  end loop;
  update crm.invoices set status=case when v_paid+v_total=total then 'paid'::crm.invoice_status else 'sent'::crm.invoice_status end where id=p_invoice_id;
  insert into crm.lead_activity(lead_id,actor_id,type,detail) values(v_invoice.lead_id,p_actor,'invoice',
    jsonb_build_object('event','invoice_payment_recorded','invoice_id',p_invoice_id,'amount',v_total,
      'receipts',v_clean,'outstanding',v_invoice.total-v_paid-v_total));
end
$function$;
revoke all on function crm.record_invoice_payment_batch(uuid,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function crm.record_invoice_payment_batch(uuid,jsonb,uuid,uuid) to service_role;

-- A correction may reopen a paid invoice, but never change its original charges.
create or replace function crm.validate_invoice_update() returns trigger language plpgsql set search_path='' as $function$
declare v_allowed boolean;
begin
  if old.deleted_at is not null then raise exception 'deleted invoice is immutable' using errcode='55000'; end if;
  if row(new.id,new.invoice_number,new.lead_id,new.branch_id,new.treatment_id,new.created_by,new.created_at,new.invoice_date,new.consulting_doctor_name)
    is distinct from row(old.id,old.invoice_number,old.lead_id,old.branch_id,old.treatment_id,old.created_by,old.created_at,old.invoice_date,old.consulting_doctor_name) then
    raise exception 'invoice identity fields are immutable' using errcode='55000';
  end if;
  if old.status in ('paid','cancelled') and row(new.subtotal,new.tax_rate,new.tax_amount,new.total,new.discount_amount,new.discount_given_by,new.mention,new.issued_at,new.notes)
    is distinct from row(old.subtotal,old.tax_rate,old.tax_amount,old.total,old.discount_amount,old.discount_given_by,old.mention,old.issued_at,old.notes) then
    raise exception 'paid or cancelled invoice details are immutable' using errcode='55000';
  end if;
  if new.status is distinct from old.status then
    v_allowed := case old.status when 'draft' then new.status in ('sent','paid','cancelled') when 'sent' then new.status in ('paid','cancelled')
      when 'paid' then new.status='sent' and current_setting('crm.correcting_invoice_receipt',true)=old.id::text
        and (select coalesce(sum(amount),0) from crm.invoice_payments where invoice_id=old.id)<old.total else false end;
    if not coalesce(v_allowed,false) then raise exception 'illegal invoice transition: % -> %',old.status,new.status using errcode='23514'; end if;
    if new.status='cancelled' and (current_setting('crm.cancelling_invoice',true) is distinct from old.id::text
      or exists(select 1 from crm.invoice_payments where invoice_id=old.id)) then
      raise exception 'use the admin cancellation workflow for an unpaid invoice' using errcode='55000';
    end if;
    if new.status in ('sent','paid') then new.issued_at:=coalesce(old.issued_at,new.issued_at,now()); end if;
    if new.status='paid' then new.paid_at:=coalesce(old.paid_at,now()); end if;
    if old.status='paid' and new.status='sent' then new.paid_at:=null; end if;
  end if;
  return new;
end
$function$;

create function crm.update_invoice_payment(p_invoice_id uuid,p_payment_id uuid,p_amount numeric,p_method crm.invoice_payment_method,
  p_reference text,p_reason text,p_expected_version bigint,p_actor uuid) returns crm.invoice_payments
language plpgsql set search_path='' as $function$
declare v_invoice crm.invoices%rowtype; v_old crm.invoice_payments%rowtype; v_new crm.invoice_payments%rowtype; v_paid numeric;
begin
  select * into v_invoice from crm.invoices where id=p_invoice_id for update;
  if not found or v_invoice.deleted_at is not null then raise exception 'invoice not found' using errcode='P0002'; end if;
  perform crm.assert_invoice_write_access(p_actor,v_invoice.lead_id,false);
  if v_invoice.status='cancelled' or (not v_invoice.code_enforced and v_invoice.invoice_kind<>'consultation') then
    raise exception 'this invoice cannot accept receipt changes' using errcode='55000'; end if;
  select * into v_old from crm.invoice_payments where id=p_payment_id and invoice_id=p_invoice_id for update;
  if not found then raise exception 'receipt not found' using errcode='P0002'; end if;
  if p_expected_version is null or p_expected_version<>v_old.version then raise exception 'receipt was changed; refresh and try again' using errcode='40001'; end if;
  if p_amount is null or p_amount<=0 or p_amount>9999999999.99 or p_amount<>round(p_amount,2) or p_method is null
    or char_length(coalesce(p_reference,''))>120 or p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'enter valid receipt details and a correction reason' using errcode='22023'; end if;
  select coalesce(sum(amount),0)-v_old.amount+p_amount into v_paid from crm.invoice_payments where invoice_id=p_invoice_id;
  if v_paid>v_invoice.total then raise exception 'received payments cannot exceed the invoice total' using errcode='22023'; end if;
  perform set_config('crm.updating_invoice_payment',p_payment_id::text,true);
  update crm.invoice_payments set amount=p_amount,payment_method=p_method,reference=nullif(btrim(p_reference),''),version=version+1
    where id=p_payment_id returning * into v_new;
  perform set_config('crm.updating_invoice_payment','',true);
  perform set_config('crm.correcting_invoice_receipt',p_invoice_id::text,true);
  update crm.invoices set status=case when v_paid=total then 'paid'::crm.invoice_status else 'sent'::crm.invoice_status end where id=p_invoice_id;
  perform set_config('crm.correcting_invoice_receipt','',true);
  insert into crm.audit_log(entity_type,entity_id,action,actor_id,old_data,new_data)
    values('invoice_payment',v_old.id,'corrected',p_actor,to_jsonb(v_old),to_jsonb(v_new)||jsonb_build_object('correction_reason',btrim(p_reason)));
  insert into crm.lead_activity(lead_id,actor_id,type,detail) values(v_invoice.lead_id,p_actor,'invoice',
    jsonb_build_object('event','invoice_payment_corrected','invoice_id',p_invoice_id,'payment_id',v_old.id,
      'old_amount',v_old.amount,'amount',v_new.amount,'old_method',v_old.payment_method,'method',v_new.payment_method,
      'reason',btrim(p_reason),'outstanding',v_invoice.total-v_paid));
  return v_new;
end
$function$;
revoke all on function crm.update_invoice_payment(uuid,uuid,numeric,crm.invoice_payment_method,text,text,bigint,uuid) from public,anon,authenticated;
grant execute on function crm.update_invoice_payment(uuid,uuid,numeric,crm.invoice_payment_method,text,text,bigint,uuid) to service_role;
notify pgrst, 'reload schema';
