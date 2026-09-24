begin;

create temporary table _treatment_type_legacy on commit drop as
select id, name, category, default_cost, is_active from crm.treatment_types;

alter table crm.treatment_types drop constraint if exists treatment_types_name_key;
alter table crm.treatment_types add column branch_id uuid references crm.branches(id);
alter table crm.treatment_types add column is_general_consultation boolean not null default false;

-- Keep existing catalog ids in Tirupur so historical lead interest links remain stable.
update crm.treatment_types t
set branch_id = b.id,
    is_general_consultation = (lower(t.name) in ('consultation', 'general consultation'))
from crm.branches b
where b.code = 'TUP';

-- Clone the shared catalog to every other center, retaining the existing default prices.
insert into crm.treatment_types (branch_id, name, category, default_cost, is_active, is_general_consultation)
select b.id, legacy.name, legacy.category, legacy.default_cost, legacy.is_active,
       lower(legacy.name) in ('consultation', 'general consultation')
from crm.branches b
cross join _treatment_type_legacy legacy
where b.code <> 'TUP'
  and not exists (
    select 1 from crm.treatment_types t where t.branch_id = b.id and lower(t.name) = lower(legacy.name)
  );

-- Re-point any non-Tirupur lead interest to that center's matching catalog item.
update crm.leads l
set interest_id = scoped.id
from _treatment_type_legacy legacy
join crm.treatment_types scoped on lower(scoped.name) = lower(legacy.name)
where l.interest_id = legacy.id
  and scoped.branch_id = l.branch_id
  and l.branch_id <> (select id from crm.branches where code = 'TUP');

update crm.treatments tr
set treatment_type_id = scoped.id
from _treatment_type_legacy legacy
join crm.treatment_types scoped on lower(scoped.name) = lower(legacy.name)
where tr.treatment_type_id = legacy.id
  and scoped.branch_id = tr.branch_id
  and tr.branch_id <> (select id from crm.branches where code = 'TUP');

update crm.invoice_items ii
set treatment_type_id = scoped.id
from _treatment_type_legacy legacy
join crm.treatment_types scoped on lower(scoped.name) = lower(legacy.name)
join crm.invoices inv on inv.branch_id = scoped.branch_id
where ii.treatment_type_id = legacy.id
  and ii.invoice_id = inv.id
  and scoped.branch_id <> (select id from crm.branches where code = 'TUP');

alter table crm.treatment_types alter column branch_id set not null;
create index treatment_types_branch_active_idx on crm.treatment_types (branch_id, is_active, name);
create unique index treatment_types_branch_name_key on crm.treatment_types (branch_id, lower(name));

create table crm.medication_suggestions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references crm.branches(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  strength text check (strength is null or length(strength) <= 100),
  is_active boolean not null default true,
  created_by uuid references crm.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index medication_suggestions_branch_name_strength_key
  on crm.medication_suggestions (branch_id, lower(name), coalesce(lower(strength), ''));
create index medication_suggestions_branch_active_idx
  on crm.medication_suggestions (branch_id, is_active, name);
alter table crm.medication_suggestions enable row level security;

create function crm.validate_lead_interest_branch() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.interest_id is not null and not exists (
    select 1 from crm.treatment_types t where t.id = new.interest_id and t.branch_id = new.branch_id
  ) then
    raise exception 'treatment interest must belong to the lead center' using errcode = '23514';
  end if;
  return new;
end
$$;
create trigger validate_lead_interest_branch
  before insert or update of branch_id, interest_id on crm.leads
  for each row execute function crm.validate_lead_interest_branch();

create function crm.validate_treatment_type_branch() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.treatment_type_id is not null and not exists (
    select 1 from crm.treatment_types t where t.id = new.treatment_type_id and t.branch_id = new.branch_id
  ) then
    raise exception 'treatment type must belong to the treatment center' using errcode = '23514';
  end if;
  return new;
end
$$;
create trigger validate_treatment_type_branch
  before insert or update of branch_id, treatment_type_id on crm.treatments
  for each row execute function crm.validate_treatment_type_branch();

create function crm.validate_invoice_item_catalog_branch() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.treatment_type_id is not null and not exists (
    select 1 from crm.invoices i
    join crm.treatment_types t on t.branch_id = i.branch_id
    where i.id = new.invoice_id and t.id = new.treatment_type_id
  ) then
    raise exception 'invoice catalog treatment must belong to the invoice center' using errcode = '23514';
  end if;
  return new;
end
$$;
create trigger validate_invoice_item_catalog_branch
  before insert or update of invoice_id, treatment_type_id on crm.invoice_items
  for each row execute function crm.validate_invoice_item_catalog_branch();

commit;
