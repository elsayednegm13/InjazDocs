# Checkpoint 03 cloud resource audit

Read-only. Observed 2026-10-12 with Wrangler 4.149.0. Account identifiers and secret values are omitted.

Official references checked against the installed CLI behavior on this date:

- https://developers.cloudflare.com/workers/wrangler/environments/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/r2/objects/upload-objects/
- https://developers.cloudflare.com/r2/buckets/cors/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/d1/wrangler-commands/
- https://developers.cloudflare.com/d1/reference/time-travel/
- https://developers.cloudflare.com/workers/versions-and-deployments/

| Gate | Result |
| --- | --- |
| G0 local config | `wrangler.jsonc` has one unnamed environment. D1 id is the local placeholder. Bucket binding is `exportflow-documents-local`. No `env.staging`. No `env.production`. |
| G1 identity | Wrangler OAuth session is present. Token can read the account and has write scopes for Workers and D1. That is not approval to create resources. |
| Remote D1 | One database exists. Its name is `nexora-db` and its version label is production. It is not an ExportFlow staging database. |
| Remote R2 | One bucket exists. Its name is `nexora-project-files`. It is not an ExportFlow staging bucket. |
| Worker `exportflow` | Not deployed. API code 10007. |
| DNS | Not inspected and not changed. No custom domain is configured in this repo. |
| Secret names in local `.dev.vars` | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BOOTSTRAP_SECRET` are set. `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` are absent. |
| G2 mutating staging | BLOCKED. No existing isolated ExportFlow staging worker, D1, or private R2 bucket. Creating them would be new cloud resources and was not authorized by "ابدأ". |

## Actions taken

Read-only: `wrangler whoami`, `wrangler d1 list`, `wrangler r2 bucket list`, `wrangler deployments status`.

Not taken: deploy, `d1 create`, `r2 bucket create`, migrations `--remote`, CORS, DNS, deletes.

## Cost if the owner later approves a disposable staging bucket

Four synthetic files are 20 + 100 + 250 + 400 MiB = 770 MiB, about 0.75 GiB. At the public R2 storage rate of $0.015 per GiB-month, storage for one month is well under one US dollar before Class A operations and retries. That estimate is not permission to upload. Nexora resources must stay untouched.

## Owner checklist before any future staging run

1. Create a new private R2 bucket whose name is explicitly for ExportFlow staging, not `nexora-project-files`.
2. Create a new D1 database whose name is explicitly for ExportFlow staging, not `nexora-db`.
3. Add `env.staging` in `wrangler.jsonc` with those ids only, after reviewing the diff.
4. Put staging-only `R2_*` and Better Auth secrets in a staging secret store, not in Git and not in `.dev.vars.e2e`.
5. Set the bucket CORS to the staging workers.dev origin only, methods PUT/GET/HEAD, expose `ETag`.
6. Re-run this checkpoint's preflight. `node scripts/staging-preflight.mjs` currently exits 2 on purpose.
