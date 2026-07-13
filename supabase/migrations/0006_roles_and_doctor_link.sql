-- ============================================================
-- 0006_roles_and_doctor_link.sql
-- Role model v2: Admin / Operations / Front Office / Clinical Head / Doctor
-- (replaces admin/manager/agent). Postgres enums can't drop values, so
-- 'manager' and 'agent' remain valid-but-unused values for compatibility.
-- ============================================================

alter type crm.user_role add value if not exists 'operations';
alter type crm.user_role add value if not exists 'front_office';
alter type crm.user_role add value if not exists 'clinical_head';
alter type crm.user_role add value if not exists 'doctor';
