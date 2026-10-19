# Checkpoint 06.3 QA and security

Commands from `I:\WORK\InjazDocs` on 2026-10-16. Playwright `retries: 0` (`playwright.config.ts`). Isolated database only (`.wrangler-e2e`). Developer database mtime after the runs: `2026-10-14T21:07:38.480Z`, size 638976. It was not migrated.

| Command | Exit | Result |
| --- | --- | --- |
| `corepack pnpm typecheck` | 0 | `tsc -b` clean |
| `corepack pnpm lint` | 0 | oxlint warning only: `CustomFieldsPanel.tsx:49` fast-refresh (already known in 06.2) |
| `corepack pnpm test` | 0 | vitest 6 files, 27 passed. Staging preflight still refuses remote deploy |
| `corepack pnpm build` | 0 | `publishable output is clean: dist`. Client chunk unchanged: `index-Bc7FcXnZ.js` 541.74 kB, gzip 164.76 kB |
| `corepack pnpm exec playwright test` | 0 | 32 passed, 11.6m, ended `2026-10-16T09:59:28.360Z`. Four Vite `fetch failed` log lines. Invoice lock, reminders, tracking, and security specs passed |
| `corepack pnpm exec playwright test` (second) | 0 | 32 passed, 11.0m, ended `2026-10-16T10:10:46.766Z`. Four Vite `fetch failed` log lines again |

The four proxy errors per run did not fail the assertions. Setup still races bootstrap and keeps its single bounded retry only for the missing-secret HTML case. `e2e/invoice-lock.spec.ts` still uses a fresh browser context for the first correction POST. Those are existing test behaviors, not a new product retry.

## Domain coverage inside the two green runs

Auth and no public signup, case and file and reminder access, custom fields, FOB/CFR totals, Rule C lock and atomic correction, bank vs direct, manual carrier URL, booking slots, reminder snooze and ETA invalidation, tracking rotate/revoke, last administrator, Arabic/English direction. No assertion was weakened in this checkpoint.

## Privacy

Probe JSON stores path, status, and milliseconds. It does not store cookies, passwords, response bodies, or tracking tokens. No HAR. The temporary SQLite scripts were deleted. `.wrangler-preview` was deleted after the preview attempt. Built `dist` passed the existing artifact guard.

## Browser flows

The probe, on the isolated dev server, signed in and opened dashboard, cases, bookings, schedule, reminders, and settings, including a 390px dashboard reload. It did not time a case-detail document tab, a 768px layout, or a public tracking page. Those flows are in the Playwright suite (operations, locale, visual, tracking revoke) rather than in the timing probe. This checkpoint did not redesign screens. Screenshot files produced by the visual spec were not used as performance evidence.
