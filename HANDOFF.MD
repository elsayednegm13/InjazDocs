# HANDOFF.MD — ExportFlow Current-State Handoff & Next-Action Register

> **Later repository note (2026-11-06):** commits after this snapshot added migrations `0005`–`0016`, the server route split, and the UI standardization. The 2026-10-23 test counts below stay historical. They are not a current end-to-end pass or a production approval.
>
> **Snapshot date:** 2026-10-23. **Snapshot kind:** HISTORICAL EVIDENCE SYNTHESIS; not a live scan of the Windows project.  
> **Intended destination:** `I:\WORK\InjazDocs\HANDOFF.MD` (first verify that this is still the actual root).  
> **Mandatory companion:** [`AGANT.MD`](./AGANT.MD) — standing agent charter and frozen commercial contracts.  
> **Next checkpoint:** `ET-2026-10-21-B — Isolated Runtime Integration & Migration Acceptance` is **PROPOSED, NOT AUTHORIZED** by the request to create these handoff files.  
> **Current release posture:** **PARTIAL / LOCAL-ONLY; STAGING NO-GO; PRODUCTION NO-GO; DESIGN OWNER REVIEW PENDING.**

**START HERE (for a new agent):** This is an existing bilingual export-operations platform, not a greenfield app. Read `AGANT.MD` in full, then this document in full. Read the most recent project records and inspect current source **without touching developer state or reading secrets**. Do not execute a proposed phase automatically. A user's request to generate this handoff **does not grant permission** to launch tests, migrations, UI redesign, Git actions, staging or production.

## 00. رسالة تسليم سريعة للوكيل الجديد

**ما هو المشروع؟** ExportFlow / InjazDoc تطبيق عمليات تصدير داخلي باللغة العربية والإنجليزية، يحل محل ملفات Excel المتفرقة لإدارة العملاء، قضايا التصدير (`EF-…`)، الفواتير، المستندات الخاصة وإصداراتها، مسار BANK/DIRECT، البريد المستندي DHL اليدوي، الحجز البحري، فتحات الحاويات وأرقامها الفعلية، الشحن والوصول والتسليم النهائي، التذكيرات، الصلاحيات، والتتبع المحدود للعملاء.

**أين توقفنا؟** أُنجزت إصلاحات D-1/D-2/D-3 مع ترحيل مصدر جديد `0008`، وقدمت أداة الإصلاح نتيجة **53/53 اختبارًا ناجحًا داخل `node:sqlite` مؤقت و`createFakeAuth`**، ونجح TypeScript/Lint. لكن **لم تُشغّل اختبارات Playwright أو Vite أو Worker/Better Auth الحقيقيين بعد التعديلات الأخيرة**؛ ولذلك **لا تعتبر الإصلاحات مقبولة تكامليًا أو جاهزة للإنتاج**. بيئة التطوير وقاعدة بياناتها محمية بشدة بسبب حوادث WAL/SHM سابقة.

**ما البداية التالية المقترحة؟** مراجعة عزل تشغيل Wrangler/Miniflare طوال دورة الحياة من الإنشاء حتى الإغلاق أولًا؛ ثم اختبار `0007→0008` على قاعدة مأهولة اصطناعية منفصلة؛ ثم تكامل Hono/Better Auth/D1 حقيقي محلي مع D-1/D-2/D-3؛ ثم اختبارات الانحدار والأداء. **لكن لا تبدأ ذلك إلا بتفويض صريح مستقل.**

---

## 01. Evidence status / what is fact versus claim

| Evidence class | Meaning | Use in decision |
|---|---|---|
| `OWNER_APPROVED` | Explicit user decision in project history | Binding until explicitly superseded |
| `OBSERVED_TEST_ISOLATED` | Actual reported tests on an isolated synthetic SQLite/fake-auth harness | Strong for harness contracts, not for Worker runtime parity |
| `OBSERVED_SOURCE_REPORTED` | Source reading quoted in dated audit; actual tree not inspected in this chat | Recheck against present files before editing |
| `PRIOR_REPORT` | Older full E2E/test figures, timing, design screenshots | Historical baseline, not current passing verification |
| `CURRENT_ENV_UNVERIFIED` | Facts about the active Windows filesystem/processes that cannot be remotely inspected here | Must measure on entry, safely |
| `BLOCKED/NOT_RUN` | Deliberately not tested to protect existing state | Never convert to PASS |
| `PROPOSED_NOT_APPROVED` | Recommendation without owner authorization | Must not execute |

