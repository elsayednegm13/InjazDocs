# Checkpoint 03 R2 upload evidence

## Result

NOT RUN. Mode requested: `R2_PRESIGNED` against an isolated Cloudflare staging bucket. That bucket does not exist for ExportFlow.

Local `.dev.vars` has no `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, or `R2_BUCKET_NAME`. Health `uploadMode` therefore stays `LOCAL_WORKER_PARTS` on the developer server. `productionUploadReady` is false and is no longer copied from the presence of those keys.

The only remote bucket visible to this account is `nexora-project-files`. It was not used. No object was uploaded, listed, or deleted.

| Size | Result | Duration | Parts | D1 | R2 HEAD |
| --- | --- | --- | --- | --- | --- |
| 20 MiB | NOT RUN | — | — | — | — |
| 100 MiB | NOT RUN | — | — | — | — |
| 250 MiB | NOT RUN | — | — | — | — |
| 400 MiB | NOT RUN | — | — | — | — |

Resume, expired signature, cancel, and tampered finalize were not executed remotely.

Local Worker-part uploads remain covered by E2E-07 and A5. That is not cloud presign proof.

Code already refuses to buffer the whole object in D1 and can sign part URLs only when all R2 secrets exist (`server/services/uploads.ts`). Part size in config is 10 MiB, which is above the 5 MiB R2 minimum for non-final parts. That path is untested against real R2.
