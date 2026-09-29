# Dental workflow review — 29 September 2026

## Scope and safety

MocDoc was explored read-only in the signed-in browser. No patient, appointment, clinical, billing or master records were created or changed. No sync, check-in, save or billing submission was performed. The clinical workflow was inspected through MocDoc's own Learning Hub tutorial, not by modifying a live patient's chart.

The initial review and browser checks used local implementation work and `tests/preview`, whose actions are replaced by in-memory mocks; no real patient information was used. The user subsequently authorized migration, commit, push and production deployment. Production migration verification is recorded below; application release identity is tracked in Git and Firebase App Hosting.

## Observed patterns and implementation decisions

| MocDoc screen or feature observed | CRM adaptation |
| --- | --- |
| Treatment master and treatment suggestions in estimates | Start an invoice with one treatment picker; add further lines as needed. |
| Optional notes alongside treatment/billing entries | One main clinical remark; optional tooth remarks, treatment notes and invoice-line notes. |
| Separate treatment advised and billed/completed work in the case-sheet tutorial | Explicit **Yet to treat** and **Treated** groups using clinical status. Creating or paying an invoice never marks a treatment completed. |
| Patient and visit-oriented clinical tabs | Retain the general tooth record independently of whether treatment was performed. Show treatment progress across all visits. |
| Line quantity, rate, discounts and totals on estimates | Keep treatment and rate visible; collapse optional teeth, notes, tax and discount controls. |
| Content master categories for clinical notes | Keep an open remark for now; reusable note templates remain a possible later enhancement, not a new required field. |

MocDoc's public [dental clinic overview](https://mocdoc.com/dental-clinic-management-software) also describes tooth-chart selection and treatment planning. Product descriptions were used as context, not evidence that every feature was exercised in the signed-in account.

## Current CRM workflow

1. Enter the patient's concern and one clinical remark; review medical history.
2. Optionally select one or several teeth and add shared findings. Existing individual notes and legacy diagnosis/plan fields are preserved.
3. Optionally add coded treatments and mark them planned or completed. Selection alone never creates a finding or implies completed care.
4. Save the case sheet. Clinical review can be saved without a treatment or invoice.
5. In the patient's invoice section, choose center treatments, optionally select teeth and add notes, then create a multi-line invoice independently of case sheets.
6. Refer to the patient's cross-visit progress summary when planning follow-up work. A completed procedure on one tooth does not automatically resolve another planned procedure on that tooth.

## Patient workspace and later-visit improvements

- Sticky, phone-friendly shortcuts jump to appointments, clinical history and invoices without hiding the rest of the patient record. Each scheduled appointment has its own case-sheet entry point.
- The consultation shortcut opens the same invoice editor, with the center's configured consultation charge preselected and editable. Other treatment lines can be added immediately. Switching the patient or invoice preset resets the form to prevent carrying lines into another patient's invoice.
- Patient invoice totals cover all non-archived, non-cancelled invoices, not just the 200-row history preview. Patient-filtered invoice listing retains patient context through filtering and pagination. Cancelled invoices remain visible in history but do not count as debt.
- Unassigned front-desk users receive an assignment prompt before entering an invoice, preserving the existing access rules.
- A later visit can explicitly continue an earlier signed plan. The code, original note and remaining teeth are carried forward; the clinician selects teeth treated today and explicitly confirms completion. Completing one tooth leaves the other teeth pending. Billing or payment never implies clinical completion.
- New case sheets validate the actual scheduled appointment. An earlier completed visit no longer blocks finalizing a later already-booked appointment merely because the overall lead status has changed.
- Edit links reflect the existing 24-hour limit. Saved treatment rows remain in signed history and cannot be removed; unsaved draft lines can be removed. Corrections to permitted fields still require an amendment reason, an unchanged version and an open edit window. Plans with linked later care cannot have their original code, site or status rewritten.
- No-show/cancellation confirmations require an explicit date, time and doctor selection when several appointments exist. They never silently choose the first appointment or submit an undefined appointment reference.
- Known treatment-plan conflicts explain what needs reviewing. Unknown database messages remain hidden.

## Database changes and rollout

Apply the new migrations in timestamp order before deploying the matching application code:

1. `20260929115207_independent_invoice_teeth_and_notes.sql`: independent multi-line invoice metadata, safe payment/edit/cancellation behavior and narrow helper permissions.
2. `20260929122511_treatment_plan_continuation.sql`: explicit plan-to-completion links, remaining-tooth progress view and validation. Existing plans are not automatically matched or rewritten. The view has no contact or billing fields and uses caller permissions. The source plan is locked while checking duplicate completion. Historical function extensions validate exact insertion anchors and fail safely on schema drift.
3. `20260929122545_patient_invoice_summary.sql`: exact invoice count, invoiced total, receipts and outstanding balance across patient history, with service-role-only execution and explicit actor/branch/assignment checks.

