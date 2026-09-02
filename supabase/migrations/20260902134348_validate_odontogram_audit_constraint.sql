-- Validate separately so the audit-log scan uses PostgreSQL's weaker
-- ShareUpdateExclusive lock instead of extending the schema migration's
-- ACCESS EXCLUSIVE lock.
alter table crm.audit_log validate constraint audit_log_entity_type_check;
