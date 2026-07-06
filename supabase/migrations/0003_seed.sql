-- ============================================================
-- 0003_seed.sql — reference data: branches, sources, treatments
-- ============================================================

insert into crm.branches (name, code, address, phone) values
  ('Anna Nagar',   'ANN', 'Anna Nagar, Chennai',   '+91 44 4000 0001'),
  ('T. Nagar',     'TNG', 'T. Nagar, Chennai',     '+91 44 4000 0002'),
  ('Velachery',    'VEL', 'Velachery, Chennai',    '+91 44 4000 0003'),
  ('Adyar',        'ADY', 'Adyar, Chennai',        '+91 44 4000 0004'),
  ('Porur',        'POR', 'Porur, Chennai',        '+91 44 4000 0005')
on conflict (code) do nothing;

insert into crm.lead_sources (name) values
  ('Twitter'), ('Facebook'), ('Instagram'), ('Google'),
  ('Reference'), ('Walk-in'), ('Website'), ('Other')
on conflict (name) do nothing;

insert into crm.treatment_types (name, default_cost) values
  ('Consultation',       500),
  ('Scaling / Cleaning', 1500),
  ('Filling',            2000),
  ('Root Canal (RCT)',   6000),
  ('Extraction',         2500),
  ('Crown',              8000),
  ('Implant',            35000),
  ('Braces / Aligners',  45000),
  ('Whitening',          8000)
on conflict (name) do nothing;
