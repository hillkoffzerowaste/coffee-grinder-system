# Neon migration verification — 2026-09-04

- Runtime migrated from Supabase SDK to `pg` with Vercel-managed pooling lifecycle.
- Neon `coffee` schema initialized transactionally; pre-existing `neon_auth` untouched.
- Seed result: 139 products, 133 distinct barcode rows, 3 login accounts. Credentials are ignored locally.
- Automated suite: 26 passed, 0 failed. Covers real Neon schema SQL under PGlite, guarded transitions, RLS/direct-write denial, idempotency, Thai-layout scanner, client retry protection, API validation and password hashing.
- TypeScript, ESLint and production Next.js build passed.
- Local production server against live Neon: all 3 logins, catalog, station/admin permissions, malformed-order rejection, logout/session revocation, and cross-origin rejection passed.
- Live Neon transaction: create order, duplicate-key retry, all 5 packing lifecycle transitions and audit insert passed. All test rows rolled back (PostgreSQL sequences can retain gaps).

Remaining operational setup: add actual grinder names; assign missing barcodes to 7 products; implement/configure physical print worker if labels are required; isolate preview database and establish restore/backup retention.
