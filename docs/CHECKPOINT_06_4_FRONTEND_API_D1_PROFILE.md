# Checkpoint 06.4 frontend, API, and D1 profile

The 500-case store did not reproduce a multi-second data stall. The same dashboard query is about 200 ms from 10 cases through 500 cases. Local SQLite runs that SQL in about 1 ms. The wait is the Worker/D1 round trip, the session request in front of the page, and, in dev, the Vite module graph.

## D1 plans on 500 cases

Engine: `node:sqlite` opened on the perf file, not the Worker binding. N=20. Source: `docs/performance/checkpoint-06-4/explain-large.json`.

| Query | p50 ms | rows | Plan note |
| --- | ---: | ---: | --- |
| Dashboard counts | 0.585 | 1 | Status counts use `export_cases_status_idx`. Bank-path count scans `export_cases`. Document count scans `operation_document_requirements`. |
| Recent events | 0.260 | 12 | Scan `case_events` plus a temp b-tree for `ORDER BY created_at`. Index is `(case_id, created_at)` only. |
| Due reminders | 0.603 | 24 | `reminder_due_idx`, then a temp b-tree for the sort. |
| Case list page | 1.217 | 20 | Temp b-tree for `GROUP_CONCAT` and for `ORDER BY updated_at`. |
| Schedule, all open bookings | 1.182 | 500 | Scan plus temp b-tree. No `LIMIT`. |
| Containers | 3.374 | 200 | Scan `containers`, temp b-tree, `LIMIT 200`. |

An index on `case_events(created_at)` would remove the temp b-tree. At 1500 rows the sort is 0.26 ms. No migration was added. A developer migration is not proposed for this cost.

## Worker versus client, before the batch

On the dev server, dashboard handler lines during the before probe were commonly 179–220 ms, with separate samples at 512, 835, and 906 ms. The matching client median was 254 ms (N=20). Health, which does one `SELECT 1`, was 75 ms at the client and about 17–25 ms in the handler. The gap from a 0.6 ms local SQL plan to a ~190 ms handler is the D1 binding round trip, repeated once per statement.

Case detail was the clearest serial chain: access check, then customer, snapshot, invoices, documents, bookings, containers, reminders, then two custom-field reads. Client median 411 ms, minimum 384 ms. Several handler lines sat around 330–350 ms, with outliers above 1 s.

`/api/v1/me` client median was 188 ms before and 179 ms after. It was not part of the batch. Full reload still waits for it because `SessionProvider` blocks the tree on that query (`retry: false`). Anonymous login and public track also call it and log a 401. That 401 was left as specified.

## Frontend, 500 cases

Dev Chrome, after the batch (`browser-dev-large-after.json`):

| Journey | Time |
| --- | --- |
| Sign-in → dashboard heading | 880 ms |
| Dashboard reload, N=10 | p50 982 ms, min 964, max 1380 |
| First operations list until rows | 909 ms |
| Open case until reference | 385 ms |
| Later in-app dashboard ↔ list | 169–315 ms |

Built preview, same data (`browser-built-large.json`): dashboard reload p50 421 ms. In-app navigation 101–131 ms. The extra half-second in dev is the module graph (06.3 counted about 26 `/src` requests per full reload). The client bundle is still one 541.74 kB chunk. Splitting it was slower in 06.3 and was not tried again.

Schedule's first dev load was 1893 ms (one sample, includes first-time transforms). The same route on the built preview was 372 ms. The API returns all 500 bookings and the p50 of that call is 162–209 ms. The dev spike was not treated as a render defect.

Operations paging already stops at 20 rows. The UI does not download 500 cases to filter them.

## Data size, after the batch, dev, N=20, 0 failures

| Route | 10 cases p50 | 100 cases p50 | 500 cases p50 |
| --- | ---: | ---: | ---: |
| Dashboard | 199 | 200 | 215 |
| Case list | 227 | 220 | 221 |
| Case detail | 261 | 269 | 261 |
| Schedule | 199 | 200 | 202 |

10 and 100 were measured only after the fix. They show the cost does not grow with the fixture. They are not a before/after pair.

## Concurrency

Dev, before the fix, dashboard p50: 1-wide 257 ms (N=8), 2-wide 448 (N=16), 4-wide 847 (N=32), 8-wide 1775 (N=64), 16-wide 3337 (N=64). Zero failures. workerd runs these on one isolate, so wall time grows with the queue. After the shorter dashboard handler, 8-wide fell to 1109 ms and 16-wide to 2836 ms. That is queue math, not a faster database engine.
