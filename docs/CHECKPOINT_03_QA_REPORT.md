# Checkpoint 03 QA report

LOCAL ONLY. Staging uploads were not run.

Environment: Windows, Node v24.19.0, pnpm 12.11.2, Wrangler 4.149.0. Playwright uses Chrome channel against `127.0.0.1:43174` and `.wrangler-e2e`. Developer data in `.wrangler/state` was not reset.

## Commands

| Command | Exit | Result |
| --- | --- | --- |
| `corepack pnpm typecheck` | 0 | clean after import error `code` typing |
| `corepack pnpm lint` | 0 | oxlint |
| `corepack pnpm test` | 0 | 19 passed / 5 files, including staging preflight exit 2 |
| `corepack pnpm build` | 0 | client JS 509.97 kB, gzip 157.18 kB, CSS 25.12 kB. Built in 33.33s. Chunk-size warning only |
| `corepack pnpm exec playwright test` before the A4/A5 retry tweak | 1 | 24 passed, 2 failed, 7.2m. A4 saw 38×410 and 2×429 after an isolate drop. A5 then received HTML (`fetch failed`) instead of JSON |
| `corepack pnpm exec playwright test` | 0 | 26 passed, 7.1m |
| `corepack pnpm exec playwright test` | 0 | 26 passed, 8.2m |

The two exit-0 runs are consecutive and both include E2E-01 through E2E-15b, A2–A5, locale, import screenshot assertions, and the visual capture. Vite still logs `fetch failed` during isolate resets. The limit of 30 was not raised.

## Screenshots

`docs/qa-screenshots/checkpoint-03/after/` contains the required names, including import preview, public tracking, document error, and auth error. Environment: isolated E2E, synthetic names such as "Preview Buyer".

## Cloud

`wrangler d1 list` and `wrangler r2 bucket list` were read-only. No deploy. `node scripts/staging-preflight.mjs` exits 2.
