# ExportFlow — read this first

Updated: 2026-10-16. Local product only. No Git repository. No Cloudflare staging resources.

## Why it exists

One exporting company tracks commercial documents, paper originals (bank route or direct courier), vessel bookings, and container slots. Staff need the next action, not a generic CRM. Customers may open a revocable public link. There is no tenant model, no payment gateway, and no live carrier API.

## Run locally

From `I:\WORK\InjazDocs` (the folder is `InjazDocs`, not `Injaz Docs`):

```
corepack pnpm install
corepack pnpm db:migrate:local
corepack pnpm dev
```

App: `http://127.0.0.1:43173`. First admin uses `/login` plus `BOOTSTRAP_SECRET` from `.dev.vars` (names only; never copy values into docs). `pnpm` may be unavailable on PATH; `corepack pnpm` works with Node 24.

## Architecture in one paragraph

React 19 + Vite 7 SPA, Hono `/api/v1` on a Cloudflare Worker, Better Auth HttpOnly cookies, D1 for rows, private R2 for file bytes. Domain SQL is in `server/services`. Shared enums and money/weight helpers are in `shared/`. Playwright uses port `43174` and deletes only `.wrangler-e2e` before migrate. Developer state under `.wrangler` must not be wiped.

## Primary modules

| Area | Path |
| --- | --- |
| HTTP | `server/http/app.ts`, `worker/index.ts` |
| Cases / invoices | `server/services/cases.ts` |
| Customers | `server/services/customers.ts` |
| Documents, bank, courier | `server/services/documents.ts`, `bank-courier.ts` |
| Bookings / containers | `server/services/bookings.ts` |
| Custom fields | `server/domain/custom-fields.ts`, `server/services/custom-fields.ts` |
| Reminders | `server/domain/reminders.ts`, `server/services/reminders.ts` |
| Public tracking | `server/services/tracking.ts` |
| UI | `src/features/**`, `src/locales/ar.json`, `src/locales/en.json` |

## Safe tests

```
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm test:e2e
```

E2E is isolated. Do not point it at `.wrangler/state` or a remote D1.

## Last safe checkpoint

Checkpoint 03 stayed local-only and staging-blocked. This handoff run restored an empty `server/services/cases.ts` from the last production bundle and finished typed custom fields for customer, export case, invoice, booking, and container. See `docs/NEW_AGENT_FINAL_REPORT.md`.

### Checkpoint 04 continuation (2026-10-13)

`cases.ts` provenance is `RECONSTRUCTED_AND_CONTRACT_VERIFIED`. The compiled bundle used for recovery was overwritten by a later local build, so historical byte identity is not proven. `pnpm build` now strips copied `.dev.vars` from `dist/` and fails if a prohibited file or a configured secret value remains. Do not deploy `dist/` from before that gate. Details: `docs/CHECKPOINT_04_FINAL_REPORT.md`. Staging, production, and design signoff remain unapproved.

### Checkpoint 05 continuation (2026-10-14)

Unset `repeat_every_days` now sends one in-app notice per reminder instance. The Vite build drops `.dev.vars` from the bundle before it is written; the artifact guard remains. Invoice edits after completion are unchanged pending an owner decision. See `docs/CHECKPOINT_05_FINAL_REPORT.md`.

### Checkpoint 06 continuation (2026-10-14)

Invoice rule C is implemented for isolated E2E only. Migration `drizzle/migrations/0004_invoice_revisions.sql` was not applied to developer `.wrangler`. The full Playwright run was 29 passed and 3 failed, exit 1. Visual work covers the shell and dashboard, not every screen. Report: `docs/CHECKPOINT_06_FINAL_REPORT.md`.

### Checkpoint 06.1 continuation (2026-10-14)

Setting `hmr: false` under `CI` turned Vite's error overlay back on (`overlay !== false` when HMR is not an object). The click blocker was `vite-error-overlay` after Miniflare `fetch failed`, not a missing customer field. Current E2E config keeps `hmr: { overlay: false }` and disables file watch when `CI=1`. Two later full Playwright runs were 32 passed, exit 0. At that time the note said developer D1 had no `invoice_revisions` table. The screen set is not fully redesigned. Report: `docs/CHECKPOINT_06_1_FINAL_REPORT.md`.

