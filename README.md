# Kishore Dentistry CRM

An internal, multi-branch dental-clinic CRM for lead intake, appointments,
treatments, follow-ups, comments, invoicing, printable invoices, and
role-scoped reporting.

The application handles sensitive clinic data. Do not use real patient data in
development, screenshots, tests, issues, or support requests.

## Stack

- Next.js 16 App Router with TypeScript and React 19
- Supabase Auth and PostgreSQL, using a dedicated `crm` schema
- Server-only data-access layer with resource-level authorization
- Tailwind CSS and accessible UI primitives
- Firebase App Hosting with Google Cloud Secret Manager references

## Local setup

Requirements are Node.js 22, npm 11, and Docker for the local Supabase stack.
The supported versions are recorded in `.nvmrc` and `package.json`.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Fill `.env.local` with credentials from a non-production Supabase project.
Never commit the file or paste its values into terminal output, tickets, or
documentation.

Useful verification commands:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
```

For a clean local database:

```bash
npm run db:start -- -x studio,imgproxy,storage-api,edge-runtime,logflare,vector
npm run db:reset
npm run db:lint
npm run db:test
```

## Supabase project configuration

Use separate development, staging, and production projects.

1. In **Project Settings > Data API**, expose the `crm` schema.
2. Keep public sign-up and anonymous sign-in disabled.
3. Keep the minimum password length at 12 or higher.
4. Confirm `anon` and `authenticated` have no grants or RLS policies on
   `crm.*`. The server-side service role is the only application data path.
5. Apply every numbered migration in `supabase/migrations/` in order. The
   current release requires migrations `0001` through `0012`; apply `0012`
   (`0012_admin_and_history_invariants.sql`) before deploying the application
   revision that depends on its operational safety RPCs and triggers.

The migrations are forward-only. Validate the complete sequence and the SQL
regression suite in staging before production. See
[`docs/OPERATIONS.md`](docs/OPERATIONS.md).

### First Admin bootstrap

New Auth users intentionally receive an inactive Front Office profile. A fresh
installation therefore needs one controlled bootstrap:

1. Configure the exact hosted Auth redirects, production SMTP, and Firebase
   managed secrets described below.
2. Apply all migrations through `0012`.
3. Deploy the matching application revision and verify its liveness, login,
   callback, set-password, and MFA routes.
4. From the trusted Supabase Auth administration interface, send an invitation
   to the individually owned first-Admin address. Do not create or share a
   preset password.
5. In a reviewed SQL transaction, promote and activate the exact generated
   Auth user UUID. Verify that exactly one intended row changed; never select
   the account by a partial name or copy an invitation token into SQL.
   Migration `0012` permits this zero-Admin bootstrap while protecting an
   established environment from losing its last active Admin.
6. The invitee accepts the link, chooses their own password, enrolls TOTP, and
   creates a second independently owned Admin account through the application.
   Confirm that both Admin accounts can complete an `aal2` challenge.

The concrete transaction and rollback checks are in
[`docs/OPERATIONS.md`](docs/OPERATIONS.md). Never add a bootstrap password,
bootstrap user, or reusable invitation link to a migration or seed file.

### Exact authentication redirects

In **Authentication > URL Configuration**, substitute the actual HTTPS origin
for `<production-origin>` and configure:

```text
Site URL: <production-origin>
Additional Redirect URL: <production-origin>/auth/callback
Additional Redirect URL: <production-origin>/auth/set-password
```

Use exact production paths, not wildcard production redirects. Local
development URLs are already represented in `supabase/config.toml`.

The administrator workflow sends invitations to `/auth/set-password`.
Password recovery sends users to `/auth/callback`, which accepts a Supabase
PKCE `code` or a `token_hash` with `type=invite|recovery`, establishes the
session, and redirects internally to the appropriate password page. Successful
password changes sign out all sessions.

For hosted environments, configure a production SMTP provider and verified
sender in Supabase Auth. Test invitation, recovery, expiry, replay, and spam
handling before launch. If custom token-hash email templates are used, they
must point to the exact callback above and include the correct `invite` or
`recovery` type. Disable email-link tracking because link rewriting can break
authentication links. See the official
[Supabase redirect guide](https://supabase.com/docs/guides/auth/redirect-urls)
and
[email-template guide](https://supabase.com/docs/guides/auth/auth-email-templates).

### Privileged TOTP

Admin, Operations, and Clinical Head accounts cannot enter the application
until their current session reaches Supabase Auth assurance level `aal2`.
First use enrolls a TOTP authenticator at `/mfa`; later sign-ins challenge the
verified factor. Front Office and Doctor accounts are not currently forced
through this role-based TOTP policy.

There is no self-service lost-device bypass. Keep at least two separately
owned, active Admin accounts with working TOTP. Factor recovery requires
identity verification, session revocation, administrative factor removal, and
fresh enrollment; never weaken the role policy to recover one account. The
full procedure is in [`docs/OPERATIONS.md`](docs/OPERATIONS.md). See the
official
[Supabase TOTP guide](https://supabase.com/docs/guides/auth/auth-mfa/totp)
for the provider-side enrollment, challenge, and assurance-level model.

## Roles and authorization

| Role | Product scope |
|---|---|
| Admin | Global branches, users, catalogs, workflows, invoices, and reports |
| Operations | Branch-wide business workflows and reports for allocated branches |
| Front Office | Intake and reception; may read assigned leads and the unassigned pool, but must claim a lead before writing |
| Clinical Head | Branch-wide clinical administration, catalog/roster management, workflows, and reports |
| Doctor | Own linked schedule and treatment completion only; no Leads, Follow-ups, Comments, or Invoices module access |

Navigation visibility is not an authorization boundary. Every protected read
and mutation loads a verified `AuthContext`, re-reads the target record, and
applies role, branch, assignment, ownership, and doctor-link scope in
`src/data/`. Important transactional workflows repeat those checks in
PostgreSQL.

See the detailed
[`docs/AUTHORIZATION_MATRIX.md`](docs/AUTHORIZATION_MATRIX.md).

## Data integrity highlights

- Lead transitions, lead creation plus initial activity, invoice writes, and
  comment writes use transactional RPCs.
- Invoice and comment edits use optimistic versions to reject stale writes.
- Leads, eligible invoices, and comments are archived rather than physically
  deleted; audit records are append-only.
- Comment edits retain immutable before/after snapshots and archives require a
  reason.
- Appointment collision checks and trusted doctor attribution are enforced in
  PostgreSQL.
- Dashboard and report aggregates are computed in PostgreSQL with actor scope.
- Server Action limits are durable in PostgreSQL and fail closed.

Paid invoices are intentionally immutable. The CRM does **not** implement a
refund, void, credit-note, payment-gateway, or accounting-reconciliation
workflow. Do not represent a refund by editing, deleting, or moving a paid
invoice backward. Follow the clinic's external accounting procedure until a
reviewed corrective workflow is implemented.

Soft-deleted patient/workflow records and immutable audit, lead-activity, and
comment-history snapshots have no automatic legal-retention purge in this
release. The clinic owner must define jurisdiction-appropriate retention and
legal-hold rules before a reviewed purge process is designed. This repository
does not prescribe a retention period.

## Health and load testing

`GET /api/health` is an exact public, uncached **liveness** endpoint. It proves
that the application process can route a request; it deliberately does not
contact Supabase and is not a database/authentication readiness check.

The load script defaults to that liveness path. Meaningful staging validation
must also target an authenticated read such as `/dashboard` with a temporary,
least-privilege synthetic-user cookie supplied through `LOAD_TEST_COOKIE`.
Never load-test production or record the cookie in shell history or CI logs.
See [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Firebase App Hosting

`apphosting.yaml` contains only managed-secret references:

| Environment variable | Managed secret | Availability |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `supabase-public-url` | Build and runtime |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `supabase-anon-key` | Build and runtime |
| `SUPABASE_SERVICE_ROLE_KEY` | `supabase-service-role-key` | Runtime only |

Although `NEXT_PUBLIC_*` values are browser-visible, keeping them as managed
configuration avoids copying project values into Git. The service-role key is
privileged and must never be available during build or in client code.

Create or rotate each secret through the Firebase CLI prompt, then grant the
App Hosting backend access:

```bash
firebase apphosting:secrets:set <secret-name> --location <region> --project <firebase-project-id>
firebase apphosting:secrets:grantaccess <secret-name> --backend <backend-id> --location <region> --project <firebase-project-id>
```

Do not pass a secret value as a command-line argument; let the CLI prompt for
it or provide it through an approved standard-input secret runner.

App Hosting normally creates a rollout when the reviewed commit reaches the
backend's connected live branch. Apply the reviewed production migrations
first, then merge that exact commit. For an approved manual rollout from a
connected repository, use:

```bash
firebase apphosting:rollouts:create <backend-id> --git_commit <reviewed-commit-id> --project <firebase-project-id>
```

The service-role client is intentionally created lazily because its runtime
secret is unavailable during the App Hosting build. See the official
[App Hosting configuration guide](https://firebase.google.com/docs/app-hosting/configure)
for managed-secret and availability settings and the
[App Hosting rollout guide](https://firebase.google.com/docs/app-hosting/rollouts)
for automatic and manual rollouts.

## Security

Never commit passwords, API keys, invitation/recovery links, production
account lists, patient data, exported cookies, TOTP secrets, or database
backups. Follow [`SECURITY.md`](SECURITY.md) for private reporting and
[`docs/GIT_HISTORY_CLEANUP.md`](docs/GIT_HISTORY_CLEANUP.md) for the required
coordinated cleanup of previously exposed repository history.
