# Operations runbook

This runbook covers environment setup, releases, routine maintenance, account
recovery, and incident containment for the Dr. Kishor's Dentistry CRM. Production
changes require a named operator, a reviewer, a recorded application revision,
and a recorded migration list.

## Operating principles

- Maintain separate development, staging, and production Supabase projects and
  Firebase App Hosting backends.
- Do not copy production patient data into development or ordinary staging.
  Use synthetic records. A production restore exercise belongs in an isolated,
  access-controlled recovery environment.
- Keep public signup and anonymous sign-in disabled. Provision accounts
  individually with expiring invitations.
- Give each person an individual account. Never share passwords, TOTP seeds,
  sessions, or recovery links.
- Keep all `crm` data inaccessible to browser Supabase roles. The server-side
  service role is the application's only data path.
- Treat migrations as forward-only. Correct a production migration with a new,
  reviewed migration rather than editing a migration that has already run.

## Managed Firebase secrets

`apphosting.yaml` contains managed-secret references, not project values:

| Environment variable | Managed secret | Availability |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `supabase-public-url` | Build and runtime |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `supabase-anon-key` | Build and runtime |
| `SUPABASE_SERVICE_ROLE_KEY` | `supabase-service-role-key` | Runtime only |

The two `NEXT_PUBLIC_*` values are intentionally browser-visible, but they
still belong in managed configuration so project identifiers are not copied
through source control. `SUPABASE_SERVICE_ROLE_KEY` is privileged. It must
never be exposed during a build, imported by client code, or printed in logs.

Create or rotate a secret through the Firebase CLI's interactive prompt, then
grant only the intended App Hosting backend access:

```bash
firebase apphosting:secrets:set <secret-name> --location <region> --project <firebase-project-id>
firebase apphosting:secrets:grantaccess <secret-name> --backend <backend-id> --location <region> --project <firebase-project-id>
```

Do not place the secret value on the command line, in an environment file
committed to Git, or in a ticket. Let the CLI prompt for it or provide it
through an approved standard-input secret runner. After creating a new secret
version:

1. Verify the intended backend identity has access.
2. Deploy a new application revision that resolves the managed-secret version.
3. Exercise authentication and a scoped database read in staging, then
   production.
4. Revoke the replaced credential at its source when the provider does not
   revoke it automatically.
5. Confirm the old value is rejected and review access logs.

If any credential may have been disclosed, follow the
[security policy](../SECURITY.md). Credential rotation and session revocation
happen before any Git history rewrite.

## Supabase Auth configuration

### Exact production URLs

In **Authentication > URL Configuration**, replace `<production-origin>` with
the single canonical HTTPS origin and configure:

```text
Site URL: <production-origin>
Additional Redirect URL: <production-origin>/auth/callback
Additional Redirect URL: <production-origin>/auth/set-password
```

Do not add wildcard production redirects. Do not add an alternate scheme,
hostname, or preview origin unless it is a separately reviewed environment.
The password pages reached after callback are internal relative redirects and
do not need additional Supabase allowlist entries.

The exact localhost callback and set-password paths are recorded in
`supabase/config.toml`. Keep hosted settings aligned with that file for signup,
password length, refresh-token rotation, and TOTP, while substituting the
hosted origins.

### SMTP and authentication email links

Configure a production SMTP provider and a verified sender domain in Supabase
Auth. Publish and validate the provider's SPF, DKIM, and DMARC records. Disable
click tracking or other link rewriting for authentication mail because it can
invalidate one-time links. Never log or retain an invitation or recovery URL.

The application supports both Supabase email-link modes:

- With the standard Supabase confirmation link, keep
  `{{ .ConfirmationURL }}` in the email. Admin-created invitations already set
  their trusted redirect to `/auth/set-password`; recovery requests set their
  trusted redirect to `/auth/callback`.
- With a direct token-hash template, send the user to the exact callback:

  ```text
  {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite
  {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery
  ```

Do not combine a confirmation URL and a token hash in one link. The callback
accepts an eligible PKCE `code`, or a `token_hash` with exactly `invite` or
`recovery`. It establishes a session and uses a relative `303` redirect:

```text
invite   -> /auth/set-password
recovery -> /reset-password
```

Successful password creation or recovery attempts a global sign-out so prior
sessions cannot continue. Before launch and after changing templates, test:

1. a new invitation and user-chosen password;
2. password recovery without account-enumerating responses;
3. an expired link;
4. replay of an already consumed link;
5. malformed and wrong-type token hashes;
6. delivery, spam handling, and rendering on a small mobile screen.

