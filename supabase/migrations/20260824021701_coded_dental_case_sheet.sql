-- Coded dental case sheets and invoice traceability.
-- Historical treatments/invoices remain nullable/legacy. A private release
-- flag keeps the currently deployed app compatible while this schema and the
-- new app are rolled out; the next migration enables mandatory enforcement.

alter table crm.security_state
  add column coded_dental_enforced boolean not null default false;

create function crm.coded_dental_enforcement_enabled() returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((
    select s.coded_dental_enforced
    from crm.security_state s
    where s.id = 1
  ), false)
$function$;

revoke execute on function crm.coded_dental_enforcement_enabled()
  from public, anon, authenticated;
grant execute on function crm.coded_dental_enforcement_enabled()
  to service_role;

create table crm.treatment_codes (
  code text primary key,
  name text not null,
  category text,
  status text not null,
  raw_metadata text,
  source text,
  created_at timestamptz not null default now(),
  constraint treatment_codes_code_check check (code ~ '^TMT_[0-9]+$'),
  constraint treatment_codes_name_check check (length(btrim(name)) between 1 and 300),
  constraint treatment_codes_status_check check (length(btrim(status)) between 1 and 40)
);

insert into crm.treatment_codes (code, name, category, status, raw_metadata, source)
values
  ('TMT_108', 'TOOTH POLISHING', 'GENERAL', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_11', 'FRENECTOMY (SCALPEL)', 'PERIODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_12', 'FRENECTOMY (LASER)', 'PERIODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_123', 'ALIGNER COMPREHENSIVE  3 YEARS WARRANTY', 'ORTHO', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_124', 'ALIGNER COMPREHENSIVE  5 YEARS WARRANTY', 'ORTHO', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_125', 'RETAINER HAWLEYS AND ESSIX PER ARCH', 'ORTHO', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_128', 'BIOPSY', 'ORAL SURGERY', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_132', 'CROWN REMOVAL', 'PROSTHODONTICS', 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_134', 'EXTRACTION ANTERIOR', 'ORAL SURGERY', 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_139', 'SCALING - OP', 'PERIODONTICS', 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_144', 'CROWN REFIXING', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_145', 'ALVEOLOPLASTY', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_154', 'SURGICAL EXTRACTION POSTERIOR', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_169', 'CROWN REMOVAL DONE', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_17', 'EXTRACTION (FOR GRADE 3 MOBILITY)', 'ORAL SURGERY', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_173', 'ROOT CANAL TREATMENT - NORMAL', 'ENDODONTICS', 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_177', 'NORMAL GIC', 'ENDODONTICS', 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_179', 'NORMAL GIC WITH BASE', 'ENDODONTICS', 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_18', 'EXTRACTION (FOR GRADE 2 AND 1 AND ORTHO)', 'ORAL SURGERY', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_181', 'COMPOSITE RESTORATION', 'ENDODONTICS', 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_184', 'ALIGNER (MODERATE)', 'ORTHO', 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_186', 'ALIGNER (COMPREHENSIVE) EMI OPTION', 'ORTHO', 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_19', 'EXTRACTION UPPER 8 THIRD MOLAR', 'ORAL SURGERY', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_191', 'EXTRACTION - RC TREATED', 'ORAL SURGERY', 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_198', 'temporary filling', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_2', 'SPECIALIST CONSULTATION', 'GENERAL', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_20', 'EXTRACTION LOWER 3RD MOLAR (NOT IMPACTED)', 'ORAL SURGERY', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_200', 'CLASS II GIC', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_21', 'EXTRACTION LOWER 3RD MOLAR (IMPACTED)', 'ORAL SURGERY', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_22', 'ALVEOLOPLASTY FOR EDENTULOUS ARCH', 'ORAL SURGERY', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_220', 'ENTRANCE FILLING', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_250', 'SURGEONS FEES', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_254', '5D scan', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_260', 'scaling', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_276', '3M METAL BRACES', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_278', '5D SCANNING', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_284', 'COURIER CHARGE', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_293', 'ULTRA SOUND', 'PHYSIO', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_295', 'INTERNATIONAL COURIER CHARGES', 'OTHERS', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_296', 'crown lengthening', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_297', 'SURGICAL EXTRACTION', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_298', 'concious sedation', 'others', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_3', 'OPG (>1 FINDING)', 'GENERAL', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_30', 'CLASS I LC POSTERIOR COMPOSITE', 'RESTORATIVE', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_300', 'impacted canine', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_305', 'PERIAPICAL SURGERY', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_31', 'CLASS I GIC ULTRA TYPE 9', 'RESTORATIVE', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_316', 'EXTRACTION OF UPPER 3RD MOLAR', 'EXTRACTION', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_317', 'LASER CURETTAGE FULL MOUTH SUNGINGIVAL', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_32', 'CLASS II LCR', 'RESTORATIVE', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_325', 'SURGICAL EXTRACTION OF IMPACTED', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_329', 'ACCESS OPENING', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_33', 'DEEP FILLING CALCIUM BASE', 'RESTORATIVE', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_330', 'BRACES', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_331', 'COMPOSITE FILLINGS', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_332', 'CYST REMOVAL', 'ORAL SURGERY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_333', 'ROOT CANAL', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_334', 'BLT IMPLANT', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_335', 'DECIDIOUS TOOTH EXTRACTION PEDO', 'PEDEATRIC', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_337', 'ROOT CANAL TREATMENT', 'ENDODONTICS', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_339', 'CROWN REFIXING DONE', 'REPLACEMENT', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_34', 'CLASS IIIIV LCR', 'RESTORATIVE', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_340', 'RPD', 'TEMPORARY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_342', 'GIC FILLINGS', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_343', 'LC FILLINGS', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_346', 'FLR BONDED IRT', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_347', 'FULL MOUTH ZIRCONIA PACKAGE', 'IMPLANT CROWN', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_348', 'ADVANCE AMOUNT', 'advance', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_349', 'ZYGOMATIC IMPLANT', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_35', 'CLASS V GIC', 'RESTORATIVE', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_350', 'UNDER GA ( GENERAL ANAESTHETIC)', 'ANESTHESIA', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_351', 'TAB', 'TAB', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_352', 'DMLS PFM', 'CROWN', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_353', 'UPPER CD AND LOWER RPD', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_354', 'BLT IMPLANT( STRAUMAN)', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_355', 'ROOM', 'RENT', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_356', 'FULL MOUTH STRAUMAN BLX IMPLANT', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_357', 'FULL MOUTH ZIRCONIA CROWN', 'IMPLANT CROWN', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_358', 'TRP INJECTION GIVEN', 'INJ', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_359', 'CYST REMOVAL UNDER GA', 'OTHERS', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_36', 'DIASTEMA CLOSURE', 'RESTORATIVE', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_360', 'ROOM RENT', 'others', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_361', 'GINGIVECTOMY DONE', 'others', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_362', 'GIC TOOTH FILLER', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_368', 'LASER SRP', 'PERIODONTICS', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_37', 'RCT', 'ENDODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_370', 'SUTURE REMOVAL', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_371', 'TRP INJECTION', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_376', 'MARYLAND BRIDGE', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_377', 'EXTRACTION-1000', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_378', 'DR.KISHOR KUMAR  CONSULTING FEE', 'CONSULTING', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_381', 'STRAUMANN BLT', 'implant', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_384', 'TEMPORARY FILLING IN', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_386', 'corno plasty', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_388', 'ALIGNER FIRST 7YEARS', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_389', 'EXTRACTION MOBILITY TOOTH', 'EXTRACTION', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_39', 'Re-RCT', 'ENDODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_395', 'D.SOLUTION IMPLANT FULL MOUTH', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_396', 'D.SOLUTION SINGLE IMPLANT', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_398', 'ADIN IMPLANT', 'IMPLANT', 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_399', 'consultant', 'PROSTHODONTICS', 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_4', 'RVG (IF 1 FINDING)', 'GENERAL', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_40', 'MICROSCOPE ASSISTED RCT', 'ENDODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_400', 'PLATE REMOVAL', 'surgery', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_401', 'PULPECTOMY UNDER GA', 'PEDEATRIC', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_402', 'ZIRCONIA CROWN PEDO', 'PEDEATRIC', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_403', 'SSC PLACED ( STAINLESS STEEL)', 'PEDEATRIC', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_404', 'GIC FILLING UNDER GA', 'PEDEATRIC', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_405', 'ROOM RENT ( VIP)', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_408', 'pulpectomy with gic', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_409', 'ALIGNER 10YEAR PLAN', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_41', 'MICROSCOPE - Re-RCT', 'ENDODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_410', '5D SCAN FOR ALIGNER ORTHO TREATMENT', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_411', 'REBONDING', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_412', 'CHARGES', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_413', 'BRACKETS', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_414', 'LOWER FDP FIXATION', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_419', 'NM', 'PASTE', 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_42', 'MTA FILLING', 'ENDODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_420', 'APEXICETOMY DONE', 'surgery', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_421', 'ALIGNERS', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_422', 'LOWER REMOVABLE PARTIAL DENTURE', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_423', 'FULL MOUTH STRAUMANN IMPLANT ( Zygomatic Implant) under GA', 'IMPLANT', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_424', '3M GEMINI', 'BRACES', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_425', 'BLX IMPLANT', 'implant', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_426', '2 PERCENT CREDIT', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_427', 'CONSULTING FEES', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_429', 'ALIGNER 5 YEARS COMPREHENCE PACKAGE', 'others', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_43', 'POST AND CORE  (FIBRE)', 'ENDODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_430', 'ALIGNER 3 YEARS COMPREHENCE PACKAGE', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_431', 'DMLS CROWN', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_432', 'Aligner 3 years', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_434', 'EMI OPTION 6 MONTHS FOR BRACES', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_435', 'Aligner 2 years', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_436', 'Aligner processing', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_437', 'Debonding', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_439', 'GA CHARGES', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_44', 'ENTRANCE FILLING( IF STRUCTURE IS COMPROMISED)', 'ENDODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_440', 'PULPECTOMY WITH METAL CROWN', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_441', 'GIC AND COMPPOSITIE', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_442', 'SCALING AND FLURIDE', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_445', 'OLD BRIDGE REMOVED', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_446', 'ALIGNER 3 YEAR PLAN', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_447', 'DMLS WORK', 'CROWN', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_448', 'PREMIUM ZIRCONIA', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_45', 'NON-VITAL BLEACHING', 'ENDODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_450', 'INVESTIGATION', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_453', '3M GEMINI bracket', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_454', 'evaluation of apicoectomy', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_457', 'Biopsy lab', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_458', 'Enucleation with Apicoectomy', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_459', 'GIC FILLING -IPC', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_46', 'GOLD CROWN', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_460', 'COMPOSITE', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_461', 'Zoom Teeth Whitening', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_465', 'Zirconia Crown 1', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_466', 'ZIRCONIA BRUX CARE CROWN', 'CROWN', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_467', 'ALIGNER 5 YEAR', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_468', 'LOWER SPLINT', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_47', 'GOLD INLAY', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_470', 'NEODENT IMPLANT( IMPLANT)', 'IMPLANT', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_471', 'PTERYGOID IMPLANT', 'implant', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_474', 'shy nm paste', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_475', 'ECHAINS', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_476', 'ALIGNER CONSULTANT FEE', 'ORTHO', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_477', 'ALIGNER 5D SCANNING', 'ORTHO', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_478', 'DEEP CLEANING', 'SCALING', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_479', 'IMPRESSING CHARGE', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_48', 'GOLD ONLAY', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_480', 'X RAY', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_481', '3YRS RX PLAN VIDEO', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_482', '3YRS ATTACHMENT CHARGE', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_483', 'OPERATING CHARGES', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_484', 'STRIPPING CHARGES', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_485', 'STAFF FEE', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_486', 'DOCTOR CHARGES', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_487', 'ALIGNERS FOR 3YRS', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_488', 'EXTRUSION CHARGES', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_489', 'X RAY FOR 5YRS PLAN', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_49', 'GOLD 1 GM', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_490', '5YRS RX PLAN VIDEO', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_491', 'ATTACHMENT CHARGES FOR 5YRS', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_492', 'OPERATING CHARGE FOR 5YRS PLAN', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_493', 'STRIPPING CHARGE FOR 5YRS', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_494', 'EXTRUSION CHARGE FOR  5YRS', 'ORTHO', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_495', 'ALIGNERS CHARGES FOR 5YR PLAN', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_496', 'LITE PACKAGE RX PLAN VIDEO', 'ORTHO', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_497', 'ATTACHMENT CHARGE FOR LITE PACKAGE', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_498', 'ALIGNERS FOR LITE PACKAGE', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_499', 'MODERATE PACKAGE RX PLAN VIDEO', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_5', '5 D SCANNING - full mouth', 'GENERAL', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_50', 'DIRECT FILLING GOLD', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_500', 'ATTACHMENT CHARGE FOR MODERATE PACKAGE', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_501', 'ALIGNERS CHARGE FOR MODERATE PACKAGE', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_502', 'ALIGNER PEDO CONSULTANT CHARGE', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_503', 'ATTACHMENT CHARGE FOR ALIGNER 1ST', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_504', 'ALIGNERS CHARGE FOR 1ST', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_505', 'ALIGNER 1ST RX PLAN VIDEO', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_506', 'IMPRESSION CHARGE FOR 5YRS', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_507', 'CROWN CHARGE FOR 10YRS', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_508', 'DOCTOR FEE FOR DMLS', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_509', 'NURSING FEES', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_51', 'PFM', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_510', 'CROWN CUTTING FOR DMLS', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_511', 'CROWN FIXING FOR DMLS', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_512', 'CROWN CHARGE', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_513', 'CROWN CUTTING CHARGES', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_514', 'DOCTOR FEES', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_515', 'NURSING FEE', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_516', 'MARYLAND BRIDGE RECEMNETATION', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_517', 'ROOT CANAL CONSULTANT FEE', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_519', 'BMP & OBTURATION', 'ENDODONTICS', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_52', 'DMLS CROWN', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_520', 'RE-RCT CONSULTANT FEE', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_521', 'GP RETRIEVE FEE', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_523', 'NURSING CHARGES', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_524', 'RETAINER DOCTOR FEE', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_525', 'RETAINER COST', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_526', 'IMPRESSION CHARGES', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_527', 'POLISHING & TRIMMING CHARGES', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_528', 'DOCTOR FEE FOR RETAINER', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_53', 'ZIRCONIA SOLID PLUS BRUX CARE (15 YRS WARRANTY)', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_530', 'RETAINER CHARGES', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_531', 'IMPRESSION CHARGES FOR RETAINER', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_532', 'POLISHINING AND TRIMMING FOR RETAINER', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_533', 'DOCTOR FEE FOR UPPER 8 EXTRACTION', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_534', 'EXTRACTION FOR UPPER 8 TEETH', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_535', 'BETADINE WASH FOR EXTRACTION', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_536', 'SURGEON FEE', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_537', 'SUTURE FEE', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_538', 'BETADINE WASH', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_539', 'X RAY FOR EXTRACTION', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_54', 'ZIRCONIA ULTRA PLUS (15 YRS WARRANTY)', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_540', 'CROWN CUTTING', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_541', 'CROWN FIXING', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_542', 'SCANNING', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_543', 'DOCTOR FEE', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_545', 'CROWN CHARGES', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_549', 'DOCTOR CONSULTANT CHARGES', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_55', 'ZIRCONIA CLASSIC (15 YRS WARRANTY)', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_551', 'SOFT SPLINT CHARGES', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_552', 'SCANNING FOR SOFT SPLINT', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_553', 'POLISHING AND TRIMMIMG', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_555', 'BLT IMPLANT SCREW', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_556', 'CONSULTANT CHARGES', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_557', 'NURSING FEE', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_558', 'FLAP OPENING', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_559', 'BONE GUTTERING', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_56', 'ZIRCONIA PREMIUM (25 YRS WARRANTY)', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_561', 'BETADINE WITH SALINE WASH', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_562', 'IMPLANT FIXING', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_563', 'IMPLANT FIXING CHARGES', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_564', 'SUTURE', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_565', 'X RAY', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_566', 'CONSULTANT FEES', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_567', 'bone grafting', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_568', 'OUTIE AND CHERRIE', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_569', 'SUBGINGIVAL SCALING', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_57', 'ZIRCONIA PLATINUM PLUS (LIFETIME WARRANTY)', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_570', 'CANAL IRRIGATION', 'RCT', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_571', 'BMP AND OBT', 'RCT', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_572', 'X RAY FOR RCT', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_573', 'RETAINER', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_575', 'DOCTOR FEES FOR UPPER 8 EXTRACTION', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_576', 'EXTRACTION FOR UPPER 8', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_577', 'SUTURING', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_58', 'EMAX VENEERS(WITHOUT CAD CAM )', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_581', 'NURSING CHARGE', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_585', 'ACCESS OPENING IN RCT', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_586', 'BMP AND OBTURATION', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_587', 'MEDICATION PLACEMENT', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_588', 'RE RCT CONSULTING FEE', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_589', 'GP RETRIVEL', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_59', 'EMAX VENEERS(USING CAD CAM )', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_590', 'MICROSCOPIC   RE RCT CONSULTING FEES', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_591', 'MICROSCOPIC RCT CONSULTANT FEE', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_592', 'RCT CONSULTANT FEE', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_593', 'opg', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_594', 'crown charge for DMLS', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_595', 'DOCTOR FEES FOR CROWN', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_6', 'SCALING PER SITTING (can perform upto  3 to 5 sittings)', 'PERIODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_60', 'CROWN REMOVAL PER TOOTH', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_600', 'DAMON METAL BRACES', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_602', 'courier charge extra aligners', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_603', 'LA', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_604', 'FLAP REFLECT PFM', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_605', 'X RAY', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_606', 'DRILLING', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_607', 'BONE EXPANSION FOR ADIN', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_608', 'IMPLANT SCREW FOR ADIN', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_609', 'COVER SCREW FOR ADIN', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_61', 'SINUS LIFT', 'IMPLANTOLOGY', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_610', 'SALINE IRRIGATION', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_611', 'BETADINE IRRIGATION', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_612', 'SUTURING', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_613', 'DOCTOR CHARGE FOR ADIN', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_614', 'CONSULTATION CHARGE', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_615', 'STAFF CHARGE', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_616', 'BETADINE WASH FOR ADIN PFM', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_617', 'SUTURE REMOVAL', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_618', 'FLAP REFLECT', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_619', 'HEALING ABUTMENT', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_62', 'BASIC DENTURES WITH ACRYLIC TEETH', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_620', 'ALGINATE IMPRESSION', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_621', 'PUTTY IMPRESSION', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_622', 'LIGHT BODY IMPRESSION', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_623', 'BITE REGISTERATION FOR ADIN PFM', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_624', 'WAX BITE', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_625', 'ZIG TRAIL', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_626', 'METAL TRAIL', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_627', 'TECHNICIAN  CHARGES', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_628', 'CROWN FIXING FOR ADIN PFM', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_629', 'DOCTOR FEES ZIRCONIA CROWN', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_63', 'BASIC DENTURES WITH IVOCLAR TEETH', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_630', 'ABDUMENT PLACEMENT', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_631', 'IMPLANT ZIG TRIAL', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_632', 'CROWN CUTTING FOR ZIRCONIA', 'CROWN', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_633', 'CROWN FIXING FOR ZIRCONIA', 'CROWN', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_634', 'CROWN CHARGES FOR ZIRCONIA', 'CROWN', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_64', 'BPS DENTURES WITH ACRYLIC TEETH)', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_642', 'tab(medicine)', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_643', 'feshclor', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_644', 'freshclor', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_645', 'LAB BILL FOR PFM', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_646', 'STAFF FEE FOR PFM', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_647', 'IMPRESSION FOR PFM', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_649', 'ENTRANCE FILLINGS', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_65', 'BPS DENTURES WITH IVOCLAR TEETH', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_650', 'CEMENTATION CHARGE', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_651', 'POST CEMENTATION X-RAY CHARGE', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_652', 'LAB BILL', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_654', 'STAFF FEES', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_655', 'IMPRESSION', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_656', 'omnident', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_66', 'TEMPORARY DENTURES (UPPER AND LOWER)', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_660', 'RCT (STANDARD)', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_661', 'PRE OP XRAY', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_662', 'POST OP XRAY', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_663', 'ACCESS OPENING -RCT', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_664', 'BMP,CANAL IRRIGATION,OBTURATION-(RCT)', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_665', 'DOCTOR FEES (RCT)', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_666', 'ACCESS OPENING (MRCT)', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_667', 'BMP,CANAL IRRIGATION,OBTURATION (MRCT)', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_668', 'DOCTOR FEES (MRCT)', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_669', 'DOCTOR FEES (RE- RCT)', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_67', 'PARTIAL DENTURE FRAMEWORK', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_670', 'BMP,CANAL IRRIGATION,OBTURATION (RE-RCT)', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_671', 'GP RETRIVAL (RE-RCT)', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_672', 'DOCTOR FEES (MICRO RE-RCT)', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_673', 'GP RETRIVAL (MICRO RE-RCT)', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_674', 'BMP,CANAL IRRIGATION,OBTURATION (MICRO RE-RCT)', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_675', 'SALINE BETADINE IRRIGATION', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_678', 'tonguecrib', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_68', 'PARTIAL DENTURE PER TOOTH', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_680', 'DMLS CROWN(PFM)', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_681', 'IMPLANT SCREW ADIN', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_682', 'DOCTOR FEE ADIN', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_683', 'CONSULTANT FEE', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_684', 'DRILLING 1', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_685', 'IMPLANT FIXING ADIN', 'IMPL', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_686', 'FLAP OPENING', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_689', 'pulpectomy-1', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_69', 'BASIC DENTURES WITH ACRYLIC TEETH SINGLE ARCH', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_690', 'IPT', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_691', 'FRENECTOMY', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_693', 'Aligner  comprehensive first (7years)', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_694', 'Aligner comprehensive 10years', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_696', 'CROWN CUTTING FOR PREMIUM', 'CROWN', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_697', 'CROWN FIXING FOR ZIRCONIA PREMIUM', 'CROWN', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_698', 'SCANNING FOR ZIRCONIA PREMIUM', 'CROWN', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_699', 'WAX BITE', 'CROWN', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_7', 'FLAP SURGERY (FULL MOUTH)', 'PERIODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_70', 'BASIC DENTURES WITH IVOCLAR TEETH SINGLE ARCH', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_700', 'PUTTY BITE', 'CROWN', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_701', 'ZIRCONIA PREMIUM PLUS', 'CROWN', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_702', 'IMPLANT SCREW D.TECH', 'IMPLANT CROWN', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_703', 'DOC FEE 2000', 'IMPLANT CROWN', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_704', 'CONSULTANT FEE', 'IMPLANT CROWN', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_707', 'NURSING FEES', 'IMPLANT CROWN', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_708', 'FLAP OPENING', 'IMPLANT CROWN', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_709', 'BONE GUTTERING D.TECH', 'IMPLANT CROWN', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_71', 'BPS DENTURES WITH ACRYLIC TEETH) SINGLE ARCH', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_710', 'IMPLANT FIXING D.TECH', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_711', 'BONDING', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_713', 'braces monthly checkup', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_714', 'vivera retainer', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_715', 'post and core', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_716', 'DOCTOR FEE FOR BPS', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_717', 'NURSE FEE FOR BPS', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_718', 'LAB FEE FOR BPS', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_719', 'PRIMARY IMPRESSION', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_72', 'BPS DENTURES WITH IVOCLAR TEETH - SINGLE ARCH', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_720', 'SECONDARY IMPRESSION', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_721', 'JAW RELATION', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_722', 'DENTURE INSERTION', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_723', 'TRIAL', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_724', 'DOCTOR FEES FOR BRACKETS-DAMON METAL', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_725', 'X-RAY PRE OP-DAMON', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_726', 'TREATMET X-RAY - DAMON', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_727', 'POST OP- DAMON', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_728', 'MATERIAL CHARGES', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_729', 'NURSE FEE- DAMON', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_73', 'TEMPORARY DENTURES (SINGLE ARCH)', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_730', 'DEBONDING CHARGES - DAMON', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_731', 'SPECIALIST FEE', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_732', 'PRE XRAY', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_733', 'SALINE', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_734', 'POST XRAY', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_735', 'SURGICAL DRESSING', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_736', 'FOLLOW UP SURGICAL DRESSING CHARGES', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_737', 'ALVEOLOPLASTY XHARGES', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_738', 'SURGICAL EXTRACTION POSTERIOR RCT TREATED', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_739', '3M VICTORY', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_74', 'FLEXI PARTIAL DENTURE  FRAMEWORK', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_743', '3M GEMINI BRACES', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_744', 'AMERICAN ORTHO BRACES', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_747', '3M METAL BRACKET', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_748', 'DAMON CERAMIC', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_75', 'FLEXI PARTIAL DENTURE  PER TOOTH', 'PROSTHODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_750', 'tooth paste', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_751', 'pediflor', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_753', 'RETAINER UPPER AND LOWER', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_754', 'ZIRCONIA CROWN FOR IMPLANT', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_755', 'ALIGNER COMPREHENSIVE (5YEARS)', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_756', 'ADVANCE FOR GA CASE', 'OTHERS', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_757', 'VIVERA RETAINERS', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_758', 'TEMPORARY DENTURE NORMAL', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_76', 'BLEACHING (3 CYCLES)', 'RESTORATIVE', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_760', 'LA FOR IMPLANT', 'OTHERS', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_761', 'FLAP REFLECT', 'IMPLANT', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_762', 'X RAY ADIN', 'implant', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_764', 'DRILLING IMPLANT', 'IMPLANT', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_765', 'BONE EXPANSION ADIN', 'implant', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_767', 'IMPLANT SCREW ADIN(ADIN)', 'IMPLANT', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_768', 'COVER SCREW ADIN', 'implant', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_769', 'SUTURING', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_77', 'BLEACHING (2 CYCLES)', 'RESTORATIVE', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_770', 'CONSULTANT CHARGE IMPLANT', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_771', 'SUTURE REMOVAL', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_774', 'FLAP OPENING IMPLANT', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_775', 'HEALING ABUTMENT IMPLANT', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_776', 'PUTTY IMP', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_777', 'LIGHT BODY IMP', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_778', 'WAX BITE IMP', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_779', 'DENTURE  CROWN FIXING', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_78', 'BLEACHING (1 CYCLE)', 'RESTORATIVE', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_780', 'IMPLANT SCREW D SOL DENTURE', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_781', 'COVER SCREW D SOL DENTURE', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_782', 'HEALING ABUTMENT D SOL DENTURE', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_783', 'CROWN FIXING D SOL DENTURE', 'IMPLANT', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_784', 'FLAP REFLACT', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_785', 'DRILLING', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_786', 'BONE EXPANSION', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_787', 'IMPLANT SCREW D SOL PFM', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_788', 'COVER SCREW D SOL PFM', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_79', 'ALL ON 4 SINGLE ARCH', 'IMPLANTOLOGY', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_790', 'CONSULTANTS', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_791', 'STAFFS FEE', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_792', 'HEALING ABUTMENT D SOL PFM', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_793', 'CROWN FIXING D SOL PFM', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_794', 'IMPLANT SCREW NEODENT DENTURE', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_795', 'COVER SCREW NEODENT DENTURE', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_797', 'STAFFS', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_798', 'HEALING ABUTMENT NEODENT DENTURE', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_799', 'CROWN FIXING NEODENT DENTURE', 'IMPLANTOLOGY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_8', 'FLAP SURGERY (QUAD)', 'PERIODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_80', 'D SOLUTION IMPLANT WITH DENTURE', 'IMPLANTOLOGY', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_800', 'impalnt retrived', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_801', 'implant retrived', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_802', 'ZIRCONIA CLASSIC (NO WARRANTY)', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_803', 'TONGUE CRIB', 'ORTHO', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_804', 'IMPLANT PROSTHESIS', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_805', 'PTERYGOID IMPLANT (struamann)', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_806', 'OAC CLOSURE SURGERY UNDER GENERAL ANAESTHETIC', 'ORAL SURGERY', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_808', 'ADVANCE FOR TREATMENT', 'advance', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_809', 'FORSUS APPLIANCE', 'ORTHO', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_81', 'D SOLUTION FULL MOUTH IMPLANTS WITH METAL CERAMIC CROWN', 'IMPLANTOLOGY', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_812', 'Aligner comprehensive 3year', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_813', 'Align 5 years comprehensive', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_814', 'surgical impaction lower', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_815', 'surgical impaction upper', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_816', 'implant crown (screw)', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_817', 'dmls impant crown(screw)', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_819', 'dycal', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_82', 'D SOLUTION FULL MOUTH IMPLANTS WITH ZIRCONIA CROWN', 'IMPLANTOLOGY', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_820', 'COMPLETE DENTURE BASIC', 'DENTURE', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_822', 'RE RCT(PER TOOTH)', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_824', 'scaling upper&lower', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_825', 'surgical extraction upper (pos)', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_826', '3 MONTHS EMI FOR BRACES', 'BRACES', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_827', 'EMI FOR BRACES', 'BRACES', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_828', 'BRACES NORMAL', 'BRACES', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_829', 'ACRYLIC TEETH PER TOOTH', 'OTHERS', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_83', 'BIOHORIZON  NEODENT FULL MOUTH IMPLANTS (METAL CERAMIC CROWN)', 'IMPLANTOLOGY', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_830', 'VIVERA RETAINER PER SET', 'BRACES', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_831', 'ACRYLIC IMPACT DENTURE', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_832', 'CROWN FIXATION', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_833', 'soft liner', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_834', 'DIGITAL SCANNING', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_835', 'DENTURE FLEX 17 TOOTH', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_836', 'SOFT SPLINTS', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_837', 'appexcification', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_838', 'INTERLIG SPLINT', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_84', 'BIOHORIZON  NEODENT FULL MOUTH IMPLANTS (ZIRCONIA CROWN)', 'IMPLANTOLOGY', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_840', 'CROWN REMOVAL-1', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_841', 'RESTORATION-1', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_842', 'BRACES (ORTHO)', 'BRACES', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_843', 'PFM PER CROWN', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_845', 'CROWN LENGTHENING 23', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_846', 'LOWER NIGHT GUARD', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_848', 'LASER SRP(single)', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_849', 'CHEWY', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_85', 'STRAUMANN FULL MOUTH IMPLANTS (METAL CERAMIC CROWN)', 'IMPLANTOLOGY', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_850', 'composite (Deep cavity) filling', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_852', 'ANTERIOR BITE PLANE ORTHO', 'ORTHO', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_853', 'RVG ( IOPA)', 'RVG', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_855', 'scaling(full mouth)', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_856', 'PALATAL EXPANDER', 'ORTHO', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_857', 'ADDITIONAL ALIGNERS', 'ORTHO', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_858', 'OPERCULECTOMY DONE', 'GENERAL', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_859', 'refinement scaning', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_86', 'STRAUMANN FULL MOUTH IMPLANTS (ZIRCONIA CROWN)', 'IMPLANTOLOGY', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_860', 'MTA PULPOTOMY', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_862', 'FRENECTOMY DONE (LASER)', 'OTHERS', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_863', 'FLAT PLANE APPLIANCE', 'ORTHO', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_864', 'EMAX VENEERS', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_866', 'braces monthly review', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_867', 'PULPECTOMY PER TOOTH', 'PERIODONTICS', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_868', 'BIOFLEX CROWN PER TOOTH', 'PERIODONTICS', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_869', 'ZIRCONIA CROWN BASIC', 'CROWN', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_87', 'ADIN FULL MOUTH  IMPLANT WITH DENTURE', 'IMPLANTOLOGY', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_870', 'pulpectomy and ssc crown', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_871', 'INCISAL REDUCTION', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_873', 'CONSULTANT FEE FOR ORTHO', 'ORTHO', 'active', 'false', 'Dr. Kishore'),
  ('TMT_874', '5D SCANNING FOR ORTHO TREATMENT', 'ORTHO', 'active', 'false', 'Dr. Kishore'),
  ('TMT_875', 'flexi rpd', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_876', 'zirconia(impalnt crown screw)', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_878', 'ADIN IMPLANT(SINGLE)', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_879', 'D TECH IMPLANT', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_88', 'ADIN FULL MOUTH IMPLANT WITH METAL CERAMIC CROWN', 'IMPLANTOLOGY', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_880', 'invisalign  5 years comprehensive', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_885', 'RCT single sitting', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_888', 'SPACE MAINTAINER PEDO', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_89', 'ADIN (SINGLE IMPLANT)', 'IMPLANTOLOGY', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_890', 'NEODENT  SINGLE IMPLANT', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_891', 'IMPLANT -THERAPY 5', 'OTHERS', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_892', 'IMPLANT -THERAPY 3', 'OTHERS', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_895', 'ANTI SNORING DEVICE 1', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_896', 'PIT & FISSURE SEALANT', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_897', 'BLX implant (single)', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_898', 'THERAPHY- 7', 'OTHERS', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_899', 'COMPOSITE FILLING CLASS II', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_9', 'SPLINTING (FIBER and COMPOSITE) per tooth', 'PERIODONTICS', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_90', 'D SOLUTION (SINGLE IMPLANT)', 'IMPLANTOLOGY', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_900', 'OT CHARGES', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_901', 'IMPLANT THERAPHY 03', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_902', 'IMPLANT THERAPHY 05', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_903', 'pulpectomy with zirconia crown', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_904', '-', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_905', 'GEN ANAESTHESIA, ANAESTHETOLOGIST CHARGES, OOT CHARGES', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_906', 'bone grafting for implant', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_907', 'ATTACHMENT REMOVED', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_908', 'CANINE EXPOSED BLADE', 'GENERAL', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_909', 'EXPOSURE', 'GENERAL', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_91', 'BIOHORIZONNEODENT(SINGLE IMPLANT)', 'IMPLANTOLOGY', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_910', 'treatment plan change', null, 'active', 'false', 'HEAD COIMBATORE'),
  ('TMT_911', 'ROOT SURFACE DEBRIDEMENT', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_912', 'CONSULTATION DONE', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_914', 'TWIN BLOCK APPLIANCE', 'ORTHO', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_915', 'OT CHARGES WITH MEDICINE', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_916', 'SCALING & ROOT PLANING', null, 'active', 'false', 'HEAD CHENNAI'),
  ('TMT_917', 'MINOR SURGERY', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_918', 'FIXED RETAINER REMOVAL', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_919', 'Pus drainage', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_92', 'STRAUMANN (SINGLE IMPLANT)', 'IMPLANTOLOGY', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_920', 'TREATMENT DONE UNDER CONSIOUS SEDATION', 'surgery', 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_921', 'Temporary crown', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_922', 'RCT( LASER)', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_923', 'RE RCT ( LASER)', null, 'active', 'false', 'HEAD TIRUPUR'),
  ('TMT_93', 'CONSCIOUS SEDATION 1ST HOUR', 'ANESTHESIA', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_94', 'CONSCIOUS SEDATION ADDITIONAL HOUR', 'ANESTHESIA', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_95', 'FILLING  CLASS 1', 'PEDEATRIC', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_96', 'FILLING  CLASS 2', 'PEDEATRIC', 'active', null, 'Kishor''s Dentistry'),
  ('TMT_99', 'DECIDUOUS TOOTH RCT', 'PEDEATRIC', 'active', null, 'Kishor''s Dentistry');

do $seed_check$
begin
  if (select count(*) from crm.treatment_codes) <> 584 then
    raise exception 'expected 584 authoritative treatment codes';
  end if;
end
$seed_check$;

create function crm.reject_treatment_code_mutation() returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'crm.treatment_codes is an immutable treatment master'
    using errcode = '55000';
end
$function$;

create trigger protect_treatment_codes_update_delete
  before update or delete on crm.treatment_codes
  for each row execute function crm.reject_treatment_code_mutation();
create trigger protect_treatment_codes_truncate
  before truncate on crm.treatment_codes
  for each statement execute function crm.reject_treatment_code_mutation();

create table crm.case_sheets (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references crm.leads(id) on delete restrict,
  branch_id uuid not null references crm.branches(id),
  appointment_id uuid not null unique references crm.appointments(id) on delete restrict,
  doctor_id uuid not null references crm.doctors(id),
  visit_at timestamptz not null,
  chief_complaint text,
  findings text,
  diagnosis text,
  plan text,
  medical_alerts text,
  finalized_at timestamptz not null,
  signed_by uuid not null references crm.profiles(id),
  created_by uuid not null references crm.profiles(id),
  created_at timestamptz not null default now(),
  constraint case_sheets_finalized_time_check check (finalized_at >= created_at),
  constraint case_sheets_text_length_check check (
    coalesce(length(chief_complaint), 0) <= 4000 and
    coalesce(length(findings), 0) <= 12000 and
    coalesce(length(diagnosis), 0) <= 4000 and
    coalesce(length(plan), 0) <= 8000 and
    coalesce(length(medical_alerts), 0) <= 4000
  )
);

create index case_sheets_lead_visit_idx on crm.case_sheets (lead_id, visit_at desc);
create index case_sheets_branch_visit_idx on crm.case_sheets (branch_id, visit_at desc);
create index case_sheets_doctor_visit_idx on crm.case_sheets (doctor_id, visit_at desc);

alter table crm.treatments
  add column case_sheet_id uuid references crm.case_sheets(id) on delete restrict,
  add column treatment_code text references crm.treatment_codes(code) on delete restrict,
  add column treatment_name text,
  add column treatment_category text,
  add column clinical_status text,
  add column site_scope text,
  add column site_detail text,
  add column tooth_number text,
  add column surfaces text[],
  add column diagnosis text,
  add column quantity numeric(8,2),
  add column performed_at timestamptz,
  add column signed_at timestamptz,
  add column signed_by uuid references crm.profiles(id);

alter table crm.treatments
  add constraint treatments_coded_shape_check check (
    case_sheet_id is null or (
      treatment_code is not null and
      treatment_name is not null and
      length(btrim(treatment_name)) between 1 and 300 and
      clinical_status is not null and
      clinical_status in ('planned', 'completed') and
      site_scope in ('not_applicable', 'full_mouth', 'arch', 'quadrant', 'tooth') and
      quantity is not null and
      quantity > 0 and
      signed_at is not null and
      signed_by is not null and
      (clinical_status = 'planned' or performed_at is not null)
    )
  ) not valid,
  add constraint treatments_site_check check (
    case_sheet_id is null or
    case site_scope
      when 'tooth' then
        tooth_number ~ '^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$'
        and site_detail is null
      when 'arch' then tooth_number is null and cardinality(surfaces) = 0 and site_detail in ('upper', 'lower')
      when 'quadrant' then tooth_number is null and cardinality(surfaces) = 0 and site_detail in ('upper_right', 'upper_left', 'lower_right', 'lower_left')
      when 'full_mouth' then tooth_number is null and cardinality(surfaces) = 0 and site_detail is null
      when 'not_applicable' then tooth_number is null and cardinality(surfaces) = 0 and site_detail is null
      else false
    end
  ) not valid,
  add constraint treatments_surfaces_check check (
    case_sheet_id is null or (
      surfaces is not null and surfaces <@ array[
        'mesial','distal','occlusal','incisal','buccal','lingual','palatal','facial'
      ]::text[]
    )
  ) not valid,
  add constraint treatments_clinical_text_check check (
    coalesce(length(diagnosis), 0) <= 4000 and coalesce(length(notes), 0) <= 8000
  ) not valid;

create index treatments_case_sheet_idx on crm.treatments (case_sheet_id, created_at);
create index treatments_lead_code_time_idx on crm.treatments (lead_id, treatment_code, treated_at desc)
  where treatment_code is not null;
create index treatments_invoice_eligible_idx on crm.treatments (lead_id, performed_at desc, id)
  where clinical_status = 'completed' and treatment_code is not null;

create function crm.enforce_coded_treatment() returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_sheet crm.case_sheets%rowtype;
  v_code crm.treatment_codes%rowtype;
begin
  if current_user = 'postgres'
     and current_setting('crm.allow_legacy_test_records', true) = 'on' then
    return new;
  end if;
  if new.case_sheet_id is null
     and not crm.coded_dental_enforcement_enabled() then
    return new;
  end if;
  if new.case_sheet_id is null or new.treatment_code is null then
    raise exception 'new treatments require a finalized coded case sheet'
      using errcode = '23514';
  end if;

  if current_setting('crm.finalizing_case_sheet', true) is distinct from new.case_sheet_id::text then
    raise exception 'treatments may only be added while finalizing their case sheet'
      using errcode = '55000';
  end if;

  select * into v_sheet from crm.case_sheets where id = new.case_sheet_id;
  if not found or v_sheet.finalized_at is null then
    raise exception 'case sheet % is missing or not finalized', new.case_sheet_id
      using errcode = '23514';
  end if;
  if v_sheet.lead_id is distinct from new.lead_id
     or v_sheet.branch_id is distinct from new.branch_id
     or v_sheet.appointment_id is distinct from new.appointment_id
     or v_sheet.doctor_id is distinct from new.doctor_id then
    raise exception 'treatment identity must match its case sheet'
      using errcode = '23514';
  end if;

  select * into v_code from crm.treatment_codes where code = new.treatment_code;
  if not found or lower(v_code.status) <> 'active' then
    raise exception 'treatment code % is missing or inactive', new.treatment_code
      using errcode = '23514';
  end if;

  new.treatment_name := v_code.name;
  new.treatment_category := v_code.category;
  new.signed_at := v_sheet.finalized_at;
  new.signed_by := v_sheet.signed_by;
  new.surfaces := coalesce(new.surfaces, array[]::text[]);
  new.site_detail := nullif(btrim(new.site_detail), '');
  new.tooth_number := nullif(btrim(new.tooth_number), '');
  new.diagnosis := nullif(btrim(new.diagnosis), '');
  new.notes := nullif(btrim(new.notes), '');
  return new;
end;
$function$;

create trigger enforce_coded_treatment
  before insert on crm.treatments
  for each row execute function crm.enforce_coded_treatment();

create function crm.enforce_case_sheet_creation() returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if current_setting('crm.finalizing_case_sheet', true) is distinct from new.id::text then
    raise exception 'case sheets may only be created by the finalization workflow'
      using errcode = '55000';
  end if;
  return new;
end
$function$;

create trigger enforce_case_sheet_creation
  before insert on crm.case_sheets
  for each row execute function crm.enforce_case_sheet_creation();

create function crm.protect_finalized_clinical_record() returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'finalized clinical records are immutable'
    using errcode = '55000';
end
$function$;

create trigger protect_case_sheet_update_delete
  before update or delete on crm.case_sheets
  for each row execute function crm.protect_finalized_clinical_record();
create trigger protect_case_sheet_truncate
  before truncate on crm.case_sheets
  for each statement execute function crm.protect_finalized_clinical_record();
create trigger protect_coded_treatment_update
  before update on crm.treatments
  for each row when (old.case_sheet_id is not null or new.case_sheet_id is not null)
  execute function crm.protect_finalized_clinical_record();

alter table crm.audit_log drop constraint audit_log_entity_type_check;
alter table crm.audit_log add constraint audit_log_entity_type_check
  check (entity_type in ('lead','appointment','treatment','follow_up','invoice','comment','profile','case_sheet'));

create function crm.finalize_case_sheet(
  p_lead_id uuid,
  p_appointment_id uuid,
  p_doctor_id uuid,
  p_visit_at timestamptz,
  p_chief_complaint text,
  p_findings text,
  p_diagnosis text,
  p_plan text,
  p_medical_alerts text,
  p_treatments jsonb,
  p_actor uuid
) returns crm.case_sheets
language plpgsql
set search_path = ''
as $function$
declare
  v_actor crm.profiles%rowtype;
  v_lead crm.leads%rowtype;
  v_appointment crm.appointments%rowtype;
  v_doctor crm.doctors%rowtype;
  v_sheet crm.case_sheets%rowtype;
  v_item jsonb;
  v_treatment crm.treatments%rowtype;
  v_code text;
  v_status text;
  v_scope text;
  v_detail text;
  v_tooth text;
  v_surfaces text[];
  v_quantity numeric;
  v_cost numeric;
  v_performed_at timestamptz;
begin
  if p_actor is null or p_lead_id is null or p_appointment_id is null
     or p_doctor_id is null or p_visit_at is null then
    raise exception 'lead, appointment, doctor, visit time, and actor are required'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_treatments) is distinct from 'array'
     or jsonb_array_length(p_treatments) not between 1 and 50 then
    raise exception 'case sheet requires between 1 and 50 treatment lines'
      using errcode = '22023';
  end if;

  select * into v_actor from crm.profiles where id = p_actor;
  if not found or not v_actor.is_active
     or v_actor.role::text not in ('admin','clinical_head','doctor') then
    raise exception 'actor is not authorized to finalize case sheets'
      using errcode = '42501';
  end if;
  select * into v_lead from crm.leads where id = p_lead_id for update;
  if not found or v_lead.deleted_at is not null then
    raise exception 'active lead % not found', p_lead_id using errcode = 'P0002';
  end if;
  if v_lead.status <> 'appointment_booked' then
    raise exception 'lead must have a booked appointment before case-sheet finalization'
      using errcode = '55000';
  end if;
  if v_actor.role::text <> 'admin' and not exists (
    select 1 from crm.user_branches ub
    where ub.user_id = p_actor and ub.branch_id = v_lead.branch_id
  ) then
    raise exception 'actor is not allocated to the patient branch'
      using errcode = '42501';
  end if;

  select * into v_doctor from crm.doctors where id = p_doctor_id;
  if not found or not v_doctor.is_active or v_doctor.branch_id is distinct from v_lead.branch_id then
    raise exception 'doctor is missing, inactive, or belongs to another branch'
      using errcode = '23514';
  end if;
  select * into v_appointment from crm.appointments
  where id = p_appointment_id and lead_id = p_lead_id for update;
  if not found or v_appointment.branch_id is distinct from v_lead.branch_id
     or v_appointment.status <> 'scheduled'
     or (v_appointment.doctor_id is not null and v_appointment.doctor_id is distinct from p_doctor_id) then
    raise exception 'case sheet requires this patient''s scheduled appointment and doctor'
      using errcode = '23514';
  end if;
  if v_appointment.doctor_id is null and v_actor.role::text = 'doctor' then
    raise exception 'a manager must assign the appointment before a doctor can finalize it'
      using errcode = '42501';
  end if;
  if v_actor.role::text = 'doctor'
     and v_doctor.profile_id is distinct from p_actor then
    raise exception 'doctor may finalize only their own appointment'
      using errcode = '42501';
  end if;

  perform set_config('crm.actor_id', p_actor::text, true);
  v_sheet.id := gen_random_uuid();
  perform set_config('crm.finalizing_case_sheet', v_sheet.id::text, true);

  insert into crm.case_sheets (
    id, lead_id, branch_id, appointment_id, doctor_id, visit_at,
    chief_complaint, findings, diagnosis, plan, medical_alerts,
    finalized_at, signed_by, created_by
  ) values (
    v_sheet.id, p_lead_id, v_lead.branch_id, p_appointment_id, p_doctor_id, p_visit_at,
    nullif(btrim(p_chief_complaint), ''), nullif(btrim(p_findings), ''),
    nullif(btrim(p_diagnosis), ''), nullif(btrim(p_plan), ''),
    nullif(btrim(p_medical_alerts), ''), now(), p_actor, p_actor
  ) returning * into v_sheet;

  update crm.appointments
  set doctor_id = p_doctor_id, status = 'completed'
  where id = p_appointment_id;

  for v_item in select value from jsonb_array_elements(p_treatments)
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or jsonb_typeof(v_item->'treatment_code') is distinct from 'string'
       or jsonb_typeof(v_item->'status') is distinct from 'string'
       or jsonb_typeof(v_item->'site_scope') is distinct from 'string'
       or jsonb_typeof(v_item->'quantity') is distinct from 'number'
       or jsonb_typeof(v_item->'unit_price') is distinct from 'number'
       or (v_item ? 'surfaces' and jsonb_typeof(v_item->'surfaces') <> 'array') then
      raise exception 'each treatment line requires code, status, scope, and numeric quantity'
        using errcode = '22023';
    end if;
    v_code := btrim(v_item->>'treatment_code');
    v_status := btrim(v_item->>'status');
    v_scope := btrim(v_item->>'site_scope');
    v_detail := nullif(btrim(v_item->>'site_detail'), '');
    v_tooth := nullif(btrim(v_item->>'tooth_number'), '');
    v_quantity := (v_item->>'quantity')::numeric;
    v_cost := (v_item->>'unit_price')::numeric;
    v_performed_at := case
      when v_status = 'completed' then coalesce(nullif(v_item->>'performed_at', '')::timestamptz, p_visit_at)
      else null
    end;

    if v_status not in ('planned','completed')
       or v_scope not in ('not_applicable','full_mouth','arch','quadrant','tooth')
       or v_quantity <= 0 or v_quantity > 999999.99 or v_quantity <> round(v_quantity, 2)
       or v_cost < 0 or v_cost > 99999999.99 or v_cost <> round(v_cost, 2) then
      raise exception 'treatment status, scope, quantity, or cost is invalid'
        using errcode = '22023';
    end if;
    if v_item ? 'surfaces' and exists (
      select 1 from jsonb_array_elements(v_item->'surfaces') s
      where jsonb_typeof(s.value) <> 'string'
         or lower(s.value #>> '{}') not in (
           'mesial','distal','occlusal','incisal','buccal','lingual','palatal','facial'
         )
    ) then
      raise exception 'tooth surfaces are invalid' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct lower(s.value #>> '{}') order by lower(s.value #>> '{}')), array[]::text[])
    into v_surfaces
    from jsonb_array_elements(coalesce(v_item->'surfaces', '[]'::jsonb)) s;

    insert into crm.treatments (
      lead_id, branch_id, appointment_id, doctor_id, case_sheet_id,
      treatment_code, clinical_status, site_scope, site_detail, tooth_number,
      surfaces, diagnosis, quantity, cost, notes, performed_at, treated_at, created_by
    ) values (
      p_lead_id, v_lead.branch_id, p_appointment_id, p_doctor_id, v_sheet.id,
      v_code, v_status, v_scope, v_detail, v_tooth, v_surfaces,
      coalesce(nullif(btrim(v_item->>'diagnosis'), ''), nullif(btrim(p_diagnosis), '')), v_quantity, v_cost,
      nullif(btrim(v_item->>'notes'), ''), v_performed_at, p_visit_at, p_actor
    ) returning * into v_treatment;

    insert into crm.audit_log(entity_type, entity_id, action, actor_id, new_data)
    values (
      'treatment', v_treatment.id, 'case_sheet_signed', p_actor,
      jsonb_build_object(
        'case_sheet_id', v_sheet.id,
        'treatment_code', v_treatment.treatment_code,
        'clinical_status', v_treatment.clinical_status,
        'site_scope', v_treatment.site_scope,
        'tooth_number', v_treatment.tooth_number,
        'signed_at', v_treatment.signed_at
      )
    );
  end loop;

  update crm.leads set status = 'visited_treated' where id = p_lead_id;
  insert into crm.lead_activity(lead_id, actor_id, type, detail)
  values (p_lead_id, p_actor, 'treatment', jsonb_build_object(
    'event','case_sheet_finalized','case_sheet_id',v_sheet.id,
    'appointment_id',p_appointment_id,'doctor_id',p_doctor_id,
    'treatment_count',jsonb_array_length(p_treatments)
  ));
  insert into crm.audit_log(entity_type, entity_id, action, actor_id, new_data)
  values (
    'case_sheet', v_sheet.id, 'finalized', p_actor,
    jsonb_build_object(
      'lead_id', v_sheet.lead_id,
      'branch_id', v_sheet.branch_id,
      'appointment_id', v_sheet.appointment_id,
      'doctor_id', v_sheet.doctor_id,
      'visit_at', v_sheet.visit_at,
      'finalized_at', v_sheet.finalized_at,
      'treatment_count', jsonb_array_length(p_treatments)
    )
  );
  return v_sheet;
end
$function$;

alter table crm.invoices add column code_enforced boolean not null default false;
alter table crm.invoices alter column code_enforced set default true;
alter table crm.invoices add constraint invoices_code_primary_treatment_check
  check (not code_enforced or treatment_id is not null) not valid;

alter table crm.invoice_items
  add column treatment_id uuid references crm.treatments(id) on delete restrict,
  add column treatment_code text,
  add column treatment_name text,
  add column treatment_category text,
  add column case_sheet_id uuid,
  add column tooth_number text,
  add column site_scope text,
  add column site_detail text,
  add column surfaces text[],
  add column active_billing boolean not null default true;

do $billing_backfill$
begin
  perform set_config('crm.allow_hard_delete', 'on', true);
  update crm.invoice_items ii
  set active_billing = false
  from crm.invoices i
  where i.id = ii.invoice_id
    and i.deleted_at is not null
    and ii.active_billing;
  perform set_config('crm.allow_hard_delete', 'off', true);
end
$billing_backfill$;

create unique index invoice_items_treatment_unique_idx
  on crm.invoice_items (treatment_id)
  where treatment_id is not null and active_billing;
create index invoice_items_code_idx on crm.invoice_items (treatment_code)
  where treatment_code is not null;

create function crm.populate_coded_invoice_item() returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_invoice crm.invoices%rowtype;
  v_treatment crm.treatments%rowtype;
  v_site text;
begin
  select * into v_invoice from crm.invoices where id = new.invoice_id;
  if not found then return new; end if;
  new.active_billing := case
    when current_user = 'postgres'
      and current_setting('crm.archiving_invoice', true) = new.invoice_id::text
      then false
    else v_invoice.deleted_at is null
  end;
  if not v_invoice.code_enforced then return new; end if;
  if new.treatment_id is null then
    raise exception 'code-enforced invoice lines require treatment_id' using errcode = '23514';
  end if;
  select * into v_treatment from crm.treatments where id = new.treatment_id;
  if not found or v_treatment.lead_id is distinct from v_invoice.lead_id
     or v_treatment.branch_id is distinct from v_invoice.branch_id
     or v_treatment.clinical_status is distinct from 'completed'
     or v_treatment.treatment_code is null or v_treatment.case_sheet_id is null
     or v_treatment.performed_at is null then
    raise exception 'invoice treatment must be a completed coded line for the same patient and branch'
      using errcode = '23514';
  end if;
  if not exists (select 1 from crm.case_sheets c where c.id = v_treatment.case_sheet_id and c.finalized_at is not null) then
    raise exception 'invoice treatment case sheet is not finalized' using errcode = '23514';
  end if;
  if new.quantity is distinct from v_treatment.quantity then
    raise exception 'invoice quantity must match the signed treatment quantity' using errcode = '23514';
  end if;
  v_site := case v_treatment.site_scope
    when 'tooth' then ' - Tooth ' || v_treatment.tooth_number
    when 'arch' then ' - ' || initcap(v_treatment.site_detail) || ' arch'
    when 'quadrant' then ' - ' || initcap(replace(v_treatment.site_detail, '_', ' '))
    when 'full_mouth' then ' - Full mouth'
    else ''
  end;
  new.description := '[' || v_treatment.treatment_code || '] ' || v_treatment.treatment_name || v_site;
  new.treatment_code := v_treatment.treatment_code;
  new.treatment_name := v_treatment.treatment_name;
  new.treatment_category := v_treatment.treatment_category;
  new.case_sheet_id := v_treatment.case_sheet_id;
  new.tooth_number := v_treatment.tooth_number;
  new.site_scope := v_treatment.site_scope;
  new.site_detail := v_treatment.site_detail;
  new.surfaces := v_treatment.surfaces;
  return new;
end
$function$;

create trigger populate_coded_invoice_item
  before insert or update on crm.invoice_items
  for each row execute function crm.populate_coded_invoice_item();

create function crm.sync_invoice_item_billing_state() returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    perform set_config('crm.archiving_invoice', new.id::text, true);
    update crm.invoice_items
    set active_billing = false
    where invoice_id = new.id;
    perform set_config('crm.archiving_invoice', '', true);
  end if;
  return new;
end
$function$;

create trigger sync_invoice_item_billing_state
  before update of deleted_at on crm.invoices
  for each row execute function crm.sync_invoice_item_billing_state();

create function crm.coded_invoice_items_subtotal(p_items jsonb) returns numeric
language plpgsql immutable set search_path = ''
as $function$
declare v_item jsonb; v_quantity numeric; v_price numeric; v_subtotal numeric := 0;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'invoice requires between 1 and 100 coded treatment lines' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item->'treatment_id') <> 'string'
       or jsonb_typeof(v_item->'quantity') <> 'number'
       or jsonb_typeof(v_item->'unit_price') <> 'number' then
      raise exception 'each invoice line requires treatment_id, quantity, and unit_price' using errcode = '22023';
    end if;
    perform (v_item->>'treatment_id')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    v_price := (v_item->>'unit_price')::numeric;
    if v_quantity <= 0 or v_quantity > 999999.99 or v_quantity <> round(v_quantity,2)
       or v_price < 0 or v_price > 99999999.99 or v_price <> round(v_price,2) then
      raise exception 'invoice quantity or unit price is invalid' using errcode = '22023';
    end if;
    v_subtotal := v_subtotal + round(v_quantity * v_price, 2);
    if v_subtotal > 9999999999.99 then raise exception 'invoice subtotal is out of range' using errcode = '22003'; end if;
  end loop;
  return v_subtotal;
end
$function$;

create function crm.assert_coded_invoice_ready(p_invoice_id uuid) returns void
language plpgsql set search_path = ''
as $function$
declare v_invoice crm.invoices%rowtype;
begin
  select * into v_invoice from crm.invoices where id = p_invoice_id;
  if not found or not v_invoice.code_enforced then return; end if;
  if not exists (select 1 from crm.invoice_items ii where ii.invoice_id = p_invoice_id)
     or not exists (select 1 from crm.invoice_items ii where ii.invoice_id = p_invoice_id and ii.treatment_id = v_invoice.treatment_id)
     or exists (
       select 1 from crm.invoice_items ii
       left join crm.treatments t on t.id = ii.treatment_id
       left join crm.case_sheets c on c.id = t.case_sheet_id
       where ii.invoice_id = p_invoice_id and (
         t.id is null or t.lead_id <> v_invoice.lead_id or t.branch_id <> v_invoice.branch_id
         or t.clinical_status is distinct from 'completed'
         or t.performed_at is null or c.finalized_at is null
         or ii.treatment_code is distinct from t.treatment_code
         or ii.treatment_name is distinct from t.treatment_name
         or ii.case_sheet_id is distinct from t.case_sheet_id
       )
     )
     or v_invoice.subtotal is distinct from (select coalesce(sum(ii.amount),0) from crm.invoice_items ii where ii.invoice_id = p_invoice_id) then
    raise exception 'code-enforced invoice is missing valid signed treatment lines' using errcode = '23514';
  end if;
end
$function$;

create function crm.protect_invoice_code_enforcement() returns trigger
language plpgsql set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' and not new.code_enforced
     and crm.coded_dental_enforcement_enabled()
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

create trigger protect_invoice_code_enforcement
  before insert or update of code_enforced, status on crm.invoices
  for each row execute function crm.protect_invoice_code_enforcement();

create or replace function crm.create_invoice(
  p_lead_id uuid, p_treatment_id uuid, p_tax_rate numeric, p_notes text,
  p_items jsonb, p_actor uuid
) returns crm.invoices
language plpgsql set search_path = ''
as $function$
declare
  v_lead crm.leads%rowtype; v_invoice crm.invoices%rowtype; v_item jsonb;
  v_subtotal numeric; v_tax_rate numeric := coalesce(p_tax_rate,0);
  v_tax_amount numeric; v_total numeric; v_number text; v_primary uuid;
begin
  perform crm.assert_invoice_write_access(p_actor,p_lead_id,false);
  if v_tax_rate < 0 or v_tax_rate > 100 or v_tax_rate <> round(v_tax_rate,2) then
    raise exception 'tax_rate must be between 0 and 100 with at most two decimals' using errcode = '22023';
  end if;
  if (
    current_user = 'postgres'
    and current_setting('crm.allow_legacy_test_records', true) = 'on'
  ) or (
    not crm.coded_dental_enforcement_enabled()
    and not coalesce((p_items->0) ? 'treatment_id', false)
  ) then
    v_subtotal := crm.invoice_items_subtotal(p_items);
    v_tax_amount := round(v_subtotal*v_tax_rate/100,2);
    v_total := v_subtotal+v_tax_amount;
    select * into v_lead from crm.leads where id=p_lead_id for update;
    v_number := crm.next_invoice_number(v_lead.branch_id);
    insert into crm.invoices(
      invoice_number,lead_id,treatment_id,status,subtotal,tax_rate,tax_amount,
      total,notes,created_by,code_enforced
    ) values (
      v_number,p_lead_id,p_treatment_id,'draft',v_subtotal,v_tax_rate,
      v_tax_amount,v_total,nullif(btrim(p_notes),''),p_actor,false
    ) returning * into v_invoice;
    for v_item in select value from jsonb_array_elements(p_items) loop
      insert into crm.invoice_items(invoice_id,description,quantity,unit_price)
      values(
        v_invoice.id,btrim(v_item->>'description'),
        (v_item->>'quantity')::numeric,(v_item->>'unit_price')::numeric
      );
    end loop;
    insert into crm.lead_activity(lead_id,actor_id,type,detail) values
      (p_lead_id,p_actor,'invoice',jsonb_build_object(
        'event','invoice_created','invoice_id',v_invoice.id,
        'invoice_number',v_invoice.invoice_number,'total',v_invoice.total,
        'code_enforced',false
      ));
    insert into crm.audit_log(entity_type,entity_id,action,actor_id,new_data)
    values('invoice',v_invoice.id,'created',p_actor,to_jsonb(v_invoice));
    return v_invoice;
  end if;
  v_subtotal := crm.coded_invoice_items_subtotal(p_items);
  v_primary := coalesce(p_treatment_id, (p_items->0->>'treatment_id')::uuid);
  if not exists (select 1 from jsonb_array_elements(p_items) e where (e.value->>'treatment_id')::uuid = v_primary) then
    raise exception 'primary treatment must be included in invoice items' using errcode = '23514';
  end if;
  perform 1 from crm.treatments t
  where t.id in (select (e.value->>'treatment_id')::uuid from jsonb_array_elements(p_items) e)
  order by t.id for update;
  v_tax_amount := round(v_subtotal*v_tax_rate/100,2); v_total := v_subtotal+v_tax_amount;
  select * into v_lead from crm.leads where id=p_lead_id for update;
  v_number := crm.next_invoice_number(v_lead.branch_id);
  insert into crm.invoices(invoice_number,lead_id,treatment_id,status,subtotal,tax_rate,tax_amount,total,notes,created_by,code_enforced)
  values(v_number,p_lead_id,v_primary,'draft',v_subtotal,v_tax_rate,v_tax_amount,v_total,nullif(btrim(p_notes),''),p_actor,true)
  returning * into v_invoice;
  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into crm.invoice_items(invoice_id,treatment_id,description,quantity,unit_price)
    values(v_invoice.id,(v_item->>'treatment_id')::uuid,'Derived from treatment',
      (v_item->>'quantity')::numeric,(v_item->>'unit_price')::numeric);
  end loop;
  perform crm.assert_coded_invoice_ready(v_invoice.id);
  insert into crm.lead_activity(lead_id,actor_id,type,detail) values
    (p_lead_id,p_actor,'invoice',jsonb_build_object('event','invoice_created','invoice_id',v_invoice.id,'invoice_number',v_invoice.invoice_number,'total',v_invoice.total,'code_enforced',true));
  insert into crm.audit_log(entity_type,entity_id,action,actor_id,new_data)
  values('invoice',v_invoice.id,'created',p_actor,to_jsonb(v_invoice));
  return v_invoice;
end
$function$;

create or replace function crm.update_invoice(
  p_invoice_id uuid, p_tax_rate numeric, p_notes text, p_items jsonb,
  p_actor uuid, p_expected_version bigint default null
) returns crm.invoices
language plpgsql set search_path = ''
as $function$
declare
  v_old crm.invoices%rowtype; v_invoice crm.invoices%rowtype; v_item jsonb;
  v_subtotal numeric; v_tax_rate numeric := coalesce(p_tax_rate,0); v_tax_amount numeric; v_total numeric;
begin
  select * into v_old from crm.invoices where id=p_invoice_id for update;
  if not found then raise exception 'invoice % not found',p_invoice_id using errcode='P0002'; end if;
  if v_old.deleted_at is not null then raise exception 'invoice % is deleted',p_invoice_id using errcode='55000'; end if;
  perform crm.assert_invoice_write_access(p_actor,v_old.lead_id,false);
  if p_expected_version is not null and p_expected_version<>v_old.version then
    raise exception 'invoice % was modified by another request',p_invoice_id using errcode='40001';
  end if;
  if v_old.status='paid' then raise exception 'paid invoice % cannot be edited',p_invoice_id using errcode='55000'; end if;
  if v_tax_rate<0 or v_tax_rate>100 or v_tax_rate<>round(v_tax_rate,2) then
    raise exception 'tax_rate must be between 0 and 100 with at most two decimals' using errcode='22023';
  end if;
  if v_old.code_enforced then
    v_subtotal := crm.coded_invoice_items_subtotal(p_items);
    if not exists (select 1 from jsonb_array_elements(p_items) e where (e.value->>'treatment_id')::uuid=v_old.treatment_id) then
      raise exception 'primary treatment must remain on a code-enforced invoice' using errcode='23514';
    end if;
    perform 1 from crm.treatments t where t.id in
      (select (e.value->>'treatment_id')::uuid from jsonb_array_elements(p_items)e)
      order by t.id for update;
  else
    v_subtotal := crm.invoice_items_subtotal(p_items);
  end if;
  v_tax_amount:=round(v_subtotal*v_tax_rate/100,2); v_total:=v_subtotal+v_tax_amount;
  update crm.invoices set subtotal=v_subtotal,tax_rate=v_tax_rate,tax_amount=v_tax_amount,total=v_total,notes=nullif(btrim(p_notes),'')
  where id=p_invoice_id returning * into v_invoice;
  delete from crm.invoice_items where invoice_id=p_invoice_id;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if v_old.code_enforced then
      insert into crm.invoice_items(invoice_id,treatment_id,description,quantity,unit_price)
      values(p_invoice_id,(v_item->>'treatment_id')::uuid,'Derived from treatment',(v_item->>'quantity')::numeric,(v_item->>'unit_price')::numeric);
    else
      insert into crm.invoice_items(invoice_id,description,quantity,unit_price)
      values(p_invoice_id,btrim(v_item->>'description'),(v_item->>'quantity')::numeric,(v_item->>'unit_price')::numeric);
    end if;
  end loop;
  if v_old.code_enforced then perform crm.assert_coded_invoice_ready(p_invoice_id); end if;
  insert into crm.lead_activity(lead_id,actor_id,type,detail) values
    (v_invoice.lead_id,p_actor,'invoice',jsonb_build_object('event','invoice_updated','invoice_id',v_invoice.id,'invoice_number',v_invoice.invoice_number,'total',v_invoice.total));
  insert into crm.audit_log(entity_type,entity_id,action,actor_id,old_data,new_data)
  values('invoice',v_invoice.id,'updated',p_actor,to_jsonb(v_old),to_jsonb(v_invoice));
  return v_invoice;
end
$function$;

create or replace function crm.get_report_aggregates(
  p_actor uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_branch_id uuid default null,
  p_doctor_id uuid default null
)
returns table (
  by_doctor jsonb,
  by_center jsonb,
  by_day jsonb,
  by_treatment jsonb,
  totals jsonb
)
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_actor_role text;
  v_doctor_branch_id uuid;
begin
  if p_actor is null then
    raise exception 'report actor is required'
      using errcode = '42501';
  end if;

  select p.role::text
  into v_actor_role
  from crm.profiles p
  where p.id = p_actor
    and p.is_active;

  if not found then
    raise exception 'report actor is missing or inactive'
      using errcode = '42501';
  end if;

  if v_actor_role not in ('admin', 'operations', 'clinical_head') then
    raise exception 'actor does not have report access'
      using errcode = '42501';
  end if;

  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'report end must be after report start'
      using errcode = '22023';
  end if;

  if p_to - p_from > interval '366 days' then
    raise exception 'report range cannot exceed 366 days'
      using errcode = '22023';
  end if;

  if p_branch_id is not null
     and v_actor_role <> 'admin'
     and not exists (
       select 1
       from crm.user_branches ub
       where ub.user_id = p_actor
         and ub.branch_id = p_branch_id
     ) then
    raise exception 'actor is not allocated to the selected branch'
      using errcode = '42501';
  end if;

  if p_doctor_id is not null then
    select d.branch_id
    into v_doctor_branch_id
    from crm.doctors d
    where d.id = p_doctor_id
      and d.is_active;

    if not found then
      raise exception 'selected doctor is missing or inactive'
        using errcode = '22023';
    end if;

    if v_actor_role <> 'admin'
       and not exists (
         select 1
         from crm.user_branches ub
         where ub.user_id = p_actor
           and ub.branch_id = v_doctor_branch_id
       ) then
      raise exception 'actor is not allocated to the doctor branch'
        using errcode = '42501';
    end if;

    if p_branch_id is not null and p_branch_id <> v_doctor_branch_id then
      raise exception 'selected doctor does not belong to the selected branch'
        using errcode = '22023';
    end if;
  end if;

  return query
  with
  actor_branches as materialized (
    select ub.branch_id
    from crm.user_branches ub
    where ub.user_id = p_actor
  ),
  scoped_appointments as materialized (
    select
      a.id,
      a.lead_id,
      a.branch_id,
      a.doctor_id,
      a.scheduled_at
    from crm.appointments a
    where a.scheduled_at >= p_from
      and a.scheduled_at < p_to
      and (v_actor_role = 'admin' or a.branch_id in (select ab.branch_id from actor_branches ab))
      and (p_branch_id is null or a.branch_id = p_branch_id)
      and (p_doctor_id is null or a.doctor_id = p_doctor_id)
  ),
  scoped_treatments as materialized (
    select
      t.id,
      t.lead_id,
      t.branch_id,
      t.appointment_id,
      t.treatment_type_id,
      t.treatment_code,
      t.treatment_name,
      t.doctor_id,
      case
        when t.case_sheet_id is null then coalesce(t.cost, 0::numeric)
        else round(coalesce(t.cost, 0::numeric) * coalesce(t.quantity, 1::numeric), 2)
      end as cost,
      t.treated_at
    from crm.treatments t
    where t.treated_at >= p_from
      and t.treated_at < p_to
      and (t.case_sheet_id is null or t.clinical_status = 'completed')
      and (v_actor_role = 'admin' or t.branch_id in (select ab.branch_id from actor_branches ab))
      and (p_branch_id is null or t.branch_id = p_branch_id)
      and (p_doctor_id is null or t.doctor_id = p_doctor_id)
  ),
  lead_doctors as materialized (
    select a.lead_id, a.doctor_id
    from scoped_appointments a
    where a.doctor_id is not null
    union
    select t.lead_id, t.doctor_id
    from scoped_treatments t
    where t.doctor_id is not null
  ),
  scoped_leads as materialized (
    select
      l.id,
      l.branch_id,
      l.created_at
    from crm.leads l
    where l.deleted_at is null
      and l.created_at >= p_from
      and l.created_at < p_to
      and (v_actor_role = 'admin' or l.branch_id in (select ab.branch_id from actor_branches ab))
      and (p_branch_id is null or l.branch_id = p_branch_id)
      and (
        p_doctor_id is null
        or exists (
          select 1
          from lead_doctors ld
          where ld.lead_id = l.id
        )
      )
  ),
  scoped_follow_ups as materialized (
    select
      f.id,
      f.lead_id,
      f.branch_id,
      f.due_at
    from crm.follow_ups f
    where f.due_at >= p_from
      and f.due_at < p_to
      and (v_actor_role = 'admin' or f.branch_id in (select ab.branch_id from actor_branches ab))
      and (p_branch_id is null or f.branch_id = p_branch_id)
      and (
        p_doctor_id is null
        or exists (
          select 1
          from lead_doctors ld
          where ld.lead_id = f.lead_id
        )
      )
  ),
  doctor_keys as (
    select ld.doctor_id
    from lead_doctors ld
    group by ld.doctor_id
  ),
  doctor_appointment_metrics as (
    select
      a.doctor_id,
      count(*)::bigint as appointments
    from scoped_appointments a
    where a.doctor_id is not null
    group by a.doctor_id
  ),
  doctor_treatment_metrics as (
    select
      t.doctor_id,
      coalesce(sum(t.cost), 0::numeric) as revenue
    from scoped_treatments t
    where t.doctor_id is not null
    group by t.doctor_id
  ),
  doctor_lead_metrics as (
    select
      ld.doctor_id,
      count(*)::bigint as leads
    from lead_doctors ld
    group by ld.doctor_id
  ),
  doctor_follow_up_metrics as (
    select
      ld.doctor_id,
      count(f.id)::bigint as follow_ups
    from lead_doctors ld
    join scoped_follow_ups f on f.lead_id = ld.lead_id
    group by ld.doctor_id
  ),
  doctor_rows as (
    select
      'doctor'::text as dimension,
      dk.doctor_id::text as row_key,
      coalesce(d.full_name, 'Unknown')::text as row_label,
      coalesce(dlm.leads, 0::bigint) as leads,
      coalesce(dam.appointments, 0::bigint) as appointments,
      coalesce(dfm.follow_ups, 0::bigint) as follow_ups,
      coalesce(dtm.revenue, 0::numeric) as revenue
    from doctor_keys dk
    left join crm.doctors d on d.id = dk.doctor_id
    left join doctor_lead_metrics dlm on dlm.doctor_id = dk.doctor_id
    left join doctor_appointment_metrics dam on dam.doctor_id = dk.doctor_id
    left join doctor_follow_up_metrics dfm on dfm.doctor_id = dk.doctor_id
    left join doctor_treatment_metrics dtm on dtm.doctor_id = dk.doctor_id
  ),
  center_events as (
    select l.branch_id, 1::bigint as leads, 0::bigint as appointments, 0::bigint as follow_ups, 0::numeric as revenue
    from scoped_leads l
    union all
    select a.branch_id, 0::bigint, 1::bigint, 0::bigint, 0::numeric
    from scoped_appointments a
    union all
    select f.branch_id, 0::bigint, 0::bigint, 1::bigint, 0::numeric
    from scoped_follow_ups f
    union all
    select t.branch_id, 0::bigint, 0::bigint, 0::bigint, coalesce(t.cost, 0::numeric)
    from scoped_treatments t
  ),
  center_metrics as (
    select
      ce.branch_id,
      sum(ce.leads)::bigint as leads,
      sum(ce.appointments)::bigint as appointments,
      sum(ce.follow_ups)::bigint as follow_ups,
      sum(ce.revenue) as revenue
    from center_events ce
    group by ce.branch_id
  ),
  center_rows as (
    select
      'center'::text as dimension,
      cm.branch_id::text as row_key,
      coalesce(b.name, 'Unknown')::text as row_label,
      cm.leads,
      cm.appointments,
      cm.follow_ups,
      cm.revenue
    from center_metrics cm
    left join crm.branches b on b.id = cm.branch_id
  ),
  day_events as (
    select
      (l.created_at at time zone 'Asia/Kolkata')::date as clinic_day,
      1::bigint as leads,
      0::bigint as appointments,
      0::bigint as follow_ups,
      0::numeric as revenue
    from scoped_leads l
    union all
    select
      (a.scheduled_at at time zone 'Asia/Kolkata')::date,
      0::bigint,
      1::bigint,
      0::bigint,
      0::numeric
    from scoped_appointments a
    union all
    select
      (f.due_at at time zone 'Asia/Kolkata')::date,
      0::bigint,
      0::bigint,
      1::bigint,
      0::numeric
    from scoped_follow_ups f
    union all
    select
      (t.treated_at at time zone 'Asia/Kolkata')::date,
      0::bigint,
      0::bigint,
      0::bigint,
      coalesce(t.cost, 0::numeric)
    from scoped_treatments t
  ),
  day_metrics as (
    select
      de.clinic_day,
      sum(de.leads)::bigint as leads,
      sum(de.appointments)::bigint as appointments,
      sum(de.follow_ups)::bigint as follow_ups,
      sum(de.revenue) as revenue
    from day_events de
    group by de.clinic_day
  ),
  day_rows as (
    select
      'day'::text as dimension,
      dm.clinic_day::text as row_key,
      to_char(dm.clinic_day, 'FMDD Mon')::text as row_label,
      dm.leads,
      dm.appointments,
      dm.follow_ups,
      dm.revenue
    from day_metrics dm
  ),
  treatment_rows as (
    select
      'treatment'::text as dimension,
      coalesce(t.treatment_code, t.treatment_type_id::text)::text as row_key,
      coalesce(
        t.treatment_code || ' — ' || t.treatment_name,
        tt.name,
        'Unknown'
      )::text as row_label,
      count(distinct t.lead_id)::bigint as leads,
      count(*) filter (
        where t.appointment_id is not null
          and exists (
            select 1
            from scoped_appointments a
            where a.id = t.appointment_id
          )
      )::bigint as appointments,
      0::bigint as follow_ups,
      coalesce(sum(t.cost), 0::numeric) as revenue
    from scoped_treatments t
    left join crm.treatment_types tt on tt.id = t.treatment_type_id
    where t.treatment_code is not null or t.treatment_type_id is not null
    group by
      coalesce(t.treatment_code, t.treatment_type_id::text),
      coalesce(t.treatment_code || ' — ' || t.treatment_name, tt.name, 'Unknown')
  ),
  total_rows as (
    select
      'total'::text as dimension,
      'total'::text as row_key,
      'Total'::text as row_label,
      (select count(*)::bigint from scoped_leads) as leads,
      (select count(*)::bigint from scoped_appointments) as appointments,
      (select count(*)::bigint from scoped_follow_ups) as follow_ups,
      (select coalesce(sum(t.cost), 0::numeric) from scoped_treatments t) as revenue
  )
  select
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'key', dr.row_key,
            'label', dr.row_label,
            'leads', dr.leads,
            'appointments', dr.appointments,
            'followUps', dr.follow_ups,
            'revenue', dr.revenue
          )
          order by dr.revenue desc, dr.appointments desc, dr.row_label asc
        )
        from doctor_rows dr
      ),
      '[]'::jsonb
    ) as by_doctor,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'key', cr.row_key,
            'label', cr.row_label,
            'leads', cr.leads,
            'appointments', cr.appointments,
            'followUps', cr.follow_ups,
            'revenue', cr.revenue
          )
          order by cr.revenue desc, cr.appointments desc, cr.row_label asc
        )
        from center_rows cr
      ),
      '[]'::jsonb
    ) as by_center,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'key', dr.row_key,
            'label', dr.row_label,
            'leads', dr.leads,
            'appointments', dr.appointments,
            'followUps', dr.follow_ups,
            'revenue', dr.revenue
          )
          order by dr.row_key asc
        )
        from day_rows dr
      ),
      '[]'::jsonb
    ) as by_day,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'key', tr.row_key,
            'label', tr.row_label,
            'leads', tr.leads,
            'appointments', tr.appointments,
            'followUps', tr.follow_ups,
            'revenue', tr.revenue
          )
          order by tr.revenue desc, tr.appointments desc, tr.row_label asc
        )
        from treatment_rows tr
      ),
      '[]'::jsonb
    ) as by_treatment,
    (
      select jsonb_build_object(
        'leads', tr.leads,
        'appointments', tr.appointments,
        'followUps', tr.follow_ups,
        'revenue', tr.revenue
      )
      from total_rows tr
    ) as totals;
