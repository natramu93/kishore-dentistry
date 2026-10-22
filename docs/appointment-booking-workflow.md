# Appointment-only booking workflow

All patient booking buttons use **Book appointment** and open the same start
date/time, doctor and notes form. Saving creates a normal scheduled appointment
and uses the branch-configured WhatsApp handoff only after the save succeeds.
There is no separate reminder or follow-up scheduling form.

- Assigned patients book their initial visit as before.
- Visited/treated patients transition directly to appointment booked.
- Patients already in appointment booked use the existing additional-appointment
  action. Existing visits are not overwritten.
- Legacy follow-up leads may book directly with the same form. Their old
  reminders are not automatically converted into appointments or marked done.
- The follow-up menu, queue, completion/cancellation actions, dashboard tile,
  pipeline step and report/export columns have been removed.
- Old `/follow-ups` bookmarks authenticate and redirect to `/appointments`.
- Past reminders and their comments remain available in patient history when
  records exist. Their stored rows are read-only to the application role.

## Database rollout

Apply `20261022083906_appointment_only_booking_workflow.sql` before deploying
the matching application. It updates the lead-transition validator and RPC,
blocks creation of follow-up statuses, removes reminder side effects, and
restricts `crm.follow_ups` to server-only reads. It does not delete or rewrite
existing patient, clinical, appointment or reminder history.

The migration was applied to production on 22 October 2026 and the booking
regression passed against the migrated schema. Deploy the matching application
revision to make the unified booking form available to users.

## Verification

- Application unit/component suite, type checking, lint and production build pass.
- Regression `0027_appointment_only_workflow_test.sql` passes using synthetic
  fixtures in one rolled-back database transaction. It covers admin, operations
  and front desk booking from assigned, visited/treated and legacy follow-up
  states; future out-of-hours appointments; doctor/time/notes/activity; replay
  safety; cross-center rejection; and read-only reminder history.
- The same regression completes an actual general clinical visit, then books
  another appointment and verifies the signed case sheet and completed visit
  remain attached to the original appointment.
- Pre-release rollback verification confirmed no test users/centers remained
  and restored the original production function/trigger. After the authorized
  production migration, the same regression passed again using rolled-back
  fixtures; the new workflow rules remain installed.
- Two older SQL scripts are not clean against the existing production schema:
  `0015` still expects caller-supplied future clinical timestamps to be rejected
  (the unchanged baseline also fails), and `0016` uses removed `TMT_108` data.
  Their booking sections have been updated for the retired follow-up route;
  their unrelated legacy clinical assumptions have not been rewritten here.
