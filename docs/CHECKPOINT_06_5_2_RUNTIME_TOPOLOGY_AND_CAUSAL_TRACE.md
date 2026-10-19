# Checkpoint 06.5.2 runtime topology and causal trace

## Arm A — canonical

```
Browser / Playwright
  → Vite 7.3.7 on 127.0.0.1:43174 (E2E) or 43176 (perf)
  → @cloudflare/vite-plugin 1.63.1 createRequestHandler
  → Miniflare 5.20261006.1-alpha dispatchFetch
  → undici 7.29.1 Pool
  → workerd 1.20261006.1
  → Hono worker entry
```

E2E sets `CI=1`, which sets Vite `watch: null` in `vite.config.ts`. Persist is `.wrangler-e2e`, not the developer store.

## Arm B — diagnostic only

```
Browser or Node fetch
  → Vite on 127.0.0.1:43181 (react + tailwind, no Cloudflare plugin)
  → proxy /api and /cdn-cgi, changeOrigin false
  → wrangler dev --local --no-latest on 127.0.0.1:43182
  → workerd
  → same Hono app
```

Config file: `.wrangler-reliability-b/wrangler.jsonc` with `assets.directory` set to an empty folder so Wrangler does not redirect to `dist/exportflow/wrangler.json`. Secrets file sat beside that config and was deleted after the last stop. This topology is not the product default.

## First failing boundary

Captured on Arm A during the 500-case bank PATCH and again in Playwright run 1.

Example, Playwright run 1, `2026-10-16` 23:27:36 local:

```
[exportflow-trace] POST /api/v1/auth/bootstrap TypeError > Error:ECONNRESET
[vite] Internal server error: fetch failed
  at undici processResponse
  at miniflare dispatchFetch
  at @cloudflare/vite-plugin dist/index.mjs:56327
```

There is no `[exportflow-handler] enter` for that attempt. Earlier bootstrap calls in the same second did enter and returned 201 and 409. Classification: `DISPATCHED_NOT_ENTERED_HANDLER`. The HTML page is Vite's error page, not a Hono JSON error. Confidence: high for this boundary, low for any cause inside workerd. Label: `UNOBSERVABLE_WITH_AUTHORIZED_TOOLS` below `dispatchFetch`.

The same stack was the only transport failure on the perf server: `PATCH /api/v1/reminder-rules/rr-bank` at 316 ms client time, no handler enter. The next PATCH of the same unchanged offset entered and returned 200.

## Hypotheses

| Hypothesis | Test | Result | Confidence |
|---|---|---|---|
| Data volume causes the reset | Dashboard work in 06.4 was flat; this run's resets are on bootstrap, sign-up, users, custom-fields, and GET reminders, including the small E2E database | NOT_SUPPORTED | High that volume is not required |
| Serial reminder work causes the reset | The 220 s review PATCH returned 200. The bank reset happened before the handler | NOT_SUPPORTED as the reset cause | High |
| Five-second idle pool timeout | Resets also happen in the first seconds of E2E (bootstrap and sign-up at 23:27:36) | NOT_SUPPORTED as the only cause | Medium |
| Short GET floods discriminate | Not repeated. 06.5.1 short probes were non-discriminating and were not treated as a fix | NOT_USED as proof | High |
| Arm B removes the Vite plugin hop | 1950 authenticated API calls in 605485 ms, 0 resets. Full Playwright was not run on Arm B | INCONCLUSIVE for a permanent architecture change | Medium |
| SQLite WAL watching reloads Arm B pages | Vite logged `page reload` of `.wrangler-reliability-b/**.sqlite-wal` while the login form was open | REPRODUCED, then watch disabled on the diagnostic config only | High for the browser-harness failure |
| File-watcher reloads cause Arm A resets | E2E already sets `watch: null` and the resets still happen | NOT_SUPPORTED for Arm A | High |
| Plugin 1.63.2 / 1.64.0 pool constants | Not retried. 06.5 and 06.5.1 already saw the same `keepAliveTimeout: 1000` in the inspected 1.63.2 tarball, and 1.64.0 did not win a reliability trial | NOT_RETRIED | Prior evidence stands |
| Trace overhead | Trace was on for perf and E2E this run. Resets also existed in earlier runs. Not isolated this time | NOT_TESTED as a sole cause | Low |

No `node_modules` edit. No lockfile edit. No automatic retry was added.
