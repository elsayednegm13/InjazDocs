# Checkpoint 06.5.2 requirements traceability

Frozen behavior was not intentionally changed. Coverage below is what this run actually executed.

| Requirement | Service / route | Test | Observed | Gap | Status |
|---|---|---|---|---|---|
| Case numbers and visibility | `caseVisibilitySql`, reports overview | `tests/dashboard-scope.test.ts` 2/2; Playwright suite includes the dashboard | Unit test passed. Live 250/500 split was not remeasured | Live perf dashboard not rechecked | PASS for the unit regression |
| Invoice total is explicit; Rule C lock | `cases.ts` correction batch | Inside Playwright (invoice-lock spec is part of the 32) | Run 1: 32 passed. Run 2 in the QA report | Spec body not re-read | PASS if both suites are green |
| Documents, bank vs direct | Document services; bank reminder condition | E2E-15; bank instance count stayed 100 | DIRECT-style cases did not gain bank rows in the perf fixture | No new dedicated DIRECT negative spec | PASS for the measured fixture |
| DHL manual, no invented carrier events | Courier reminder copy | Family inventory only | No carrier client added | No new DHL test | UNCHANGED |
| Bookings and unnumbered slots | Booking loaders skip null dates | Family timings | Zero loading/cutoff rows stayed zero | No new container-number test | UNCHANGED |
| Arrival is not final delivery | `GOODS_DELIVERY_PENDING` uses `actual_eta` and container status | Domain unit tests | 17 domain tests passed. Goods family wrote 0 rows | No new ETA-shift fixture | PARTIAL |
| Reminder offset, once-vs-repeat, snooze, dedupe | `evaluateDue`, `syncRuleInstances` | Status histogram; E2E-15 | Histogram unchanged; E2E-15 passed in 1.9 m | Timezone, repeat cap, and ETA shift not re-fired | PARTIAL |
| Public tracking without login | `GET /api/v1/public/track/:token` | Arm B unknown token | 410 | Revoke flow not re-run on Arm B | PASS for unknown token |
| Custom fields permissioned | Existing suite | Playwright | Included in the 32 | Not split out | PASS if the suite is green |
| Localized errors, real HTTP status | `api.ts` maps HTML fetch-failed; server still returns the real status on handled errors | Client unchanged | Vite HTML 500 still happens on reset, and the client maps it | The reset itself remains | UNCHANGED |
| No new product category, mail, or live tracker | n/a | Diff scope | No such feature added | n/a | PASS |

`cases.ts` remains reconstructed-and-contract-verified from earlier checkpoints. This run did not reopen that file.
