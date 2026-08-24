-- Activate the mandatory coded-treatment contract only after the compatible
-- schema migration and new application release are both available.
update crm.security_state
set coded_dental_enforced = true
where id = 1;

do $release_check$
begin
  if not crm.coded_dental_enforcement_enabled() then
    raise exception 'coded dental enforcement release flag was not activated';
  end if;
end
$release_check$;

comment on column crm.security_state.coded_dental_enforced
is 'Private release flag. True requires finalized coded case sheets for new treatments and invoices.';
