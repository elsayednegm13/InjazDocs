# Checkpoint 02.1 QA matrix

Isolated base URL: `http://127.0.0.1:43174`. Persistence: `.wrangler-e2e/state`. Playwright `channel: "chrome"`. `.wrangler/state` was absent before and after.

## Full command

`corepack pnpm exec playwright test` — exit 1 — `23 passed, 1 failed` in 8.3m.

The single failure was `E2E-15` at the last assertion, after Vite logged `fetch failed`. Focused re-run:

`corepack pnpm exec playwright test -g "E2E-15 snoozed"` — exit 0 — `3 passed` (setup ×2 + E2E-15) in 1.4m.

An earlier focused run of E2E-15 and E2E-15b had also passed (`4 passed` plus setup) before the full command.

## A1–A5 and locale

| Id | Test | Full run | Notes |
| --- | --- | --- | --- |
| A1 | E2E-15 | FAIL then PASS on re-run | Snooze, upload, approve, resolve, other case still open. Due time via `PATCH /api/v1/reminder-rules/rr-doc-due` `offsetAmount: -1` and `GET /cdn-cgi/local/scheduled`. |
| A1b | E2E-15b | PASS | Upload without approval leaves the review reminder. |
| A2 | security.spec A2 | PASS | Officer session gets 404 and a body that is not `%PDF`. Admin download starts with `%PDF`. Cross-requirement attach is 404. Self role grant is 403. |
| A3 | security.spec A3 | PASS | Disable self, demote, DENY override, and stripping `role-admin` return 409. Second admin can be created and disabled. |
| A4 | security.spec A4 | PASS | 8-wide burst of 40 public-track calls: 30 × 410 and 10 × 429. Spoofed `X-Forwarded-For` and `CF-Connecting-IP` share one bucket. Window reset returns 410. |
| A5 | security.spec A5 | PASS | Abort, bad etag, retry, short body, empty part, bad signature, expired session. Requirement stays `MISSING`. |
| C4 | locale.spec | PASS | AR/EN/AR, reload, 390 and 768 overflow. |
| Original | E2E-01..E2E-14, isolation | PASS | Inside the full run. |

## Unit, typecheck, lint, build

| Command | Result |
| --- | --- |
| `corepack pnpm test` | 15 passed (13 domain, 1 i18n, 1 client-ip) |
| `corepack pnpm typecheck` | exit 0 |
| `corepack pnpm lint` | exit 0, no warnings |
| `corepack pnpm build` | exit 0. Client JS 486.18 kB, gzip 150.52 kB. CSS 25.54 kB, gzip 5.49 kB |

## Not run

20/100/250/400 MiB uploads to real Cloudflare R2. Remote D1. DNS, WAF, email, live DHL, backup restore. Chrome `--version` opened an existing window and did not print a version string.