### Checkpoint 06.2 continuation (2026-10-14)

Local result is PARTIAL. Completed-invoice correction, including custom fields, revision, and audit, is one D1 batch on isolated E2E. A read-only look at developer `.wrangler/state` found `0004_invoice_revisions.sql` already recorded in `d1_migrations` at `2026-10-14 19:35:55`. This continuation did not run a migration. Playwright: one full run 29 passed / 3 failed / exit 1, then two consecutive runs 32 passed / exit 0 (ended `2026-10-14T20:51:45Z` and `2026-10-14T21:06:25Z`). `fetch failed` is an undici `ECONNRESET` to workerd and remains ENVIRONMENT_RISK_OPEN. Owner design signoff is PENDING. Report: `docs/CHECKPOINT_06_2_FINAL_REPORT.md`.

### Checkpoint 06.3 continuation (2026-10-16)

Local result is PARTIAL. Product source was not changed. `scripts/checkpoint-06-3-probe.mjs` records anonymized timings. On an empty isolated database, warm dashboard full reloads were about 1.0–1.7 s and in-app links about 100 ms. A `React.lazy` split was slower on the warm rerun and was reverted. `fetch failed` is still the Vite → Miniflare → undici hop; both Playwright runs on this date were 32 passed, exit 0, and each logged that error four times. Authenticated `vite preview` was not measured. Developer `.wrangler/state` was not written (mtime `2026-10-14T21:07:38.480Z`). Report: `docs/CHECKPOINT_06_3_FINAL_REPORT.md`.

### Checkpoint 06.4 continuation (2026-10-16)

Local result is PARTIAL. A disposable `.wrangler-perf` store held 10, 100, and 500 synthetic export cases. Dashboard client median stayed about 200 ms from 10 cases to 500. Case detail on 500 cases moved from 411 ms to 261 ms after independent reads were sent in one D1 batch. Anonymous public tracking had been answered 401 by the session middleware; the route is now registered first and returns 410 for an unknown token. `ECONNRESET` (`TypeError` → `Error:ECONNRESET`) was captured on sign-in and on one built-preview case read; it is still open and needs an owner decision before any Vite plugin upgrade. Authenticated `vite preview` on the 500-case store measured dashboard reload p50 421 ms. Developer D1 mtime stayed `2026-10-14T21:07:38.480Z`. Two Playwright runs were 32 passed, exit 0, and each still logged `fetch failed` four times. Report: `docs/CHECKPOINT_06_4_FINAL_REPORT.md`.

### Checkpoint 06.5 continuation (2026-10-16)

Local result is PARTIAL. Officer dashboard counts were global (500) while the case list was 250; `overview` in `server/services/reports.ts` now applies case visibility. Admin totals stayed 500. A disposable sandbox measured `@cloudflare/vite-plugin` 1.64.0 (Miniflare `5.20261012.0-beta`) and did not justify installing it. `fetch failed` still occurs on `dispatchFetch`. Two Playwright runs on port 43174 were 31 passed / 1 failed / exit 1; both failed `E2E-15` on a 150s timeout. An earlier run exited 1 because `EXPORTFLOW_PORT` was still 43180. Developer D1 mtime stayed `2026-10-14T21:07:38.480Z`. Tailwind Plus assets are not in the workspace. Design approval was not granted. Report: `docs/CHECKPOINT_06_5_FINAL_REPORT.md`.

### Checkpoint 06.5.1 continuation (2026-10-16)

Local result is PARTIAL. `ECONNRESET` on `miniflare.dispatchFetch` was captured again and is still open; short Arm A vs standalone Worker reads both had zero resets, so that comparison is LIMITED. Saving the document-not-ready reminder rule on 500 synthetic cases took 537447 ms and the Node client hit a headers timeout; a batched update of that rule family now returns 200 in 453 ms. Two later full Playwright runs were 32 passed, exit 0, in 10.1 min and 11.4 min, with 4 and 5 `ECONNRESET` lines. Developer D1 mtime stayed `2026-10-14T21:07:38.480Z`. Report: `docs/CHECKPOINT_06_5_1_FINAL_REPORT.md`.

