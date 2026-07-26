# Security policy

This repository contains an internal healthcare CRM. Treat patient and clinic
data, authentication material, and operational metadata as sensitive.

Do not open a public issue with credentials, patient data, production project
identifiers, database exports, cookies, TOTP material, invitation/recovery
links, or detailed exploit steps.

## Private reporting

Report a suspected vulnerability or exposure privately to the repository owner
or the clinic's established security contact. If no private reporting address
is configured, use a previously verified private channel to reach the owner;
do not create a public issue to ask for one.

Include:

- the affected application revision and environment;
- the observed impact and UTC time range;
- the smallest reproduction that uses synthetic data;
- relevant request or event identifiers; and
- whether credentials or patient records may have been accessed.

Do not include live secret values, complete patient records, reusable sessions,
or one-time authentication links. Coordinate transfer of sensitive evidence
through the organization's approved restricted channel.

## Data and secret handling

- Never commit or upload passwords, API keys, service-role credentials,
  session cookies, TOTP seeds or QR codes, invitation/recovery links, production
  account lists, patient exports, screenshots containing patient data, or
  database backups.
- Use synthetic patient records in development, tests, demos, issues, and load
  tests.
- Keep development, staging, recovery, and production isolated. Production
  data must not be restored into ordinary development or staging.
- Store Firebase App Hosting configuration as managed-secret references.
  `SUPABASE_SERVICE_ROLE_KEY` is runtime-only and must remain in server code.
- Although the Supabase URL and anonymous key are browser-visible, keep their
  project-specific values out of documentation and Git.
- Treat invitation and recovery URLs as passwords until they are consumed or
  expired.
- Do not log passwords, tokens, cookies, TOTP material, authentication email
  links, full request bodies, or unrestricted patient records.

## Deployed access baseline

- Public signup and anonymous sign-in remain disabled.
- Accounts are individually invited and choose their own password.
- Admin, Operations, and Clinical Head sessions must reach Supabase Auth
  assurance level `aal2` with TOTP.
- Browser `anon` and `authenticated` roles have no direct grants or policies on
  `crm` data; the service-role data client is server-only.
- Server-side authorization rechecks role, branch, assignment, ownership,
  Doctor linkage, and record state. Hidden navigation is not a security
  boundary.
- `/api/health` is public liveness only and must not query or disclose patient,
  Auth, or database state.

See the
[authorization matrix](docs/AUTHORIZATION_MATRIX.md)
for product access policy and the
[operations runbook](docs/OPERATIONS.md)
for deployment, backup, recovery, and monitoring procedures.

## Credential or authentication exposure

Containment must precede repository cleanup:

1. Assign an incident owner and restrict the affected application, account,
   deployment, or repository access.
2. Inventory the affected credential names and owners without reproducing
   their values.
3. Rotate each exposed credential at its source. Update the corresponding
   Firebase managed-secret version and backend grant, deploy a reviewed
   revision, and confirm the old value is rejected.
4. Revoke all sessions for affected users. If the scope is uncertain or a
   privileged server credential was disclosed, revoke all application user
   sessions and require fresh sign-in.
5. Reset affected passwords through the normal one-time recovery flow. Remove
   and freshly enroll any exposed TOTP factor. Invalidate invitation/recovery
   links where supported or contain the account until they expire.
6. Review authentication, administrative, export, mutation, deletion,
   deployment, and database logs. Preserve evidence in restricted storage.
7. Remove the material from the current tree, build and CI output, artifacts,
   caches under the organization's control, and deployed configuration.
8. Only after rotation, old-value rejection, and session revocation, perform
   the coordinated
   [Git history rewrite](docs/GIT_HISTORY_CLEANUP.md).
9. Validate the repaired environment and continue monitoring before restoring
   normal access.

Cleaning Git is not a substitute for credential rotation or session
revocation.

## Patient-data exposure

1. Restrict the affected workflow while preserving volatile evidence.
2. Identify the environment, UTC time range, actors, roles, actions, and record
   categories involved. Avoid making additional unrestricted exports.
3. Preserve relevant Auth, application, database, deployment, and access logs
   in restricted storage with an evidence owner.
4. Correct the access path with a reviewed change and verify each affected role
   and branch boundary using synthetic records.
5. Have the clinic's authorized privacy, security, and legal owners determine
   notification, documentation, and retention obligations for the applicable
   jurisdiction. This repository does not define those obligations.

Do not delete audit evidence, soft-deleted records, or backups during an active
investigation or legal hold.

## Privileged TOTP recovery

There is no self-service lost-device bypass. Recovery for an Admin, Operations,
or Clinical Head requires out-of-band identity verification, a second
authorized reviewer, session revocation, removal of only the lost factor from a
trusted Supabase Auth administration interface, and fresh enrollment. If
compromise is possible, deactivate the application profile until the verified
user is ready to enroll again.

Never recover access by weakening the TOTP policy, assigning a temporary
non-privileged role, sharing another account, or asking for a TOTP seed. Follow
the complete, auditable procedure in the
[operations runbook](docs/OPERATIONS.md).

## Record integrity and retention boundary

Paid invoices are immutable, but this release does not implement refunds,
voids, credit notes, payment-gateway settlement, or accounting reconciliation.
Do not use direct database changes to imitate any of those workflows.

Soft-deleted patient/workflow records and immutable audit, lead-activity, and
comment-history snapshots have no automatic legal-retention purge in this
release. The clinic owner must define jurisdiction-appropriate retention,
legal-hold, approval, evidence, and deletion rules before a purge is designed.
Do not infer a retention period from this repository, and do not add an ad hoc
purge job or manually delete protected history.

## Dependency and release security

Run the full application checks, high-severity dependency audit, database
reset/lint/tests, and repository secret scan before release. Apply migrations
to staging first and deploy the exact reviewed revision. The dependency
compatibility override documented in `docs/OPERATIONS.md` must remain narrowly
scoped and should be removed when the upstream lint dependency tree supports
the patched API directly.
