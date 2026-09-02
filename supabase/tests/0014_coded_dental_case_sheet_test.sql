-- Dependency-free TAP-compatible regression test for coded case sheets.
begin;

select '1..1';

do $test$
declare
  v_admin constant uuid := 'c1400000-0000-4000-8000-000000000001';
  v_doctor_profile constant uuid := 'c1400000-0000-4000-8000-000000000002';
  v_branch uuid;
  v_doctor uuid;
  v_lead uuid;
  v_appointment uuid;
  v_sheet crm.case_sheets%rowtype;
  v_completed uuid;
  v_planned uuid;
  v_invoice crm.invoices%rowtype;
  v_reissued_invoice crm.invoices%rowtype;
  v_compat_invoice crm.invoices%rowtype;
  v_legacy_lead uuid;
  v_legacy_appointment uuid;
  v_legacy_treatment uuid;
  v_unassigned_lead uuid;
  v_unassigned_appointment uuid;
  v_by_treatment jsonb;
  v_totals jsonb;
  v_uncoded_rejected boolean := false;
begin
  if (select count(*) from crm.treatment_codes) <> 584 then
    raise exception 'authoritative treatment master does not contain 584 codes';
  end if;
  if not exists (
    select 1 from crm.treatment_codes
    where code = 'TMT_108' and name = 'TOOTH POLISHING' and status = 'active'
  ) then
    raise exception 'authoritative treatment code snapshot is incorrect';
  end if;

  insert into auth.users(id,email,raw_user_meta_data) values
    (v_admin,'case-sheet-admin@example.test','{"full_name":"Case Sheet Admin"}'),
    (v_doctor_profile,'case-sheet-doctor@example.test','{"full_name":"Case Sheet Doctor"}');
  update crm.profiles set role='admin',is_active=true where id=v_admin;
  update crm.profiles set role='doctor',is_active=true where id=v_doctor_profile;

  insert into crm.branches(name,code) values('Case Sheet Test Branch','H14') returning id into v_branch;
  insert into crm.user_branches(user_id,branch_id) values(v_doctor_profile,v_branch);
  insert into crm.doctors(branch_id,full_name,profile_id)
  values(v_branch,'Case Sheet Doctor',v_doctor_profile) returning id into v_doctor;

  insert into crm.leads(branch_id,name,mobile,status,created_by)
  values(v_branch,'Coded Patient','9000000014','appointment_booked',v_admin)
  returning id into v_lead;
  insert into crm.appointments(lead_id,branch_id,doctor_id,scheduled_at,status,created_by)
  values(v_lead,v_branch,v_doctor,'2020-01-14T09:00:00Z','scheduled',v_admin)
  returning id into v_appointment;

  update crm.security_state set coded_dental_enforced=false where id=1;
  execute 'set local role service_role';
  select * into v_compat_invoice from crm.create_invoice(
    v_lead,null,0,'Compatibility window',
    jsonb_build_array(jsonb_build_object(
      'description','Pre-release application line','quantity',1,'unit_price',100
    )),v_admin
  );
  execute 'reset role';
  if v_compat_invoice.code_enforced then
    raise exception 'compatibility window did not preserve the deployed invoice contract';
  end if;

  select * into v_sheet from crm.finalize_case_sheet(
    v_lead,v_appointment,v_doctor,'2020-01-14T09:05:00Z',
    'Sensitivity','Localized findings','Clinical diagnosis','Treat and review','None',
    jsonb_build_array(
      jsonb_build_object(
        'treatment_code','TMT_108','status','completed','site_scope','tooth',
        'tooth_number','11','surfaces',jsonb_build_array('buccal','mesial'),
        'quantity',2,'unit_price',1000,'notes','Completed uneventfully'
      ),
      jsonb_build_object(
        'treatment_code','TMT_11','status','planned','site_scope','not_applicable',
        'quantity',1,'unit_price',2000,'notes','Discussed as future care'
      )
    ),
    v_doctor_profile
  );
  update crm.security_state set coded_dental_enforced=true where id=1;

  begin
    perform crm.create_invoice(
      v_lead,null,0,'Uncoded after release',
      jsonb_build_array(jsonb_build_object(
        'description','Uncoded line','quantity',1,'unit_price',100
      )),v_admin
    );
  exception when others then
    v_uncoded_rejected := true;
  end;
  if not v_uncoded_rejected then
    raise exception 'uncoded invoice unexpectedly passed the release gate';
  end if;

  if (select status from crm.appointments where id=v_appointment) <> 'completed'
     or (select status from crm.leads where id=v_lead) <> 'visited_treated'
     or (select count(*) from crm.treatments where case_sheet_id=v_sheet.id) <> 2 then
    raise exception 'case-sheet finalization was not atomic';
  end if;

  select id into v_completed from crm.treatments
  where case_sheet_id=v_sheet.id and treatment_code='TMT_108';
  select id into v_planned from crm.treatments
  where case_sheet_id=v_sheet.id and treatment_code='TMT_11';

  if not exists (
    select 1 from crm.treatments
    where id=v_completed and treatment_name='TOOTH POLISHING'
      and clinical_status='completed' and tooth_number='11'
      and surfaces @> array['buccal','mesial']::text[] and signed_by=v_doctor_profile
  ) then
    raise exception 'signed tooth-level treatment snapshot is incorrect';
  end if;

  begin
    update crm.case_sheets set findings='Tampered' where id=v_sheet.id;
    raise exception 'finalized case sheet remained mutable';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    update crm.treatment_codes set name='Tampered' where code='TMT_108';
    raise exception 'treatment master remained mutable';
  exception when object_not_in_prerequisite_state then null;
  end;

  select report.by_treatment, report.totals
  into v_by_treatment, v_totals
  from crm.get_report_aggregates(
    v_admin,'2020-01-01T00:00:00Z','2020-02-01T00:00:00Z',v_branch,null
  ) report;
  if not exists (
    select 1 from jsonb_array_elements(v_by_treatment) item
    where item->>'key'='TMT_108' and (item->>'revenue')::numeric=2000
  ) or exists (
    select 1 from jsonb_array_elements(v_by_treatment) item
    where item->>'key'='TMT_11'
  ) or (v_totals->>'revenue')::numeric <> 2000 then
    raise exception 'reports did not use completed coded quantity totals';
  end if;

  begin
    insert into crm.case_sheets(
      id,lead_id,branch_id,appointment_id,doctor_id,visit_at,finalized_at,signed_by,created_by
    ) values (
      gen_random_uuid(),v_lead,v_branch,v_appointment,v_doctor,now(),now(),v_admin,v_admin
    );
    raise exception 'direct case-sheet insert unexpectedly succeeded';
  exception when object_not_in_prerequisite_state then null;
  end;

  perform set_config('crm.allow_legacy_test_records','on',true);
  insert into crm.treatments(
    lead_id,branch_id,appointment_id,doctor_id,cost,treated_at,created_by
  ) values (v_lead,v_branch,v_appointment,v_doctor,10,now(),v_admin)
  returning id into v_legacy_treatment;
  perform set_config('crm.allow_legacy_test_records','off',true);
  begin
    update crm.treatments
    set case_sheet_id=v_sheet.id,treatment_code='TMT_108',treatment_name='Forged',
        clinical_status='completed',site_scope='not_applicable',quantity=1,
        performed_at=now(),signed_at=now(),signed_by=v_admin,surfaces=array[]::text[]
    where id=v_legacy_treatment;
    raise exception 'legacy treatment was promoted into a coded record';
  exception when object_not_in_prerequisite_state then null;
  end;

  -- An authorized manager can assign an unassigned appointment as part of the
  -- same transaction that finalizes its coded case sheet.
  insert into crm.leads(branch_id,name,mobile,status,created_by)
  values(v_branch,'Unassigned Appointment Patient','9000000214','appointment_booked',v_admin)
  returning id into v_unassigned_lead;
  insert into crm.appointments(lead_id,branch_id,doctor_id,scheduled_at,status,created_by)
  values(v_unassigned_lead,v_branch,null,'2020-01-16T09:00:00Z','scheduled',v_admin)
  returning id into v_unassigned_appointment;
  perform crm.finalize_case_sheet(
    v_unassigned_lead,v_unassigned_appointment,v_doctor,'2020-01-16T09:05:00Z',
    'Review','Review findings','Review diagnosis','Review plan',null,
    jsonb_build_array(jsonb_build_object(
      'treatment_code','TMT_108','status','planned','site_scope','not_applicable',
      'quantity',1,'unit_price',0,'notes','Planned after review'
    )),
    v_admin
  );
  if not exists (
    select 1 from crm.appointments
    where id=v_unassigned_appointment and doctor_id=v_doctor and status='completed'
  ) then
    raise exception 'unassigned appointment was not atomically assigned and completed';
  end if;

  -- The historical visited_treated shortcut can no longer create an uncoded treatment.
  insert into crm.leads(branch_id,name,mobile,status,created_by)
  values(v_branch,'Legacy Shortcut Patient','9000000114','appointment_booked',v_admin)
  returning id into v_legacy_lead;
  insert into crm.appointments(lead_id,branch_id,doctor_id,scheduled_at,status,created_by)
  values(v_legacy_lead,v_branch,v_doctor,'2020-01-15T09:00:00Z','scheduled',v_admin)
  returning id into v_legacy_appointment;
  begin
    perform crm.transition_lead(v_legacy_lead,'visited_treated',v_admin,
      jsonb_build_object('appointment_id',v_legacy_appointment,'doctor_id',v_doctor,'cost',100));
    raise exception 'uncoded legacy transition unexpectedly created a treatment';
  exception when check_violation then null;
  end;
  if (select status from crm.appointments where id=v_legacy_appointment) <> 'scheduled' then
    raise exception 'rejected legacy transition partially completed the appointment';
  end if;

  begin
    perform crm.create_invoice(v_lead,v_planned,0,null,
      jsonb_build_array(jsonb_build_object('treatment_id',v_planned,'quantity',1,'unit_price',2000)),v_admin);
    raise exception 'planned treatment unexpectedly became invoiceable';
  exception when check_violation then null;
  end;

  select * into v_invoice from crm.create_invoice(v_lead,v_completed,18,'Coded invoice',
    jsonb_build_array(jsonb_build_object('treatment_id',v_completed,'quantity',2,'unit_price',1000)),v_admin);

  if not v_invoice.code_enforced or v_invoice.treatment_id is distinct from v_completed
     or not exists (
       select 1 from crm.invoice_items
       where invoice_id=v_invoice.id and treatment_id=v_completed
         and treatment_code='TMT_108'
         and treatment_name='TOOTH POLISHING'
         and tooth_number='11'
         and description like '[TMT_108] TOOTH POLISHING%'
     ) then
    raise exception 'invoice did not retain the signed coded treatment snapshot';
  end if;

  begin
    perform crm.create_invoice(v_lead,v_completed,0,null,
      jsonb_build_array(jsonb_build_object('treatment_id',v_completed,'quantity',2,'unit_price',1000)),v_admin);
    raise exception 'treatment was billed twice';
  exception when unique_violation then null;
  end;

  delete from crm.invoice_items where invoice_id=v_invoice.id;
  begin
    perform crm.transition_invoice_status(v_invoice.id,'sent',v_admin,v_invoice.version);
    raise exception 'malformed code-enforced invoice changed status';
  exception when check_violation then null;
  end;

  insert into crm.invoice_items(invoice_id,treatment_id,description,quantity,unit_price)
  values(v_invoice.id,v_completed,'Derived from treatment',2,1000);
  select * into v_invoice from crm.delete_invoice(
    v_invoice.id,v_admin,'Replaced draft',v_invoice.version
  );
  if exists (
    select 1 from crm.invoice_items
    where invoice_id=v_invoice.id and active_billing
  ) then
    raise exception 'archived invoice retained an active treatment reservation';
  end if;
  select * into v_reissued_invoice from crm.create_invoice(
    v_lead,v_completed,0,'Reissued after archived draft',
    jsonb_build_array(jsonb_build_object(
      'treatment_id',v_completed,'quantity',2,'unit_price',1000
    )),v_admin
  );
  if not exists (
    select 1 from crm.invoice_items
    where invoice_id=v_reissued_invoice.id and treatment_id=v_completed and active_billing
  ) then
    raise exception 'archived treatment could not be safely re-invoiced';
  end if;
end
$test$;

select 'ok 1 - coded case sheets gate invoices and preserve tooth-level history';

rollback;
