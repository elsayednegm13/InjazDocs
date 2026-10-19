# Checkpoint 06.5.2 safety baseline

## Machine

- Root: `I:\WORK\InjazDocs`
- OS: Windows 10.0.26300 (`win32 10.0.26300`)
- CPU: Intel Core i7-9750H, 12 threads, 16225 MB RAM
- Node: v24.19.0
- Package manager: `corepack pnpm` (the `pnpm` shim was not on PATH)
- Lockfile pins: Vite 7.3.7, `@cloudflare/vite-plugin` 1.63.1, Wrangler 4.149.0, Miniflare 5.20261006.1-alpha, workerd 1.20261006.1, undici 7.29.1, Hono 4.13.13
- No in-place lockfile or dependency upgrade

## Developer database

Path: `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/e086a16c2df761e404ed26001d3f081a26268e90033ffbf14d8419a939ea8dbc.sqlite`

| When | Bytes | mtime UTC |
|---|---|---|
| Before any server this run | 638976 | 2026-10-14T21:07:38.4798993Z |
| After Arm B stop | 638976 | 2026-10-14T21:07:38.4798993Z |

No test command used this path. Perf used `.wrangler-perf/state`. E2E uses `.wrangler-e2e`. Arm B used `.wrangler-reliability-b/state` and refused the developer state path in `scripts/reliability-arm-b.mjs`. Contents were not read.

## Secrets

- `.dev.vars` was not opened and not modified.
- Perf server log: `Using secrets defined in .dev.vars.perf`. Variable values were not printed.
- Arm B log, every clean start: `Using secrets defined in .wrangler-reliability-b\.dev.vars`.
- Arm B vars names only: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BOOTSTRAP_SECRET`, `EXPORTFLOW_TRACE`, `EXPORTFLOW_FIXTURE`.
- `EXPORTFLOW_FIXTURE=reliability-b` was required by the session script. Health returned `fixture: reliability-b`.
- The script refused the file if its real path was not under `.wrangler-reliability-b` or if cloud key names were present.
- `CLOUDFLARE_ENV` was deleted in the Arm B child environment so Wrangler would not fall through to the project `.dev.vars`.
- After the last Arm B stop, `.wrangler-reliability-b/.dev.vars` was deleted. Check: `VARS_REMOVED`.
- `dist/.dev.vars` and `dist/exportflow/.dev.vars` were absent after build. Guard: `publishable output is clean: dist`.

## Ports and processes

Chosen ports were free at the start (`netstat` found no listeners on 4317x / 4318x / 9231). This run only stopped PIDs it had started:

| Arm | Port | Persist |
|---|---|---|
| Developer app | 43173 not started | not used |
| Canonical E2E | 43174 | `.wrangler-e2e` via `scripts/e2e-server.mjs` |
| Perf measurements | 43176 | `.wrangler-perf/state` |
| Arm B Vite | 43181 | none (static/dev only) |
| Arm B Worker | 43182 | `.wrangler-reliability-b/state` |

The first perf launch inherited `EXPORTFLOW_PORT=43174` from the shell and was stopped before any measurement. Later launches set `EXPORTFLOW_PORT=43176` explicitly.

## Rollback

Product edits are limited to `server/services/reminders.ts`, `server/http/app.ts` (`EXPORTFLOW_FIXTURE` on health only when set), `worker-configuration.d.ts`, and `vite.reliability.config.ts` (diagnostic watch). Revert those four files to restore the serial rule update and the previous diagnostic Vite watch. Do not revert the 06.5 dashboard scope fix or the 06.5.1 document batch; the document batch is now inside the shared family batch.

No Git commands were run.
