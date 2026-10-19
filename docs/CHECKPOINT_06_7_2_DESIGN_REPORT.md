# Checkpoint 06.7.2 — UX feedback + design pass

Scope: close the three product gaps reported after 06.7.1 (invisible errors, no upload feedback, no file visibility) and bring the
dashboard / operations list / case dossier closer to the approved references
(`docs/design-references/exportflow-premium-workspace-0671/REFERENCES/TARGET_01_Premium_Dashboard_AR.png`,
`TARGET_02_Premium_Export_Operations_AR.png`).

## 1. Errors were invisible

Root cause (from the user's console capture): `onClick` handlers called `api(...)` without `try/catch`, so a 409/403 surfaced only as
`Uncaught (in promise) ApiRequestError` in devtools.

- `src/lib/notify.ts` (new): `describeError` maps `error.code` to `errors.<CODE>` in the active language (fallback: English text from
  `src/lib/fail.ts`), plus `notifyError` / `notifySuccess` on top of `sonner`.
- `src/components/ui/toaster.tsx` (new) + mount in `src/main.tsx`: global Toaster, RTL aware, `richColors`, `closeButton`.
- `src/main.tsx`: `QueryCache.onError` toasts every failed query except 401; `window.addEventListener("unhandledrejection", …)` toasts
  anything that still escapes a handler — nothing can fail silently again.
- Every action that previously swallowed its error now shows a toast and inline text: document review, add requirement, bank stage,
  direct route stage, courier create/status, booking create, tracking link create/revoke, case status transitions.

## 2. Uploads had no feedback

`DocumentsPanel` (`src/features/cases/CasesPages.tsx`):

- per-requirement upload progress (percentage + progress bar) via the existing `uploadFile(..., onProgress)` hook,
- file picker disabled while that requirement is uploading,
- success toast carrying the real file name,
- inline error + toast on failure; the input is reset so the same file can be re-picked.

## 3. Uploaded files were invisible

- `server/services/cases.ts`: `getCaseOverview` now also returns `documentVersions` (join on requirements, uploader name), additive only.
- `DocumentsPanel` renders the versions of each requirement: original file name, version number, byte size, upload time, review state,
  and an **Open file** link.
- `server/http/app.ts` `GET /api/v1/files/download`: looks up `document_versions.original_name` / `content_type` by `r2_key`,
  serves PDFs and images `inline` so they open in the browser, everything else as `attachment`, and sends RFC 5987
  (`filename*=UTF-8''…`) so Arabic file names survive.

## 4. Design pass (reference fidelity)

- Shell (`src/app/shell.tsx`): brand block with logo mark, white active nav pill with teal icon, sidebar footer card, header with bell,
  globe language pill, avatar + name chip, compact sign-out.
- Dashboard (`src/features/dashboard/DashboardPage.tsx`): hero band with ship mark, pastel KPI cards (icon chips, hints, overdue turns
  rose only when > 0), actions table with column headers + priority pills, alerts panel as collapsible queue rows with counts and a
  "most urgent" callout, upcoming dates with date tiles, document/goods track cards, latest activity as a two-column card grid.
- Shared primitives (`src/components/ui/chrome.tsx`): `StatCard` gained `tone`, `SectionCard` gained `icon` / `action`.
- Operations list + dossier (`src/features/cases/CasesPages.tsx`): KPI cards, toolbar search card, table inside a card with sticky-style
  header and hover/selection states, richer preview rail; dossier header rewritten into title block + meta strip + next-action strip;
  overview tab now shows a case summary, reminders with statuses and custom fields; reminders tab restyled.
- Arabic dates now use `ar-EG-u-nu-latn` so numerals no longer mix Arabic-Indic and Latin forms.
- Case activity feed: dashboard `recent` rows now include `case_reference` (server: `server/services/reports.ts`) and the event map in
  `src/lib/copy.ts` learned the `CASE_CREATED`, `CASE_STATUS`, `BANK_STATUS`, `DIRECT_STATUS`, `COURIER_STATUS`, `CONTAINER_STATUS`,
  `BOOKING_CREATED`, `DOCUMENT_UPLOADED`, `DOCUMENT_REVIEW`, `ROUTE_CHANGED` codes written by `writeCaseEvent`, so rows show a real
  label instead of "Recorded activity".

## Evidence

- `docs/qa-screenshots/checkpoint-06-7-2/after/` — dashboard (EN/AR 1366 + 390), operations list (AR 1366 + 390), dossier (AR 1366).
- `scripts/capture-design.mjs` — reproduces the set (`CAPTURE_DIR`, `VERIFY_EMAIL`, `VERIFY_PASSWORD`).
- Browser verification of the upload flow: `scripts/verify-upload-ux.mjs` (sign-in, upload PDF, success toast, version row, download
  headers `inline; filename="sample.pdf"`, global error toast, no uncaught promise rejections) — 8/8 PASS.
- `pnpm typecheck`, `pnpm lint` (one pre-existing `CustomFieldsPanel` warning), `pnpm test` 33/33.

## Still open

- Full Playwright suite re-run for this checkpoint (launched after the commit; result to be recorded here).
- Visual approval of the new pass against the two reference images.
- Known local transport flakiness (`ECONNRESET` before Hono) is unrelated to these changes.
