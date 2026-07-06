-- ============================================================
-- 0004_cascade_deletes.sql — enable full CRUD deletes
-- Ensures deleting a lead (or treatment) cleans up dependents
-- instead of failing on FK constraints.
-- ============================================================

-- invoices.lead_id: cascade when the lead is deleted
alter table crm.invoices drop constraint if exists invoices_lead_id_fkey;
alter table crm.invoices
  add constraint invoices_lead_id_fkey
  foreign key (lead_id) references crm.leads(id) on delete cascade;

-- invoices.treatment_id: null out if the treatment is removed
alter table crm.invoices drop constraint if exists invoices_treatment_id_fkey;
alter table crm.invoices
  add constraint invoices_treatment_id_fkey
  foreign key (treatment_id) references crm.treatments(id) on delete set null;

-- treatments.appointment_id: null out if the appointment is removed
alter table crm.treatments drop constraint if exists treatments_appointment_id_fkey;
alter table crm.treatments
  add constraint treatments_appointment_id_fkey
  foreign key (appointment_id) references crm.appointments(id) on delete set null;
