-- Keep the legacy archive path for voided invoices that were never paid.
-- Paid/part-paid bills still require the audited admin-only workflow.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function crm.prevent_paid_invoice_delete_with_receipts() returns trigger
language plpgsql set search_path = ''
as $function$
begin
  if new.deleted_at is distinct from old.deleted_at and new.deleted_at is not null
     and (old.status='paid' or old.paid_at is not null
       or exists (select 1 from crm.invoice_payments p where p.invoice_id=old.id)
       or (old.status='cancelled' and exists (
         select 1 from crm.audit_log a where a.entity_type='invoice' and a.entity_id=old.id
           and a.action='cancelled' and a.old_data->>'status'='paid'
       )))
     and (new.status<>'cancelled' or current_setting('crm.cancelling_invoice',true) is distinct from old.id::text
       or not exists (select 1 from crm.profiles where id=new.deleted_by and role='admin' and is_active)) then
    raise exception 'use the admin void workflow to archive a paid invoice' using errcode='55000';
  end if;
  return new;
end
$function$;