This handoff was compiled from prior checkpoint reports and the latest **ET-2026-10-21 Controlled Remediation final report**. **It does not imply direct source-code audit or a live test run.** The code/files may have changed since those reports; reconcile first.

### 01.1 Source records to read, if present

1. `docs/transition-2026-10-21/FINAL_CONTROLLED_REMEDIATION_REPORT_AR.md` — most recent, reported `53/53` isolated tests, migration `0008` and no E2E.
2. `docs/transition-2026-10-21/00_SOURCE_READ_LEDGER.md`, `02_ISOLATION_AND_TEST_PROTOCOL.md`, `03_ISOLATED_HARNESS_EVIDENCE.md`, `04_UPGRADE_AND_SCHEMA_READINESS.md`, `05_MIGRATION_0008_AND_ROLLBACK.md`.
3. `docs/transition-2026-10-21/06_IDEMPOTENCY_STATE_MACHINE.md`, `07_REPLAY_AUTHORIZATION_MATRIX.md`, `08_D1_TEST_EVIDENCE.md`.
4. `docs/transition-2026-10-21/09_IMPORT_FINGERPRINT_CONTRACT.md`, `10_D2_TEST_EVIDENCE.md`, `11_AUTH_COMPENSATION_FAULT_MATRIX.md`, `12_D3_TEST_EVIDENCE.md`.
5. `docs/transition-2026-10-21/13_BUSINESS_INVARIANTS_AND_ATOMICITY.md`, `14_SECURITY_AND_TEST_QUALITY_REVIEW.md`, `15_API_CONTRACT_AND_CLIENT_COMPATIBILITY.md`, `16_VISUAL_AND_E2E_BOUNDARY.md`, `17_PERFORMANCE_AND_TRANSPORT.md`, `18_EVIDENCE_INDEX_AND_COMMAND_LEDGER.md`, `19_OWNER_DECISION_REGISTER.md`, `20_CHANGE_SCOPE_ROLLBACK_AND_STOP.md`.
6. `docs/transition-2026-10-21/evidence/vitest.json`, `evidence/remediation-matrix.json`, `evidence/isolation-status.json`, `evidence/protected-{pre,post}.json`, `evidence/source-hashes-{pre,post}.json` — reported generated evidence; inspect with precautions.
7. `docs/transition-2026-10-20/FINAL_ENGINEERING_TRANSITION_REPORT_AR.md` and `docs/transition-2026-10-20/` supporting review: identified confirmed IDEM-F, IMP-B/C, compensation and isolation faults.
8. `docs/SYSTEM_AUDIT_2026-10-20.md` and `docs/ENGINEERING_AUDIT_2026-10-20.md`: previous actual Worker E2E figures `58/58` and `47/47` respectively **before** latest D-1..D-3 changes.
9. `docs/CHECKPOINT_06_7_1_FINAL_REPORT.md`, `docs/CHECKPOINT_06_7_1_VISUAL_REFERENCE_MAPPING.md` if they exist; reference images under `docs/design-references/exportflow-premium-workspace-0671/`.
10. `docs/qa-screenshots/checkpoint-06-7-1/after/`, `docs/audit/2026-10-20/responsive/`, `docs/audit/2026-10-20/skeletons/` — historical visual evidence, **not final owner acceptance**.

**Path caveat:** Source documents above were named in reports; do not assume every path exists exactly as listed. Locate files by read-only filename metadata if necessary and record any mismatch.

---

## 02. Current status dashboard (as of the last submitted report)

