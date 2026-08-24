-- Dependency-free TAP-compatible regression test for the Tirupur clinic
-- identity and immutable invoice issuer snapshots.

begin;

select '1..1';

do $test$
declare
  v_branch crm.branches%rowtype;
  v_invoice crm.invoices%rowtype;
  v_invoice_after_branch_edit crm.invoices%rowtype;
  v_lead_id constant uuid := 'c1300000-0000-4000-8000-000000000001';
  v_invoice_id constant uuid := 'c1300000-0000-4000-8000-000000000002';
  v_address constant text := E'No-541, 543/338-34, 1st floor, Aadhaar Hospital,\nOpp to KR Bakes, Puspha Theatre Bus stop,\nTirupur – 641602.';
begin
  perform set_config('crm.allow_legacy_test_records', 'on', true);
  if (select count(*) from crm.branches where code = 'TUP') <> 1 then
    raise exception 'expected exactly one TUP branch';
  end if;

  select *
  into strict v_branch
  from crm.branches
  where code = 'TUP';

  if v_branch.name <> 'Tirupur'
     or v_branch.address is distinct from v_address
     or v_branch.phone <> '+919361135459'
     or v_branch.timezone <> 'Asia/Kolkata'
     or not v_branch.is_active then
    raise exception 'TUP branch does not contain the canonical Tirupur contact details';
  end if;

  insert into crm.leads (id, branch_id, name, mobile)
  values (v_lead_id, v_branch.id, 'Issuer Snapshot Test', '9000000013');

  insert into crm.invoices (
    id,
    invoice_number,
    lead_id,
    branch_id,
    code_enforced,
    issuer_name,
    issuer_address,
    issuer_phone
  )
  values (
    v_invoice_id,
    'TUP/2099/0013',
    v_lead_id,
    v_branch.id,
    false,
    'Untrusted caller-supplied name',
    'Untrusted caller-supplied address',
    '+910000000000'
  )
  returning * into v_invoice;

  if v_invoice.issuer_name <> 'DR. KISHOR''S DENTISTRY - TIRUPUR'
     or v_invoice.issuer_address is distinct from v_address
     or v_invoice.issuer_phone <> '+919361135459' then
    raise exception 'new invoice did not snapshot the Tirupur issuer details';
  end if;

  update crm.branches
  set address = 'A later branch address',
      phone = '+919999999999'
  where id = v_branch.id;

  select *
  into strict v_invoice_after_branch_edit
  from crm.invoices
  where id = v_invoice_id;

  if v_invoice_after_branch_edit.issuer_name is distinct from v_invoice.issuer_name
     or v_invoice_after_branch_edit.issuer_address is distinct from v_invoice.issuer_address
     or v_invoice_after_branch_edit.issuer_phone is distinct from v_invoice.issuer_phone then
    raise exception 'branch edits rewrote an existing invoice issuer snapshot';
  end if;

  begin
    update crm.invoices
    set issuer_address = 'Tampered invoice address'
    where id = v_invoice_id;

    raise exception 'invoice issuer snapshot was directly mutable';
  exception
    when sqlstate '55000' then
      null;
  end;
end
$test$;

select 'ok 1 - Tirupur clinic identity and invoice issuer snapshots hold';

rollback;