end
$function$;

comment on function crm.get_report_aggregates(uuid, timestamptz, timestamptz, uuid, uuid)
is 'Returns branch-authorized report aggregates; coded revenue includes completed quantities and excludes planned care.';

create or replace function crm.get_doctor_dashboard(
  p_actor uuid,
  p_day_start timestamptz,
  p_day_end timestamptz
)
returns table (
  todays_appointments bigint,
  week_appointments bigint,
  patients_treated bigint,
  revenue_generated numeric
)
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_doctor_id uuid;
  v_actor_role text;
begin
  select p.role::text
  into v_actor_role
  from crm.profiles p
  where p.id = p_actor
    and p.is_active;

  if not found or v_actor_role <> 'doctor' then
    raise exception 'actor does not have doctor dashboard access'
      using errcode = '42501';
  end if;

  if p_day_start is null or p_day_end is null or p_day_end <= p_day_start then
    raise exception 'dashboard day range is invalid'
      using errcode = '22023';
  end if;

  if p_day_end - p_day_start > interval '2 days' then
    raise exception 'dashboard day range is too large'
      using errcode = '22023';
  end if;

  select d.id
  into v_doctor_id
  from crm.doctors d
  where d.profile_id = p_actor;

  return query
  select
    (
      select count(*)::bigint
      from crm.appointments a
      where a.doctor_id = v_doctor_id
        and a.status = 'scheduled'
        and a.scheduled_at >= p_day_start
        and a.scheduled_at < p_day_end
    ) as todays_appointments,
    (
      select count(*)::bigint
      from crm.appointments a
      where a.doctor_id = v_doctor_id
        and a.status = 'scheduled'
        and a.scheduled_at >= p_day_start
        and a.scheduled_at < p_day_start + interval '7 days'
    ) as week_appointments,
    (
      select count(distinct t.lead_id)::bigint
      from crm.treatments t
      where t.doctor_id = v_doctor_id
        and (t.case_sheet_id is null or t.clinical_status = 'completed')
    ) as patients_treated,
    (
      select coalesce(sum(
        case
          when t.case_sheet_id is null then coalesce(t.cost, 0::numeric)
          else round(coalesce(t.cost, 0::numeric) * coalesce(t.quantity, 1::numeric), 2)
        end
      ), 0::numeric)
      from crm.treatments t
      where t.doctor_id = v_doctor_id
        and (t.case_sheet_id is null or t.clinical_status = 'completed')
    ) as revenue_generated;
