-- Invoice charges stay locked after any payment, but age alone no longer
-- prevents authorized corrections. Clinical case-sheet rules are separate.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $migration$
declare
  v_body text;
  v_deadline constant text := $deadline$  if clock_timestamp() >= v_old.created_at + interval '24 hours' then
    raise exception 'invoices can only be edited within 24 hours of creation' using errcode='55000';
  end if;
$deadline$;
  v_date_deadline constant text := $deadline$          or clock_timestamp() >= old.created_at + interval '24 hours'
$deadline$;
begin
  v_body := pg_get_functiondef('crm.update_invoice_with_date(uuid,numeric,text,jsonb,uuid,bigint,numeric,text,text,date)'::regprocedure);
  if array_length(string_to_array(v_body,v_deadline),1) is distinct from 2 then
    raise exception 'unexpected invoice edit workflow definition';
  end if;
  execute replace(v_body,v_deadline,'');

  v_body := pg_get_functiondef('crm.validate_invoice_update()'::regprocedure);
  if array_length(string_to_array(v_body,v_date_deadline),1) is distinct from 2 then
    raise exception 'unexpected invoice date guard definition';
  end if;
  execute replace(v_body,v_date_deadline,'');
end
$migration$;

-- Retain the separate guard on audit metadata when dropping the age check.
create or replace function crm.guard_invoice_edit_window() returns trigger
language plpgsql set search_path='' as $function$
begin
  if row(new.void_reason,new.voided_at,new.voided_by) is distinct from row(old.void_reason,old.voided_at,old.voided_by)
     and (current_setting('crm.cancelling_invoice',true) is distinct from old.id::text or new.status<>'cancelled') then
    raise exception 'use the admin void workflow' using errcode='55000';
  end if;
  return new;
end
$function$;

-- Keep the parent-row lock that serializes line changes with payment/voids.
-- An internal void may clear active_billing without modifying the sale lines.
create or replace function crm.guard_invoice_line_edit_window() returns trigger
language plpgsql set search_path='' as $function$
declare v_id uuid; v_changed boolean;
begin
  if tg_op='DELETE' then v_id:=old.invoice_id; v_changed:=true;
  elsif tg_op='INSERT' then v_id:=new.invoice_id; v_changed:=true;
  else
    v_id:=old.invoice_id;
    v_changed:=row(new.invoice_id,new.description,new.quantity,new.unit_price,new.treatment_id,new.treatment_type_id,new.tooth_numbers,new.line_note)
      is distinct from row(old.invoice_id,old.description,old.quantity,old.unit_price,old.treatment_id,old.treatment_type_id,old.tooth_numbers,old.line_note);
  end if;
  perform 1 from crm.invoices where id=v_id for update;
  if v_changed and current_setting('crm.allow_hard_delete',true) is distinct from 'on'
     and exists (select 1 from crm.invoice_payments where invoice_id=v_id) then
    raise exception 'an invoice with recorded payments cannot be edited; original charges are preserved' using errcode='55000';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end
$function$;
