-- Dental ICD-9-CM Volume 3 procedures, CMS Version 32 (effective 2014-10-01).
-- Source: https://www.cms.gov/medicare/coding/icd9providerdiagnosticcodes/downloads/icd-9-cm-v32-master-descriptions.zip
-- Scope: all leaf codes in 23 and 24, plus dental radiography 87.11/87.12 and scaling 96.54.
-- These are legacy procedure codes, not WHO ICD-10 diagnoses or an Indian-specific standard.
-- Existing codes, patient records, permissions and foreign keys are preserved.
begin;
alter table crm.treatment_codes drop constraint treatment_codes_code_check;
alter table crm.treatment_codes drop constraint treatment_codes_system_check;
alter table crm.treatment_codes drop constraint treatment_codes_system_code_check;
alter table crm.treatment_codes add constraint treatment_codes_code_check check (
  code ~ '^(TMT_[0-9]+|K(0[0-9]|1[0-4])([.][0-9A-Z]{1,2})?|(23|24)[.][0-9]{1,2}|87[.]1[12]|96[.]54)$'
);
alter table crm.treatment_codes add constraint treatment_codes_system_check check (
  code_system in ('KISHORE_TREATMENT', 'ICD10_IN', 'ICD9_CM_PROCEDURE')
);
alter table crm.treatment_codes add constraint treatment_codes_system_code_check check (
  (code_system = 'KISHORE_TREATMENT' and code ~ '^TMT_[0-9]+$' and status = 'inactive')
  or (code_system = 'ICD10_IN' and code ~ '^K(0[0-9]|1[0-4])([.][0-9A-Z]{1,2})?$')
  or (code_system = 'ICD9_CM_PROCEDURE' and code ~ '^((23|24)[.][0-9]{1,2}|87[.]1[12]|96[.]54)$' and code_level = 'procedure')
);
insert into crm.treatment_codes (code, name, category, status, raw_metadata, source, code_system, code_level, billable, source_version) values
  ('23.01', 'Extraction of deciduous tooth', '23', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('23.09', 'Extraction of other tooth', '23', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('23.11', 'Removal of residual root', '23', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('23.19', 'Other surgical extraction of tooth', '23', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('23.2', 'Restoration of tooth by filling', '23', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('23.3', 'Restoration of tooth by inlay', '23', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('23.41', 'Application of crown', '23', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('23.42', 'Insertion of fixed bridge', '23', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('23.43', 'Insertion of removable bridge', '23', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('23.49', 'Other dental restoration', '23', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('23.5', 'Implantation of tooth', '23', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('23.6', 'Prosthetic dental implant', '23', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('23.70', 'Root canal, not otherwise specified', '23', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('23.71', 'Root canal therapy with irrigation', '23', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('23.72', 'Root canal therapy with apicoectomy', '23', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('23.73', 'Apicoectomy', '23', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('24.0', 'Incision of gum or alveolar bone', '24', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('24.11', 'Biopsy of gum', '24', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('24.12', 'Biopsy of alveolus', '24', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('24.19', 'Other diagnostic procedures on teeth, gums, and alveoli', '24', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('24.2', 'Gingivoplasty', '24', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('24.31', 'Excision of lesion or tissue of gum', '24', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('24.32', 'Suture of laceration of gum', '24', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('24.39', 'Other operations on gum', '24', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('24.4', 'Excision of dental lesion of jaw', '24', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('24.5', 'Alveoloplasty', '24', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('24.6', 'Exposure of tooth', '24', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('24.7', 'Application of orthodontic appliance', '24', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('24.8', 'Other orthodontic operation', '24', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('24.91', 'Extension or deepening of buccolabial or lingual sulcus', '24', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('24.99', 'Other dental operations', '24', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('87.11', 'Full-mouth x-ray of teeth', '87', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('87.12', 'Other dental x-ray', '87', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01'),
  ('96.54', 'Dental scaling, polishing, and debridement', '96', 'active', null, 'CMS ICD-9-CM Volume 3', 'ICD9_CM_PROCEDURE', 'procedure', true, '32 / 2014-10-01')
on conflict (code) do nothing;
comment on table crm.treatment_codes is 'Admin-managed dental code catalogue: WHO ICD-10 2019 K00-K14 diagnoses and CMS ICD-9-CM Volume 3 dental procedures. Legacy TMT codes remain inactive history only.';
commit;