Do all tests with synthetic staging accounts. The official
[Supabase email-template guide](https://supabase.com/docs/guides/auth/auth-email-templates)
and
[redirect URL guide](https://supabase.com/docs/guides/auth/redirect-urls)
describe the provider-side settings.

### Privileged TOTP policy

Admin, Operations, and Clinical Head accounts must reach assurance level
`aal2` before entering the application. Hosted Supabase Auth must allow TOTP
enrollment and verification. Test both first-time enrollment and subsequent
challenge after every Auth configuration change. See the official
[Supabase TOTP guide](https://supabase.com/docs/guides/auth/auth-mfa/totp).

Front Office and Doctor are not currently forced through the role-based TOTP
policy. Do not temporarily change a privileged user to either role as an MFA
recovery mechanism.

Keep at least two separately owned active Admin accounts, each with an
independent TOTP authenticator. Never retain QR codes or TOTP seeds for another
person.

## First Admin bootstrap

An invited Auth user receives an inactive Front Office profile. A new
installation therefore needs one controlled, one-time promotion. Migration
`20260726070825_admin_and_history_invariants.sql` deliberately permits
promotion from a zero-Admin state, then prevents an established environment
from losing its last active Admin.

1. Configure and verify the exact hosted Auth redirects, SMTP sender and
   templates, hosted TOTP settings, and Firebase managed secrets described
   above.
2. Apply every migration through version `20260726070825`.
3. Deploy the matching application revision. Verify its liveness, login,
   callback, set-password, and MFA routes before generating a live invitation.
4. From the trusted Supabase Auth administration interface, invite the
   individually owned first-Admin email address. Do not create a preset
   password.
5. Copy the exact Auth user UUID from the trusted administration interface.
   Independently verify the address and UUID with the reviewer.
6. Run the reviewed owner transaction below with the placeholder replaced by
   that exact UUID. Commit only if the security-state query returns zero active
   Admins, the profile query returns the intended inactive Front Office
   profile, the `UPDATE ... RETURNING` output contains exactly that one row,
   and the final query returns an audit ID:

   ```sql
   begin;

   select active_admin_count
   from crm.security_state
   where id = 1
   for update;

   select id, email, role, is_active
   from crm.profiles
   where id = '<exact-auth-user-uuid>'::uuid
   for update;

   update crm.profiles
   set role = 'admin',
       is_active = true
   where id = '<exact-auth-user-uuid>'::uuid
     and role = 'front_office'
     and is_active = false
   returning id, email, role, is_active;

   select crm.record_profile_admin_audit(
     '<exact-auth-user-uuid>'::uuid,
     '<exact-auth-user-uuid>'::uuid,
     'updated',
     jsonb_build_object(
       'role', 'front_office',
       'is_active', false,
       'branch_ids', jsonb_build_array(),
       'doctor_id', null
     ),
     jsonb_build_object(
       'role', 'admin',
       'is_active', true,
       'branch_ids', jsonb_build_array(),
       'doctor_id', null,
       'changed_fields', jsonb_build_array('role', 'is_active')
     )
   );

   -- Review every result. Use ROLLBACK on any unexpected value or row count.
   commit;
   ```

7. Record the operator, reviewer, UTC time, exact UUID, and result in the
   protected change log. Do not record the invitation URL.
8. The invitee opens the invitation, chooses their own password, enrolls TOTP
   at `/mfa`, and confirms that their session reaches `aal2`.
9. Through the application, create a second independently owned Admin and
   verify that account's TOTP before ending the bootstrap window.

If any identity, row state, result count, or environment is unexpected, roll
back and investigate. Never add a bootstrap account, password, or reusable
invitation to a seed or migration. After bootstrap, use the application's
audited Admin user-management workflow rather than direct profile updates.
The bootstrap uses the newly active Admin profile as the PII-free audit actor;
the protected operational change record identifies the human operator and
reviewer without copying the invitation link.

## Migration order

Apply every timestamped migration in order. Later hardening intentionally
supersedes some early schema behavior; that does not make an earlier migration
optional. The timestamp prefix is the migration identity compared with the
hosted `supabase_migrations.schema_migrations` ledger.

| Migration | Purpose |
|---|---|
| `20260706110302_crm_schema.sql` | Creates the `crm` schema, grants lockdown, core enums, and core tables |
| `20260706110357_crm_functions_triggers.sql` | Adds profile creation, timestamps, workflow rules, and initial RPCs |
| `20260706110415_crm_seed_reference_data.sql` | Adds baseline reference data |
| `20260706131215_cascade_deletes.sql` | Establishes historical foreign-key behavior later constrained by hardening |
| `20260706132931_dental_reference_data.sql` | Expands the dental catalog, lead sources, and treatment-interest link |
| `20260713082604_roles_and_doctor_link.sql` | Adds the current five role values |
| `20260713082605_role_migration_and_doctor_profile_link.sql` | Migrates legacy roles and links Doctor logins to roster records |
| `20260726070821_data_integrity_hardening.sql` | Adds current defaults, cross-record validation, audit history, soft deletion, appointment collision protection, and transactional invoice rules |
| `20260726070822_transaction_and_rate_limit.sql` | Makes lead creation atomic and adds durable PostgreSQL action limits with bounded pruning |
| `20260726070823_report_aggregates.sql` | Moves scoped dashboard and report aggregates into PostgreSQL |
| `20260726070824_comment_history.sql` | Adds optimistic comment versions, soft archives, and immutable before/after history |
| `20260726070825_admin_and_history_invariants.sql` | Serializes last-active-Admin protection, makes lead activity append-only, rejects clinical hard deletion, and adds audited Admin profile-mutation support |

### One-time legacy production ledger alignment

The original production project recorded the first five migrations with their
timestamp versions, but the role-model migrations were applied before they
were recorded in the migration ledger. Before the first release from this
timestamp-aligned repository:

1. Create and verify the production backup and capture the output of
   `supabase migration list --linked`.
2. Confirm the remote ledger contains the five `20260706...` versions in the
   table above and no later version.
3. Independently confirm that the `operations`, `front_office`,
   `clinical_head`, and `doctor` enum values and `crm.doctors.profile_id`
   already exist.
4. Mark `20260713082604` and then `20260713082605` as applied with separate
   `supabase migration repair --linked --status applied <version>` commands,
   checking the migration list after each command. These repairs update the
   ledger only; they must not execute the already-present SQL again.
5. Run `supabase db push --linked --dry-run`. Stop unless it lists exactly
   versions `20260726070821` through `20260726070825`, in order.

Never use `--include-all` to work around a ledger mismatch. If any schema
fingerprint or version differs, stop and reconcile the environment before
changing production.

Version `20260726070825` must be live before the application revision that
relies on those invariants and audit functions. Validate a clean reset through
that version, database lint, and SQL tests before applying it to staging.

## Release procedure

### Development and staging

1. Start from the exact revision proposed for release. Confirm the working tree
   contains no credentials, patient data, database exports, session cookies,
   TOTP material, or invitation/recovery links.
2. Run the repository secret scan and dependency review.
3. Install from the lockfile and run the full application checks:

   ```bash
   npm ci
   npm run check
   npm audit --audit-level=high
   ```

4. Rebuild a disposable local database from all migrations:

   ```bash
   npm run db:start -- -x studio,imgproxy,storage-api,edge-runtime,logflare,vector
   npm run db:reset
   npm run db:lint
   npm run db:test
   ```

5. Back up staging, record its current migration state, and apply the pending
   migrations without resetting the hosted project.
6. Deploy the exact candidate revision to the staging backend.
7. Exercise at least:

   - invite, set-password, recovery, expiry, and replay behavior;
   - privileged TOTP enrollment and challenge;
   - every role and branch-scope boundary in the
     [authorization matrix](AUTHORIZATION_MATRIX.md);
   - appointment collision and Doctor ownership rules;
   - comment edit conflicts, history, and reasoned archive;
   - non-paid invoice editing/archive and paid-invoice immutability;
   - liveness plus an authenticated dashboard/database read;
   - durable action limiting and maintenance pruning.

8. Run the approved authenticated load check described below. Record request
   count, concurrency, failures, p50, p95, p99, application resource use, and
   database connection use.
9. Record reviewer approval for the revision, migrations, evidence, and known
   limitations.

### Production

1. Pause unrelated deployments and database maintenance.
2. Confirm the managed secrets and backend grants resolve without printing
   their values.
3. Create or confirm a recent encrypted production backup. Record its UTC
   timestamp, retention, restore owner, application revision, and migration
   state.
4. Apply the exact migrations already tested in staging. For this release,
   apply through version `20260726070825` before deploying the matching
   application revision.
5. Create the App Hosting rollout for the exact reviewed commit:

   - In the normal Git-connected flow, merge that commit into the backend's
     configured live branch only after the migrations are complete; App Hosting
     creates the rollout automatically.
   - For an approved manual rollout from the connected repository, run:

     ```bash
     firebase apphosting:rollouts:create <backend-id> --git_commit <reviewed-commit-id> --project <firebase-project-id>
     ```

6. Verify `/api/health`, sign-in, privileged MFA, a least-privilege dashboard,
   branch scoping, appointment scheduling, comment history, invoice
   creation/printing, and paid-invoice rejection.
7. Watch authentication, application, and database errors, latency, instance
   utilization, connection use, rate-limit rejections, and unexpected
   privilege changes through the agreed observation window.
8. Record completion or begin containment. Never improvise a destructive
   database rollback.

See the official
[Firebase App Hosting rollout guide](https://firebase.google.com/docs/app-hosting/rollouts)
for the current connected-branch and manual rollout workflows.

## Health checks

`GET /api/health` is an exact, public, uncached liveness endpoint. It verifies
only that the application process can route an HTTP request. It deliberately
does not contact Supabase and must not be treated as authentication, database,
SMTP, or application readiness.

There is no public readiness endpoint. Readiness monitoring should combine:

- the liveness check;
- an authenticated synthetic-user request to a scoped read such as
  `/dashboard`;
- provider-side Supabase database/Auth status and App Hosting metrics; and
- periodic synthetic invitation/recovery tests in staging.

Do not place a service-role key or patient data in a monitoring probe.

## Authenticated load testing

The bundled load script sends same-origin `GET` requests, does not follow
redirects, uses a 10-second request timeout, and fails if any response is not
successful. Its defaults are 20 concurrent workers, 200 requests, and
`/api/health`.

| Variable | Meaning |
|---|---|
| `LOAD_TEST_URL` | Required approved local or staging origin |
| `LOAD_TEST_PATH` | Same-origin absolute path; defaults to `/api/health` |
| `LOAD_TEST_COOKIE` | Optional complete `Cookie` header value |
| `LOAD_TEST_CONCURRENCY` | Integer from 1 to 100; defaults to 20 |
| `LOAD_TEST_REQUESTS` | Integer from 1 to 10,000; defaults to 200 |

A default `/api/health` run measures only process liveness. To exercise Auth,
server rendering, authorization, and PostgreSQL:

1. Use an approved staging window, never production.
2. Create a synthetic, least-privilege user with synthetic records.
3. Establish a short-lived session. Inject the complete cookie value through
   the CI secret store or approved secret runner as `LOAD_TEST_COOKIE`. Include
   every chunk when the Supabase session is split across cookies, separated by
   semicolons, without a `Cookie:` prefix.
4. Run an authenticated read such as:

   ```bash
   LOAD_TEST_URL=<staging-origin> LOAD_TEST_PATH=/dashboard npm run load:test
   ```

5. Treat a login redirect as a failed test; do not change the script to follow
   it.
6. Revoke the synthetic session and remove the temporary account/records under
   the approved test-data procedure.

Never paste the cookie into the command itself, shell history, CI logs, a
screen recording, or this repository. Increase concurrency gradually and stop
if errors, latency, connections, or resource use breach the staging guardrail.

## Durable rate-limit maintenance

Server Action limits use `crm.action_rate_limits`, so enforcement is shared
across application instances. Each request deletes expired rows for its actor
and performs a bounded global prune of 100 expired rows.

Configure a trusted scheduled database maintenance job to run the
service-role-only bounded function:

```sql
select crm.prune_action_rate_limits(10000);
```

The accepted batch is 1 through 10,000. Record the returned delete count. If it
repeatedly equals the batch size, run additional bounded batches and
investigate scheduler health or abusive traffic. Monitor expired-row backlog,
table/index size, execution time, and rate-limit rejection volume. Never grant
this function to browser roles or expose it as a public maintenance endpoint.

## Backup and restore

- Keep encrypted, access-controlled database backups on a schedule consistent
  with the clinic's recorded recovery-point objective (RPO).
- Record a recovery-time objective (RTO), backup retention, owner, and the
  provider features in use.
- Confirm a current backup before every production schema change.
- Periodically restore into an isolated recovery project. Do not use the
  ordinary staging project for a production-data restore.
- Verify Auth/profile linkage, branch allocations, leads, appointments,
  treatments, follow-ups, invoices and items, comments and comment history,
  lead activity, profile-admin audit events, and migration state.
- Prove that paid invoices and append-only histories retain their protections
  after restore.
- Destroy the recovery project and its copied patient data under the approved
  retention procedure after evidence is recorded.

A backup is not considered usable until a timed restore exercise has passed.

## Data retention and legal hold

This release has no automatic legal-retention purge for soft-deleted
patient/workflow data or for immutable audit, lead-activity, and comment-history
snapshots. Soft archive is a product integrity control, not a complete
retention program.

Before any purge capability is designed, the clinic owner must define the
jurisdiction-appropriate record categories, retention and legal-hold rules,
approval roles, evidence requirements, backup treatment, and deletion
verification. Do not infer a retention period from application timestamps or
this repository. Do not add a scheduled purge, delete protected history, or
purge backups ad hoc.

## Privileged TOTP recovery

There is no self-service lost-device bypass. Use this procedure for Admin,
Operations, or Clinical Head accounts:

1. Open a security case without including patient data, session cookies,
   recovery links, QR codes, or TOTP seeds.
2. Have an authorized person verify the user's identity out of band. Require a
   second Admin or designated security reviewer to approve the recovery.
3. If compromise is possible, deactivate the application profile immediately.
   Keep another independently owned Admin available so this does not remove the
   last active Admin.
4. Revoke all sessions for the affected Auth user. If the password may be
   compromised, use the normal one-time password-recovery flow as well.
5. From a trusted Supabase Auth administration interface or Admin API, remove
   only the lost TOTP factor. Never ask the user to disclose an existing TOTP
   seed or code history.
6. When the verified user is present and ready, reactivate the profile if it
   was deactivated.
7. The user signs in, is forced to `/mfa`, enrolls a new authenticator, and
   completes a challenge. Confirm the new session is `aal2` before allowing
   privileged work.
8. Review authentication and privileged activity around the incident. Record
   approvers, UTC times, factor identifier, session revocation, password action,
   reactivation, and successful `aal2` verification without recording secrets.

Never bypass recovery by disabling the privileged TOTP policy, changing the
user to a non-privileged role, sharing another Admin account, or creating a
reusable recovery credential.

## Paid-invoice operational boundary

`draft` invoices may advance to `sent` or `paid`; `sent` may advance to
`paid`. A paid invoice cannot be edited, moved backward, archived, or
physically deleted.

The CRM does not implement refunds, voids, credit notes, payment-gateway
transactions, or accounting reconciliation. Marking an invoice paid is an
internal status change, not proof of settlement from a payment provider. If a
paid invoice is wrong or money must be returned:

1. preserve the CRM invoice unchanged;
2. follow the clinic's separately approved accounting and payment procedure;
3. record the external correction in the authorized accounting system; and
4. do not issue direct SQL to make the CRM appear reconciled.

Do not claim that this release supports a refund or corrective invoice
workflow. Implementing one requires a reviewed product, accounting, audit, and
data-migration design.

## Rollback and containment

Database migrations are forward-only. If the application revision is faulty
but the additive migration is safe, restore the previously reviewed
application revision and leave the migration in place. In App Hosting, use a
reviewed earlier rollout only if its built configuration references credentials
that are still valid. If current managed-secret versions are required, rebuild
the earlier reviewed commit as a new rollout instead of restoring an image
that may contain revoked configuration.

If a release may corrupt or expose data:

1. restrict application access or stop the affected workflow;
2. preserve logs and volatile evidence;
3. revoke affected sessions and rotate exposed credentials;
4. restore the previous safe application revision when compatible;
5. write and stage-test a forward corrective migration; and
6. restore from backup only under the incident plan when forward repair cannot
   preserve correctness.

Do not reverse production schema changes with ad hoc `DROP`, `DELETE`,
history-table updates, or edits to an already-applied migration.

## Dependency compatibility note

`package.json` temporarily overrides `brace-expansion` to a patched 5.x
release. Its CommonJS export differs from the legacy version still required by
Next's ESLint dependency path, so `postinstall` applies a narrow compatibility
change to minimatch 3. Keep the change covered by CI and remove both the
override and compatibility script when the upstream lint dependency tree
supports the patched API directly.

## Monitoring and incident evidence

Alert on repeated login failures, MFA recovery, privileged profile changes,
bulk reads or exports, unusual invoice status changes, rejected destructive
actions, database/RPC errors, rate-limit spikes, and sustained latency,
connection, memory, or instance pressure.

Never log passwords, TOTP material, tokens, cookies, complete request bodies,
full patient records, or authentication email links. Incident records should
capture the timeline, affected identities and records, evidence sources,
containment, rotations, session revocations, remediation, validation, and
required notifications without reproducing sensitive values.