| Area | Last reported state | Required next evidence |
|---|---|---|
| D-1 Idempotency fix | `PASS` 18/18 isolated; 30-day witness, 1-hour response, replay reauthorization | Actual Hono + Better Auth + D1 replay matrix, all mutating-route coverage, shutdown/multi-isolate caveat |
| D-2 CSV import identity | `PASS` 13/13 isolated; canonical parsed CSV fingerprint `csv-v1` | Preview→commit parity, old NULL fingerprints, real parser, collisions, D1 concurrency |
| D-3 Auth/Bootstrap compensation | `PASS` 13/13 isolated using **fake auth** | Real Better Auth integration, compensation failure and incident persistence |
| Isolation checks | `PASS` 6/6 within tests without Wrangler/Vite | Process start/shutdown test with *proven* new disposable local state only; no developer DB access |
| Schema readiness | `PASS` 2/2 isolated; <0008 returns 503 | Verify with actual Worker/D1 adapter; no auto migration |
| Smoke | `PASS` 1/1 isolated | Comprehensive Worker test suite |
| TypeScript / lint | Reported zero errors; previous fast-refresh warning | Re-run after validated environment/scope, capture exact command and exit |
| Unit latest | `53/53` **new transition harness**, not the old `34/34` project-wide Vitest suite | Run both relevant suites in correctly isolated/test-only mode |
| Playwright full latest | `BLOCKED_ISOLATION`; **NOT RUN after latest changes** | Real full E2E twice after successful isolation and any final edit |
| Previous Playwright | `58/58` one full run **before D-1..D-3**; another older `47/47` twice | Never quote as post-0008 runtime acceptance |
| Populated `0007→0008` | `NOT_TESTED`; `0001→0008` synthetic harness succeeded | Official migration runner on populated wholly disposable `0007` DB, not developer DB |
| Developer DB | Not explicitly opened in most recent `node:sqlite` harness; path `mtime` changed due to reported external writer | No content equivalence assumed; protect it, verify lifecycle isolation |
| Cloud staging / production | `NOT_RUN / NOT_APPROVED` | Separate owner approvals, resources and preflight |
| Premium visual redesign | Approved visual direction but implementation has unresolved visual fidelity/accessibility | Owner review against two references and actual final screenshots |
| Old reminder Cron / Cairo rules | `OPEN` inherited | Separate remediation and business decision, not part of D-1..D-3 |
| Current release | `NO-GO` | Full hard gates, not just test counts |

### 02.1 Important numeric baseline — do not mix runs

- Last isolated run: **53/53 = D-1 18 + D-2 13 + D-3 13 + isolation 6 + readiness 2 + smoke 1**.
- Before that run: a previous system audit reported **58/58** Playwright E2E and **34/34** unit, with 136/136 overflow measurements; **those are historical**, obtained before latest source changes.
- Latest isolated harness elapsed about 22 seconds; no real Cloudflare/Miniflare load test for D-1..D-3.
- Local performance prior: GET mixed workload about **3.6 RPS** and **p95 ≈27.5 seconds** at concurrency 100 in Miniflare; not a production throughput claim.
- Reported code/bundle sizes varied over checkpoints; use fresh comparable build metrics, never infer performance from raw KB alone.

---

## 03. Project-specific source map / inspect these first

| Module | Last known responsibility | Caution |
|---|---|---|
| `server/http/app.ts` | Hono routes/middleware, schema checks, idempotency, auth endpoints | Route precedence and replay auth; inspect all mutation paths |
| `server/services/idempotency.ts` | Durable effect witness, response TTL, `UNKNOWN`, replay storage | Must not delete committed witness merely on permission updates |
| `server/services/replay-policy.ts` | Authorized replay policies | Missing coverage should fail closed; document UI regression |
| `server/services/import-fingerprint.ts` | CSV canonical parsed content hashing | Frontend preview/backend commit must match |
| `server/services/imports.ts` | Resumable per-row customer import | Prevent duplicate/changed-file resume; partial import semantics |
| `server/services/compensation.ts` | Auth/Bootstrap failure incidents | Real Better Auth compensation can fail or crash |
| `server/services/schema.ts` | Schema readiness check (`0008`) | 503 on old schema; do not migrate automatically |
| `server/services/users.ts` / `server/auth.ts` | RBAC, account creation, sessions | Server-side permissions, last-admin, password-change gate |
| `server/services/customers.ts` | Customers, snapshots and atomic create | Version, historical snapshot and idempotency |
| `server/services/cases.ts` | Cases/invoices + Rule C | HISTORICALLY RECONSTRUCTED_AND_CONTRACT_VERIFIED; never label original recovered |
| `server/services/documents.ts` | Private document versions/reviews | Version-sensitive no-op, bank scan requirements |
| `server/services/bank-courier.ts` | BANK/DIRECT, manual courier state | No bank for DIRECT; no DHL-cargo conflation |
| `server/services/bookings.ts` | Booking, slots/actual containers | No fabricated IDs; `expected_containers` risk open |
| `server/services/reminders.ts` | Rule recomputation, Cron, snooze, repeat | Old large-workload/semantic risks remain open |
| `server/services/tracking.ts` | Public revocable limited tracking | Never expose confidential data |
| `server/services/reports.ts` | Dashboard, CSV and import preview | Scope to actor; preserve CSV formula safety |
| `shared/` | Enums, permissions/contracts | Do not invent CUSTOM_FOLLOWUP behavior |
| `src/lib/api.ts` | API client, retry, request keys | NEVER blind-retry writes after UNKNOWN/EXPIRED |
| `src/lib/idempotency.ts` | Hooks for key and synchronous submit lock | One key per logical user action |
| `src/app/shell.tsx` | Responsive app shell | User specifically wants accurate modern visual fidelity |
| `src/features/` | Forms, dossier, customer and admin pages | Never confuse UI hide with backend permission |
| `src/components/ui/skeleton.tsx` | Skeleton loading | Not proof of Core Web Vitals or screen-reader quality |
| `vite.config.ts`, `scripts/e2e-server.mjs`, `shared/isolation.ts`, `scripts/isolation-guard.mjs` | Vite/Miniflare runtime, isolation | They previously fell back to developer `.wrangler/state` |
| `drizzle/migrations/0001..0008` | Schema evolution | Applied on temporary tests only for latest migration |
| `e2e/`, `tests/transition-2026-10-21/` | Regression and isolated harness | Inspect setup, cleanup and preserved fixtures before running |

