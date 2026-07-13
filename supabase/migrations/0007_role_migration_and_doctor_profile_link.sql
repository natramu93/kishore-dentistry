-- ============================================================
-- 0007_role_migration_and_doctor_profile_link.sql
-- Must run after 0006 commits (new enum values can't be used in the same
-- transaction that adds them).
-- ============================================================

-- Link a doctor row to a login, so a "doctor" role user self-scopes to it.
alter table crm.doctors add column if not exists profile_id uuid references crm.profiles(id);
create unique index if not exists doctors_profile_id_key on crm.doctors (profile_id) where profile_id is not null;

-- Migrate existing role assignments to the new model.
update crm.profiles set role = 'operations'   where role = 'manager';
update crm.profiles set role = 'front_office' where role = 'agent';
