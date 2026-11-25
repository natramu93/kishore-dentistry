-- Keep branch_id as the bill's issuing center; the patient may belong to another center.
-- Live invoices, receipts and care records are unaffected.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table crm.legacy_patient_bills add column patient_branch_id uuid;
update crm.legacy_patient_bills set patient_branch_id = branch_id;

alter table crm.legacy_patient_bills
  alter column patient_branch_id set not null,
  add constraint legacy_patient_bills_patient_chart_fkey
    foreign key (lead_id, patient_branch_id) references crm.leads(id, branch_id) on delete restrict,
  add constraint legacy_patient_bills_billing_branch_fkey
    foreign key (branch_id) references crm.branches(id) on delete restrict,
  drop constraint legacy_patient_bills_lead_id_branch_id_fkey;

create index legacy_patient_bills_chart_history_idx
  on crm.legacy_patient_bills(lead_id, patient_branch_id, billed_at desc, bill_number, branch_id);
drop index crm.legacy_patient_bills_patient_date_idx;

comment on column crm.legacy_patient_bills.branch_id is 'Original issuing center; part of the historical bill key.';
comment on column crm.legacy_patient_bills.patient_branch_id is 'Center of the existing CRM patient chart, independently of the issuing center.';
notify pgrst, 'reload schema';
