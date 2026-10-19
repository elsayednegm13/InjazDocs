# Cloudflare setup (owner-approved only)

Do **not** run remote create/deploy/migrate from this repo without explicit approval.

## Local (already supported)

- `wrangler.jsonc` binds `DB` → `exportflow-local` and `DOCUMENTS` → `exportflow-documents-local`.
- `database_id` in config is a **placeholder**, not a live D1 id.
- `pnpm db:migrate:local` applies `drizzle/migrations`.
- `.dev.vars` holds secrets. Never commit it.

## Staging / production (manual)

1. Create a D1 database and replace `database_id` / `database_name` for that environment only.
2. Create a **private** R2 bucket.
3. Create a scoped R2 S3 API token used only for presigning multipart UploadPart.
4. Set Worker secrets: `BETTER_AUTH_SECRET`, `BOOTSTRAP_SECRET` (disable after first admin), `R2_*`.
5. Bucket CORS for the app origin:

```json
[{
  "AllowedOrigins": ["https://your-app.example"],
  "AllowedMethods": ["PUT", "GET", "HEAD"],
  "AllowedHeaders": ["Content-Type", "Content-MD5", "x-amz-content-sha256", "x-amz-date", "authorization"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3600
}]
```

6. Apply migrations to that D1 **after** owner approval.
7. Cron is already declared (`* * * * *` UTC). Confirm in the dashboard after deploy.
8. Validate uploads at 20 / 100 / 250 / 400 MiB on staging before calling them production-ready.

`pnpm db:migrate:remote` is intentionally a no-op refusal.
