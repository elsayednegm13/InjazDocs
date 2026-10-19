# Checkpoint 06.4 issue and fix register

## ISSUE-06.4-01 — socket reset before the Worker

- Severity: P1 reliability. Route: any proxied request. Seen on `POST /api/auth/sign-in/email` and `GET /api/v1/export-cases/pcase-0`.
- Hypothesis: undici's pooled connection to workerd is reset, and Miniflare does not retry because the dispatcher marks the request non-idempotent. Confidence: **CONFIRMED** for `TypeError` caused by `Error` code `ECONNRESET` at `dispatchFetch`. Confidence that every reset is the 5 second idle timeout: **not supported** by the 6 second gap sample.
- Smallest safe product change: none found in app code. A pool timeout change belongs to `@cloudflare/vite-plugin` 1.63.1 / Miniflare 5.20261006.1-alpha / workerd 1.20261006.1.
- Security: no auth bypass, no retry of POST.
- Status: open. **OWNER_DECISION_REQUIRED** before a dependency upgrade. Evidence: `docs/CHECKPOINT_06_4_RUNTIME_TRANSPORT_ROOT_CAUSE.md`.

## ISSUE-06.4-02 — anonymous public track required a session

- Severity: P1. Route: `GET /api/v1/public/track/:token`.
- Hypothesis: `app.route("/api/v1", api)` mounted the session middleware before the public route, so a missing cookie threw 401 `SESSION_EXPIRED` and the public handler never ran. With a cookie, the middleware called `next()` and the public handler answered. Confidence: **CONFIRMED**. Anonymous missing token was 401; after the move it is 410 `CUSTOMER_TRACKING_UNAVAILABLE`. An active synthetic token returned 200 and the JSON had no `invoice_total`. A revoked token returned 410.
- Change: register that one GET before `app.route` in `server/http/app.ts`. The handler is still `publicTracking`, which omits money and bank fields.
- Rollback: move the route back below `app.route`. That restores the 401.
- Regression: existing `e2e/errors.spec.ts` expects 410 for an unknown token, and `e2e/operations.spec.ts` opens a visitor context with no storage state. Those run inside the full Playwright suite.
- Speed: not a performance change.

## ISSUE-06.4-03 — serial D1 reads on dashboard and case overview

- Severity: P2. Routes: `GET /api/v1/dashboard`, `GET /api/v1/export-cases/:id`.
- Hypothesis: each `db.prepare().all/first` pays a Worker round trip. Local SQLite for the same statements was under 4 ms, while the dashboard handler was commonly ~190 ms for three statements and case detail ~340 ms for a longer chain. Confidence: **CONFIRMED**.
- Change: `server/services/reports.ts` `overview` and `server/services/cases.ts` `getCaseOverview` use one `db.batch` for the independent reads. The access check still runs first. Custom fields stay a follow-up read. Reminder visibility SQL is unchanged.
- Measured on the 500-case dev server: dashboard client p50 254 → 215 ms; case detail 411 → 261 ms; minimum detail 384 → 202 ms. Unbatched routes did not get faster. Officer list total remained 250. Dashboard counts on 500 cases remained `total_cases` 500.
- Rollback: restore the sequential `one` / `all` calls in those two functions.
- Not done: batching `/api/v1/me`, adding indexes, limiting `/api/v1/schedule`. Schedule SQL is ~1 ms locally and ~200 ms through the Worker at 500 rows; the built page load was 372 ms in one sample.

## Experiments not kept

- `React.lazy` route split from 06.3. Still reverted. Not retried.
- No GET retry, no overlay change, no `CI=1` on the user's dev script, no package upgrade, no schema migration.

## Trace-only additions

`EXPORTFLOW_TRACE=1` logs `[exportflow-handler] METHOD pattern status ms` and, in Vite, `[exportflow-trace] METHOD path TypeError > Error:CODE`. Path segments outside a fixed name list become `:id`. Cookies, SQL, and bodies are not logged. `pnpm dev` does not set the variable, so those lines stay off in normal use. Rollback: remove `traceDispatch` from `vite.config.ts` and the timing block in `server/http/app.ts`.