end
$function$;

comment on function crm.get_doctor_dashboard(uuid, timestamptz, timestamptz)
is 'Returns a doctor schedule plus completed coded and historical legacy treatment aggregates.';

create index treatments_completed_report_idx
  on crm.treatments (branch_id, treated_at, doctor_id)
  include (treatment_code, treatment_name, treatment_type_id, cost, quantity)
  where case_sheet_id is null or clinical_status = 'completed';


alter table crm.treatment_codes enable row level security;
alter table crm.case_sheets enable row level security;
revoke all on crm.treatment_codes, crm.case_sheets from public, anon, authenticated;
grant select on crm.treatment_codes to service_role;
grant select, insert on crm.case_sheets to service_role;
revoke insert, update, delete, truncate on crm.treatment_codes from service_role;
revoke update, delete, truncate on crm.case_sheets from service_role;

revoke execute on function crm.reject_treatment_code_mutation(), crm.enforce_coded_treatment(),
  crm.enforce_case_sheet_creation(), crm.protect_finalized_clinical_record(),
  crm.populate_coded_invoice_item(), crm.sync_invoice_item_billing_state(),
  crm.protect_invoice_code_enforcement() from public, anon, authenticated, service_role;
revoke execute on function crm.finalize_case_sheet(uuid,uuid,uuid,timestamptz,text,text,text,text,text,jsonb,uuid),
  crm.coded_invoice_items_subtotal(jsonb), crm.assert_coded_invoice_ready(uuid),
  crm.create_invoice(uuid,uuid,numeric,text,jsonb,uuid),
  crm.update_invoice(uuid,numeric,text,jsonb,uuid,bigint)
  from public, anon, authenticated;
grant execute on function crm.finalize_case_sheet(uuid,uuid,uuid,timestamptz,text,text,text,text,text,jsonb,uuid),
  crm.coded_invoice_items_subtotal(jsonb), crm.assert_coded_invoice_ready(uuid),
  crm.create_invoice(uuid,uuid,numeric,text,jsonb,uuid),
  crm.update_invoice(uuid,numeric,text,jsonb,uuid,bigint)
  to service_role;
