-- Preserve an invoice's outstanding-balance contract once any receipt is logged.
create function crm.prevent_invoice_financial_edit_with_receipts() returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if row(new.subtotal, new.tax_rate, new.tax_amount, new.total)
       is distinct from row(old.subtotal, old.tax_rate, old.tax_amount, old.total)
     and exists (select 1 from crm.invoice_payments p where p.invoice_id = old.id) then
    raise exception 'an invoice with recorded payments cannot be financially edited'
      using errcode = '55000';
  end if;
  return new;
end
$function$;
revoke all on function crm.prevent_invoice_financial_edit_with_receipts() from public, anon, authenticated;
create trigger prevent_invoice_financial_edit_with_receipts
  before update of subtotal, tax_rate, tax_amount, total on crm.invoices
  for each row execute function crm.prevent_invoice_financial_edit_with_receipts();
