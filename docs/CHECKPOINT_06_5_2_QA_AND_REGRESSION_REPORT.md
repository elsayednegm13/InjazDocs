# Checkpoint 06.5.2 QA and regression

Commands were run from `I:\WORK\InjazDocs`. `pnpm` was invoked as `corepack pnpm` because the `pnpm` shim was not on PATH.

| Command | Exit | Result |
|---|---|---|
| `corepack pnpm typecheck` | 0 | `tsc -b` clean |
| `corepack pnpm lint` | 0 | One existing warning: `src/features/fields/CustomFieldsPanel.tsx:49` fast-refresh. Not introduced here |
| `corepack pnpm test` | 0 | 7 files, 29 tests, including `dashboard-scope` 2/2 and domain 17 |
| `corepack pnpm build` | 0 | Guard: `publishable output is clean: dist`. `dist/.dev.vars` absent. Client CSS `index-BipniZkD.css` 30.68 kB. Client JS `index-Bc7FcXnZ.js` 541.74 kB. Worker `index-BQdRi_WI.js` 1900.92 kB |
| Playwright run 1 | 0 | 32 passed (13.0 m) |
| Playwright run 2 | 0 | 32 passed (12.5 m) |

Retries stayed 0. No test was skipped. No assertion was removed.

## Playwright run 1

- Command: `corepack pnpm exec playwright test`
- Port: `http://127.0.0.1:43174/`
- Started: `2026-10-16T20:26:38.393Z`
- Ended: `2026-10-16T20:40:01.798Z`
- Elapsed: 803405 ms
- Result: 32 passed, exit 0
- Trace lines (`TypeError > Error:ECONNRESET`), no handler enter on the failed attempt:
  - `POST /api/v1/auth/bootstrap`
  - `POST /api/auth/sign-up/email`
  - `POST /api/v1/users`
  - `POST /api/v1/custom-fields`
  - `GET /api/v1/reminders`
- Vite `Internal server error: fetch failed` lines: 6. Two of them sit on the reminders failure, so the request lower bound is 5 and the log-line upper bound is 6.
- E2E-15 passed in 1.9 m. Server: `DOCUMENT_REQUIREMENT_NOT_READY` 49 rows, 99 ms.
- E2E-15b server: `DOCUMENT_REVIEW_PENDING` 81 rows, 152 ms.
- Expected domain statuses seen in the log and not counted as resets: bootstrap 409/403, anonymous-style 401, `User not found` on a bad sign-in.

## Playwright run 2

- Same command and port
- Started: `2026-10-16T20:40:58.865Z`
- Ended: `2026-10-16T20:53:39.486Z`
- Elapsed: 760621 ms
- Result: 32 passed, exit 0
- Trace lines:
  - `POST /api/auth/sign-up/email`
  - `POST /api/v1/users`
  - `POST /api/v1/custom-fields`
- Vite `fetch failed` stacks: 4. The fourth stack is `dispatchFetch` / undici with no paired trace line, during the reminders page, and the following `GET /api/v1/reminders` entered and returned 200. Lower bound 3, upper bound 4.
- E2E-15 passed in 1.6 m. Document batch 49 rows, 115 ms. Review batch 81 rows, 95 ms, then 86 rows in 82 ms.

A green suite is not a healthy transport. Both runs dropped real requests.

## What was not weakened

No `test.skip`, no `force: true`, no timeout increase, no mutation retry. The client still maps an HTML `fetch failed` page to a user-facing unavailable message and does not replay the PATCH.
