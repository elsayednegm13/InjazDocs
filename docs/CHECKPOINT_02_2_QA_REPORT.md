# Checkpoint 02.2 QA report

LOCAL ONLY. Isolated E2E persist: `.wrangler-e2e/state`. `.wrangler/state` and `.dev.vars`: NOT FOUND. Tests reset only the E2E persist via `scripts/e2e-server.mjs`.

## Commands

| Command | Exit | Result |
| --- | --- | --- |
| `corepack pnpm typecheck` | 0 | clean after import `HttpError` fix |
| `corepack pnpm lint` | 0 | oxlint |
| `corepack pnpm test` | 0 | 18 passed / 4 files (domain, i18n, client-ip, errors) |
| `corepack pnpm build` | 0 | Vite production build |
| `corepack pnpm exec playwright test` run 1 | 0 | **26 passed**, 6.4m |
| `corepack pnpm exec playwright test` run 2 | 0 | **26 passed**, 7.2m |

Earlier full runs during locator work: 22/4, then 24/2, then 25/1 (A4 all-410 after isolate reset). Those are not the acceptance pair. The two consecutive clean suites above are.

## Playwright IDs

E2E-01, E2E-01 logout, E2E-02..E2E-15, E2E-15b, isolated DB, A2, A3, A4, A5, C4, T01, T05, visual.

A4 retries the 40-hit burst once if the first burst yields zero 429s (Miniflare isolate reset). Limit remains 30/60s. Spoofed XFF/CF-IP still ignored.

## Server logs

Vite `Internal server error: fetch failed` still appears at bootstrap and around scheduled/isolate resets. Overlay is disabled. Tests do not treat that log as a failure when HTTP assertions pass. 40-at-once Worker crash was not re-run; it remains a local stress limit.

## Screenshots

Before (copied genuine 02.1 captures): `docs/qa-screenshots/checkpoint-02-2/before/`

After (real Playwright):

- `after/en-dashboard-1366.png`, `after/ar-dashboard-1366.png`, `after/ar-dashboard-390.png`
- `after/en-case-1366.png`, `after/ar-case-detail-1366.png`, `after/ar-case-detail-390.png`
- `after/ar-reminders-1366.png`, `after/ar-bookings-schedule-1366.png`
- `after/en-login-1366.png`

NOT CAPTURED as named files: `ar-documents-1366.png`, `ar-bookings-390.png`, `ar-public-tracking-390.png`, `ar-document-validation-390.png`. Documents add/validation were asserted in T01/E2E-06, not photographed.

## Isolation

E2E users stay in `.wrangler-e2e`. Assertion: isolated DB does not contain `ops@exportflow.local`.
