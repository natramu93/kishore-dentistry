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

### Test accounts (seeded)

| Email | Password | Role | Branches |
|---|---|---|---|
| admin@kishore.dev | Admin@12345 | Admin | all |
| manager.north@kishore.dev | Manager@12345 | Manager | Anna Nagar, T. Nagar |
| manager.south@kishore.dev | Manager@12345 | Manager | Velachery, Adyar, Porur |
| agent.ann@kishore.dev | Agent@12345 | Agent | Anna Nagar |
| agent.multi@kishore.dev | Agent@12345 | Agent | T. Nagar, Velachery |

> Change these passwords (or delete the test users) before going live.

## Architecture

### Authorization — API level, no RLS

- The `crm.*` schema is granted **only** to `service_role`; browser clients hold just the anon key for auth sessions and can read nothing.
- All reads/writes go through `src/data/` — the only place allowed to import the service-role client (`src/data/db.ts`, fenced by an ESLint `no-restricted-imports` rule).
- Every data function takes an `AuthContext` (`{ userId, role, branchIds }` from `src/lib/auth/context.ts`) and applies scoping unconditionally:
  - **Admin** — everything, all branches
  - **Manager** — full lead access at allocated branches; manages doctors there
  - **Agent** — own leads + the unassigned pool at allocated branches
- Mutations re-fetch the target row and authorize against it — client-supplied IDs are never trusted.

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

1. Push this repo to GitHub.
2. Firebase console → App Hosting → *Create backend* → connect the repo, live branch `main`. `apphosting.yaml` is already configured.
3. Store the secret and grant access:
   ```bash
   firebase apphosting:secrets:set supabase-service-role-key
   firebase apphosting:secrets:grantaccess supabase-service-role-key --backend <backend-id>
   ```
4. Add the App Hosting domain in Supabase → Authentication → URL Configuration (Site URL + redirect URLs).
