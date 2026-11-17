-- Pre-CRM receivables are collectible but are not new treatment billings.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table crm.invoices
  drop constraint invoices_invoice_kind_check,
  add column legacy_patient_ref text,
  add constraint invoices_invoice_kind_check check (invoice_kind in ('clinical','consultation','opening_balance')) not valid,
  add constraint invoices_opening_balance_identity_check check (
    (invoice_kind <> 'opening_balance' and legacy_patient_ref is null) or
    (invoice_kind = 'opening_balance' and legacy_patient_ref is not null and not code_enforced
     and invoice_date is not null and treatment_id is null and subtotal = total
     and tax_rate = 0 and tax_amount = 0 and discount_amount = 0));
create unique index invoices_legacy_opening_balance_ref_idx
  on crm.invoices(legacy_patient_ref) where legacy_patient_ref is not null;

create function crm.guard_opening_balance_identity() returns trigger
language plpgsql set search_path = '' as $function$
begin
  if tg_op = 'INSERT' then
    if new.invoice_kind = 'opening_balance'
       and current_setting('crm.importing_opening_balance', true) is distinct from 'on' then
      raise exception 'use the opening balance import' using errcode = '55000';
    end if;
  elsif (new.invoice_kind,new.legacy_patient_ref) is distinct from (old.invoice_kind,old.legacy_patient_ref)
     or (old.invoice_kind = 'opening_balance'
         and (new.invoice_date,new.subtotal,new.total) is distinct from (old.invoice_date,old.subtotal,old.total)) then
    raise exception 'opening balance identity and amount are immutable' using errcode = '55000';
  end if;
  return new;
end
$function$;
create trigger opening_balance_identity_guard before insert or update on crm.invoices
for each row execute function crm.guard_opening_balance_identity();
revoke all on function crm.guard_opening_balance_identity() from public, anon, authenticated;

do $migration$
declare v_rpc regprocedure; v_def text; v_anchor text;
begin
  -- Allow receipt entry/correction without treating the opening balance as a consultation.
  foreach v_rpc in array array[
    'crm.record_invoice_payment(uuid,numeric,crm.invoice_payment_method,text,text,uuid)'::regprocedure,
    'crm.record_invoice_payment_batch(uuid,jsonb,uuid,uuid)'::regprocedure,
    'crm.update_invoice_payment(uuid,uuid,numeric,crm.invoice_payment_method,text,text,bigint,uuid)'::regprocedure
  ] loop
    v_def := pg_get_functiondef(v_rpc);
    if array_length(string_to_array(v_def, 'v_invoice.invoice_kind'),1) is distinct from 2 then
      raise exception 'Unexpected receipt workflow definition: %',v_rpc;
    end if;
    v_def := regexp_replace(v_def, 'v_invoice\.invoice_kind\s*<>\s*''consultation''',
      'v_invoice.invoice_kind not in (''consultation'',''opening_balance'')');
    if v_def not like '%''opening_balance''%' then raise exception 'Receipt anchor not found: %',v_rpc; end if;
    execute v_def;
  end loop;

  v_def := pg_get_functiondef('crm.get_report_invoice_values(uuid,timestamptz,timestamptz,uuid,uuid)'::regprocedure);
  v_anchor := 'where i.deleted_at is null and i.status<>''cancelled''';
  if array_length(string_to_array(v_def,v_anchor),1) is distinct from 2 then raise exception 'Unexpected billing report definition'; end if;
  execute replace(v_def,v_anchor,v_anchor || ' and i.invoice_kind<>''opening_balance''');

  v_def := pg_get_functiondef('crm.update_invoice_with_date(uuid,numeric,text,jsonb,uuid,bigint,numeric,text,text,date)'::regprocedure);
  v_anchor := 'if v_old.deleted_at is not null or v_old.status in (''paid'', ''cancelled'') then';
  if array_length(string_to_array(v_def,v_anchor),1) is distinct from 2 then raise exception 'Unexpected invoice edit definition'; end if;
  execute replace(v_def,v_anchor,'if v_old.invoice_kind = ''opening_balance'' or v_old.deleted_at is not null or v_old.status in (''paid'', ''cancelled'') then');
end
$migration$;

