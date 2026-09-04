# Coffee Grinder System — Neon

Next.js on Vercel; PostgreSQL on Neon (`neon-bronze-chair`). The application uses only server-side Neon connections; browser database keys are not used.

## Configuration and deployment

1. Connect the Neon integration to the Vercel project and expose `DATABASE_URL` to Production. Preview must use a separate Neon branch before preview mutation tests; never point untrusted previews at production data.
2. For local work, set server-only variables shown in `.env.example`. Do not commit credentials.
3. Run `npm ci`, then `node --env-file=.env.neon.local --import tsx scripts/bootstrap-neon.mjs` with the deployment owner's connection. The bootstrap is transactional, checksum-verified and idempotent. It creates only the `coffee` schema and application roles; it does not alter `neon_auth`.
4. Run `npm test`, `npm run lint`, `npm run build`. Push `main` to trigger Vercel production deployment.

The initial catalog has 143 whole-bean SKUs >=200g, including Thai-labelled red-bag coffee products. Seven products have no barcode in the source; add their barcodes in Admin before scanning. Future products and alternate barcodes are managed in Admin. Add real grinder/operator names in Admin before starting jobs.

## Authentication and database security

Username/password login uses salted scrypt password hashes. Random 256-bit sessions are hashed in Neon, stored in HttpOnly/SameSite cookies (Secure on production), and revoked at logout. Database sessions have no automatic expiry; browser cookies last one year. Disabling a profile blocks existing sessions. Login attempts are limited per username in the database. Generated initial account credentials are stored in ignored `.production-accounts.json`, never in Git or build output.

SQL transactions use transaction-local identity and role, compatible with Neon pooled connections. Ordinary operations run under `coffee_app` with RLS and no direct write privileges; orders/transitions use guarded SQL functions. Admin writes are parameterized and recheck active admin permission within the same transaction. Owner credentials remain server-side. Role choice is not controlled by a browser-supplied user id.

## Operational guarantees and limits

- Numeric barcode strings preserve leading zeros. SKU is separate from barcode.
- Scan product → scan grind → quantity (default 1) → confirm. No brewing method/reason fields.
- Duplicate confirmation/network retry uses an immutable idempotency key; one job per bag.
- FIFO, row locking, expected-state checks and operator ownership guard transitions.
- Packing refreshes via HTTP polling.
- Orders, job events, print requests and audit records commit atomically.
- Print requests are durable, but a physical printer worker is not implemented. Do not assume labels are printed.
- Neon restore retention/backup plan and a separate preview branch must be configured for the business's recovery requirements. Export/test restore before major future schema changes.

This README and `database/migrations` describe the current implementation.
