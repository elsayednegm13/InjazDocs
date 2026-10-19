# Cloudflare staging verification plan

Do not execute this plan until the owner approves the resources and the cost. Nothing here was run.

## Resources to create manually

- One staging D1 database, not the local placeholder id in `wrangler.jsonc`
- One private R2 bucket
- One R2 S3 token scoped to that bucket, used only for presigning `UploadPart` / `CreateMultipartUpload` / `CompleteMultipartUpload` / `AbortMultipartUpload`
- Worker secrets: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BOOTSTRAP_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
- Bucket CORS for the staging origin only: `PUT`, `GET`, `HEAD`; expose `ETag`

## Checks

1. Apply the checked-in migrations to staging D1. Keep the SQL. Roll back by restoring the pre-migration export, not by deleting the bucket.
2. Confirm `GET /api/v1/health` reports `uploadMode: R2_PRESIGNED` and `productionUploadReady: true`. If it still says `LOCAL_WORKER_PARTS`, stop. That mode is only for Wrangler.
3. Browser upload of generated files at about 20 MiB, 100 MiB, 250 MiB, and 400 MiB. Parts of 10 MiB, at most 4 in flight. Confirm the Worker request body stays small.
4. Interrupt a part, retry it, abort the session, and confirm the object is not linked to a document version.
5. Expire a session and confirm complete is rejected.
6. Wrong case id and a user without `documents.upload` are rejected.
7. Download remains an authorized short-lived response, not a public bucket URL.
8. Delete the staging objects and the staging admin after the notes are saved.

## Cost

R2 storage and Class A operations for a few hundred megabytes are small, but multipart retries can multiply writes. Do not leave the 400 MiB objects in the bucket. D1 on the free tier has query and size limits; this plan uses one staging database only.
