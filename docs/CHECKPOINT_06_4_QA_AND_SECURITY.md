# Checkpoint 06.4 QA and security

LOCAL DEV and LOCAL BUILT were measured on `.wrangler-perf`. The Playwright suite uses `.wrangler-e2e` and port 43174. STAGING NOT RUN. PRODUCTION NOT APPROVED.

## Commands

| Command | When (UTC) | Exit | Result |
| --- | --- | --- | --- |
| `corepack pnpm build` | finished before preview start `2026-10-16T14:15:49Z` | 0 | tsc, Vite client + Worker, artifact guard clean. Client chunk `index-Bc7FcXnZ.js` 541.74 kB, gzip 164.76 kB |
| `corepack pnpm lint` | after the unused-variable cleanup | 0 | One existing warning: `src/features/fields/CustomFieldsPanel.tsx:49` fast refresh |
| `corepack pnpm test` | start `2026-10-16T14:24:14Z`, 3.10 s | 0 | 6 files, 27 passed |
| `corepack pnpm exec playwright test` | ended `2026-10-16T14:35:16.717Z`, 10.3 m | 0 | 32 passed |
| `corepack pnpm exec playwright test` | ended `2026-10-16T14:45:59.659Z`, 10.4 m | 0 | 32 passed |

`playwright.config.ts` has `retries: 0` and `workers: 1`. The reporter listed 32 passed and no skipped count. Each green run still printed `Internal server error: fetch failed` four times in the webServer log. Those lines are the open transport fault. They did not fail a test, and a green suite does not clear that fault.

`scripts/e2e-server.mjs` still deletes `.wrangler-e2e` only. `.wrangler-perf` was left in place. Developer D1 remained 638976 bytes, mtime `2026-10-14T21:07:38.480Z`. `dist/exportflow/.dev.vars` is absent. The artifact guard passed after it was removed.

Setup still has one bounded retry when bootstrap HTML contains `fetch failed`. No new product retry was added.

## Domain and security checks that ran

| Invariant | Evidence |
| --- | --- |
| Invoice rule C | `e2e/invoice-lock.spec.ts` passed in both full runs: ordinary edit locked, privileged correction recorded |
| FOB / CFR explicit totals | E2E-04 and E2E-05 passed. Seeded invoices store total as goods plus invoiced freight; FOB invoiced freight is 0 |
| Bank vs direct, manual courier | E2E operations passed. No live carrier client was added |
| Booking slots and UCR | Seed has five slots and numbers on two of them. E2E booking tests passed |
| Reminders | E2E-15 and E2E-15b passed (snooze/resolve and the unapproved-document case) |
| Public tracking | T05 passed (unknown token 410, body contains `CUSTOMER_TRACKING_UNAVAILABLE` and not `export_cases`). E2E-12 passed (rotate/revoke). Anonymous probe after the route move: missing token 410, active token 200 without `invoice_total`, revoked token 410 |
| Case visibility | Officer on the 500-case store: list total 250, page 20. Admin dashboard count 500 |
| Last admin / uploads / roles | A2, A3, A5, A6 passed in both runs |
| Arabic / English | C4 and E2E-13 passed. Built and dev track pages switched `dir` to `rtl` on the active link |
| Secrets | Build guard clean. Trace logs paths and status codes only |

The batch reads use the same visibility SQL as before. They do not cache one user's rows for another.

## Console

Expected: anonymous `GET /api/v1/me` is 401 `SESSION_EXPIRED`, including on `/login` and `/track/:token`, because `SessionProvider` always loads the session. Chrome records that as a failed resource. Revoked tracking is 410.

Unexpected and still open: HTML `fetch failed` / `ECONNRESET` from the Vite–Miniflare hop. Counted above. No `pageerror` and no `requestfailed` in the two saved Chrome journeys.