---

## 04. Frozen business decision matrix — must remain invariant

| ID | Business behavior | Acceptance check |
|---|---|---|
| B01 | Case ID `EF-…` and immutable customer snapshot at creation | Edit customer; existing case snapshot remains unchanged |
| B02 | FOB/CFR goods, freight and explicit **grand total** | No silent recalculation; a historical `310000 ≠ 250000+50000` CFR example must survive migration |
| B03 | Owner Rule C: completed case invoice lock | Ordinary mutation fails; exceptional correction needs permission, 3–500 char reason, version and immutable before/after revision |
| B04 | BANK vs DIRECT documentary path | Direct never enters bank-only checkpoints |
| B05 | Private versioned PDFs and review | Every review linked to correct actual document version; unauthorized downloads denied |
| B06 | Original paper documents scanned before BANK handoff | Do not skip prerequisite |
| B07 | DHL manual courier != sea cargo state | Courier event never implies cargo delivery |
| B08 | Booking confirmation, booking no, optional UCR | Distinguish tentative vs official values |
| B09 | Planned container slots vs actual ISO numbers | Empty numbers stay empty; independent per-container states |
| B10 | Arrival at destination port != final delivery to client | Backend case-completion gate enforces this |
| B11 | Reminder rules repeat/snooze/ETA generations/ACL | Preserve no duplicates, avoid reset across generations, no email |
| B12 | Public tracking token | Revocable, nonfinancial, no private PDFs or internal details |
| B13 | Dynamic roles, overrides and case scope | Server-side authorization for every sensitive endpoint |
| B14 | Custom fields on five entity families | Definitions/values persist safely |
| B15 | `CUSTOM_FOLLOWUP` | Enum present; behavior **NOT DEFINED**, never invent |
| B16 | CSV partial import/resume | Explicit partial successes allowed, same file identity required |

---

## 05. Current D-1, D-2, D-3 integration acceptance gates

### 05.1 D-1 — Durable witness and authorized replay

**Current reported implementation:** `0008` introduces `response_expires_at`, `outcome_class`, `effect_ref` and an index; witness `expires_at` remains for about **30 days**, response payload about **one hour**, replay policy is checked before returning saved body. Legacy clients without a key remain backward compatible but not protected.

**Required real-integration scenarios** (actual isolated Worker/Hono + D1 + Better Auth, once safe): same-key burst (15), mismatch body/path/query, distinct actor, changed roles/overrides, deactivation, case-scope loss, noop replay for completed invoice correction, expired replay body, witness not expired, expired witness limitation, `IN_PROGRESS→UNKNOWN`, lost response, concurrency across processes if possible, cleanup retention, and **all protected mutating routes**.

**Hard gate:** no second business record for same logical action during witness lifetime; no replay of confidential response without current authorization; missing policy must produce safe failure **without silent second write**. Map every mutating route to actual replay policy or document why excluded; hidden exceptions are unacceptable.

### 05.2 D-2 — Canonical CSV identity

**Current reported implementation:** canonical fingerprint `csv-v1`, NFC, CRLF→LF, trim, canonical headers, preserve row order; new `0008` columns on import operation. `409 IMPORT_FILE_MISMATCH`, `409 IMPORT_FINGERPRINT_MISSING`, `409 IMPORT_ID_CONFLICT` fail closed.

