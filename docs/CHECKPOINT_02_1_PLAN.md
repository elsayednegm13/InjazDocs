# Checkpoint 02.1 plan

LOCAL ONLY. Written after reading the repository, before the UI rewrite. This is the execution plan for the work in this checkpoint, not a later phase.

## Sources read

Read: `README.md`, `package.json`, `vite.config.ts`, `playwright.config.ts`, `wrangler.jsonc`, `index.html`, `src/**`, `server/**`, `shared/**`, `e2e/**`, `tests/domain.test.ts`, `drizzle/migrations/0001_init.sql` through `0003_checkpoint.sql`, `scripts/e2e-server.mjs`, and every file in `docs/` including `CHECKPOINT_02_FINAL_REPORT.md`, `CHECKPOINT_02_QA_REPORT.md`, `CHECKPOINT_02_PLAN.md`, `REQUIREMENTS_MATRIX.md`, `IMPLEMENTATION_STATUS.md`, `ARCHITECTURE.md`, `WORKFLOWS.md`, `REMINDERS.md`, `SECURITY.md`, `CLOUDFLARE_STAGING_VERIFICATION_PLAN.md`.

`AGENTS.md`: NOT FOUND. `.cursor` rules: NOT FOUND. Git repository: NOT FOUND (no `.git`). `.dev.vars`: NOT FOUND. `.wrangler/state`: NOT FOUND. The Checkpoint 02 claim that `.wrangler/state` still holds `ops@exportflow.local` and `EF-2026-0001` is not true in this workspace copy.

## Baseline defects (verified in code, not assumed)

| Id | Severity | Where | Defect | Intended change |
| --- | --- | --- | --- | --- |
| A1 | P1 | `e2e/operations.spec.ts` E2E-15, `server/services/reminders.ts` | Browser test stops at snooze. First insert always stored `PENDING` even when already due. Reason text was not item-specific. Snooze was not cleared on resolve. Resolved reminders could remain in the notification list. | Real browser flow: due via rule offset + scheduled handler, snooze, upload vs approval, resolve, cron does not resurrect, unrelated reminder stays. |
| A2 | P1 | `server/services/uploads.ts`, `documents.ts` | Download already called `authorizeObjectKey`, but a 403 named the case. Document attach did not require the completed upload session to belong to that requirement. Booking/container/schedule lists were not case-scoped. | Generic 404 on denied object access. Bind attach to the completed session. Scope list queries with `caseVisibilitySql`. |
| A3 | P1 | `server/services/users.ts` | Last-admin guard looked at the `administrator` role label only. Overrides and `replaceRolePermissions` could strip effective `users.manage` / `roles.manage`. A principal with only one of those permissions could edit privileges. | Count effective root admins. Restore-on-failure. Only a user who currently holds both permissions may change them. |
| A4 | P1 | `server/auth.ts`, `server/services/tracking.ts`, `app.ts` | `X-Forwarded-For` and `CF-Connecting-IP` were trusted. The rate counter incremented and then read in a second statement, so concurrent requests could observe a later total. | Ignore forwarding headers unless `TRUST_CF_CONNECTING_IP=1`. Atomic `RETURNING hits`. |
| A5 | P1 | `server/services/uploads.ts` | Bad etag/size/signature could 500 or leave a usable object. Expired multipart sessions were not aborted by the scheduler. | Map finalize failure to 409, delete mismatched objects, expire stale sessions from the scheduled handler. |
| UI | P1 | `src/features/**`, `src/app/shell.tsx`, `src/index.css` | One flat card style, raw English inside Arabic mode, enum buttons, no density system, Google Fonts CDN, dashboard copy hardcoded, public tracking not bilingual. | Tokenized shell, tables, forms, two case journeys, system fonts, Arabic dictionaries. No new component library. |
| i18n | P1 | `src/locales/*.json` (46 keys) | Most screens bypass the dictionaries. Status chips render raw enums in Arabic. | One `ar`/`en` dictionary, RTL/LTR already via `exportflow.lang`, bidi isolation for identifiers. |

## Out of scope

Remote D1/R2, DNS, WAF, email, live DHL, 20/100/250/400 MiB presigned uploads, production backups. No schema migration: the fixes are code-only. No new SaaS dependency.

## Acceptance

Focused Playwright tests on the isolated workerd (`.wrangler-e2e` only), then the existing suite, `pnpm test`, typecheck, lint, build, and a scheduled-handler smoke. Dev persist path `.wrangler/state` is not deleted. Screenshots go under `docs/qa-screenshots/checkpoint-02-1/`.