The application expects these migrations; deploying code ahead of schema will break the affected patient pages. Existing invoice, case-sheet and audit history is retained. No destructive reset or production fixture creation is needed.

## Verification boundaries

- Mobile component preview covers tooth selection and independent invoice entry without horizontal overflow at a 360px viewport.
- A further 360px browser check covered sticky navigation and partial-plan continuation: already-treated teeth were disabled, completion was explicitly required, and the in-memory submission retained its source plan and only the selected tooth. The progress display distinguishes partly treated plans from completed care.
- Component/unit tests cover legacy-note preservation, multi-tooth selection, save errors, progress visibility, patient context, appointment selection and access checks. See the final verification below for the current totals.
- Database checks use an isolated PostgreSQL-compatible test database and synthetic fixtures, including application-role permissions, invoice create/edit, payment immutability, cancellation, historical snapshots and tooth metadata.
- The actual case-sheet finalize/amend procedures passed with one remark, no diagnosis/plan and no treatments for admin, doctor, operations and front desk. Edits preserve visit and appointment times; stale versions and unconfirmed medical history are rejected.
- True concurrent database transactions were not exercised by the single-connection test harness.
- SQL regressions 0017–0020 pass after applying every real migration to an isolated PGlite database. Coverage includes service-role access, partial and overlapping completion, cross-patient/center rejection, immutable plan links, 24-hour amendments, repeat scheduled visits, split payments and totals beyond the 200-invoice preview limit.
- Production authentication, live records and external WhatsApp/file delivery were not exercised in this read-only review.
- Some MocDoc screens displayed a master-sync warning. No sync was triggered; no claim is made that all MocDoc workflows were verified end to end.
- Existing lead-level pipeline transitions still change overall lead status when one appointment is cancelled or marked missed; this work makes the appointment choice explicit but does not redesign the entire lead state machine. Pending-plan and completed-treatment summaries each display up to 100 records with a visible truncation notice; complete case-sheet history remains paginated.

## Final verification

- 58 component/unit test files passed: 389 tests.
- Full lint, standalone type check and optimized production build passed.
- All four new SQL regressions (0017–0020) passed against the complete local migration chain in isolated PGlite.
- Browser checks used the real components with synthetic, in-memory actions at a 360px viewport. The temporary viewport was reset and the preview server was stopped afterward.
- These checks do not establish live production operation or concurrent-transaction behavior; a migration-first deployment and authenticated role-based smoke test are still required before release.

## Authorized production release — 29 September 2026

The three reviewed migrations were applied through the connected Supabase migration tool, which assigns its own ledger timestamps. The CLI's legacy profile loader failed, and existing historical ledger versions already differ from the repository timestamps. No ledger repair, reset or replay of older migrations was attempted.

| Repository migration | Production ledger version |
| --- | --- |
| `20260929115207_independent_invoice_teeth_and_notes.sql` | `20260929135538` |
| `20260929122511_treatment_plan_continuation.sql` | `20260929135556` |
| `20260929122545_patient_invoice_summary.sql` | `20260929135616` |

Post-migration read-only checks passed for patient summaries and clinical progress under the application's service role. Patient, invoice and case-sheet counts were unchanged. Browser roles cannot execute the financial summary or read the clinical progress view; the view uses caller permissions.

An encrypted CRM-row snapshot was captured at **2026-09-29 13:54:40 UTC**, covering all 34 CRM tables, in the ignored local `backups/` folder. Windows DPAPI encryption and a decrypt/SHA-256 round trip were verified. Recovery requires the same Windows account. This is an application-data snapshot with per-table reads, **not** a transactionally consistent full-database backup: it excludes Auth secrets and Storage file contents. Provider physical-backup listing returned insufficient privilege, so provider backup/PITR coverage was not verified.

Release preflight identified vulnerable framework/image-processing dependencies. Exact patch pins were updated to Next.js and eslint-config-next **16.3.7**, Sharp **0.35.5**, and Vitest/coverage **4.1.11**. The dependency audit reports zero vulnerabilities. Supabase dependencies are unchanged. The Firebase archive explicitly excludes local backups, environment files, temporary files, test fixtures and internal development folders in addition to respecting `.gitignore`.

The existing Supabase advisory for [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) remains; Auth configuration was not changed by this release. The 34 informational RLS-without-policy notices reflect the intentional server-only CRM data access model, not newly exposed browser access.