### Checkpoint 06.5.2 continuation (2026-10-16)

Local result is PARTIAL. Saving the document-review reminder rule on the disposable 500-case store dropped from 220528 ms to about 1.2 s, and the other seeded families now use the same batch path. `ECONNRESET` before Hono is still open: two Playwright runs were 32 passed, exit 0, with 6 and 4 Vite `fetch failed` lines. An isolated Worker arm completed a real browser sign-in and a 1950-request authenticated loop with 0 resets; that mix is not the Playwright suite, so the architecture comparison stays inconclusive. Developer D1 mtime stayed `2026-10-14T21:07:38.4798993Z`. Report: `docs/CHECKPOINT_06_5_2_FINAL_REPORT.md`.

### Checkpoint 06.5.3 continuation (2026-10-17)

Local result is PARTIAL. Serial JSON POSTs through the canonical Vite plugin were alternating `ECONNRESET` before Hono (6 of 12). The local workerd pool now closes after one request and the next body request waits 320 ms; it does not retry the failed call. Two later full Playwright runs were 32 passed, exit 0, in 14.7 min and 13.4 min, with 741 and 739 Hono entries and 0 `ECONNRESET`. Seeded reminder-rule saves are one D1 batch: a poisoned batch left the courier offset unchanged, and review/document batches of 602 and 202 statements returned 200. Cron delivery advanced 100 then 100 notifications (100→200→300) instead of repeating the same 100. A matched long Arm B run was not executed. Developer D1 mtime stayed `2026-10-14T21:07:38.4798993Z`. Report: `docs/CHECKPOINT_06_5_3_FINAL_REPORT.md`. Do not start Checkpoint 06.6 or 07.

### Checkpoint 06.5.4 continuation (2026-10-17)

Local result is PARTIAL. The 320 ms local body gate stayed in place: 20 serial and 8 queued JSON POSTs had zero resets, and Playwright run 2 logged 749 handler entries with zero `ECONNRESET`. Run 1 was 32/32 exit 0 with zero fault strings, but handler entries were not traced. Reminder saves now require the caller's prior field snapshot and return 409 `REMINDER_STALE` on conflict; a lost confirmation returns 503 after the row has changed and the client does not retry. Active deliverable reminders on the copied 500-case store went from 1250 eligible / 900 deliveries to 0 eligible / 2150 deliveries with zero duplicate cycles. Later ticks still scanned 100 rows and delivered 0. Arm B was not run. Developer D1 mtime stayed `2026-10-14T21:07:38.4798993Z`. Report: `docs/CHECKPOINT_06_5_4_FINAL_REPORT.md`. Do not start Checkpoint 06.6 or 07.

### Checkpoint 06.5.4 continuation (2026-10-17)

Local result is PARTIAL. The 320 ms local dispatch wait stayed in place and is accepted only as a local mitigation. A fresh isolated race rejected a stale reminder-rule snapshot with 409 while the first distinct offset won, twice. Poison and pre-batch faults left the offset unchanged; a post-commit fault returned 503 and the new offset was visible on the next read without a second PATCH. On a copy of the synthetic 500-case D1, active deliverable reminders fell from 1250 to 0 and deliveries rose from 900 to 2150 with zero duplicate cycle keys, but later ticks still scanned and recomputed 100 rows while delivering 0. Playwright run 1 was 32/32 exit 0 with no logged transport faults and no handler-entry count. Run 2 was 32/32 exit 0 with 749 handler entries and zero transport faults. Developer D1 stayed 638976 bytes at `2026-10-14T21:07:38.4798993Z`. Report: `docs/CHECKPOINT_06_5_4_FINAL_REPORT.md`. Do not start Checkpoint 06.6 or 07.

### Checkpoint 06.6 continuation (2026-10-17)

