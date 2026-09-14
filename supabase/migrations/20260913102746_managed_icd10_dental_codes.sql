-- Managed dental coding catalogue: WHO ICD-10 2019 K00-K14 oral-health diagnoses used for India-aligned clinical documentation.
-- Legacy TMT_* rows are removed when unreferenced and retained only as inactive history when referenced.

alter table crm.treatment_codes
  add column if not exists code_system text,
  add column if not exists code_level text,
  add column if not exists billable boolean,
  add column if not exists source_version text;

update crm.treatment_codes
set code_system = coalesce(code_system, 'KISHORE_TREATMENT'),
    code_level = coalesce(code_level, 'procedure'),
    billable = coalesce(billable, true),
    source_version = coalesce(source_version, 'legacy');

alter table crm.treatment_codes
  alter column code_system set default 'ICD10_IN',
  alter column code_system set not null,
  alter column code_level set not null,
  alter column billable set default true,
  alter column billable set not null,
  alter column source_version set not null;

alter table crm.treatment_codes drop constraint if exists treatment_codes_code_check;
alter table crm.treatment_codes add constraint treatment_codes_code_check check (code ~ '^(TMT_[0-9]+|K(0[0-9]|1[0-4])([.][0-9A-Z]{1,2})?)$');
alter table crm.treatment_codes add constraint treatment_codes_system_check check (code_system in ('KISHORE_TREATMENT', 'ICD10_IN'));
alter table crm.treatment_codes add constraint treatment_codes_level_check check (code_level in ('procedure', 'category', 'detail'));
alter table crm.treatment_codes add constraint treatment_codes_system_code_check check (
  (code_system = 'KISHORE_TREATMENT' and code ~ '^TMT_[0-9]+$')
  or (code_system = 'ICD10_IN' and code ~ '^K(0[0-9]|1[0-4])([.][0-9A-Z]{1,2})?$')
);
alter table crm.treatment_codes drop constraint if exists treatment_codes_name_check;
alter table crm.treatment_codes add constraint treatment_codes_name_check check (length(btrim(name)) between 1 and 300);

drop trigger if exists protect_treatment_codes_update_delete on crm.treatment_codes;
drop trigger if exists protect_treatment_codes_truncate on crm.treatment_codes;
drop function if exists crm.reject_treatment_code_mutation();

delete from crm.treatment_codes tc
where tc.code like 'TMT_%'
  and not exists (select 1 from crm.treatments t where t.treatment_code = tc.code)
  and not exists (select 1 from crm.invoice_items ii where ii.treatment_code = tc.code);

update crm.treatment_codes
set status = 'inactive'
where code like 'TMT_%';

alter table crm.treatment_codes drop constraint if exists treatment_codes_system_code_check;
alter table crm.treatment_codes add constraint treatment_codes_system_code_check check (
  (code_system = 'KISHORE_TREATMENT' and code ~ '^TMT_[0-9]+$' and status = 'inactive')
  or (code_system = 'ICD10_IN' and code ~ '^K(0[0-9]|1[0-4])([.][0-9A-Z]{1,2})?$')
);

