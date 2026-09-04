# Complete after grinding implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish every bag when grinding is completed, show actionable queue age at sales, and prioritize scanable grind barcodes on both operational screens.

**Architecture:** A versioned SQL migration retires packaging transitions while preserving legacy records and emits auditable completion events. API summaries provide queue-age facts, while React components render those facts and use a barcode-first responsive layout.

**Tech Stack:** Next.js 16, React 19, TypeScript, Neon Postgres SQL, Node test runner, JSDOM.

**Spec:** `docs/superpowers/specs/2026-09-04-complete-after-grinding-design.md`

## Global Constraints

- New lifecycle is exactly `QUEUED → CLAIMED → GRINDING → COMPLETED`.
- Legacy `GROUND` and `PACKING` bags become `COMPLETED` with preserved history, an event, and an audit record.
- Sales warning threshold is strictly more than one minute for `QUEUED` bags.
- Packing audio repeats while, and only while, global queued count is greater than zero.
- The five scanable grind barcodes are visible without a scroll container at the top of Counter and Packing workspaces.

---

### Task 1: Retire packaging transitions safely

**Files:**
- Create: `database/migrations/004_complete_after_grinding.sql`
- Modify: `src/lib/validation.ts`, `src/lib/job-status.ts`, `src/components/packing-workspace.tsx`, `src/app/api/jobs/route.ts`
- Test: `tests/database.test.mjs`, `tests/validation.test.mjs`

**Interfaces:** Produces only `GRINDING → COMPLETED`; `GET /api/jobs` does not return obsolete active statuses.

- [ ] Write tests proving `GRINDING → COMPLETED` sets both timestamps, completes an all-terminal order, rejects new `GRINDING → GROUND`, and migration completes legacy `GROUND`/`PACKING` records with events.
- [ ] Run `node --import tsx --test tests/database.test.mjs tests/validation.test.mjs`; observe failure against current lifecycle.
- [ ] Create migration that replaces `coffee.transition_bag`, permits `('GRINDING','COMPLETED')`, sets `ground_at` and `completed_at`, and one-time migrates legacy active records using a valid admin profile, events, outbox events, audit log, and parent-order reconciliation.
- [ ] Remove GROUND/PACKING from accepted transition payloads, labels, next actions, and active job query.
- [ ] Re-run the focused tests; then commit with `git add database/migrations/004_complete_after_grinding.sql src/lib/validation.ts src/lib/job-status.ts src/components/packing-workspace.tsx src/app/api/jobs/route.ts tests/database.test.mjs tests/validation.test.mjs && git commit -m "Complete jobs when grinding ends"`.

### Task 2: Expose sales queue age and warning state

**Files:**
- Modify: `src/app/api/orders/route.ts`, `src/components/order-monitor.tsx`
- Test: `tests/api-regressions.test.mjs`, `tests/client-regressions.test.mjs`

**Interfaces:** Every order summary returns `queued_bags`, `active_bags`, `completed_bags`, `oldest_queued_at`, `overdue_queued_bags`; `OrderMonitor` displays whole waiting minutes and warning if overdue count is positive.

- [ ] Write focused API/component tests for queue summary fields and an open order with a queued bag older than 60 seconds showing a warning and wait minutes.
- [ ] Run the focused tests and observe the missing fields/UI failure.
- [ ] Aggregate bag statuses and oldest queued time in `/api/orders`; update OrderMonitor summary type and render clear counts, longest queued minutes, and a `.notice.error` warning containing the overdue count.
- [ ] Re-run focused tests and commit with `git add src/app/api/orders/route.ts src/components/order-monitor.tsx tests/api-regressions.test.mjs tests/client-regressions.test.mjs && git commit -m "Show queue aging alerts at sales"`.

### Task 3: Make barcode scanning primary on both stations

**Files:**
- Modify: `src/components/counter-workspace.tsx`, `src/components/packing-workspace.tsx`, `src/components/grind-barcodes.tsx`, `src/app/globals.css`
- Test: `tests/client-regressions.test.mjs`

**Interfaces:** `GrindBarcodes` renders the five configured numeric codes in a non-scrolling responsive grid; each workspace places it before secondary controls/data.

- [ ] Write client regressions asserting Counter and Packing render five barcode SVGs before secondary tables, barcode panel is not constrained by `max-height`/overflow scrolling, and packing states that the alarm continues until unclaimed count is zero.
- [ ] Run `node --import tsx --test tests/client-regressions.test.mjs`; observe failure.
- [ ] Move barcode panels to the first operational area in both workspaces; make barcode grid five equal responsive columns on desktop, non-scrolling; keep table/status/product controls below. Preserve scanner focus after every interaction.
- [ ] Re-run the focused test and commit with `git add src/components/counter-workspace.tsx src/components/packing-workspace.tsx src/components/grind-barcodes.tsx src/app/globals.css tests/client-regressions.test.mjs && git commit -m "Prioritize visible grind barcodes"`.

### Task 4: Full verification and live migration

**Files:** no production changes expected.

- [ ] Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.
- [ ] Pull only `DATABASE_URL` and `DATABASE_URL_UNPOOLED` with Neon CLI into ignored `.env.neon.local`, then run `node --env-file=.env.neon.local scripts/bootstrap-neon.mjs`.
- [ ] Query live database through the direct URL without logging credentials: confirm no `GROUND`/`PACKING` bags remain and no queued alarm condition exists when queued count is zero.
- [ ] Review the full branch diff, commit any verification-only documentation required, then push `main`.
