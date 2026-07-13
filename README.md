# Kishore Dentistry CRM

Multi-branch dental clinic CRM: lead pipeline, appointments, treatments, invoicing (print-to-PDF), follow-ups, per-stage comments, and a role-scoped dashboard.

**Stack:** Next.js 16 (App Router, TypeScript) · Supabase (Postgres + Auth, dedicated `crm` schema, **no RLS** — authorization is enforced in the server data layer) · Tailwind + shadcn/ui · Firebase App Hosting.

---

## ⚠️ Two one-time setup steps (required before the app works)

1. **Expose the `crm` schema to the API**
   Supabase Dashboard → Project Settings → **Data API** → *Exposed schemas* → add `crm`.
   Without this, every page fails with `PGRST106: Invalid schema: crm`.
   (Safe: `anon`/`authenticated` roles have zero grants on `crm` — only the service-role key can read it. Verified: anon requests return permission errors.)

2. **Set the service-role key**
   Supabase Dashboard → Project Settings → **API Keys** → copy the `service_role` secret into `.env.local`:
   ```
   SUPABASE_SERVICE_ROLE_KEY=eyJ...
   ```

Also recommended: Supabase Dashboard → Authentication → Sign In / Up → **disable public sign-ups** (this is an internal tool; admins create users in-app).

## Run locally

```bash
npm install
npm run dev
```

### Roles

| Role | Scope |
|---|---|
| **Admin** | Everything — branches, users, catalogs, all leads/appointments/invoices/reports |
| **Operations** | Runs the business side of their branches: full lead/appointment/invoice/follow-up access, reports |
| **Front Office** | Reception/intake: creates leads, books appointments, works own leads + the open pool, raises invoices — no deletes |
| **Clinical Head** | Owns the treatment catalog + doctor roster; branch-wide lead/pipeline access like Operations; clinical reports |
| **Doctor** | Self-scoped to their own schedule only (linked via `crm.doctors.profile_id`) — marks their appointments treated/no-show and logs treatment notes; never touches Leads/Follow-ups/Invoices |

### Accounts

| Email | Password | Role | Branches |
|---|---|---|---|
| admin@kishor.dev | Admin@12345 | Admin | all |
| che.head@kishor.dev | Kishor@2026 | Operations | all Chennai branches |
| blr.head@kishor.dev | Kishor@2026 | Operations | Bangalore |
| clinical.head@kishor.dev | Kishor@2026 | Clinical Head | all branches |
| reception1@kishor.dev | Kishor@2026 | Front Office | all Chennai branches |
| reception2@kishor.dev | Kishor@2026 | Front Office | all Chennai branches |
| doctor.meena@kishor.dev | Kishor@2026 | Doctor (linked to Dr. Meena Krishnan) | Chennai |
| doctor.ravi@kishor.dev | Kishor@2026 | Doctor (linked to Dr. Ravi Shankar) | Chennai |
| manager.north@kishor.dev | Manager@12345 | Operations | Anna Nagar area |
| manager.south@kishor.dev | Manager@12345 | Operations | Velachery area |
| agent.ann@kishor.dev | Agent@12345 | Front Office | Chennai |
| agent.multi@kishor.dev | Agent@12345 | Front Office | Chennai |

> Change these passwords before going live. New users' temp password is `Kishor@2026`.

## Architecture

### Authorization — API level, no RLS

- The `crm.*` schema is granted **only** to `service_role`; browser clients hold just the anon key for auth sessions and can read nothing.
- All reads/writes go through `src/data/` — the only place allowed to import the service-role client (`src/data/db.ts`, fenced by an ESLint `no-restricted-imports` rule).
- Every data function takes an `AuthContext` (`{ userId, role, branchIds, doctorId }` from `src/lib/auth/context.ts`) and applies scoping unconditionally — see the Roles table above for what each of the five roles can do.
- Mutations re-fetch the target row and authorize against it — client-supplied IDs are never trusted.
- `/reports` (Admin/Operations/Clinical Head) breaks down leads, appointments, follow-ups, and revenue by doctor, center, day, and treatment type.

### Lead pipeline

`open → assigned → appointment_booked → visited_treated → follow_up → closed`, with terminal `dropped` (from any active state) and `missed` (no-show). The transition map lives in `src/lib/leads/transitions.ts` and is mirrored by a DB trigger (defense in depth). Compound moves (book appointment + change status) run atomically via the `crm.transition_lead` RPC.

- Booking an appointment captures date/time (IST), doctor, duration.
- Marking visited/treated records the treatment (type, doctor, cost) and completes the appointment.
- "Raise invoice" on a treatment prefills the invoice editor; numbers are per-branch (`ANN-2026-0001`) via the `crm.next_invoice_number` RPC. Print/PDF at `/invoices/[id]/print`.
- Comments can be added at the bottom of the lead page **and** on every appointment / treatment / follow-up / invoice card.

### Scaling branches

Admin → Branches → *New branch*. Users, doctors, and leads attach to it immediately; nothing else to configure.

### Migrations

SQL sources live in `supabase/migrations/` and have been applied to the hosted project (`mgjdpszrjbkmxfvzzoqp`). Keep future schema changes as new numbered files.

## Deploy (Firebase App Hosting)

Live at **https://kishore-crm--kishore-dentistry-crm.asia-east1.hosted.app**. App Hosting builds from local source — no GitHub connection required:

```bash
firebase deploy --only apphosting --project kishore-dentistry-crm
```

One-time setup already done for this project (for reference if standing up a new one):
1. `firebase apphosting:backends:create --backend <name> --primary-region asia-east1 --non-interactive` (App Hosting isn't available in `asia-south1`).
2. Store the secret and grant access:
   ```bash
   firebase apphosting:secrets:set supabase-service-role-key
   firebase apphosting:secrets:grantaccess supabase-service-role-key --backend <backend-id>
   ```
3. `firebase.json` needs an `apphosting` block (`backendId`, `rootDir: "."`) — don't put `"supabase"` in its `ignore` list, it also matches `src/lib/supabase/` and breaks the build.
4. The service-role client must be lazily constructed (see `src/data/db.ts`) — the RUNTIME-only secret isn't present during the Cloud Build step.
