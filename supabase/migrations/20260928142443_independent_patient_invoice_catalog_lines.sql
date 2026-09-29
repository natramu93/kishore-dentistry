-- A standalone patient invoice can be backed entirely by active treatment
-- catalog lines; it does not need a completed case-sheet treatment as its
-- legacy primary treatment. The invoice RPC and line-item/readiness checks
-- continue to enforce patient, center, catalog, amount, and audit integrity.
alter table crm.invoices
  drop constraint if exists invoices_code_primary_treatment_check;
