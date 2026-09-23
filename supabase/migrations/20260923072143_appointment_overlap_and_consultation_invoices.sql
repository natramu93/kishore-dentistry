-- Appointment duration and scheduling policy
alter table crm.appointments
  alter column duration_minutes set default 15;

create or replace function crm.validate_appointment_integrity() returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_lead_branch uuid;
  v_lead_deleted_at timestamptz;
  v_doctor_branch uuid;
  v_doctor_active boolean;
begin
  select l.branch_id, l.deleted_at
  into v_lead_branch, v_lead_deleted_at
  from crm.leads l
  where l.id = new.lead_id;

  if not found then
    raise exception 'lead % not found', new.lead_id
      using errcode = '23503';
  end if;

  if v_lead_deleted_at is not null then
    raise exception 'lead % is deleted', new.lead_id
      using errcode = '55000';
  end if;

  if new.branch_id is distinct from v_lead_branch then
    raise exception 'appointment branch must match lead branch'
      using errcode = '23514';
  end if;

  if new.doctor_id is not null then
    select d.branch_id, d.is_active
    into v_doctor_branch, v_doctor_active
    from crm.doctors d
    where d.id = new.doctor_id;

    if not found then
      raise exception 'doctor % not found', new.doctor_id
        using errcode = '23503';
    end if;

    if new.status = 'scheduled' and not v_doctor_active then
      raise exception 'doctor % is inactive', new.doctor_id
        using errcode = '55000';
    end if;

    if v_doctor_branch is distinct from v_lead_branch then
      raise exception 'appointment doctor must belong to the lead branch'
        using errcode = '23514';
    end if;
  end if;

  -- Overlapping visits are allowed. A patient may be booked with multiple
  -- doctors at the same time, and the clinic can decide how to handle it.
  return new;
end
$function$;

-- A consultation invoice is a non-clinical collection raised at reception.
-- It is deliberately distinct from historical uncoded invoices, which remain
-- read-only for audit safety.
alter table crm.invoices
  add column invoice_kind text not null default 'clinical';
alter table crm.invoices
  add constraint invoices_invoice_kind_check
  check (invoice_kind in ('clinical', 'consultation')) not valid;

create index invoices_kind_idx on crm.invoices (invoice_kind, created_at desc);

create or replace function crm.protect_invoice_code_enforcement() returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' and not new.code_enforced
     and crm.coded_dental_enforcement_enabled()
     and coalesce(current_setting('crm.allow_adhoc_invoice', true), '') <> 'on'
     and not (
       current_user = 'postgres'
       and current_setting('crm.allow_legacy_test_records', true) = 'on'
     ) then
    raise exception 'new invoices must be generated from coded case-sheet treatments'
      using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and new.code_enforced and new.status <> 'draft' then
    raise exception 'code-enforced invoices must be created as drafts' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.code_enforced is distinct from old.code_enforced then
    raise exception 'invoice code enforcement is immutable' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.code_enforced then
    perform crm.assert_coded_invoice_ready(old.id);
  end if;
  return new;
end
$function$;

create or replace function crm.create_consultation_invoice(
  p_lead_id uuid,
  p_amount numeric,
  p_notes text,
  p_actor uuid
) returns crm.invoices
language plpgsql
set search_path = ''
as $function$
declare
  v_lead crm.leads%rowtype;
  v_invoice crm.invoices%rowtype;
  v_number text;
  v_amount numeric := round(coalesce(p_amount, 0), 2);
begin
  perform crm.assert_invoice_write_access(p_actor, p_lead_id, false);
  if v_amount <= 0 or v_amount > 99999999.99 or v_amount <> round(v_amount, 2) then
    raise exception 'consultation amount must be greater than zero and have at most two decimals'
      using errcode = '22023';
  end if;
  if p_notes is not null and char_length(p_notes) > 4000 then
    raise exception 'invoice notes are too long' using errcode = '22023';
  end if;

  select * into v_lead from crm.leads where id = p_lead_id for update;
  if not found then
    raise exception 'lead % not found', p_lead_id using errcode = 'P0002';
  end if;
  v_number := crm.next_invoice_number(v_lead.branch_id);

  perform set_config('crm.allow_adhoc_invoice', 'on', true);
  insert into crm.invoices(
    invoice_number, lead_id, treatment_id, status, subtotal, tax_rate,
    tax_amount, total, notes, created_by, code_enforced, invoice_kind
  ) values (
    v_number, p_lead_id, null, 'draft', v_amount, 0,
    0, v_amount, nullif(btrim(p_notes), ''), p_actor, false, 'consultation'
  ) returning * into v_invoice;

  insert into crm.invoice_items(invoice_id, description, quantity, unit_price)
  values (v_invoice.id, 'Consultation', 1, v_amount);
  perform set_config('crm.allow_adhoc_invoice', 'off', true);

  insert into crm.lead_activity(lead_id, actor_id, type, detail)
  values (
    p_lead_id, p_actor, 'invoice',
    jsonb_build_object(
      'event', 'consultation_invoice_created',
      'invoice_id', v_invoice.id,
      'invoice_number', v_invoice.invoice_number,
      'total', v_invoice.total,
      'invoice_kind', 'consultation'
    )
  );
  insert into crm.audit_log(entity_type, entity_id, action, actor_id, new_data)
  values ('invoice', v_invoice.id, 'created', p_actor, to_jsonb(v_invoice));
  return v_invoice;
end
$function$;