**Required scenarios:** preview and commit same fingerprint; exact replay skips `IMPORTED`; `FAILED` rows recover; changed content/header/row order rejected; legacy null fingerprint safely rejected; two different actors/import IDs do not collide; malformed CSV, alternate encodings, large file bounds; same-import concurrent Worker requests; no row duplication and proper audit.

**Hard gate:** old `importId` cannot silently mix two different CSV files or re-order an in-progress import. Keep partial-resumable behavior and do **not** convert to all-or-nothing without explicit owner decision.

### 05.3 D-3 — Real auth & compensation

**Current reported implementation:** `auth_compensation_incidents` table, compensation checks residual records and records incident on failure; bogus success prohibited; startup and Bootstrap have safety guards. **FakeAuth** was used in recent tests.

**Required scenarios:** malformed payload; role assignment fails after account creation; credential linking fails; compensation itself fails; incident insertion fails; blocked/residual accounts cannot log in or act; Bootstrap secret reset requires verified cleanup; concurrent Bootstraps yield at most one valid first admin; last admin cannot be removed; password change invalidates other sessions; recoverable vs operator-required states are explicit.

**Hard gate:** never leave a usable admin without verified role/permissions; never mark Bootstrap consumed permanently with no valid admin; no secrets in incident logs; no silent success or deletion of unrelated user accounts.

### 05.4 `0008` schema / runtime parity

- Migration `0001→0008` passed an isolated `node:sqlite` harness (reported). **Upgrade populated `0007→0008` remains NOT TESTED** with official local D1 migration runner.
- Build two **new disposable roots**: clean baseline and a populated `0007` snapshot with historical ledger, imports, invoices/revisions, document versions, roles and reminders. Apply only `0008` to the second; verify preservation of old rows/hashes, FK, migration table and idempotent rerun.
- Verify `/api/v1/health/live = 200` while `/api/v1/health = 503` before upgrade, then `/health = 200` **only on upgraded isolated DB**. Application must fail safely on an older schema, never self-migrate.
- Confirm using D1 semantics; `node:sqlite` behavior may differ from Miniflare/Cloudflare D1. Never claim full parity from a shim.

---

## 06. Isolation incident register & blocking operational rule

### 06.1 Historical problems — don't erase

- During the **ET-2026-10-20** inspection, shutdown of a Wrangler/Miniflare sub-process reportedly triggered an SQLite checkpoint affecting the *developer* `.wrangler/state` default path: WAL/SHM disappeared, with total protected path reduction of **197,600 bytes**. This is an access-boundary violation even if business rows were not intentionally queried.
- During the later isolated D-1..D-3 run, the protected directory still reported **44 files totaling 71,907,860 bytes**, but its newest mtime changed `02:01:08→02:16:13`; the report attributes this to a pre-existing foreign writer, not independently proven. **Do not declare logical DB identity based on same size/file count.**
- Older developer main SQLite sizes recorded 638,976 B then 864,256 B at different dates. Causes and logical identity cannot be established without authenticated historical snapshots, and no real DB audit is authorized here.
- Legacy test `.wrangler-e2e` and other historical roots are preserved as evidence; do not delete, overwrite, migrate or use them as scratch.

### 06.2 Mandatory PRE-START GATE for future runtime work

**Do not start Vite/Wrangler/Playwright/Cloudflare Vite build integration unless all conditions are demonstrably true:**

1. Explicit owner authorization specifies the exact work and permits runtime validation.
2. Verify currently running app/build/dev server processes by safe process metadata; **do not kill foreign or pre-existing processes**. Identify whether a daemon already owns the default developer state.
3. Inspect all startup scripts and tool subprocess lifecycle paths including **working directory, `--persist-to`, env overrides, fallback behavior, cleanup and shutdown**. Review `vite.config.ts`, `scripts/e2e-server.mjs`, `playwright.config.ts` and `shared/isolation.ts` before running.
4. Launch only in an **entirely new path under a unique approved disposable root**, with explicit persistence redirection and hard-fail if redirection missing. Prove no reference to `.wrangler/state` even if subprocess crashes.
5. The test harness **must not copy live developer `.dev.vars`**; use synthetic secrets in a bounded disposable file, redacted in reports. Never disclose real secrets.
6. Snapshot **path metadata only**, before and after. Any unexplained mutation of protected files must stop additional testing and be reported as a violation; source attribution needs process evidence.
7. Do not use the old `playwright test` project config blindly; it was previously reported to wipe `.wrangler-e2e` (historical evidence) and may spawn Wrangler defaults.

