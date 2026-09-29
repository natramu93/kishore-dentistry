# Isolated dental workflow preview

Run from the repository root after `npm ci`:

```powershell
node node_modules/vite/bin/vite.js --config tests/preview/vite.config.ts
```

Open `http://127.0.0.1:4173`. This renders the real case-sheet and invoice components with synthetic fixtures. All `@/actions/*` imports are replaced by local in-memory mocks. It does not authenticate, connect to Supabase, or write patient records. Submissions display their payload on the page for manual verification. Nothing from this directory is an application route or included in the production Next.js build.

Check phone widths, sticky patient-section navigation, keyboard selection, multi-tooth remarks, empty-form errors, and invoice treatment/teeth/notes without using production data. The synthetic earlier plan includes three teeth with one already treated: continuing it should allow only teeth 26 and 36, require an explicit Completed selection, and retain the source plan ID in the previewed submission.
