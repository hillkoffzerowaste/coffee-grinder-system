# Admin Control Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe, versioned Admin control center for operational settings, approved UI customization, order amendments, and daily work/history views.

**Architecture:** Persist Draft and Published configuration snapshots in Neon, validate them with an allowlisted schema, and serve only the currently published configuration to operational screens. Keep scan controls and workflow components locked while allowing configuration of named layout slots, visual tokens, menus, sounds, and operational thresholds. Record amendments and publishing actions as immutable audit events.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Neon/Postgres, Zod, Node test runner, jsdom.

**Spec:** User-approved conversation, 2026-09-06 (no standalone design file by request).

## Global Constraints

- Desktop PWA only; preserve Windows-enterprise visual language.
- No arbitrary HTML, JavaScript, remote URLs, selectors, or unsanitized CSS.
- Scanner input, scanner focus, quantity dialog, start/complete actions, permissions, and API routes are locked blocks.
- Every Admin mutation is admin-only, transactionally audited, and validates payloads before database access.
- UI changes use Draft → Preview → Publish → Rollback; operational screens read Published configuration only.
- Bangkok time (`Asia/Bangkok`) defines daily work and historical date boundaries.
- Orders are editable only while every affected bag is `QUEUED`; active bags may only be cancelled with a non-empty reason; terminal orders are read-only.

---

### Task 1: Versioned safe configuration schema and migration