**If proof is insufficient:** mark `BLOCKED_ISOLATION`, do not run even the 'quick smoke' using these services. Static/source/fake-auth/sqlite tests only if proven safe and separately within scope.

### 06.3 CRITICAL: no auto-clean or repair

- Never alter `.wrangler/state`, its `*.sqlite`, `*-wal`, `*-shm`; do not run `.backup`, SQLite copy, `integrity_check` on real files, or `wrangler d1 migrations` there without a separate specific authorization.
- Never delete or reset old `.wrangler-e2e`, `.wrangler-perf`, `.wrangler-reliability-b`, `.wrangler-transition-audit-*`, screenshots or evidence.
- Do not use `Remove-Item -Recurse .wrangler*`, `git clean`, blanket `taskkill`, `pnpm db:migrate:*`, or 'fix by reset'.
- If runtime encounters `SCHEMA_UPGRADE_REQUIRED`, **stop**, do not apply migration to developer DB.

---

## 07. Minimal safe START commands for Windows PowerShell

**These commands are for future explicitly authorized agents, not permission to execute them now.** Run only after verifying root and not printing secrets.

```powershell
# A. Read-only entry. Verify the directory first.
Set-Location 'I:\WORK\InjazDocs'
Get-Location
Test-Path .\AGANT.MD
Test-Path .\HANDOFF.MD
Get-Content .\AGANT.MD -Encoding UTF8
Get-Content .\HANDOFF.MD -Encoding UTF8

# B. Read-only repository inventory. Do not change branch/HEAD.
git rev-parse --show-toplevel
git status --short
git log -1 --format='%h %s'
git diff --name-status
Get-ChildItem .\drizzle\migrations -File | Select-Object Name

# C. File existence and source reading (not any secret or SQLite file).
Test-Path .\drizzle\migrations\0008*.sql
Test-Path .\server\services\idempotency.ts
Test-Path .\server\services\replay-policy.ts
Test-Path .\server\services\import-fingerprint.ts
Test-Path .\server\services\compensation.ts
Test-Path .\server\services\schema.ts
Get-ChildItem .\docs\transition-2026-10-21 -File | Select-Object Name
```

**PowerShell note:** `Test-Path .\drizzle\migrations\0008*.sql` accepts wildcard paths; exact actual migration filename must be inspected by `Get-ChildItem` before any command references it.

### Bounded static commands — only after confirming authorized scope and side effects

```powershell
# Possible safe checks only after checking tool scripts and paths:
node .\node_modules\typescript\bin\tsc -b --pretty false
node .\node_modules\oxlint\bin\oxlint src server worker shared tests scripts
node .\node_modules\vitest\vitest.mjs run tests/transition-2026-10-21 --reporter=default
```

`tsc -b` can write a local build-info cache. `vitest` may run test setup hooks that touch external state; verify suite isolation first. `pnpm build`, `wrangler dev`, `playwright`, `pnpm db:*`, `pnpm audit --prod` are **not** safe by default. Do not run networked tasks without authorization.

---

## 08. Planned next phase — permission-gated, not already started

**Proposed checkpoint:** `ET-2026-10-21-B — Isolated Runtime Integration & Migration Acceptance`.

### Work order if and only if owner separately authorizes it

| Step | Gate / task | Evidence / stop condition |
|---|---|---|
| 0 | Baseline fresh root, Git dirty files, process owners, approved scope | No implicit branch switch/commit; conflicting modifications ⇒ STOP |
| 1 | Isolation rehearsal with fake temp roots and subprocess teardown | Absolutely no access to `.wrangler/state`; if unproven ⇒ `BLOCKED_ISOLATION` |
| 2 | Verify reproducible `0007→0008` on new populated disposable D1 | FK zero, no data loss, correct legacy ledger/import safe behavior |
| 3 | Real local Hono/Better Auth/D1 integration for D-1 | Every mutation replay policy and permission-scope gate; lost reply and witness expiry |
| 4 | Real local D2 import preview/commit | Fingerprint matches, mismatches denied, legacy imports not silently mixed |
| 5 | Real local D3 auth/bootstrap compensation | Fault injection without production exposure; orphan/incident recovery |
| 6 | Regression suite | TypeScript, lint, old 34 unit tests, new suite, Playwright **twice after last edit**, transport logs and request count |
| 7 | Measured performance and source compatibility | Capture before/after; no claim from fake-auth timing |
| 8 | Verify protected path metadata and diff, produce Arabic report | Explicit GO/PARTIAL/NO-GO per gate; stop, await owner |

