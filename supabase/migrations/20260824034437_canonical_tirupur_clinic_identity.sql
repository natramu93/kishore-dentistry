-- Match the clinic identity exactly as supplied for the Tirupur location.
update crm.branches
set name = 'DR. KISHOR''S DENTISTRY - TIRUPUR',
    address = E'No-541, 543/338-34, 1st floor, Aadhaar Hospital, Opp to KR Bakes, Puspha Theatre Bus stop,\nTirupur – 641602.',
    phone = '9361135459',
    timezone = 'Asia/Kolkata',
    is_active = true,
    updated_at = now()
where code = 'TUP';

do $branch_check$
begin
  if not exists (
    select 1 from crm.branches
    where code = 'TUP'
      and name = 'DR. KISHOR''S DENTISTRY - TIRUPUR'
      and phone = '9361135459'
  ) then
    raise exception 'TUP branch is missing';
  end if;
end
$branch_check$;

-- Correct the three pre-release invoice snapshots as a controlled data
-- migration without turning the correction into a user edit/version change.
alter table crm.invoices disable trigger bump_invoice_version;
alter table crm.invoices disable trigger set_updated_at;
alter table crm.invoices disable trigger validate_invoice_update;
alter table crm.invoices disable trigger guard_invoice_issuer_snapshot;

update crm.invoices i
set issuer_name = 'DR. KISHOR''S DENTISTRY - TIRUPUR',
    issuer_address = b.address,
    issuer_phone = b.phone
from crm.branches b
where i.branch_id = b.id
  and b.code = 'TUP'
  and row(i.issuer_name, i.issuer_address, i.issuer_phone) is distinct from
      row('DR. KISHOR''S DENTISTRY - TIRUPUR', b.address, b.phone);

alter table crm.invoices enable trigger guard_invoice_issuer_snapshot;
alter table crm.invoices enable trigger validate_invoice_update;
alter table crm.invoices enable trigger set_updated_at;
alter table crm.invoices enable trigger bump_invoice_version;
