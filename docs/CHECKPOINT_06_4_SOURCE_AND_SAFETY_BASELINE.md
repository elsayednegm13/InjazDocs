# Checkpoint 06.4 source and safety baseline

Date: 2026-10-16. Workspace: `I:\WORK\InjazDocs`. No Git repository. No Cloudflare API calls. No edits to `.dev.vars`, `.dev.vars.e2e`, or `.wrangler/state`.

## Environment

| Item | Value |
| --- | --- |
| OS | Windows 10.0.26300 |
| Node | v24.19.0 |
| Package manager | corepack pnpm |
| Vite | 7.3.7 |
| Hono | 4.13.13 |
| `@cloudflare/vite-plugin` | 1.63.1 |
| Wrangler | 4.149.0 |
| Miniflare | 5.20261006.1-alpha |
| workerd | 1.20261006.1 |
| undici | 7.29.1 |
| React / TanStack Query | 19 / 5, `staleTime` default 0, StrictMode on |

Developer port in `package.json` is 43173. Playwright is 43174 via `scripts/e2e-server.mjs`, which deletes only `.wrangler-e2e`. This checkpoint used 43176 for both the isolated dev server and, after that process was stopped, the authenticated preview. 43173 was not started.

`pnpm dev` does not set `CI`, so the user's server keeps the file watcher and HMR. The perf server also left the watcher on. `EXPORTFLOW_TRACE=1` is set only by the perf server script. A normal `pnpm dev` does not print handler timings.

## What each script is allowed to touch

| Script | Data |
| --- | --- |
| `scripts/checkpoint-06-4-guard.mjs` | Throws unless the target is inside `.wrangler-perf` and outside `.wrangler`. |
| `scripts/checkpoint-06-4-reset.mjs` | Deletes `.wrangler-perf` only, writes `.dev.vars.perf` and `.wrangler-perf/accounts.json`, applies migrations to `.wrangler-perf/state`. |
| `scripts/checkpoint-06-4-seed.mjs` | Opens only the perf D1 file named from database id `local-exportflow-not-a-remote-id`. |
| `scripts/e2e-server.mjs` | Still wipes `.wrangler-e2e` only. |
| Cleanup this checkpoint | `dist/exportflow/.dev.vars` after the preview. Confirmed absent. Artifact guard passed. |

Developer D1 file:

` .wrangler/state/v3/d1/miniflare-D1DatabaseObject/e086a16c2df761e404ed26001d3f081a26268e90033ffbf14d8419a939ea8dbc.sqlite`

638976 bytes, mtime `2026-10-14T21:07:38.480Z`, rechecked after the perf migrations and again before the regression suite. The same hash name exists under `.wrangler-perf`; the directories differ. This checkpoint did not open the developer file.

Migration `0004_invoice_revisions.sql` was applied only inside `.wrangler-perf` by the reset script. It was not replayed on the developer database.

## Read ledger

Source that governs the hot path, read before the retained edits:

- `vite.config.ts`, `wrangler.jsonc`, `playwright.config.ts`, `package.json`, `scripts/e2e-server.mjs`
- `src/main.tsx`, `src/app/router.tsx`, `src/app/session.tsx`, `src/app/shell.tsx`, `src/lib/api.ts`
- `src/features/dashboard/DashboardPage.tsx`, `src/features/cases/CasesPages.tsx`, `src/features/auth/LoginPage.tsx`, `src/features/track/TrackPage.tsx`
- `server/http/app.ts`, `server/http/errors.ts`, `server/services/reports.ts`, `server/services/cases.ts`, `server/services/bookings.ts`, `server/services/reminders.ts`, `server/services/tracking.ts`, `server/services/actor.ts`, `server/services/custom-fields.ts`, `server/db/sql.ts`
- `drizzle/migrations/0001_init.sql` through `0004`, `shared/enums.ts`
- `docs/CHECKPOINT_06_3_FINAL_REPORT.md` and `docs/performance/checkpoint-06-3/`
- Miniflare `dispatchFetch` and its undici `Pool` (`keepAliveTimeout: 1000`, comment: close idle sockets before workerd's 5s idle timeout). `DispatchFetchDispatcher` sets `idempotent = false` and `reset = false`, so a socket error is not retried inside Miniflare.

Changes since 06.3 before this checkpoint's product edits: probe script, 06.3 docs, and the reverted router (static imports). `React.lazy` was not reintroduced.

## Pre-existing behavior kept in view

- Anonymous `GET /api/v1/me` returns 401 `SESSION_EXPIRED`. Chrome logs that as a failed resource. That is the auth contract.
- Playwright `setup.spec.ts` still has one bounded retry when bootstrap returns HTML containing `fetch failed`. Product code does not retry mutations.
- `listCases` is already paged (default 20). The operations screen renders that page, not 500 rows.
- Dashboard overview was three sequential D1 calls. Case overview was an access check plus further sequential reads.

## Built mode

`vite preview` runs the Worker through the same Cloudflare Vite plugin and Miniflare. It is not a static file server. The first preview attempt returned Better Auth `Invalid origin` because it loaded the project `.dev.vars` (developer URL) rather than `.dev.vars.perf`. Copying the perf secrets file to `dist/exportflow/.dev.vars` made sign-in succeed on port 43176. That file was removed and the artifact guard passed. Details: `docs/CHECKPOINT_06_4_AUTHENTICATED_BUILT_MODE.md`.
