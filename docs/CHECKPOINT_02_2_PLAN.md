# Checkpoint 02.2 plan

LOCAL ONLY. Written after reading the repository and before the error/UI rewrite.

## Discovery

Root: `I:\WORK\InjazDocs`. Package manager: pnpm via corepack. Scripts: `dev` 43173, Playwright 43174 via `scripts/e2e-server.mjs`.

`AGENTS.md`: NOT FOUND. `.cursor` rules: NOT FOUND. Git: NOT FOUND. `.dev.vars`: NOT FOUND. `.wrangler/state`: NOT FOUND. Isolated E2E persist `.wrangler-e2e/state` EXISTS from the previous run and may be wiped only by `e2e-server.mjs`.

Read: README, package.json, vite/wrangler/playwright configs, `src/**` feature pages, `server/http/errors.ts`, `server/services/documents.ts`, `server/services/reports.ts`, `shared/permissions.ts`, e2e specs, `docs/REQUIREMENTS_MATRIX.md`, `IMPLEMENTATION_STATUS.md`, `WORKFLOWS.md`, `REMINDERS.md`, `SECURITY.md`, Checkpoint 02 and 02.1 reports, `CLOUDFLARE_STAGING_VERIFICATION_PLAN.md`.

Before screenshots for this checkpoint: copied the genuine Checkpoint 02.1 captures into `docs/qa-screenshots/checkpoint-02-2/before/`. They are the current navy-sidebar + white-card UI. Live recapture of the same UI is optional; those files are real browser shots, not generated.

## Confirmed defects

| Id | Severity | Evidence | Remedy |
| --- | --- | --- | --- |
| DOC-ADD | P1 | E2E-06/07 log: `NOT NULL constraint failed: operation_document_requirements.document_type_id`. Form can POST empty `documentTypeId` when the type list is empty. Service inserts without checking. | Validate type exists before INSERT. Field error `DOCUMENT_TYPE_REQUIRED`. UI does not submit empty. E2E asserts the row. |
| ERR-RAW | P1 | `ApiRequestError` displays `body.error.message`. Transition messages include enums. Activity page prints `row.action`. Settings print `name_en`. `tx()` keeps English in Arabic for tests. | Stable codes + client map. Never render raw `error.message`. Map activity and rule IDs. Update tests to localized/semantic locators. |
| UI-GENERIC | P1 | Owner: navy sidebar + white KPI cards is not enough. Dashboard is six equal cards. | Command-tower shell (header + operational rail, no navy column). Attention queue. Dual-lane case progress. Date-grouped schedule. |
| E2E-FLAKE | P1 | Full suite exit 1 on E2E-15 after Vite `fetch failed`. Focused rerun passed. 02.1 cannot be PASS for 02.2. | Retry only GET/scheduled after isolate reset; do not weaken assertions. Two clean full-suite runs required for PASS. |

No schema migration. No Cloudflare. No new UI kit.

## Design principles (must appear on operational screens)

1. **Command tower**: ink header + grouped operational rail; paper canvas. Not a copied CRM sidebar.
2. **Two lanes**: documents versus cargo, independent stages, planned vs actual, next action.
3. **Attention queue**: TODAY / URGENT / UPCOMING from real D1 reminders and deadlines.

Accent: sea-glass cyan on ink. Amber = actionable. Coral = blocker. Green = delivered. Tokens only.

## Acceptance

- Valid document add persists after refresh; empty type is 422 + inline AR/EN; no SQL in API or UI.
- User-facing errors map by code; unknown → generic localized fallback.
- Distinctive UI visible on dashboard, case, documents, bookings/schedule, reminders, public tracking.
- Arabic first-class; no raw enums for known states; IDs LTR.
- Full Playwright exit 0 twice, or verdict is PARTIAL.
