# Verification — 2026-09-04

## Scope

Local automated checks only. No production database or product data was modified.
There is no `.env.local` in this project, so real Supabase login/session behaviour,
physical scanners, printers and multi-client concurrency remain unverified.

## Reproduce

Results: test runner reports 19 passed / 0 failed (including the database parent
test); lint, TypeScript and production build pass. Production HTTP smoke checks
pass for login rendering (200), invalid login payload/JSON rejection (400), and
root redirect. Node emits a non-fatal module-type inference warning for TS imports.

Use Node.js 24, install with `npm ci`, then run:

```
npm test
npm run lint
npm run typecheck
npm run build
```

The test command explicitly names its files: a missing test file now fails instead
of silently reporting zero tests. Tests run the actual SQL migrations in an isolated
PGlite PostgreSQL database. Supabase identity functions and initial table privileges
are emulated. The pgcrypto extension statement is omitted because UUID generation
is built into PostgreSQL. PGlite does not verify simultaneous independent database
sessions or Supabase's hosted Auth/PostgREST/Realtime services.

## Reproduced defects and fixes

- Packing did not claim ownership; another operator could complete the job.
- A NULL expected status bypassed the SQL status comparison.
- Cancellation left pending print jobs active. Pending/failed jobs now cancel;
  in-flight jobs become VERIFY_REQUIRED rather than assuming nothing printed.
- API validation allowed duplicate line IDs and orders exceeding the SQL bag limit.
- Station assignment did not verify compatible roles; invalid configurations could
  redirect between two pages. Guards now reject them and return to login.
- Initial grants could leave TRUNCATE available, which is not protected by RLS.
  Application tables now grant clients SELECT only; writes go through guarded RPCs.
- Added parent-order locking before bag transitions to serialize sibling completion
  checks. Multi-session stress testing is still required on real PostgreSQL.

Corrections are in `supabase/migrations/002_workflow_guards.sql`; apply after 001.
Existing data is preserved. Neither migration has been applied to a live database.

## SKU readiness

`data/sku-coffee-beans-200g-plus.csv` contains 139 unique SKUs, including 7 rows
without a barcode. These are local source records, not live database records.
The migrations do not seed this catalog. Product classification has not been
re-audited against the original workbook during this verification task.

## Local regression checklist (continuous-improvement)

- Trigger: a test command exits successfully. Action: verify non-zero discovered
  tests and explicit critical workflow coverage. Evidence: original command returned
  tests=0; explicit-file regression suite now exercises real SQL. Scope: local.
  Status: validated. Reviewed: 2026-09-04.
- Trigger: an operational phase changes operator ownership. Action: assert both
  successful owner transitions and rejection of another user, plus direct database
  privileges beyond RLS. Evidence: reproducible packing ownership and TRUNCATE
  failures in this task. Scope: local. Status: validated. Reviewed: 2026-09-04.

No global skills, security instructions, or AGENTS.md were changed.
