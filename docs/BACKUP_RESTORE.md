# Backup and restore

D1 Time Travel does **not** restore R2 objects. Treat them as independent.

## D1

- Local: copy `.wrangler/state` SQLite files or `wrangler d1 export`.
- Remote (paid): Time Travel (30 days typical) plus periodic `wrangler d1 export` to an offline store.

## R2

- Enable bucket versioning/replication as an owner decision.
- Object keys are stored in D1 (`document_versions.r2_key`, `upload_sessions.object_key`). Restoring D1 without R2 leaves broken file pointers.

## Retention

Bank-file and audit retention is a legal/owner decision. The application does not invent a statutory period. Deletion of business evidence is not offered in the UI.

## Untested

No production restore drill has been run in this environment.
