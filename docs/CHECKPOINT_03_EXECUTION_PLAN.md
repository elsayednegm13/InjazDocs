# Checkpoint 03 execution plan

Written before code changes in this checkpoint. Date observed: 2026-10-12.

## Decision

CLOUD CHECKPOINT IS BLOCKED. Local preparation and one bounded UX fix may proceed. No remote create, deploy, migrate, CORS, or upload.

Owner "ابدأ" authorizes this checkpoint's verification. It does not authorize new Cloudflare resources, DNS, production, Git writes, or secret rotation.

## What was already true before edits

- Repo root: `I:\WORK\InjazDocs`. Node v24.19.0, pnpm 12.11.2, Wrangler 4.149.0.
- `AGENTS.md` NOT FOUND. `.cursor` rules NOT FOUND. `.git` NOT FOUND (`git status` exit 128).
- Local `.dev.vars` exists. Keys present, values not recorded: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BOOTSTRAP_SECRET`. No `R2_*` keys.
- `.wrangler/state` EXISTS (developer app data). Must not be reset.
- `.wrangler-e2e/state` EXISTS and may be reset only by `scripts/e2e-server.mjs`.
- `wrangler.jsonc` has no `[env.staging]` and no `[env.production]`. D1 id is the placeholder `local-exportflow-not-a-remote-id`. R2 binding name is `exportflow-documents-local`.
- Authenticated Wrangler session exists (read-only identity check). Account id is omitted from this document.
- Remote inventory (read-only): one D1 database named `nexora-db` (version label production) and one R2 bucket named `nexora-project-files`. Worker name `exportflow` does not exist (API 10007).
- Those Nexora resources are out of scope. They must not be migrated, deployed to, or used as ExportFlow staging.
- Upload code can presign only when all `R2_*` secrets are set. Health currently sets `productionUploadReady` from that same flag. That is not proof of a 400 MiB upload.
- Customer CSV preview API exists and the reports page renders `JSON.stringify`.

## Allowed in this checkpoint

- Fail closed: health must not report production upload ready from secret presence.
- Replace the import JSON dump with a read-only table. No new commit button.
- A local preflight script that refuses staging deploy while staging bindings are absent or point at the placeholder / non-ExportFlow names.
- Screenshots from the isolated E2E browser. Copy prior real shots as "before" where they already exist.
- Docs listed in the contract.

## Forbidden

- `wrangler deploy`, remote migrations, `d1 create`, `r2 bucket create`, CORS edits, DNS, deleting Nexora or dev data, printing secrets, Git init/commit.

## Stop condition

G2 does not pass. Four-size R2 proof is NOT RUN. Final status cannot be staging PASS.
