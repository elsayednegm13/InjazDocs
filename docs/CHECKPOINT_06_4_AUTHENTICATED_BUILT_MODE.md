# Checkpoint 06.4 authenticated built mode

LOCAL BUILT means `vite preview` of the Worker bundle, with Better Auth and D1, on the disposable 500-case store. It is not a static open of `dist/client/index.html`.

## How it was started

1. `corepack pnpm build` (tsc, Vite client + Worker, artifact guard). Exit 0. Client chunk stayed `dist/client/assets/index-Bc7FcXnZ.js`, 541.74 kB raw, gzip 164.76 kB. Guard: `publishable output is clean: dist`.
2. The dev server on 43176 was stopped so it would not hold the perf SQLite file.
3. First preview, `CLOUDFLARE_ENV=perf`, `EXPORTFLOW_PERSIST=.wrangler-perf/state`, port 43176: health returned 200 JSON. Sign-in returned 403. The log said `Invalid origin: http://127.0.0.1:43176`. Wrangler had loaded the project `.dev.vars` because the built config has no `[env.perf]` section. Developer secret values were not printed.
4. `.dev.vars.perf` was copied to `dist/exportflow/.dev.vars`. Preview restarted. The log said `Using secrets defined in dist\exportflow\.dev.vars`. Sign-in then returned 200 and the probe continued.
5. After measurement the copy was deleted. The guard was run again and reported a clean `dist`.

The preview and the dev server were never pointed at `.wrangler/state`.

## API, 500 cases, signed-in administrator

N=20 after two warmups. Source: `docs/performance/checkpoint-06-4/built-large.json`.

| Route | p50 ms | p95 ms | failures | resets |
| --- | ---: | ---: | ---: | ---: |
| `/api/v1/health` | 62 | 65 | 0 | 0 |
| `/api/v1/me` | 157 | 625 | 0 | 0 |
| `/api/v1/dashboard` | 185 | 513 | 0 | 0 |
| `/api/v1/export-cases?page=1&pageSize=20` | 207 | 593 | 0 | 0 |
| `/api/v1/export-cases/pcase-0` | 249 | 663 | 1 | 1 |
| `/api/v1/bookings` | 188 | 570 | 0 | 0 |
| `/api/v1/reminders` | 189 | 476 | 0 | 0 |
| `/api/v1/schedule` | 162 | 993 | 0 | 0 |

Dashboard concurrency p50: 8-wide 1002 ms (N=64, 0 failures), 16-wide was included in the same file. The one reset is the `ECONNRESET` in `docs/CHECKPOINT_06_4_RUNTIME_TRANSPORT_ROOT_CAUSE.md`.

## Browser, installed Chrome, headless

Source: `docs/performance/checkpoint-06-4/browser-built-large.json`. The script's environment label was corrected after the run; the timings were not edited.

| Journey | Result |
| --- | --- |
| Sign-in click → dashboard heading | 1033 ms |
| Cold sign-in → heading, 3 new contexts | 1414, 893, 1906 ms |
| Dashboard full reload, N=10 | min 397, p50 421, max 998 ms |
| Operations list until a case link | 297 ms |
| Open a case until `PF-2026-` heading | 391 ms, reference present |
| In-app dashboard ↔ operations, 3 round trips | 101–131 ms |
| Bookings / schedule / reminders, one full load each | 1222 / 372 / 1183 ms |
| Dashboard reload at 768 px and 390 px | 975 ms and 943 ms |
| Active public track, then Arabic toggle | heading redacted to `PF-2026-xxxx`, `dir` became `rtl`, 1121 ms, no amount fields in the heading |
| Revoked link | heading `Tracking unavailable`, 483 ms |

Console: four `401` lines and one `410`. No `pageerror`. No `requestfailed`. The 401s are anonymous `/api/v1/me` while the public track page and the login page boot. The 410 is the revoked token. Expected.

STAGING NOT RUN. PRODUCTION NOT APPROVED.
