-- Keep payment audit lookups and profile FK checks indexed.
create index if not exists invoice_payments_created_by_idx
  on crm.invoice_payments (created_by);
