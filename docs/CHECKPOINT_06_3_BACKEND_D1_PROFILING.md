# Checkpoint 06.3 backend and D1 profiling

Isolated E2E only. Dataset at explain time: 0 cases, 0 reminders, 0 case events, 1 synthetic user. Plans: `docs/performance/checkpoint-06-3/explain-e2e.json`. No index was created. Developer `.wrangler/state` was not migrated.

## End-to-end API time is not SQL time

Dev health (no session) median about 61 ms. Authenticated `/api/v1/me` median 174 ms. `/api/v1/dashboard` median 235 ms. The dashboard handler is three sequential D1 calls (`overview` in `server/services/reports.ts`: counts, recent events, due reminders) after Better Auth `getSession` and `loadActor`. The gap from `/me` to `/dashboard` is about 60 ms on an empty database. Built-preview health was about 22 ms, so a large share of the dev number is the Vite → workerd hop.

Eight parallel dashboard reads on one reused Playwright context stretched the median to 2918 ms with zero failures. That is queueing in the local runtime, not an N+1 that was counted in one request.

## Plans on the empty E2E database

| Query | Plan |
| --- | --- |
| Case status counts | `export_cases_status_idx` covering index |
| Completed count | search `export_cases_status_idx` on status |
| Overdue reminders | search `reminder_due_idx` on status and `due_at` |
| Due reminder list | search `reminder_due_idx`, then case primary key, then a temp b-tree for `ORDER BY due_at` |
| Bank-path count | scan `export_cases` (no index on `bank_path_status`) |
| Document pending count | scan `operation_document_requirements` |
| Courier count | scan `courier_shipments` |
| Recent events `ORDER BY created_at DESC` | scan `case_events` plus a temp b-tree. Existing index is `(case_id, created_at)`, which does not serve a global time order |
| Case list `ORDER BY updated_at` | scan `export_cases` plus a temp b-tree. Existing index is `(status, updated_at)` |

These scans are not a measured user stall at N=0. Dashboard median stayed 235 ms. No additive migration was written. Adding indexes for `bank_path_status`, global `case_events.created_at`, or `updated_at` would be a schema change and is not authorized for the developer database.

## Domain paths not rewritten

Invoice Rule C remains one D1 `batch` in `correctCompletedInvoice`. It was not split into independent writes. The scheduled handler still runs only when invoked; the Vite plugin source used by this repo does not start the `* * * * *` cron on a timer during `vite dev`. That hypothesis stays unproven and is not treated as the reset cause.

Public tracking, bank columns, and permission filters were not relaxed.