**Files:**
- Create: `database/migrations/006_admin_control_center.sql`
- Create: `src/lib/ui-config.ts`
- Create: `tests/ui-config.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces `UiConfig`, `parseUiConfig(value)`, `defaultUiConfig`, and `mergeUiConfig(base, patch)`.
- Produces tables `coffee.ui_config_versions` and `coffee.order_amendments`.

- [ ] **Step 1: Write failing schema tests**

```js
assert.equal(parseUiConfig({theme:{accent:'#064f4d'}}).theme.accent,'#064f4d');
assert.throws(()=>parseUiConfig({customCss:'body{display:none}'}));
assert.throws(()=>parseUiConfig({menus:[{href:'https://foreign.example'}]}));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/ui-config.test.mjs`

Expected: FAIL because `ui-config.ts` is absent.

- [ ] **Step 3: Add migration and allowlisted Zod schema**

```ts
export const uiConfigSchema=z.object({
  theme:z.object({accent:z.string().regex(/^#[0-9a-f]{6}$/i),density:z.enum(['compact','comfortable'])}),
  menus:z.array(z.object({id:z.enum(['counter','packing','admin']),visible:z.boolean(),label:z.string().min(1).max(40),order:z.int().min(0).max(20)})),
  layouts:z.record(z.enum(['counter','packing']),z.object({main:z.enum(['left','center','wide']),detail:z.enum(['right','bottom','hidden'])})),
  sounds:z.object({queue:z.enum(['chime','pulse','alert']),overdue:z.enum(['chime','pulse','alert']),sla:z.enum(['chime','pulse','alert']),volume:z.number().min(0).max(1)}),
  operations:z.object({slaGrams:z.int().min(1).max(5000),slaSeconds:z.int().min(1).max(3600),overdueSeconds:z.int().min(30).max(3600)})
}).strict();
```

Create version/status/audit constraints and seed one `PUBLISHED` snapshot equal to `defaultUiConfig`; grant table access only through the existing role model.

- [ ] **Step 4: Run focused tests**

Run: `node --import tsx --test tests/ui-config.test.mjs tests/database.test.mjs`

Expected: PASS, including rejected unsafe config.

- [ ] **Step 5: Commit**

```bash
git add database/migrations/006_admin_control_center.sql src/lib/ui-config.ts tests/ui-config.test.mjs package.json
git commit -m "Add safe versioned UI configuration"
```

### Task 2: Draft, preview, publish, rollback APIs

**Files:**
- Create: `src/app/api/admin/config/route.ts`
- Create: `src/app/api/admin/config/[id]/publish/route.ts`
- Create: `src/app/api/admin/config/[id]/rollback/route.ts`
- Create: `src/app/api/config/route.ts`
- Modify: `tests/api-regressions.test.mjs`
- Modify: `tests/auth-neon.test.mjs`

**Interfaces:**
- Admin API accepts validated `UiConfig`; public authenticated API returns `{version,config}` from exactly one Published version.
- Publish transaction archives prior Published config, promotes one Draft, and inserts an audit event.

- [ ] **Step 1: Write failing endpoint contract tests**

```js
assert.equal(await postAsCounter('/api/admin/config',validConfig),403);
assert.equal(await postAsAdmin('/api/admin/config',validConfig),201);
assert.equal(await postAsAdmin(`/api/admin/config/${draftId}/publish`,{}),200);
assert.deepEqual((await getAsPacker('/api/config')).config,validConfig);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/api-regressions.test.mjs tests/auth-neon.test.mjs`

Expected: FAIL because configuration routes do not exist.

- [ ] **Step 3: Implement transactional routes**

Use `requireApiUser(['admin'])`, `transaction(...,profile.id,true)`, `parseUiConfig`, SQL row locking, and audit records with actions `CONFIG_DRAFT`, `CONFIG_PUBLISH`, and `CONFIG_ROLLBACK`. `GET /api/config` reads only the Published snapshot and sends no secret fields.

- [ ] **Step 4: Run focused tests**

Run: `node --import tsx --test tests/api-regressions.test.mjs tests/auth-neon.test.mjs tests/ui-config.test.mjs`

Expected: PASS for permission, atomic publish, rollback, and unsafe-payload rejection.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/config src/app/api/config tests/api-regressions.test.mjs tests/auth-neon.test.mjs
git commit -m "Add draft publish and rollback configuration APIs"
```

### Task 3: Published runtime configuration and protected operational layouts

**Files:**
- Create: `src/lib/use-ui-config.ts`
- Create: `src/components/app-menu.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/components/topbar.tsx`
- Modify: `src/components/counter-workspace.tsx`
- Modify: `src/components/packing-workspace.tsx`
- Modify: `src/lib/use-sounds.ts`
- Modify: `src/lib/use-queue-alarm.ts`
- Modify: `tests/client-regressions.test.mjs`

**Interfaces:**
- `useUiConfig()` returns the last valid Published configuration and applies it only when no scanner dialog/request is active.
- `AppMenu` renders only allowlisted route IDs in configured order.

- [ ] **Step 1: Write failing client tests**

```js
assert.equal(document.documentElement.style.getPropertyValue('--accent'),'#123456');
assert.ok(document.body.textContent.includes('ห้องบด'));
assert.equal(document.getElementById('scan').disabled,false);
assert.equal(document.querySelector('script[src]'),null);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/client-regressions.test.mjs`

Expected: FAIL because published config is not consumed by components.

- [ ] **Step 3: Implement safe runtime application**

Apply only CSS custom properties from the schema, add known layout classes, and render menu definitions from route IDs. Keep scanner, dialogs, status panels, and actions in mandatory DOM slots. Map the three internal sound IDs to Web Audio tone patterns; never fetch remote media.

- [ ] **Step 4: Run focused tests**

Run: `node --import tsx --test tests/client-regressions.test.mjs tests/scanner-search.test.mjs`

Expected: PASS with scanner focus and sound behavior unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/lib/use-ui-config.ts src/components/app-menu.tsx src/components src/app/globals.css tests/client-regressions.test.mjs
git commit -m "Apply published safe UI configuration"
```

### Task 4: Daily work and searchable historical data

**Files:**
- Create: `src/app/api/work/my-day/route.ts`
- Create: `src/app/api/work/history/route.ts`
- Create: `src/components/my-day-work.tsx`
- Modify: `src/components/counter-workspace.tsx`
- Modify: `src/components/packing-workspace.tsx`
- Modify: `tests/search-api.test.mjs`
- Modify: `tests/client-regressions.test.mjs`

**Interfaces:**
- Counter view returns orders where `created_by=current_profile` and Bangkok calendar date equals today.
- Packing view returns bags where `grinder_user_id=current_profile` and Bangkok date of `started_at` equals today.
- History accepts validated `from`, `to`, `query`, `status`, and `operator` filters.

- [ ] **Step 1: Write failing SQL/API tests**

```js
assert.deepEqual((await getAsCounter('/api/work/my-day')).orders.map(x=>x.order_no),['HK-TODAY']);
assert.deepEqual((await getAsPacker('/api/work/my-day')).batches.map(x=>x.batch_id),[todayBatch]);
assert.equal((await getAsAdmin('/api/work/history?from=2026-09-01&to=2026-09-02&q=RB-HK')).items.length,1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/search-api.test.mjs tests/client-regressions.test.mjs`

Expected: FAIL because daily/history endpoints are absent.

- [ ] **Step 3: Implement Bangkok-bounded queries and panels**

Use `created_at AT TIME ZONE 'Asia/Bangkok'` and `started_at AT TIME ZONE 'Asia/Bangkok'`; limit history results, bind every search parameter, and paginate. Render “ออเดอร์ของฉันวันนี้” for counter and “งานของฉันวันนี้” for packing above historical search; completed old work remains searchable, not active.

- [ ] **Step 4: Run focused tests**

Run: `node --import tsx --test tests/search-api.test.mjs tests/client-regressions.test.mjs`

Expected: PASS across midnight boundary, user isolation, and history filters.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/work src/components/my-day-work.tsx src/components tests/search-api.test.mjs tests/client-regressions.test.mjs
git commit -m "Add daily work and searchable history"
```

### Task 5: Safe order amendment and cancellation workflow

**Files:**
- Create: `src/app/api/admin/orders/[id]/route.ts`
- Create: `src/components/order-admin-actions.tsx`
- Modify: `database/migrations/006_admin_control_center.sql`
- Modify: `src/components/order-monitor.tsx`
- Modify: `tests/scan-batch.test.mjs`
- Modify: `tests/client-regressions.test.mjs`

**Interfaces:**
- `PATCH /api/admin/orders/:id` accepts `{reason,lines,expectedVersion}` only when every affected bag is `QUEUED`.
- `POST /api/admin/orders/:id/cancel` accepts `{reason,expectedVersion}` and only cancels non-terminal bags through a transaction.

- [ ] **Step 1: Write failing amendment tests**

```js
await assert.rejects(()=>amend(activeOrder,{reason:'แก้จำนวน',lines}),/only QUEUED/i);
const result=await amend(queuedOrder,{reason:'ลูกค้าเปลี่ยนจำนวน',lines:replacement});
assert.equal(result.total_bags,3);
assert.equal((await auditFor(queuedOrder)).action,'ORDER_AMEND');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/scan-batch.test.mjs tests/client-regressions.test.mjs`

Expected: FAIL because amendment endpoint and immutable amendment history do not exist.

- [ ] **Step 3: Implement guarded SQL and Admin UI**

Lock order/bags, verify `expectedVersion`, reject terminal/active edits, rebuild queued bags and print jobs from validated replacement lines, and persist before/after snapshots plus reason. Cancellation calls an admin-only SQL operation that cancels remaining non-terminal bags, updates order status, and records reason without deleting historical rows.

- [ ] **Step 4: Run focused tests**

Run: `node --import tsx --test tests/scan-batch.test.mjs tests/client-regressions.test.mjs tests/database.test.mjs`

Expected: PASS for queued amendment, active cancellation, terminal immutability, stale-version rejection, and audit history.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/orders src/components/order-admin-actions.tsx database/migrations/006_admin_control_center.sql tests
git commit -m "Add audited order amendment and cancellation"
```

### Task 6: Admin control-center UI and release verification

**Files:**
- Modify: `src/components/admin-console.tsx`
- Modify: `src/app/admin/page.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/client-regressions.test.mjs`
- Modify: `tests/layout-regressions.mjs`

**Interfaces:**
- Admin console exposes Config, Preview, Version history, Daily/history, and Order actions without exposing raw executable content.

- [ ] **Step 1: Write failing UI tests**

```js
assert.ok(document.body.textContent.includes('Preview'));
assert.ok(document.body.textContent.includes('Publish'));
assert.equal([...document.querySelectorAll('textarea')].length,0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/client-regressions.test.mjs`

Expected: FAIL because the control-center tabs do not exist.

- [ ] **Step 3: Implement Windows-enterprise control center**

Add tabbed configuration forms, preview panel, publish/rollback confirmation, version list, and order action dialogs. Use select/range/color inputs only for schema-backed values; require explicit reason plus confirmation for cancellation and amendment.

- [ ] **Step 4: Run complete verification**

Run: `npm test && npm run test:layout && npm run lint && npm run typecheck && npm run build && npm audit --omit=dev --json`

Expected: all tests pass, desktop layouts remain intact, production build succeeds, and no production dependency vulnerabilities are reported.

- [ ] **Step 5: Commit and push**

```bash
git add src tests database package.json
git commit -m "Add safe admin control center"
git push origin main
```

## Self-review

- Spec coverage: Tasks 1–3 implement safe Draft/Preview/Publish configuration, menus, layout, sounds and SLA; Task 4 implements daily work/history; Task 5 implements order amendment/cancellation; Task 6 completes Admin UX and verification.
- Placeholder scan: no deferred work or unspecified validation paths remain.
- Type consistency: `UiConfig` is the sole configuration contract; all admin routes use it and operational views consume Published config only.