insert into crm.treatment_codes (code, name, category, status, raw_metadata, source, code_system, code_level, billable, source_version) values
  ('K00', 'Disorders of tooth development and eruption', 'K00', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'category', false, '2019'),
  ('K00.0', 'Anodontia', 'K00', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K00.1', 'Supernumerary teeth', 'K00', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K00.2', 'Abnormalities of size and form of teeth', 'K00', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K00.3', 'Mottled teeth', 'K00', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K00.4', 'Disturbances in tooth formation', 'K00', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K00.5', 'Hereditary disturbances in tooth structure, not elsewhere classified', 'K00', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K00.6', 'Disturbances in tooth eruption', 'K00', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K00.7', 'Teething syndrome', 'K00', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K00.8', 'Other disorders of tooth development', 'K00', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K00.9', 'Disorder of tooth development, unspecified', 'K00', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K01', 'Embedded and impacted teeth', 'K01', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'category', false, '2019'),
  ('K01.0', 'Embedded teeth', 'K01', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K01.1', 'Impacted teeth', 'K01', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K02', 'Dental caries', 'K02', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'category', false, '2019'),
  ('K02.0', 'Caries limited to enamel', 'K02', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K02.1', 'Caries of dentine', 'K02', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K02.2', 'Caries of cementum', 'K02', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K02.3', 'Arrested dental caries', 'K02', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K02.4', 'Odontoclasia', 'K02', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K02.5', 'Caries with pulp exposure', 'K02', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K02.8', 'Other dental caries', 'K02', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K02.9', 'Dental caries, unspecified', 'K02', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K03', 'Other diseases of hard tissues of teeth', 'K03', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'category', false, '2019'),
  ('K03.0', 'Excessive attrition of teeth', 'K03', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K03.1', 'Abrasion of teeth', 'K03', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K03.2', 'Erosion of teeth', 'K03', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K03.3', 'Pathological resorption of teeth', 'K03', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K03.4', 'Hypercementosis', 'K03', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K03.5', 'Ankylosis of teeth', 'K03', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K03.6', 'Deposits [accretions] on teeth', 'K03', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K03.7', 'Posteruptive colour changes of dental hard tissues', 'K03', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K03.8', 'Other specified diseases of hard tissues of teeth', 'K03', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K03.9', 'Disease of hard tissues of teeth, unspecified', 'K03', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K04', 'Diseases of pulp and periapical tissues', 'K04', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'category', false, '2019'),
  ('K04.0', 'Pulpitis', 'K04', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K04.1', 'Necrosis of pulp', 'K04', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K04.2', 'Pulp degeneration', 'K04', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K04.3', 'Abnormal hard tissue formation in pulp', 'K04', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K04.4', 'Acute apical periodontitis of pulpal origin', 'K04', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K04.5', 'Chronic apical periodontitis', 'K04', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K04.6', 'Periapical abscess with sinus', 'K04', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K04.7', 'Periapical abscess without sinus', 'K04', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K04.8', 'Radicular cyst', 'K04', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K04.9', 'Other and unspecified diseases of pulp and periapical tissues', 'K04', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K05', 'Gingivitis and periodontal diseases', 'K05', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'category', false, '2019'),
  ('K05.0', 'Acute gingivitis', 'K05', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K05.1', 'Chronic gingivitis', 'K05', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K05.2', 'Acute periodontitis', 'K05', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K05.3', 'Chronic periodontitis', 'K05', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K05.4', 'Periodontosis', 'K05', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K05.5', 'Other periodontal diseases', 'K05', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K05.6', 'Periodontal disease, unspecified', 'K05', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K06', 'Other disorders of gingiva and edentulous alveolar ridge', 'K06', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'category', false, '2019'),
  ('K06.0', 'Gingival recession', 'K06', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K06.1', 'Gingival enlargement', 'K06', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K06.2', 'Gingival and edentulous alveolar ridge lesions associated with trauma', 'K06', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K06.8', 'Other specified disorders of gingiva and edentulous alveolar ridge', 'K06', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K06.9', 'Disorder of gingiva and edentulous alveolar ridge, unspecified', 'K06', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K07', 'Dentofacial anomalies [including malocclusion]', 'K07', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'category', false, '2019'),
  ('K07.0', 'Major anomalies of jaw size', 'K07', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K07.1', 'Anomalies of jaw-cranial base relationship', 'K07', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K07.2', 'Anomalies of dental arch relationship', 'K07', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K07.3', 'Anomalies of tooth position', 'K07', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K07.4', 'Malocclusion, unspecified', 'K07', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K07.5', 'Dentofacial functional abnormalities', 'K07', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K07.6', 'Temporomandibular joint disorders', 'K07', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K07.8', 'Other dentofacial anomalies', 'K07', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K07.9', 'Dentofacial anomaly, unspecified', 'K07', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K08', 'Other disorders of teeth and supporting structures', 'K08', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'category', false, '2019'),
  ('K08.0', 'Exfoliation of teeth due to systemic causes', 'K08', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K08.1', 'Loss of teeth due to accident, extraction or local periodontal disease', 'K08', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K08.2', 'Atrophy of edentulous alveolar ridge', 'K08', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K08.3', 'Retained dental root', 'K08', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K08.8', 'Other specified disorders of teeth and supporting structures', 'K08', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K08.9', 'Disorder of teeth and supporting structures, unspecified', 'K08', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K09', 'Cysts of oral region, not elsewhere classified', 'K09', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'category', false, '2019'),
  ('K09.0', 'Developmental odontogenic cysts', 'K09', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K09.1', 'Developmental (nonodontogenic) cysts of oral region', 'K09', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K09.2', 'Other cysts of jaw', 'K09', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K09.8', 'Other cysts of oral region, not elsewhere classified', 'K09', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K09.9', 'Cyst of oral region, unspecified', 'K09', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K10', 'Other diseases of jaws', 'K10', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'category', false, '2019'),
  ('K10.0', 'Developmental disorders of jaws', 'K10', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K10.1', 'Giant cell granuloma, central', 'K10', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K10.2', 'Inflammatory conditions of jaws', 'K10', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K10.3', 'Alveolitis of jaws', 'K10', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K10.8', 'Other specified diseases of jaws', 'K10', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K10.9', 'Disease of jaws, unspecified', 'K10', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K11', 'Diseases of salivary glands', 'K11', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'category', false, '2019'),
  ('K11.0', 'Atrophy of salivary gland', 'K11', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K11.1', 'Hypertrophy of salivary gland', 'K11', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K11.2', 'Sialoadenitis', 'K11', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K11.3', 'Abscess of salivary gland', 'K11', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K11.4', 'Fistula of salivary gland', 'K11', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K11.5', 'Sialolithiasis', 'K11', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K11.6', 'Mucocele of salivary gland', 'K11', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K11.7', 'Disturbances of salivary secretion', 'K11', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K11.8', 'Other diseases of salivary glands', 'K11', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K11.9', 'Disease of salivary gland, unspecified', 'K11', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K12', 'Stomatitis and related lesions', 'K12', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'category', false, '2019'),
  ('K12.0', 'Recurrent oral aphthae', 'K12', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K12.1', 'Other forms of stomatitis', 'K12', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K12.2', 'Cellulitis and abscess of mouth', 'K12', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K12.3', 'Oral mucositis (ulcerative)', 'K12', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K13', 'Other diseases of lip and oral mucosa', 'K13', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'category', false, '2019'),
  ('K13.0', 'Diseases of lips', 'K13', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K13.1', 'Cheek and lip biting', 'K13', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K13.2', 'Leukoplakia and other disturbances of oral epithelium, including tongue', 'K13', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K13.3', 'Hairy leukoplakia', 'K13', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K13.4', 'Granuloma and granuloma-like lesions of oral mucosa', 'K13', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K13.5', 'Oral submucous fibrosis', 'K13', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K13.6', 'Irritative hyperplasia of oral mucosa', 'K13', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K13.7', 'Other and unspecified lesions of oral mucosa', 'K13', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K14', 'Diseases of tongue', 'K14', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'category', false, '2019'),
  ('K14.0', 'Glossitis', 'K14', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K14.1', 'Geographic tongue', 'K14', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K14.2', 'Median rhomboid glossitis', 'K14', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K14.3', 'Hypertrophy of tongue papillae', 'K14', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K14.4', 'Atrophy of tongue papillae', 'K14', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K14.5', 'Plicated tongue', 'K14', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K14.6', 'Glossodynia', 'K14', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K14.8', 'Other diseases of tongue', 'K14', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019'),
  ('K14.9', 'Disease of tongue, unspecified', 'K14', 'active', null, 'WHO ICD-10 2019 / India-aligned', 'ICD10_IN', 'detail', true, '2019')
on conflict (code) do update set
  name = excluded.name,
  category = excluded.category,
  status = excluded.status,
  source = excluded.source,
  code_system = excluded.code_system,
  code_level = excluded.code_level,
  billable = excluded.billable,
  source_version = excluded.source_version;

grant select, insert, update, delete on crm.treatment_codes to service_role;
revoke truncate on crm.treatment_codes from service_role;

comment on table crm.treatment_codes is 'Admin-managed ICD-10 dental coding catalogue. ICD10_IN rows are WHO ICD-10 2019 K00-K14 oral-health diagnoses; any retained KISHORE_TREATMENT rows are inactive legacy history only.';
create index if not exists treatment_codes_system_status_idx on crm.treatment_codes (code_system, status, code);
