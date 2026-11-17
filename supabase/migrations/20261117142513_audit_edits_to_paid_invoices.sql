-- Permit invoice corrections without altering the receipt ledger. The existing
-- authorized edit RPC locks the invoice before reading receipts or making changes.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $migration$
declare
  v_body text;
  v_step record;
  v_fn regprocedure := 'crm.update_invoice_with_date(uuid,numeric,text,jsonb,uuid,bigint,numeric,text,text,date)'::regprocedure;
begin
  v_body := pg_get_functiondef(v_fn);
  for v_step in select * from (values
    ($old$v_subtotal numeric; v_tax numeric; v_discount numeric;$old$,
     $new$v_subtotal numeric; v_tax numeric; v_discount numeric; v_total numeric;
  v_received numeric; v_receipt_count bigint; v_next_status crm.invoice_status;$new$),
    ($old$v_old.status in ('paid', 'cancelled')$old$,$new$v_old.status='cancelled'$new$),
    ($old$paid, cancelled or archived invoices cannot be edited$old$,$new$voided or archived invoices cannot be edited$new$),
    ($old$  if exists (select 1 from crm.invoice_payments where invoice_id=p_invoice_id) then
    raise exception 'an invoice with recorded payments cannot be edited; original charges are preserved' using errcode='55000';
  end if;$old$,
     $new$  select count(*),coalesce(sum(amount),0) into v_receipt_count,v_received
    from crm.invoice_payments where invoice_id=p_invoice_id;
  if (v_receipt_count>0 or v_old.status='paid') and p_expected_version is null then
    raise exception 'refresh the invoice before editing it' using errcode='40001';
  end if;$new$),
    ($old$  -- The existing receipt guard rejects financial changes once payment is recorded.$old$,
     $new$  v_total := v_subtotal - v_discount + v_tax;
  if v_old.status='paid' and v_receipt_count=0 and v_old.total>0 and v_total<>v_old.total then
    raise exception 'a historical paid invoice without receipts can be edited, but its total cannot change' using errcode='22023';
  end if;
  if v_total<v_received then
    raise exception 'invoice total cannot be less than the amount already received' using errcode='22023';
  end if;
  perform set_config('crm.editing_invoice_charges',p_invoice_id::text,true);$new$),
    ($old$    total = v_subtotal - v_discount + v_tax, discount_amount = v_discount,$old$,
     $new$    total = v_total, discount_amount = v_discount,$new$),
    ($old$  if v_old.code_enforced then perform crm.assert_coded_invoice_ready(p_invoice_id); end if;$old$,
     $new$  if v_old.code_enforced then perform crm.assert_coded_invoice_ready(p_invoice_id); end if;
  if v_receipt_count>0 or (v_old.status='paid' and v_old.total=0) then
    v_next_status := case when v_received=v_total then 'paid'::crm.invoice_status else 'sent'::crm.invoice_status end;
    if v_invoice.status is distinct from v_next_status then
      update crm.invoices set status=v_next_status where id=p_invoice_id returning * into v_invoice;
    end if;
  end if;
  perform set_config('crm.editing_invoice_charges','',true);$new$)
  ) as patch(old_text,new_text) loop
    if array_length(string_to_array(v_body,v_step.old_text),1) is distinct from 2 then
      raise exception 'unexpected audited invoice edit definition near %',left(v_step.old_text,72);
    end if;
    v_body:=replace(v_body,v_step.old_text,v_step.new_text);
  end loop;
  execute v_body;

  v_body:=pg_get_functiondef('crm.validate_invoice_update()'::regprocedure);
  for v_step in select * from (values
    ($old$          or old.status in ('paid','cancelled')
          or exists (select 1 from crm.invoice_payments where invoice_id = old.id)$old$,
     $new$          or old.status='cancelled'$new$),
    ($old$invoice date can only be changed through the unpaid invoice edit workflow$old$,
     $new$invoice date can only be changed through the audited invoice edit workflow$new$),
    ($old$  if old.status in ('paid','cancelled') and row($old$,
     $new$  if (old.status='cancelled' or (old.status='paid'
    and current_setting('crm.editing_invoice_charges',true) is distinct from old.id::text)) and row($new$),
    ($old$when 'paid' then new.status='cancelled' or new.status='sent' and current_setting('crm.correcting_invoice_receipt',true)=old.id::text
        and (select coalesce(sum(amount),0) from crm.invoice_payments where invoice_id=old.id)<old.total else false end;$old$,
     $new$when 'paid' then new.status='cancelled' or (new.status='sent' and (
        current_setting('crm.editing_invoice_charges',true)=old.id::text
        or (current_setting('crm.correcting_invoice_receipt',true)=old.id::text
          and (select coalesce(sum(amount),0) from crm.invoice_payments where invoice_id=old.id)<old.total))) else false end;$new$)
  ) as patch(old_text,new_text) loop
    if array_length(string_to_array(v_body,v_step.old_text),1) is distinct from 2 then
      raise exception 'unexpected invoice update guard near %',left(v_step.old_text,72);
    end if;
    v_body:=replace(v_body,v_step.old_text,v_step.new_text);
  end loop;
  execute v_body;

  for v_step in select * from (values
    ('crm.guard_invoice_item_mutation()'::regprocedure,
      $old$(v_status in ('paid','cancelled') or v_deleted_at is not null)$old$,
      $new$(v_status='cancelled' or v_deleted_at is not null or (v_status='paid'
       and current_setting('crm.editing_invoice_charges',true) is distinct from v_invoice_id::text))$new$),
    ('crm.guard_invoice_line_edit_window()'::regprocedure,
      $old$     and exists (select 1 from crm.invoice_payments where invoice_id=v_id) then$old$,
      $new$     and current_setting('crm.editing_invoice_charges',true) is distinct from v_id::text
     and exists (select 1 from crm.invoice_payments where invoice_id=v_id) then$new$)
  ) as patch(signature,old_text,new_text) loop
    v_body:=pg_get_functiondef(v_step.signature);
    if array_length(string_to_array(v_body,v_step.old_text),1) is distinct from 2 then
      raise exception 'unexpected line edit guard %',v_step.signature;
    end if;
    execute replace(v_body,v_step.old_text,v_step.new_text);
  end loop;
end
$migration$;

create or replace function crm.prevent_invoice_financial_edit_with_receipts() returns trigger
language plpgsql set search_path=''
as $function$
declare v_received numeric;
begin
  if row(new.subtotal,new.tax_rate,new.tax_amount,new.total) is distinct from row(old.subtotal,old.tax_rate,old.tax_amount,old.total) then
    select sum(amount) into v_received from crm.invoice_payments where invoice_id=old.id;
    if v_received is not null then
      if current_setting('crm.editing_invoice_charges',true) is distinct from old.id::text then
        raise exception 'use the audited invoice edit workflow for invoices with payments' using errcode='55000';
      end if;
      if new.total<v_received then
        raise exception 'invoice total cannot be less than the amount already received' using errcode='22023';
      end if;
    end if;
  end if;
  return new;
end
$function$;
