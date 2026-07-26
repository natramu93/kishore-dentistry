# Authorization matrix

This matrix is the product policy. Navigation visibility is never an
authorization control. Every read and mutation must enforce the same rule in
the server data layer, and high-risk transactional workflows repeat critical
checks in PostgreSQL.

"Allocated" means the actor has an active `user_branches` allocation for the
record's active branch. Admin is globally scoped. "Manage" includes the
supported create, update, and state-transition actions; it does not imply
physical deletion.

| Capability | Admin | Operations | Front Office | Clinical Head | Doctor |
|---|---|---|---|---|---|
| Branches | All; create and update | Allocated; read | Allocated; read | Allocated; read | Allocated; read |
| Leads | All; manage | Allocated; manage | Read own and unassigned; write own after assignment | Allocated; manage | No Leads module access |
| Appointments | All; manage | Allocated; manage | Accessible leads; book and reschedule | Allocated; manage | Own linked schedule; complete or mark no-show |
| Treatment records | All; manage through lead workflow | Allocated; manage through lead workflow | Accessible assigned leads; manage through lead workflow | Allocated; manage through lead workflow | Record treatment only while completing own linked appointment |
| Follow-ups | All; manage | Allocated; manage | Read own and unassigned; complete own assigned lead's follow-up | Allocated; manage | No access |
| Comments | All accessible leads; add; edit own; archive own or another author's | Allocated leads; add; edit own; archive own or another author's | Read own and unassigned; add/edit/archive own on assigned leads | Allocated leads; add; edit own; archive own or another author's | No access |
| Invoices | All; create, edit non-paid, advance status | Allocated; create, edit non-paid, advance status | Read own and unassigned; create/edit/advance only for assigned leads | Allocated; create, edit non-paid, advance status | No access |
| Reports | Global | Allocated | No access | Allocated | Own dashboard only; no Reports module |
| User accounts and allocations | Manage through audited workflow | No access | No access | No access | No access |
| Doctor roster | All; manage | Allocated; manage | Read active choices | Allocated; manage | No roster-management access |
| Treatment catalog | Manage | Read active choices | Read active choices | Manage | Read active choices needed for own completion |
| Lead archive | All; soft archive | Allocated; soft archive | No access | No access | No access |
| Invoice archive | Non-paid only | Allocated non-paid only | No access | No access | No access |
| Privileged TOTP | Required | Required | Not role-mandated | Required | Not role-mandated |

## Shared enforcement rules

- Inactive profiles cannot enter the application. Unknown or legacy roles fail
  closed.
- Non-Admin users may access only active allocated branches. An allocation does
  not override record ownership, lead assignment, or Doctor-link checks.
- Front Office may read the unassigned lead pool, but must claim or receive
  assignment before changing sensitive lead workflow, appointments, comments,
  follow-ups, or invoices.
- A Doctor acts only on a scheduled appointment linked to their own active
  Doctor profile. The server derives Doctor identity; a client-supplied Doctor
  identifier is never trusted as identity.
- Referenced Doctors, assignees, treatments, appointments, invoice items, and
  comment targets must belong to the same active branch and parent record.
- Admin, Operations, and Clinical Head require a current `aal2` Supabase Auth
  session. Role changes must not be used to bypass TOTP recovery.
- Server Actions validate all arguments, reload the target record, and
  re-authorize the specific branch, lead, assignment, ownership, and version.
- Browser `anon` and `authenticated` roles have no direct `crm` data path. The
  service-role client remains server-only.

## Mutation and history rules

- Lead creation and its initial activity are one transaction. Pipeline
  transitions recheck state and related-record identity in PostgreSQL.
- `lead_activity` is append-only. It is an audit trail, not an editable notes
  table.
- Comment edits are limited to the author and use optimistic versions. An
  Admin, Operations, or Clinical Head moderator may archive another author's
  accessible comment; Front Office may archive only their own. Every archive
  requires a reason, and immutable before/after history is retained.
- Leads are soft archived by Admin or Operations. Eligible invoices are
  archived by Admin or Operations. Protected clinical records and audit
  histories must not be physically deleted.
- User creation and profile changes are Admin-only and recorded through the
  audited profile-management workflow. The database serializes active-Admin
  changes: a zero-Admin installation may perform the reviewed first promotion,
  but an established environment cannot deactivate, demote, or delete its last
  active Admin.
- Invoice and comment updates use expected versions. A stale writer must reload
  rather than overwrite a concurrent change.
- No role has an ad hoc purge capability. Soft-deleted patient/workflow records
  and immutable histories have no automatic legal-retention purge in this
  release; a future purge requires clinic-owned retention and legal-hold rules
  plus a reviewed design.

## Paid-invoice boundary

Paid invoices are immutable. They cannot be edited, moved back to `sent` or
`draft`, archived, or physically deleted by any role.

This release does not implement refunds, voids, credit notes, payment-gateway
transactions, or accounting reconciliation. A correction performed in an
external accounting or payment system does not automatically reconcile the
CRM. Preserve the paid CRM invoice and follow the clinic's approved external
procedure; never rewrite it with direct SQL.

See the [operations runbook](OPERATIONS.md) for the release checks, first-Admin
bootstrap, privileged TOTP recovery, and paid-invoice operating procedure.