Local implementation is PARTIAL. The case dossier at `/export-cases/:id` now keeps the reference, next action, and the two document/cargo tracks visible before the existing section buttons. Tokens moved to maritime ink `#10283F` on paper `#F7F8F6` with measured text contrast above 4.5. No new packages and no Tailwind Plus. Two Playwright runs were 32/32 exit 0; run 2 had 750 handler entries and zero `ECONNRESET`. Arabic case screenshots at 1366 and 390 were inspected. The full 4-fixture by 6-viewport matrix, screen-reader pass, and five-sample load timing were not done. Design approval is pending. Developer D1 stayed 638976 bytes at `2026-10-14T21:07:38.4798993Z`. Report: `docs/CHECKPOINT_06_6_FINAL_REPORT.md`. Do not start Checkpoint 06.7.

### Checkpoint 06.6.1 continuation (2026-10-17)

Local result is PARTIAL. Fresh before/after dossier screenshots were taken on the isolated E2E database: 24 before and 24 after, plus a locked-invoice supplemental. Container slots now show on the case page, with two real ISO numbers and empty slots labeled as unknown. Arabic system text for the checklist action is mapped. Two final Playwright runs were 33/33 exit 0 with no logged transport faults. An earlier run failed E2E-10 because the screenshot fixture reused that test's container numbers and ETD date; the fixture values were moved. Self-hosted Arabic fonts were not added. Design approval is pending. Developer D1 stayed 638976 bytes; its mtime changed without a migration aimed at that path. Report: `docs/CHECKPOINT_06_6_1_FINAL_REPORT.md`. Do not start Checkpoint 06.7.

### Checkpoint 06.6.1-A continuation (2026-10-18)

Closure is PARTIAL. The developer D1 file is still 638976 bytes with mtime `2026-10-17T20:08:31Z` and sha256 `125EFCA054938E3DAC4BC0DEA03A63A38B969D958567706DB6135962B2F4FB2F`. A WAL sidecar from `2026-10-17T21:13:51Z` exists. Historical identity with 14 October is unverifiable. A disposable copy passed `integrity_check` and was deleted. All 24 fresh dossier screenshots were opened; container ids are `TCLU0000009` and `HLXU1111119`. E2E-10 now asserts the visible schedule heading. Two Playwright runs were 33/33 exit 0 with no logged transport faults. A self-hosted Arabic font was not added. Design approval is pending. Report: `docs/CHECKPOINT_06_6_1_A_FINAL_REPORT.md`. Do not start Checkpoint 06.7.

## Do not

- Create or reuse Cloudflare D1, R2, Workers, or DNS. `nexora-db` and `nexora-project-files` are another project.
- Run `pnpm db:migrate:remote`, `wrangler deploy`, or remote `d1 execute`.
- `git init`, commit, push, or rewrite history without a separate owner request.
- Store full IBAN/account numbers. Last-four only.
- Treat vessel arrival as customer delivery, or a direct-route case as blocked by the bank.
- Invent container numbers for empty slots.
- Mark design signed off from screenshots alone.

## Detail docs

- `docs/ARCHITECTURE_RECONCILIATION.md`
- `docs/DOMAIN_WORKFLOW_CONTRACT.md`
- `docs/REQUIREMENTS_AUDIT_FOR_NEW_AGENT.md`
- `docs/NEW_AGENT_BASELINE.md`
- `docs/TECHNICAL_DECISIONS_AND_RISKS.md`
- Older accepted notes: `docs/ARCHITECTURE.md`, `docs/WORKFLOWS.md`, `docs/DATA_MODEL.md`, `docs/SECURITY.md`, `docs/REMINDERS.md`
- Checkpoint 04: `docs/CHECKPOINT_04_CASES_SOURCE_INTEGRITY.md`, `docs/CHECKPOINT_04_BUILD_SECRETS_AUDIT.md`, `docs/CHECKPOINT_04_ARCHITECTURE_VERIFIED.md`, `docs/CHECKPOINT_04_DOMAIN_WORKFLOW_AUDIT.md`, `docs/CHECKPOINT_04_REQUIREMENTS_EVIDENCE_MATRIX.md`, `docs/CHECKPOINT_04_FINAL_REPORT.md`