-- Batch is transactional. Production callers supply a reviewed manifest, not arbitrary
-- descriptions or doctor names. Stable legacy IDs prevent double-posting the same debt.
create function crm.import_legacy_opening_balances(p_date date,p_rows jsonb,p_actor uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare
  v_row record;
  v_patient crm.leads%rowtype;
  v_bill crm.invoices%rowtype;
  v_branch text;
  v_created integer := 0;
  v_posted integer := 0;
  v_skipped integer := 0;
  v_total numeric := 0;
  v_description constant text := 'Due carry forward from old system';
begin
  if not exists(select 1 from crm.profiles where id=p_actor and role='admin' and is_active) then
    raise exception 'active admin required' using errcode='42501';
  end if;
  if p_date is null or not isfinite(p_date) or jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_array_length(p_rows) not between 1 and 250 then
    raise exception 'invalid opening balance manifest' using errcode='22023';
  end if;
  -- Serialize this brief, one-time import with ordinary patient/invoice writes.
  lock table crm.leads, crm.invoices in share row exclusive mode;
  for v_row in select * from jsonb_to_recordset(p_rows) as item(
      legacy_ref text, branch_id uuid, patient_id uuid, name text, mobile text,
      title text, amount numeric, expected_name text, expected_mobile text) loop
    v_branch := case split_part(v_row.legacy_ref,'-',1)
      when 'TRPAVN' then 'TUP' when 'CMBPLM' then 'CBE' when 'CHNKLP' then 'CHE' end;
    if v_branch is null or v_row.legacy_ref !~ '^[A-Z]{6}-[0-9]+$' or v_row.amount is null
       or v_row.amount not between 0.01 and 99999999.99 or v_row.amount <> round(v_row.amount,2)
       or coalesce(v_row.mobile,'') !~ '^[6-9][0-9]{9}$' or nullif(btrim(v_row.name),'') is null
       or not exists(select 1 from crm.branches where id=v_row.branch_id and code=v_branch and is_active) then
      raise exception 'invalid opening balance row' using errcode='22023';
    end if;
    select * into v_bill from crm.invoices where legacy_patient_ref=v_row.legacy_ref;
    if found then
      if v_bill.billing_date is distinct from p_date or v_bill.total is distinct from v_row.amount
         or v_bill.branch_id is distinct from v_row.branch_id or v_bill.deleted_at is not null or v_bill.status='cancelled'
         or (v_row.patient_id is not null and v_bill.lead_id is distinct from v_row.patient_id) then
        raise exception 'existing opening balance does not match the manifest' using errcode='40001';
      end if;
      v_skipped := v_skipped + 1;
      continue;
    end if;
    if v_row.patient_id is null then
      if exists(select 1 from crm.leads p where p.branch_id=v_row.branch_id and
           (right(regexp_replace(p.mobile,'[^0-9]','','g'),10)=v_row.mobile
            or lower(btrim(p.name))=lower(btrim(v_row.name)))) then
        raise exception 'patient records changed after reconciliation' using errcode='40001';
      end if;
      select * into v_patient from crm.create_lead(v_row.branch_id,btrim(v_row.name),v_row.mobile,null,null,null,
        null::numeric,null,'Old system patient ID: ' || v_row.legacy_ref,p_actor,v_row.title,null);
      v_created := v_created + 1;
    else
      select * into v_patient from crm.leads where id=v_row.patient_id and branch_id=v_row.branch_id
        and deleted_at is null and name=v_row.expected_name and mobile=v_row.expected_mobile;
      if not found or exists(select 1 from crm.invoices where lead_id=v_row.patient_id
        and deleted_at is null and status<>'cancelled') then
        raise exception 'patient or invoices changed after reconciliation' using errcode='40001';
      end if;
    end if;
    perform set_config('crm.allow_adhoc_invoice','on',true);
    perform set_config('crm.importing_opening_balance','on',true);
    insert into crm.invoices(invoice_number,lead_id,status,subtotal,tax_rate,tax_amount,total,
      notes,created_by,code_enforced,invoice_kind,invoice_date,legacy_patient_ref,consulting_doctor_name,referring_doctor_name)
    values(crm.next_invoice_number(v_patient.branch_id),v_patient.id,'draft',v_row.amount,0,0,v_row.amount,
      v_description || ' | Old system patient ID: ' || v_row.legacy_ref,p_actor,false,'opening_balance',p_date,
      v_row.legacy_ref,'Not available in legacy export','Not available in legacy export') returning * into v_bill;
    insert into crm.invoice_items(invoice_id,description,quantity,unit_price)
      values(v_bill.id,v_description,1,v_row.amount);
    perform set_config('crm.allow_adhoc_invoice','off',true);
    perform set_config('crm.importing_opening_balance','off',true);
    insert into crm.lead_activity(lead_id,actor_id,type,detail)
      values(v_patient.id,p_actor,'invoice',jsonb_build_object('event','opening_balance_imported','invoice_id',v_bill.id,
        'invoice_number',v_bill.invoice_number,'total',v_bill.total,'invoice_date',p_date,'legacy_patient_ref',v_row.legacy_ref));
    insert into crm.audit_log(entity_type,entity_id,action,actor_id,new_data)
      values('invoice',v_bill.id,'created',p_actor,to_jsonb(v_bill));
    v_posted := v_posted + 1;
    v_total := v_total + v_bill.total;
  end loop;
  return jsonb_build_object('patients_created',v_created,'entries_posted',v_posted,'entries_already_present',v_skipped,'amount_posted',v_total);
end
$function$;
revoke all on function crm.import_legacy_opening_balances(date,jsonb,uuid) from public,anon,authenticated;
grant execute on function crm.import_legacy_opening_balances(date,jsonb,uuid) to service_role;
notify pgrst,'reload schema';
