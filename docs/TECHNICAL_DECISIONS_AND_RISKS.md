# Technical decisions and risks

## Keep

- Single company, Hono on the Worker, D1 rows, R2 bytes, Better Auth cookies, no public signup.
- Money as minor integers and mass as grams. Invoice total is explicit.
- Case-scoped queries via `assertCaseAccess` / `caseVisibilitySql`, including custom fields on invoices, bookings, and containers.
- Bank numbers as last four only.
- Manual courier. Allowlisted tracking links only.
- Forward-only SQL in `drizzle/migrations`. This run added no migration.
- E2E isolation: `scripts/e2e-server.mjs` deletes `.wrangler-e2e` only, then migrates with `--persist-to` that directory.
- Remote migrate script refuses to run.

## Restore, do not drop

`server/services/cases.ts` was 0 bytes while `server/http/app.ts` still imported it. Typecheck failed with TS2305 before the restore. The behavior was recovered from the existing `dist` worker bundle, then the draft custom-field guard was added. Do not regenerate the file from memory if it is emptied again; diff against `dist` or a backup first.

## Propose, not done

- `MONEY` custom field type. Deferred because a custom amount needs a currency and minor-unit scale, which invoice columns already have.
- Real R2 presign proof for 20/100/250/400 MiB. Blocked without a new ExportFlow bucket and owner approval.
- Staging D1/Worker. Blocked. Do not attach `nexora-db` or `nexora-project-files`.
- Git history. The workspace is not a repository. Do not init it unless the owner asks.

## Risks

| Risk | Why it matters |
| --- | --- |
| Placeholder D1 id | A remote command against `local-exportflow-not-a-remote-id` must not be "fixed" by pointing at another database |
| Vite `fetch failed` | Local Miniflare sometimes drops a dispatch. Tests may retry only when the body is the proxy HTML/error, not when the API returns a real 4xx |
| Rate limit | About 30 requests per window in one D1 counter. Not a production WAF |
| Cron | Local scheduled handler is not proof the minute trigger runs on Cloudflare |
| 400 MiB | Worker part fallback is not the production upload path |
| Sensitive custom fields | Visibility is `settings.manage`, which is broader than a dedicated bank role. Do not put full account numbers in these fields |
| Design | Screenshots exist under `docs/qa-screenshots/`. They are not owner approval |
| Backup | `docs/BACKUP_RESTORE.md` is a note, not a tested remote restore |
