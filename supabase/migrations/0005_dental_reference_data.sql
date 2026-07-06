-- ============================================================
-- 0005_dental_reference_data.sql
-- Dental-domain global data: categorized treatment catalog with
-- realistic INR pricing, expanded lead sources, and a lead
-- "treatment interest" link (marketing -> treatment funnel).
-- ============================================================

-- Schema additions
alter table crm.treatment_types add column if not exists category text;
alter table crm.leads add column if not exists interest_id uuid references crm.treatment_types(id);
create index if not exists leads_interest_idx on crm.leads (interest_id);

-- ---------- Comprehensive treatment catalog (INR) ----------
-- Upsert by name: updates the existing seed rows and adds the rest.
insert into crm.treatment_types (name, category, default_cost) values
  -- Consultation & Diagnostics
  ('Consultation',                'Consultation & Diagnostics', 300),
  ('Dental X-ray (IOPA)',         'Consultation & Diagnostics', 300),
  ('Full Mouth X-ray (OPG)',      'Consultation & Diagnostics', 800),
  -- Preventive
  ('Scaling & Polishing',         'Preventive', 1500),
  ('Fluoride Application',        'Preventive', 1000),
  -- Restorative
  ('Composite Filling',           'Restorative', 2000),
  ('GIC Filling',                 'Restorative', 1200),
  ('Inlay / Onlay',               'Restorative', 6000),
  -- Endodontics
  ('Root Canal — Anterior',       'Endodontics', 5000),
  ('Root Canal — Molar',          'Endodontics', 7000),
  ('Re-Root Canal Treatment',     'Endodontics', 8000),
  ('Post & Core',                 'Endodontics', 3000),
  -- Crowns & Bridges
  ('Metal Crown',                 'Crowns & Bridges', 4000),
  ('PFM Crown',                   'Crowns & Bridges', 5000),
  ('Zirconia Crown',              'Crowns & Bridges', 10000),
  -- Dentures
  ('Complete Denture (per arch)', 'Dentures', 15000),
  ('BPS Denture (per arch)',      'Dentures', 35000),
  ('Cast Partial Denture',        'Dentures', 15000),
  -- Dental Implants
  ('Dental Implant (single)',     'Dental Implants', 35000),
  ('All-on-4 Implants (per arch)','Dental Implants', 250000),
  ('Bone Grafting',               'Dental Implants', 15000),
  -- Orthodontics
  ('Metal Braces',                'Orthodontics', 30000),
  ('Ceramic Braces',              'Orthodontics', 45000),
  ('Invisalign / Clear Aligners', 'Orthodontics', 150000),
  -- Oral Surgery
  ('Tooth Extraction (Simple)',   'Oral Surgery', 1000),
  ('Surgical Extraction',         'Oral Surgery', 3000),
  ('Wisdom Tooth Removal',        'Oral Surgery', 5000),
  -- Periodontics
  ('Deep Cleaning (per quadrant)','Periodontics', 2500),
  ('Flap Surgery (per quadrant)', 'Periodontics', 8000),
  ('Laser Gum Treatment',         'Periodontics', 8000),
  -- Cosmetic
  ('Teeth Whitening',             'Cosmetic Dentistry', 8000),
  ('Veneers (per tooth)',         'Cosmetic Dentistry', 12000),
  ('Smile Design',                'Cosmetic Dentistry', 25000),
  -- Pediatric
  ('Kids Consultation',           'Pediatric Dentistry', 300),
  ('Milk Tooth Extraction',       'Pediatric Dentistry', 800),
  ('Pit & Fissure Sealant',       'Pediatric Dentistry', 1000)
on conflict (name) do update
  set category = excluded.category,
      default_cost = excluded.default_cost;

-- Categorize any legacy rows kept from the original seed
update crm.treatment_types set category = 'Restorative'  where name = 'Filling'            and category is null;
update crm.treatment_types set category = 'Endodontics'  where name = 'Root Canal (RCT)'   and category is null;
update crm.treatment_types set category = 'Oral Surgery' where name = 'Extraction'         and category is null;
update crm.treatment_types set category = 'Crowns & Bridges' where name = 'Crown'          and category is null;
update crm.treatment_types set category = 'Dental Implants'  where name = 'Implant'         and category is null;
update crm.treatment_types set category = 'Orthodontics' where name = 'Braces / Aligners'  and category is null;
update crm.treatment_types set category = 'Cosmetic Dentistry' where name = 'Whitening'     and category is null;
update crm.treatment_types set category = 'Preventive'   where name = 'Cleaning'           and category is null;
update crm.treatment_types set category = 'Preventive'   where name = 'Scaling / Cleaning' and category is null;
update crm.treatment_types set category = 'Consultation & Diagnostics' where category is null;

-- ---------- Expanded dental lead sources ----------
insert into crm.lead_sources (name) values
  ('Google Search'), ('Google Ads'), ('Meta / Facebook Ads'), ('Instagram'),
  ('YouTube'), ('WhatsApp'), ('Website'), ('Practo'), ('JustDial'),
  ('Google Maps (GMB)'), ('Walk-in'), ('Doctor Referral'),
  ('Patient Referral'), ('Dental Camp / Screening'), ('Hoarding / Banner'),
  ('Newspaper'), ('Corporate / Insurance'), ('Existing Patient')
on conflict (name) do nothing;
