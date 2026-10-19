# Checkpoint 06.4 runtime transport root cause

Classification: **CONFIRMED** for the failing hop and the error code. **Not fixed.** A package change was not applied.

## What failed

The client receives Vite's HTML error page, `Internal server error: fetch failed`, with HTTP 500. That body is not a Hono JSON error. `src/lib/api.ts` already turns that HTML into `SERVER_TEMPORARILY_UNAVAILABLE` and does not show the stack.

Two captures from the perf dev server, watcher on, before any later load:

```
[exportflow-handler] POST /api/v1/auth/bootstrap 201 5884
[exportflow-trace] POST /api/auth/sign-in/email TypeError > Error:ECONNRESET
```

The sign-in POST never printed a handler line. The next attempt printed:

```
[exportflow-handler] POST /api/auth/sign-in/email 200 487
```

The same pair happened again on the bootstrap retry: first sign-in `TypeError > Error:ECONNRESET`, retry 200. The bootstrap script's extra attempts are harness retries for setup, not a product retry.

On the authenticated built preview, with the watcher off, one of 20 case-detail reads failed:

```
[exportflow-trace] GET /api/v1/export-cases/pcase-0 TypeError > Error:ECONNRESET
TypeError: fetch failed
    at Object.processResponse (.../undici@7.29.1/.../fetch/index.js:237:16)
    at async fetch4 (.../miniflare/.../index.js:90260:20)
    at async _Miniflare.dispatchFetch (.../miniflare/.../index.js:134947:22)
    at async .../@cloudflare/vite-plugin/.../dist/index.mjs:56327:19
```

No handler line was logged for that failed GET. The surrounding detail reads entered Hono and returned 200 in about 200–250 ms. Sample: `built-large.json` detail `failures: 1`, `resets: 1`, N=20.

## Where it is

Installed path:

Browser or Node fetch → Vite → `@cloudflare/vite-plugin` 1.63.1 → Miniflare 5.20261006.1-alpha `dispatchFetch` → undici 7.29.1 → workerd 1.20261006.1.

Miniflare builds an undici `Pool` toward the workerd entry socket with `keepAliveTimeout: 1000` and `keepAliveMaxTimeout: 1000`. The comment in that version says idle client sockets are closed before workerd's 5 second idle timeout. `DispatchFetchDispatcher.dispatch` then sets `options.idempotent = false` and `options.reset = false`, so undici does not retry the socket error. The plugin's request handler surfaces it as `fetch failed`.

This checkpoint did not edit those packages, the lockfile, or `node_modules`.

## What did not reproduce it

Same route, `GET /api/v1/dashboard`, 500-case store, N=8 each (`transport-large.json`):

| Variant | Resets |
| --- | --- |
| Immediate keep-alive | 0 |
| 6 second gap between requests | 0 |
| New TCP connection (`Connection: close`, `agent: false`) | 0 |

Dev API matrices before and after the batch change: 0 resets on health, session, dashboard, case list, bookings, reminders, and schedule (N=20 each), and 0 resets on dashboard concurrency 1, 2, 4, 8, and 16. The built preview's parallel dashboard bursts (including 8×8 and 16×4) also had 0 resets. The single built-preview reset was a sequential case-detail read in the middle of a successful series.

A 6 second idle gap was the suspected workerd idle-timeout race. It did not fail in this sample. The confirmed failures were a sign-in immediately after a 5.8 s bootstrap, a sign-in a few seconds after an HMR CSS update, and one case read during an otherwise healthy preview run. Those are not one identical trigger. The shared fact is the same error chain at the undici → workerd socket, before Hono.

Better Auth also logged: rate limiting could not determine a client IP and fell back to one shared bucket. That warning appeared on a sign-in that then returned 200. It is not the reset. No IP header or rate-limit setting was changed.

## Comparison

| Variant | Equivalent route | Result |
| --- | --- | --- |
| Vite dev, watcher on | Authenticated dashboard and case detail | Sign-in reset twice at startup. Later N=20 matrices clean. |
| Vite preview, no watcher | Same routes, same 500-case store | One `ECONNRESET` on case detail. Dashboard bursts clean. |
| Direct workerd, bypassing the plugin | Not run | The supported local entry is the plugin's `dispatchFetch`. No second official listener was opened. |
| Sequential vs overlap | Dashboard concurrency 1–16 | Queueing grows (dev-before p50 at 8-wide: 1775 ms; at 16-wide: 3337 ms) with 0 resets. |
| Fresh vs reused client | Dashboard | 0 resets in both, N=8. |
| Cold boot | First sign-in after ready | Reset, then the retry entered the handler. |

HMR is not required. The preview failure had no file watcher.

## Decision

No local Vite flag in the installed plugin exposes the undici pool timeouts. Changing `keepAliveTimeout` means editing Miniflare or upgrading `@cloudflare/vite-plugin` / Wrangler / workerd. That is **OWNER_DECISION_REQUIRED**. No upgrade was installed.

No product GET/POST retry was added. A retry would hide the dropped request and, on a write, could commit twice. The setup scripts retry sign-in only so the fixture can be created; those retries are recorded in `signInAttempts`.

Residual impact: a real read or the first sign-in can return HTML 500 even though the Worker never ran the handler. The next request often succeeds. G3 stays PARTIAL.
