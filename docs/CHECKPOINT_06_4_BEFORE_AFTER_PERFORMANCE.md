# Checkpoint 06.4 before and after

Same machine, same 500-case perf store, same administrator, same port 43176, N=20 API samples after two warmups unless noted. Client times are wall clock from the probe process. p95 at N=20 is a sample estimate.

Raw files: `docs/performance/checkpoint-06-4/dev-large.json`, `dev-large-after.json`, `built-large.json`, `api-summary.csv`.

## API, local dev, 500 cases

| Route | Before p50 / p95 | After p50 / p95 | Failures before → after |
| --- | --- | --- | --- |
| health | 75 / 138 | 75 / 86 | 0 → 0 |
| `/api/v1/me` | 188 / 538 | 179 / 857 | 0 → 0 |
| dashboard | 254 / 929 | 215 / 575 | 0 → 0 |
| case list | 234 / 863 | 221 / 444 | 0 → 0 |
| case detail | 411 / 1060 | 261 / 863 | 0 → 0 |
| bookings | 202 / 241 | 202 / 714 | 0 → 0 |
| reminders | 216 / 547 | 229 / 971 | 0 → 0 |
| schedule | 209 / 869 | 202 / 932 | 0 → 0 |

Case detail minimum moved from 384 ms to 202 ms. Dashboard minimum moved from 234 ms to 198 ms. Routes that were not batched (list, bookings, reminders, schedule, `/me`) stayed in the same band. Their p95 moved in both directions; N=20 cannot support a claim there.

Dashboard concurrency p50, dev, 500 cases:

| Width | Before | After | Failures |
| --- | ---: | ---: | ---: |
| 1 (N=8) | 257 | 193 | 0 |
| 2 (N=16) | 448 | 321 | 0 |
| 4 (N=32) | 847 | 638 | 0 |
| 8 (N=64) | 1775 | 1109 | 0 |
| 16 (N=64) | 3337 | 2836 | 0 |

## API, built preview, 500 cases, after the fix only

There is no built-mode before sample. Preview could not sign in until the perf secrets file was placed beside the built worker.

| Route | p50 | p95 | failures |
| --- | ---: | ---: | ---: |
| dashboard | 185 | 513 | 0 |
| case list | 207 | 593 | 0 |
| case detail | 249 | 663 | 1 reset |

8-wide dashboard p50 was 1002 ms, 0 failures.

## Browser

Dev before was not saved: the first Chrome script died on the public-track language button after the journeys, and the JSON was never written. Server logs from that attempt show dashboard handlers still in the same ~120–250 ms band, with one 1985 ms outlier. The numbers below are the after run.

| Journey | Dev after | Built after |
| --- | ---: | ---: |
| Dashboard reload p50 (N=10) | 982 ms | 421 ms |
| Sign-in → heading | 880 ms | 1033 ms |
| Open case | 385 ms | 391 ms |
| In-app navigation | 169–315 ms | 101–131 ms |

The dev-versus-built gap is the module graph, measured on the same data after the same code change. It is not a before/after of the batch.

## What changed the numbers

`overview` and `getCaseOverview` send their independent reads in one `db.batch` instead of one round trip each. Visibility SQL is unchanged. The officer list total stayed 250.

Public tracking was not a speed change. Anonymous `GET /api/v1/public/track/not-a-real-token` was 401 before the route was registered ahead of the session middleware and 410 after.

No index, no bundle split, no HTTP retry, and no package upgrade is included in the delta.
