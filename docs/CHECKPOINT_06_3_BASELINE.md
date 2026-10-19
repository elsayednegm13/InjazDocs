# Checkpoint 06.3 baseline

Captured 2026-10-16 on the local machine before any performance edit was kept. Product source was not changed in order to obtain these numbers. The later route-split trial is recorded in `docs/CHECKPOINT_06_3_PERFORMANCE_COMPARISON.md` and was reverted.

## Environment

| Item | Value |
| --- | --- |
| OS | Windows 10.0.26300 |
| CPU | 12 logical processors |
| RAM | 15.8 GiB |
| Node | v24.19.0 |
| Package manager | corepack pnpm 12.11.2 (from the lockfile toolchain used by the scripts) |
| Vite | 7.3.7 |
| Wrangler | 4.149.0 |
| Browser | Playwright Chrome channel |
| Developer port | 43173 from `EXPORTFLOW_PORT ?? 43173` in `vite.config.ts`. Not started. |
| Isolated E2E | `node scripts/e2e-server.mjs` → Vite + Miniflare on 127.0.0.1:43174, `CI=1` (file watch off, inspector port off), persist `.wrangler-e2e/state` |
| Dataset | Fresh migrated E2E database: one synthetic administrator, zero cases, zero reminders. Not the developer database. |
| HMR | `hmr: { overlay: false }`. Watch is `null` because the E2E script sets `CI=1`. |

Developer `.wrangler/state` was opened read-only for a metadata compare. Its file mtime stayed `2026-10-14T21:07:38.480Z`. Migrations there remain 0001–0004, with 0004 at `2026-10-14 19:35:55`. This checkpoint did not migrate or write that database.

The first isolated server was discarded before these numbers. Its database already contained one account that was not the synthetic E2E administrator, so bootstrap returned 409 and sign-in did not establish the probe session. That process was stopped. The next `e2e-server` start wiped only `.wrangler-e2e` and the measurements below are from the fresh database. No identifier from the discarded account was copied into this report.

## What was measured

Probe: `scripts/checkpoint-06-3-probe.mjs`. It does not write cookies, passwords, or response bodies. Outputs:

- `docs/performance/checkpoint-06-3/baseline-api-cold.json` — first clean API matrix after a fresh E2E boot
- `docs/performance/checkpoint-06-3/baseline-dev2-api.json` and `baseline-dev2-browser.json` — warm dev journeys with headings
- `docs/performance/checkpoint-06-3/journeys.csv` — journey timings

Cold means the first samples after that server was ready. Warm means a later sample on the same server after Vite had already transformed the modules. N is small. p95 is the high sample, not a stable percentile.

## API, isolated dev (43174)

Health `GET /api/v1/health`, all HTTP 200, zero bodies containing `fetch failed`:

| Series | N | Median ms | High sample ms | Failures | Resets |
| --- | --- | --- | --- | --- | --- |
| Sequential | 8 | 61 | 65 | 0 | 0 |
| Parallel 2 | 2 | 87 | 88 | 0 | 0 |
| Parallel 4 | 4 | 133 | 135 | 0 | 0 |
| Parallel 8 | 8 | 183 | 188 | 0 | 0 |
| HTTP keep-alive, 1 socket | 8 | 54 | 62 | 0 | 0 |
| Fresh connection each time | 8 | 54 | 63 | 0 | 0 |

Authenticated, N=5, after one bootstrap (201) and one conflict (409), sign-in 200, password change 200:

| Endpoint | Median ms | Min | Max | Failures |
| --- | --- | --- | --- | --- |
| `/api/v1/me` | 174 | 163 | 930 | 0 |
| `/api/v1/dashboard` | 235 | 229 | 245 | 0 |
| `/api/v1/export-cases` | 208 | 207 | 878 | 0 |
| `/api/v1/bookings` | 187 | 186 | 193 | 0 |
| `/api/v1/reminders` | 187 | 183 | 211 | 0 |

The 930 ms and 878 ms values are single first-hit outliers. They are not the median.

Playwright `APIRequestContext` reuse against `/api/v1/dashboard` (same cookie, same context): 12 sequential, median 265 ms, high sample 631 ms, 0 resets. 8 parallel, median 2918 ms, 0 failures, 0 resets. Parallel work stretches latency. It did not drop the connection in this sample.

## Browser journeys, warm dev, empty data

Time is until the named level-1 heading is visible. For the dashboard that heading is behind the data query. For list pages the heading renders while the list request may still be in flight, so those times are shell time, not list-data time.

| Journey | ms | API calls | `/src` requests | Console errors added |
| --- | --- | --- | --- | --- |
| Login through dashboard heading | 2418 | 6 | 26 | 1 |
| Dashboard full reload | 1651 | 2 | 26 | 0 |
| Dashboard warm reloads 2–5 | 1059, 1048, 1067, 1033 | 2 | 26 | 0 |
| Cases / bookings / schedule / reminders / settings | 431–715 | 1–2 | 26 | 0 |
| In-app link to cases, then dashboard | 104, 105 | 0 | 0 | 0 |
| Dashboard at 390px | 1240 | 4 | 26 | 0 |

The login console line is Chrome’s “Failed to load resource: 401” for `GET /api/v1/me` before a session exists. See the console audit.

A full reload asks for 26 source modules because the router statically imports every feature page. Cumulative request count across the whole browser session was 371, which is those reloads added together, not 371 modules on one screen.

## Built preview

`vite preview` on 127.0.0.1:43175 served the existing client bundle and the Worker. Unauthenticated health responses in that log were about 14–35 ms, with some parallel samples at 111 ms. `GET /assets/index-Bc7FcXnZ.js` was 29 ms then 8 ms. Authenticated journeys were not measured: bootstrap returned 403 (the preview Worker did not receive the E2E bootstrap secret; there is no `[env.e2e]` and the artifact guard strips copied `.dev.vars`). One following dispatch returned HTML `fetch failed` (500). Label: authenticated LOCAL BUILT = NOT MEASURABLE. Unauthenticated LOCAL BUILT health = measured.

## Bundle already on disk, confirmed by the later production build

`dist/client/assets/index-Bc7FcXnZ.js` raw 541.74 kB, gzip 164.76 kB. CSS raw 30.68 kB, gzip 6.37 kB. One client JS chunk. The build after the reverted experiment emitted the same client filenames and sizes.

## Not measured

- Developer-database screen timings (the persisted database was not used for probes).
- A populated 10/100/1000 case set.
- Chrome long-task traces and JS heap snapshots.
- Public tracking page timing (no disposable token was created during the probe).
- CPU profiles of D1 itself. API time includes the Vite → Miniflare hop, so it is not pure SQL time.
