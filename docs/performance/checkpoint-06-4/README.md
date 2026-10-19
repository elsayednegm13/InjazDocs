# Checkpoint 06.4 performance evidence

Sanitized measurements only. No cookies, passwords, tracking tokens, or row contents.

## Isolation

- Disposable store: `.wrangler-perf/` (gitignored).
- Developer store `.wrangler/state` was not opened for writes. Its D1 file stayed at 638976 bytes, mtime `2026-10-14T21:07:38.480Z`.
- Perf server: `node scripts/checkpoint-06-4-server.mjs` on `http://127.0.0.1:43176`, `EXPORTFLOW_PERSIST=.wrangler-perf/state`, `CLOUDFLARE_ENV=perf`, `EXPORTFLOW_TRACE=1`, file watcher left on.
- Built preview used the same port and persist path only after the dev server was stopped. A temporary `dist/exportflow/.dev.vars` was copied from `.dev.vars.perf` so Better Auth accepted the preview origin, then deleted. `node scripts/build-artifact-guard.mjs --root dist --values .dev.vars` then reported `publishable output is clean: dist`.

## Reproduce

```
node scripts/checkpoint-06-4-reset.mjs
node scripts/checkpoint-06-4-server.mjs
node scripts/checkpoint-06-4-bootstrap.mjs
```

Stop the server, then:

```
node --experimental-sqlite scripts/checkpoint-06-4-seed.mjs --dataset large
node scripts/checkpoint-06-4-server.mjs
```

In another shell:

```
set EXPORTFLOW_PROBE_TAG=dev-large
set EXPORTFLOW_PROBE_DATASET=large
node scripts/checkpoint-06-4-probe.mjs
```

`large` is 500 cases, `medium` 100, `small` 10. Seed only while no Vite process has the perf SQLite open.

## Files

| File | Contents |
| --- | --- |
| `dev-large.json` | Authenticated dev API, 500 cases, before the batch change. N=20 per route. |
| `dev-large-after.json` | Same server and dataset after the batch and public-route fix. |
| `dev-medium-after.json` / `dev-small-after.json` | After the fix only. Parallel burst skipped. |
| `built-large.json` | Authenticated `vite preview` on the 500-case store. |
| `browser-dev-large-after.json` | Chrome journeys, dev, 500 cases. |
| `browser-built-large.json` | Chrome journeys, built preview, 500 cases. |
| `explain-large.json` | `EXPLAIN QUERY PLAN` plus node:sqlite timings on the 500-case file. |
| `transport-large.json` | Keep-alive, 6s idle, and fresh-connection dashboard reads. |
| `comparison.json` / `api-summary.csv` | Route medians used by the report. |

p95 is omitted in the probe when N is under 20. A p95 from N=20 is a sample estimate, not a stable percentile.
