# Checkpoint 06.3 changed files

No Git repository. Revert is by restoring the file contents.

## Kept

| Path | Why |
| --- | --- |
| `scripts/checkpoint-06-3-probe.mjs` | Local probe. Reads `.wrangler-e2e/admin.json` and writes timing JSON. Does not print the password or the bootstrap secret. Not part of `pnpm test` or Playwright. |
| `docs/CHECKPOINT_06_3_*.md` | This checkpoint’s reports |
| `docs/performance/checkpoint-06-3/*` | Anonymized timings, query plans, journey CSV. No cookies, tokens, or HAR |
| `docs/AI_AGENT_HANDOFF.md` | Pointer to this checkpoint |
| `docs/IMPLEMENTATION_STATUS.md` | Status line only |

## Tried and restored

`src/app/router.tsx` was switched to `React.lazy` for feature pages, measured, and written back to static imports. The warm trial was slower (login 2418 ms → 3883 ms, in-app cases 104 ms → 296 ms) while `/src` requests only fell from 26 to about 20. The production client chunk hash stayed `index-Bc7FcXnZ.js`.

## Not touched

`server/services/cases.ts`, invoice correction, permissions, reminders, tracking, migrations, `.wrangler/state`, `.dev.vars`. `.wrangler-preview/` was created for an unauthenticated preview probe and then deleted. `.wrangler-e2e/` is wiped by `scripts/e2e-server.mjs` when Playwright or that script starts.

## Revert the probe

Delete `scripts/checkpoint-06-3-probe.mjs` and `docs/performance/checkpoint-06-3/`. Product behavior does not depend on them.
