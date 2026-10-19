# Operations runbook

## User lockout

- Admin provisions a new password via Better Auth change/reset from a privileged session.
- If the last admin is locked, recovery requires owner access to D1 (`user` / `account` rows) plus `BOOTSTRAP_SECRET` is **not** reusable after the first user exists. Keep an offline break-glass procedure.

## Failed reminders

1. `curl /cdn-cgi/local/scheduled?format=json` locally or inspect Worker cron logs.
2. Recompute is idempotent. Duplicate notifications are blocked by `notification_deliveries(reminder_id, cycle_key)`.
3. If cron did not run, instances remain PENDING/ACTIVE and will notify on the next successful scan.

## Corrupt upload

1. Abort the upload session.
2. Leave previous `document_versions` rows intact.
3. Ask staff to upload a new version. Do not overwrite the original object key.

## Invalid tracking link

Revoke or wait for expiry. Users see a generic unavailable page. Rotate to issue a new token (shown once).

## Login brute force

Better Auth rate limit + `login_attempts` table exist for extension. Tighten per-IP limits in staging with KV if needed.
