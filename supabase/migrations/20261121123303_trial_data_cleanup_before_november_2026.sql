-- One-time, explicitly approved production maintenance was completed on 21 Nov 2026.
-- Eligible trial patients and their dependent records before 1 Nov 2026 (Asia/Kolkata)
-- were removed after encrypted row/file backups. November-linked patients, master
-- data, immutable audit history and all retained rows were preserved and verified.
-- No lasting schema or permission changes were made. Fresh environments must NOT
-- replay a production data purge; this marker keeps the migration ledger aligned.
select 1;
