-- Payment receipts are audited as their own entity by record_invoice_payment.
-- The previous allow-list omitted this value, causing the function's final
-- audit insert to fail and roll back the receipt and invoice status update.
alter table crm.audit_log
  drop constraint if exists audit_log_entity_type_check;

alter table crm.audit_log
  add constraint audit_log_entity_type_check
  check (entity_type = any (array[
    'lead',
    'appointment',
    'treatment',
    'follow_up',
    'invoice',
    'invoice_payment',
    'comment',
    'profile',
    'case_sheet',
    'tooth_assessment'
  ]));
