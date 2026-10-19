# Checkpoint 06.5.2 source and read ledger

Date: 2026-10-16. Root verified by shell cwd and file reads: `I:\WORK\InjazDocs`. This ledger is for this run only. Historical checkpoint reports were used as background, not as proof.

## FULL_READ

| Path | Why |
|---|---|
| `server/services/reminders.ts` | Rule update, per-case recompute, and the new family batch. Read in overlapping ranges covering the file. |
| `server/domain/reminders.ts` | `conditionStillHolds`, `evaluateDue`, `computeDueAt`. |
| `scripts/checkpoint-06-4-server.mjs` | Perf server port and persist binding. |
| `scripts/reliability-arm-b.mjs` | Fail-closed Arm B construction. |
| `scripts/reliability-rule-timing.mjs` | Pattern for authenticated timing without printing secrets. |
| `vite.reliability.config.ts` | Diagnostic proxy and the watch fix. |
| `playwright.config.ts` | Port 43174, retries 0, Chrome channel. |
| `worker-configuration.d.ts` | Optional `EXPORTFLOW_FIXTURE`. |

## TARGETED_READ

| Path | What was read | Why |
|---|---|---|
| `shared/enums.ts` | `REMINDER_TRIGGER_FAMILIES` | Roster, including `CUSTOM_FOLLOWUP`. |
| `drizzle/migrations/0002_seed.sql` | Rule insert, lines 151–165 | The 11 seeded rules. |
| `server/http/app.ts` | Health, bootstrap, reset-password, public track, session origin check, trace route templates | Auth and fixture marker. |
| `src/features/auth/LoginPage.tsx` | Sign-in, first-time setup, change-password | Arm B browser journey. |
| `src/app/session.tsx` | `/api/v1/me` query | Why the shell shows "Loading workspace…". |
| `src/app/router.tsx` | Route table | Pages the browser actually has. |
| `src/app/shell.tsx` | Sign-out button | Logout parity. |
| `src/lib/api.ts` | HTML / fetch-failed mapping | Client does not retry mutations. |
| `scripts/checkpoint-06-4-seed.mjs` | Reminder and container insert shape | Seed instances use `EXPORT_CASE`, not requirement ids. |
| `docs/AI_AGENT_HANDOFF.md` | 06.5.1 continuation and "Do not" | Progress update point. |
| `docs/IMPLEMENTATION_STATUS.md` | 06.5.1 section | Progress update point. |
| `package.json` | `typecheck`, `lint`, `test`, `build` scripts | Commands actually run. |
| `pnpm-lock.yaml` | Resolved version pins only | Vite 7.3.7, plugin 1.63.1, Wrangler 4.149.0, Miniflare 5.20261006.1-alpha, workerd 1.20261006.1, undici 7.29.1, Hono 4.13.13. |

## NOT_READ

| Area | Reason |
|---|---|
| `server/services/cases.ts` full file | Not modified. Invoice Rule C was covered by the existing Playwright suite, not by a new reading. |
| Migrations `0001`, `0003`, `0004` full text | Not applied to the developer database. Disposable Arm B applied the local migration set through Wrangler. |
| Most of `src/features/**` besides auth, router, shell, and session | No UI redesign. |
| Individual E2E spec bodies | The suite was executed; specs were not re-read line by line. |
| `node_modules` Miniflare pool source | Not re-read this run. The captured stack still ends in `dispatchFetch` / undici `processResponse`. No `node_modules` patch. |
| `.dev.vars`, `.dev.vars.perf`, `.dev.vars.e2e` values | Forbidden. Names and file paths only. |
| Developer SQLite contents | Metadata only: 638976 bytes, mtime `2026-10-14T21:07:38.4798993Z`. |

## Decisions forced by the current source

- There are 12 family names in `REMINDER_TRIGGER_FAMILIES` and 11 seeded rules. `CUSTOM_FOLLOWUP` has no seed row and no batch loader.
- `updateRule` commits the rule row before recompute. A dropped HTTP response can be `COMMITTED_RESPONSE_LOST`.
- The document-not-ready batch from 06.5.1 was already in the tree. This run measured the remaining serial families before replacing that loop.
- `cases.ts` was not treated as original historical source.

## Source-of-truth conflicts

None new. `CUSTOM_FOLLOWUP` is named in the enum and is not implemented in recompute. That is a gap, not a license to invent a policy.
