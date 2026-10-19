# Checkpoint 06.5.2 performance and reliability

All timings are from the disposable 500-case store on `http://127.0.0.1:43176`. The client sent the rule's current offset, so the write was a recompute, not a business change. N=2 warm client samples after the cancel-trim. p95 is not claimed at N=2. Server times are the two warm passes (983–1391 ms means the two samples).

## Rule PATCH

| Family | Eligible work | Before | After client N=2 | After server N=2 | Resets |
|---|---|---|---|---|---|
| `DOCUMENT_REQUIREMENT_NOT_READY` | 1000 required rows | 453 ms client in 06.5.1 (different code path) | 1686 ms, 1210 ms | 1391 ms, 983 ms | 0 |
| `DOCUMENT_REVIEW_PENDING` | 400 cases / 600 instances before; 1500 rows scanned after | 220528 ms client, 220110 ms server | 1589 ms, 1232 ms | 1279 ms, 964 ms | 0 |
| `BANK_REVIEW_OVERDUE` | 500 cases scanned, 100 instances | Not timed before (same serial function) | 674 ms, 837 ms | 357 ms, 285 ms | 1 before the handler on the first attempt, then 0 |
| `COURIER_STATUS_CHECK` | 100 shipments | Serial, not separately timed | 683 ms, 633 ms | 333 ms, 283 ms | 0 |
| `BOOKING_LOADING_APPROACHING` | 0 dated rows | n/a | 491 ms, 477 ms | 100 ms, 99 ms | 0 |
| `BOOKING_CUTOFF_APPROACHING` | 0 dated rows | n/a | 1071 ms, 778 ms | 90 ms, 339 ms | 0 |
| `BOOKING_ETD_FOLLOWUP` | 500 bookings | Serial, not separately timed | 398 ms, 910 ms | 136 ms, 119 ms | 0 |
| `CONTAINER_STATUS_FOLLOWUP` | 0 LOADED/DEPARTED | n/a | 459 ms, 351 ms | 42 ms, 41 ms | 0 |
| `VESSEL_ETA_APPROACHING` | 500 bookings | Serial, not separately timed | 1939 ms, 1643 ms | 1554 ms, 1244 ms | 0 |
| `ARRIVAL_OVERDUE` | 500 bookings | Serial, not separately timed | 2037 ms, 1978 ms | 1615 ms, 1533 ms | 0 |
| `GOODS_DELIVERY_PENDING` | 0 with actual ETA | n/a | 538 ms, 481 ms | 108 ms, 91 ms | 0 |

The review rule is the one with a true before/after on this store: 220.5 s down to about 1.2 s. Families with a zero row count are fast because there is nothing to write; they do not prove a 500-row case. ETA and arrival are the 500-row booking samples and stayed under about 2 s.

10-case and 100-case stores were not reseeded this run. Label: NOT_TESTED at those sizes. The defect that was hanging was the 500-case serial loop.

An earlier batch draft emitted a cancel statement per row and took 4462 ms (documents) and 5466 ms (review). That draft was replaced. Those numbers are in `family-patch-after-with-cancel.json` and are not the final code.

## Transport

| Exposure | Requests | Resets |
|---|---|---|
| Perf family sweeps on Arm A | 1 + 11 + 11 + 11 PATCH/read mix | 1 (`rr-bank`, before handler) |
| Arm B authenticated loop | 1950 in 605485 ms | 0 |
| Playwright run 1 | full suite, 32 passed, 13.0 m | 5 trace lines, 6 Vite `fetch failed` lines |

Playwright run 2: 32 passed, exit 0, 12.5 m, 3 trace lines and 4 Vite `fetch failed` stacks. A green suite does not clear the reset count.

Cron `processDueReminders` on the 500-case store was not timed. It still recomputes each touched case serially, capped at 100 due rows per pass.
