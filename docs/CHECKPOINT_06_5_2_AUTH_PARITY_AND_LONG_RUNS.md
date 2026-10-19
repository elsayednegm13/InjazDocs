# Checkpoint 06.5.2 auth parity and long runs

Arm B is diagnostic. It is not the shipping topology.

## Secret source

| Check | Result |
|---|---|
| Wrangler log | `Using secrets defined in .wrangler-reliability-b\.dev.vars` |
| Health `fixture` | `reliability-b` |
| Vars names | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BOOTSTRAP_SECRET`, `EXPORTFLOW_TRACE`, `EXPORTFLOW_FIXTURE` |
| `BETTER_AUTH_URL` | `http://127.0.0.1:43181` (checked, value is the port, not a credential) |
| Project `.dev.vars` | Not read. `CLOUDFLARE_ENV` removed from the child |
| After stop | Vars file deleted |

A first Arm B process in this run was stopped after it had already bootstrapped, because the browser harness failed. The state was rebuilt. The successful secret-source check is from the later processes with the log line above.

## Cookie, origin, CSRF

Measured by `scripts/checkpoint-06-5-2-arm-b-session.mjs` against the isolated worker:

| Check | Status |
|---|---|
| Sign-in with `Origin: http://evil.example` | 403 `Invalid origin` |
| Anonymous `GET /api/v1/me` | 401 |
| Unknown public track token | 410 |
| Manual cron `GET http://127.0.0.1:43182/cdn-cgi/local/scheduled` | 200 |
| Session cookie | `HttpOnly`, `SameSite=Lax`, `Secure` absent on `http` |
| `GET /api/v1/me` with cookie | 200 |
| `PATCH /api/v1/reminder-rules/rr-doc-due` same offset | 200 in 769 ms on the long-run process, 961 ms on the browser process |
| `POST /api/auth/sign-out` | 200 |
| `GET /api/v1/me` after sign-out | 401 |

## Browser journey

The first browser attempts failed because Vite, with watching left on, reloaded the page whenever the Arm B SQLite WAL changed. `vite.reliability.config.ts` now sets `watch: null` when `CI=1`, which the Arm B launcher already sets. After that:

- Browser result: `/dashboard->logout`
- `browserError`: null
- Screenshot `docs/performance/checkpoint-06-5-2/arm-b-dashboard.png` shows ExportFlow signed in as the synthetic "Reliability B Admin" on Export operations, with Sign out visible
- Page errors: 0

The screenshot was taken after reminders and export-cases navigation. The case list was still loading in that frame. Logout then returned to login.

## Long authenticated exposure

Process start context: health fixture already proven. Duration 605485 ms. Routes cycled: `/api/v1/me`, `/api/v1/reminder-rules`, `/api/v1/reminders`, `/api/v1/export-cases`, `/api/v1/health`.

| | Count |
|---|---|
| Requests | 1950 |
| HTTP ok | 1950 |
| Expected 401 | 0 |
| Unexpected | 0 |
| Resets | 0 |

Arm B had no cases, so this is not the same request mix as the 13-minute Playwright suite. It is a long authenticated session, not a 204-GET probe. It does not by itself prove the canonical hop is fixed. Full Playwright was not pointed at Arm B. Causal comparison of the reset rate is INCONCLUSIVE: Arm A still resets in the full suite; Arm B did not reset in this different mix.

Artifact: `docs/performance/checkpoint-06-5-2/arm-b-long-run.json`.
