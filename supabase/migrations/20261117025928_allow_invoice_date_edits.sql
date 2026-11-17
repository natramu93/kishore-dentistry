-- Date corrections are part of the same locked, versioned invoice edit.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $migration$
declare
  v_body text;
  v_guard text;
  v_update constant text := '  update crm.invoices set subtotal = v_subtotal, tax_rate = p_tax_rate, tax_amount = v_tax,';
  v_after_update constant text := 'where id = p_invoice_id returning * into v_invoice;';
  v_identity constant text := '    raise exception ''invoice identity fields are immutable'' using errcode=''55000'';';
  v_paid_check constant text := '  if old.status in (''paid'',''cancelled'') and row(';
begin
  select prosrc into strict v_body from pg_proc
    where oid = 'crm.update_invoice(uuid,numeric,text,jsonb,uuid,bigint,numeric,text,text)'::regprocedure;
  if array_length(string_to_array(v_body, v_update), 1) is distinct from 2
     or array_length(string_to_array(v_body, v_after_update), 1) is distinct from 2 then
    raise exception 'Invoice edit definition does not match the expected update';
  end if;
  v_body := replace(v_body, v_update, $edit$  if p_invoice_date is not null and
     (p_expected_version is null or p_invoice_date not between date '0001-01-01' and date '9999-12-31') then
    raise exception 'a valid invoice date and invoice version are required' using errcode='22023';
  end if;
  perform set_config('crm.editing_invoice_date', p_invoice_id::text, true);
$edit$ || v_update || $date$
    invoice_date = case when p_invoice_date is null or p_invoice_date = v_old.billing_date
      then v_old.invoice_date else p_invoice_date end,$date$);
  v_body := replace(v_body, v_after_update, v_after_update || $reset$
  perform set_config('crm.editing_invoice_date', '', true);$reset$);
  execute format($new$
    create function crm.update_invoice_with_date(
      p_invoice_id uuid, p_tax_rate numeric, p_notes text, p_items jsonb, p_actor uuid,
      p_expected_version bigint, p_discount_amount numeric, p_discount_given_by text,
      p_mention text, p_invoice_date date
    ) returns crm.invoices language plpgsql security invoker set search_path = '' as %L
  $new$, v_body);

  v_guard := pg_get_functiondef('crm.validate_invoice_update()'::regprocedure);
  if array_length(string_to_array(v_guard, ',new.invoice_date,new.consulting_doctor_name'), 1) is distinct from 2
     or array_length(string_to_array(v_guard, ',old.invoice_date,old.consulting_doctor_name'), 1) is distinct from 2
     or array_length(string_to_array(v_guard, v_identity), 1) is distinct from 2
     or array_length(string_to_array(v_guard, v_paid_check), 1) is distinct from 2 then
    raise exception 'Invoice guard definition does not match the expected identity and payment checks';
  end if;
  v_guard := replace(replace(v_guard, ',new.invoice_date,new.consulting_doctor_name', ',new.consulting_doctor_name'),
    ',old.invoice_date,old.consulting_doctor_name', ',old.consulting_doctor_name');
  execute replace(v_guard, v_paid_check, $guard$  if new.invoice_date is distinct from old.invoice_date
     and (current_setting('crm.editing_invoice_date', true) is distinct from old.id::text
          or old.status in ('paid','cancelled')
          or clock_timestamp() >= old.created_at + interval '24 hours'
          or exists (select 1 from crm.invoice_payments where invoice_id = old.id)) then
    raise exception 'invoice date can only be changed through the unpaid invoice edit workflow' using errcode='55000';
  end if;
$guard$ || v_paid_check);
end
$migration$;

revoke all on function crm.update_invoice_with_date(uuid,numeric,text,jsonb,uuid,bigint,numeric,text,text,date)
  from public, anon, authenticated;
grant execute on function crm.update_invoice_with_date(uuid,numeric,text,jsonb,uuid,bigint,numeric,text,text,date)
  to service_role;

-- Older clients keep the prior signature and preserve the stored date.
create or replace function crm.update_invoice(
  p_invoice_id uuid, p_tax_rate numeric, p_notes text, p_items jsonb,
  p_actor uuid, p_expected_version bigint default null,
  p_discount_amount numeric default null, p_discount_given_by text default null, p_mention text default null
) returns crm.invoices language sql security invoker set search_path = '' as $function$
  select * from crm.update_invoice_with_date(
    p_invoice_id, p_tax_rate, p_notes, p_items, p_actor, p_expected_version,
    p_discount_amount, p_discount_given_by, p_mention, null::date
  );
$function$;

notify pgrst, 'reload schema';
