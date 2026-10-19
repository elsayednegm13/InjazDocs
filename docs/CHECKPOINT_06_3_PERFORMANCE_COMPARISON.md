# Checkpoint 06.3 performance comparison

The only product edit tried was route-level `React.lazy` for feature pages. Warm measurements got worse, so `src/app/router.tsx` was restored. Shipped client bundle is unchanged.

## Conditions

Same machine (12 logical processors, 15.8 GiB RAM), Node v24.19.0, Vite 7.3.7, Playwright Chrome, isolated E2E on port 43174, empty case list, `CI=1`. Baseline file: `baseline-dev2-browser.json` (server already warm). Trial files: `after-dev-browser.json` (first run on a new server, includes compile) and `after-dev-warm-browser.json` (second run, fairer). Units are milliseconds. N=1 per named journey except where several warm reloads are listed. Do not read these as a percentage speedup.

## Journeys

| Journey | Baseline ms | Trial cold ms | Trial warm ms | Kept |
| --- | --- | --- | --- | --- |
| Login → dashboard heading | 2418 | 6430 | 3883 | No. Warm trial slower |
| Dashboard full reload | 1651 | 1210 | 1364 | No stable win |
| Dashboard warm samples 2–5 | 1059, 1048, 1067, 1033 | 1069, 1083, 1587, 1845 | 1079, 1413, 1141, 1336 | No |
| In-app cases link | 104 | 379 | 296 | No. Extra chunk request (`src` 0 → 2) |
| In-app dashboard link | 105 | 262 | 152 | No |
| `/src` requests on a full reload | 26 | 20–21 | 20–21 | Fewer modules, slower screens |

API failure rate stayed 0 on the health and authenticated matrices before and during the trial. Console signature stayed the expected login 401, with one extra console line on the warm trial login (2 vs 1). That trial was discarded with the revert.

## Bundle

| Asset | Before | After the revert build |
| --- | --- | --- |
| `dist/client/assets/index-Bc7FcXnZ.js` | 541.74 kB raw, gzip 164.76 kB | Same filename and sizes |
| CSS | 30.68 kB raw, gzip 6.37 kB | Same |

Vite still warns that the client chunk is over 500 kB. Splitting it was the trial above. On this machine the 541 kB file is not what made the dev dashboard take about a second: a full reload waits on about 26 module requests plus `/me` (~174 ms median) and `/dashboard` (~235 ms median). Local built preview served that JS file in 8–29 ms, and health in about 22 ms, so the dev hop is slower than the built asset. Authenticated built journeys were not measured (see the baseline note).

## User-visible slowness

On an empty isolated database, warm dashboard full reloads landed between about 1.0 s and 1.7 s to the real heading, and in-app navigation was about 100 ms. That does not reproduce a severe multi-second stall on this fixture. It also does not prove the developer database or a large document feels fast. Mark the perception result `NOT REPRODUCED` for severe slowness, and keep performance acceptance PARTIAL.

Parallel 8 dashboard calls through one Playwright context: median 2918 ms, 0 failures. Local Miniflare serializes concurrent work. That is a capacity characteristic of this dev runtime, not a query that was rewritten.
