-- These original trigger/RPC functions already schema-qualify every database
-- object they use. Pinning an empty search path removes role-dependent lookup.
alter function crm.set_updated_at() set search_path = '';
alter function crm.validate_lead_transition() set search_path = '';
alter function crm.log_status_change() set search_path = '';
alter function crm.next_invoice_number(uuid) set search_path = '';
