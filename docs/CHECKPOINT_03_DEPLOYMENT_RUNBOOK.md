# Checkpoint 03 deployment runbook

Staging only. This run did not deploy.

## Preflight

```text
node scripts/staging-preflight.mjs
```

Today this exits 2 with `CLOUD CHECKPOINT BLOCKED` because `wrangler.jsonc` has no `env.staging`.

`pnpm db:migrate:remote` prints a refusal and exits 1. Do not point it at `nexora-db`.

## Why deploy is unsafe now

- Unqualified `wrangler deploy` would target the top-level worker name `exportflow` with D1 id `local-exportflow-not-a-remote-id`. That id is not a real remote database.
- The account already has `nexora-db` (labeled production) and `nexora-project-files`. Neither is an ExportFlow staging resource.
- Worker rollback would not roll back D1 or R2 even after a future deploy.

## Later, only after the owner creates disposable ExportFlow staging resources

1. Add `env.staging` with the new D1 id and private bucket name. Do not inherit the placeholder id.
2. Keep secrets out of Git. Use a staging-only secret set.
3. Run `node scripts/staging-preflight.mjs` and stop if it is not clean.
4. Apply migrations with an explicit `--env staging` to that new database only. Record the bookmark before writing. Do not wipe existing rows if the database is not empty.
5. Deploy with the same explicit staging environment. Prefer the workers.dev hostname. Do not attach a production domain.
6. Confirm health: `uploadMode` may become `R2_PRESIGNED` only after `R2_*` secrets exist. `productionUploadReady` stays false until the four file sizes succeed.
7. Set bucket CORS to that staging origin only.

## Cleanup

No remote ExportFlow objects were created, so there is nothing to delete. Do not delete `nexora-project-files` or `nexora-db` from this repo.

## Local data

`.wrangler/state` is the developer database and was not reset. `.wrangler-e2e` is reset only when Playwright starts `scripts/e2e-server.mjs`.
