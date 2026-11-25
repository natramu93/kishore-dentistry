-- A missing legacy contact is unknown, not an empty or placeholder phone number.
-- The existing length check still applies to non-null values and the CRM
-- create_lead RPC still requires a mobile for regular new patient entry.
set local lock_timeout = '5s';
set local statement_timeout = '15s';
alter table crm.leads alter column mobile drop not null;