**Default scope boundaries:** Tests and findings only; no further speculative product changes. If tests reveal a bug outside explicitly authorized fix list, document impact and seek owner approval. No developer DB migration, remote staging, production work, live secrets, Git commit/push/reset/clean, dependency upgrade or visual redesign.

### Mandatory hard-stop cases

- Any process may fall back to protected developer root, or teardown would checkpoint developer WAL/SHM.
- Needed runtime credentials unavailable except real `.dev.vars`; **do not read them**.
- Failure to create a unique disposable state root.
- Irreversible mutation/unknown rollback needed.
- More than expected file scope or incompatible schema requires owner decision.
- Privileged account/session or customer private document would be exposed in logs.
- Tests are green only after suppressing assertions or disabling security.

---

## 09. Owner decision register / authorization matrix

**Approved and frozen:**

| Decision ID | State | Scope |
|---|---|---|
| O-BUS-01 | `OWNER_APPROVED` | Invoices total explicit, FOB/CFR, Rule C completed invoice correction + audit, customer snapshots |
| O-BUS-02 | `OWNER_APPROVED` | BANK≠DIRECT, scanned original docs, independent DHL manual/cargo tracks, truthful ports/containers/delivery |
| O-BUS-03 | `OWNER_APPROVED` | Configurable scoped reminders without email, revocable public tracking, dynamic RBAC/custom fields |
| O-UI-01 | `OWNER_APPROVED_AS_REFERENCE` | Two premium Arabic RTL workspace mockups as visual direction, limited consistent Lucide icons |
| O-ET-01 | `AUTHORIZED_AND_REPORTED_COMPLETED_LOCAL_ONLY` | D-1/D-2/D-3 coding and isolated verification; **not** release acceptance |
| O-GOV-01 | `STANDING_OWNER_POLICY` | Preservation of developer DB, historical fixtures/evidence; explicit approval per transition; Arabic final report and STOP |

**Not approved / requires specific new approval:**

| Decision ID | State | Why |
|---|---|---|
| D-INT | `PROPOSED_NOT_APPROVED` | Next real isolated runtime integration and `0007→0008` tests |
| D-DB-DEV | `NO-GO` | Any developer `.wrangler/state` database migration/repair/backup/inspection requires separately scoped owner decision |
| D-CLOUD | `NO-GO` | Staging resources, remote D1/R2, actual cloud deployment; each separately authorized |
| D-GIT | `NO-GO` | Commit/push/reset/clean or branch manipulation |
| D-DESIGN-FINAL | `OWNER_PENDING` | Generated reference direction does not equal completed visual approval |
| D-REM-CUSTOM | `UNDEFINED` | `CUSTOM_FOLLOWUP`/new reminder business semantics |
| D-REM-TIME | `UNDECIDED` | Cairo calendar day offset semantics |
| D-PROD | `NO-GO` | No production permission; release gates incomplete |

**IMPORTANT:** User command “ابدأ” in this conversation authorized **creating the agent and handoff Markdown documents**, not the pending integration checkpoint. The next agent must not interpret any proposal in this file as a work order.

---

## 10. Remaining risks / prioritized backlog (do not silently close)

