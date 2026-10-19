# Checkpoint 06.5.2 reminder correctness matrix

Fixture: disposable `.wrangler-perf` 500-case store. Same offset was sent, so a correct update keeps the status histogram. Snapshot files: `instances-before-batch.json` and `instances-after-batch.json`.

| Rule | Before | After | Verdict |
|---|---|---|---|
| `rr-arr` | ACTIVE 500 | ACTIVE 500 | Same |
| `rr-bank` | ACTIVE 100 | ACTIVE 100 | Same. The loader saw 500 cases and did not insert the other 400 |
| `rr-courier` | PENDING 100 | PENDING 100 | Same |
| `rr-doc-due` | ACTIVE 450, PENDING 250, RESOLVED 250, SNOOZED 250 | identical | Snooze rows kept |
| `rr-eta` | ACTIVE 500 | ACTIVE 500 | Same |
| `rr-review` | ACTIVE 600 | ACTIVE 600 | Same. 1500 requirements were considered; only the 600 existing matching rows stayed |
| `rr-load`, `rr-cutoff`, `rr-ctr`, `rr-goods` | no rows | no rows | Condition or missing dates did not invent rows |

Seed reminder rows that use `target_type = EXPORT_CASE` are a different dedup key from requirement-keyed rows. They were not deleted.

## Oracle items

| Item | Evidence this run | Status |
|---|---|---|
| Same-offset PATCH does not reshuffle statuses | Histogram above | VERIFIED_BY_TEST on the 500-case store |
| Snooze rows are not cleared by a same-offset edit | 250 SNOOZED before and after | VERIFIED |
| DIRECT / non-review cases do not gain a bank reminder | Bank count stayed 100 | VERIFIED for this fixture |
| Review rule does not create a row for every requirement | 600 stayed 600 while 1500 were scanned | VERIFIED |
| Document approval still resolves the document reminder | Playwright E2E-15 passed after the batch | VERIFIED_BY_TEST |
| Review-rule PATCH in E2E-15b | Passed, server 81 rows in 152 ms | VERIFIED_BY_TEST |
| Offset direction and timezone boundaries | Existing domain unit tests passed (17). No new timezone fixture | PARTIAL |
| Repeat interval absent means one cycle | Unchanged `notificationCycleKey`. Not re-fired in a new test | PARTIAL |
| ETA shift cancels the old generation | Batch cancels an open row only when its dedup key differs. Not exercised with a changed date in this run | PARTIAL |
| Cron does not double-send | Manual cron on empty Arm B returned 200. 500-case cron not timed | NOT_TESTED at 500 |
| Unauthorized employee cannot patch a rule | Permission check unchanged. Full Playwright security specs ran inside the 32 and were not split out here | Covered only as part of the suite |
| Concurrent editors | NOT_TESTED | NOT_TESTED |
| `CUSTOM_FOLLOWUP` | No rule row | NOT_IMPLEMENTED |

D1 `batch` is used for groups of 80 statements. The rule `UPDATE` is a separate call before the batch, matching the previous function. A crash after that `UPDATE` and before the response is still `COMMITTED_RESPONSE_LOST`. No client retry was added.

The expired snooze date in the perf seed (`2026-07-15`) was not rewritten to ACTIVE. Those SNOOZED rows are the seed's `EXPORT_CASE` keys, which this batch does not own. Requirement-keyed rows were updated in place and kept their statuses.