| Priority | ID | Risk | Closest next action |
|---|---|---|---|
| P0 / blocker | R-ISOLATION | Wrangler/Miniflare historically touched developer WAL/SHM; foreign writer unverified | Runtime isolation preflight and crash/shutdown proof |
| P1 | R-REAL-INTEGRATION | D-1/D-2/D-3 green only with fake auth + node sqlite | Actual Hono/Better Auth/D1 integration |
| P1 | R-MIGRATION-0008 | No populated official `0007→0008` proof | New synthetic populated migration arm |
| P1 | R-REPLAY-COVERAGE | Unknown replay policies may fail after successful action | Complete method/path authorization matrix |
| P1 | R-AUTH-COMP | Real compensation, crash and incident storage unknown | Real auth failure-path tests |
| P1 | R-CSV-LEGACY | Old import fingerprints null, historical data cases not checked | Safe legacy behavior, no reassociation |
| P1 | R-CRON | Reminder due-but-unproductive scan and concurrent Worker races | Separate remedial checkpoint, no premature closure |
| P1 | R-TZ | Cairo DST / calendar-offset semantics not approved | Owner business decision first |
| P1 | R-PERF | Old local GET throughput ~3.6 RPS, p95 27.5 s at 100 | Controlled diagnosis; cannot extrapolate cloud |
| P1 | R-CLOUD | No staging, real R2 or D1 remotely verified | Separate owner approval and cloud preflight |
| P2 | R-RATELIMIT | General API rate limit and multi-isolate auth throttle not verified | Scoped AppSec follow-up |
| P2 | R-HEADERS | HTML CSP/HSTS absent as reported | Scoped staging-compatible design/validation |
| P2 | R-BOOKING-SLOTS | `expected_containers` may desynchronize | Business contract review and focused tests |
| P2 | R-COMPAT | Docs/OpenAPI not updated after `0008` | Update in specifically authorized phase |
| P2 | R-CLIENT-OLD | Clients without `Idempotency-Key` remain unprotected | Compatibility + owner contract decision |
| P2 | R-STORAGE | R2 true upload parity and quota unverified | Staging-only permissioned tests |
| P2 | R-UX | Pixel-level premium reference fidelity, mobile alignment, screen reader/200% zoom unapproved | Separate real screenshot comparison |
| P2 | R-TRANSPORT | Old ~320ms local connection workaround not proven as permanent root-cause fix | Isolated apples-to-apples transport/perf test |
| P3 | R-JS-BUNDLE | Old JS ~692 kB raw; no current comparable measurement | Optional performance profiling |
| Business decision | R-CUSTOM-FOLLOWUP | Enum exists without user-approved behavior | Do not implement without owner |
| Release | R-PROD | No production approval | Maintain NO-GO |

**Priority labels reflect risk ranking, not permission to start.** Do not treat older reported 'PASS' for narrow tests as full resolution of a larger issue.

---

## 11. Change-log discipline and update rules for these files

`AGANT.MD` is a **standing charter**, modified only when an owner-approved decision, architecture contract or safety rule actually changes. `HANDOFF.MD` is **living current-state context** and must be updated after every separately authorized checkpoint **only when evidence justifies a factual new state**.

When closing an authorized checkpoint, append an entry with:

```markdown
### YYYY-MM-DD — <checkpoint name>
- AUTHORIZATION: precise owner instruction and excluded scope
- SOURCE/HEAD: root, branch, head, status (dirty count), file-hash evidence
- IMPLEMENTED: exact changed files/behavior/migrations (or NONE)
- VERIFIED: commands, exact environments, pass/fail counts and logs
- DATA ISOLATION: disposable root, protected metadata before/after, access violations
- OPEN RISKS: carried forward, newly discovered, priorities
- OWNER DECISIONS: approved / pending / refused (never infer consent)
- NEXT STAGE: proposed only, prerequisites and STOP
```

Rules:

1. **Never overwrite history to make a checkpoint appear green.** Append a dated correction and evidence instead.
2. If source and these docs conflict, **code reports implementation; owner-approved contracts report intended behavior**. Escalate gaps rather than quietly rewriting requirements.
3. Never paste tokens, passwords, customer names/IDs, full DB copies or private document links into these Markdown files.
4. Label every measurement with test environment, dataset, date and exact scope.
5. Keep project references relative to the verified root when installed; never point an agent to another user's unrelated project.
6. Every final report is Arabic and ends in a clear **STOP — AWAIT OWNER APPROVAL**.

---

## 12. One-page execution handoff — READ THIS WHEN RESUMING

> **TASK STATUS:** User has authorized creation of AGANT.MD and HANDOFF.MD **only**. Nothing in these files authorizes the next code checkpoint.  
> **LAST DONE:** D-1/D-2/D-3 code changed; `0008` SQL added; **53/53 isolated** tests passed; TypeScript/Lint passed; protected developer DB not intentionally opened by that run.  
> **LAST NOT DONE:** full E2E after `0008`, real Better Auth/Hono/D1 integration, populated `0007→0008` with official local migration runner, real R2, staging/production, premium visual acceptance.  
> **FIRST SAFE ACTION AFTER NEW AUTHORIZATION:** read this handoff and AGANT, re-inventory Git/source metadata and active processes, validate fail-closed isolated tool lifecycle without touching protected state.  
> **PROPOSED FOLLOW-UP:** `ET-2026-10-21-B` — **permission-gated**, isolation-first integration proof.  
> **DO NOT:** auto-test via Wrangler, migrate developer DB, use real secrets, kill existing processes, clean Git, deploy, implement undefined business logic, change design or advance to another phase.

**STOP — WAIT FOR EXPLICIT OWNER AUTHORIZATION.**
