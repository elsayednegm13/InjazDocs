# Reminders

Reminders are a condition evaluator, not a React timer.

## Triggers

See seeded `reminder_rule_definitions`. Families include missing documents, review pending, bank review, courier check, loading/cutoff/ETD/ETA, container follow-up, goods delivery, custom.

## Dedup

`dedup_key = rule_id + source_entity_id + generation`

Generation changes when a booking date source changes so stale ETA reminders cannot fire.

## States

PENDING / ACTIVE / SNOOZED / ACKNOWLEDGED / RESOLVED / CANCELLED

Ack ≠ resolved. Snooze sets `snoozed_until`. Recompute still evaluates the condition; if false, the instance becomes RESOLVED and `snoozed_until` is cleared. A new row is inserted with the status from `evaluateDue` (ACTIVE when the due time is already past, not a hardcoded PENDING). Missing-document and review reasons include the document type's English name so one checklist item can be told from another. Upload clears the missing-document reminder; approval, not upload alone, clears the review reminder.

## Cron

Worker `scheduled()` every minute (UTC). Scans due rows (indexed `status, due_at`), recomputes touched cases, inserts `notification_deliveries` with unique `(reminder_id, cycle_key)`. When `repeat_every_days` is null the cycle key is `once`, so a later hour does not create another notice. A positive `repeat_every_days` waits that many days and stops at `repeat_cap`. At-least-once safe; duplicates ignored.

Local smoke is `GET /cdn-cgi/local/scheduled?format=json` on the isolated Worker. `E2E-15` creates two cases, makes `rr-doc-due` due by setting `offsetAmount` to -1, snoozes the commercial-invoice reminder, uploads and approves that item, and checks that the snoozed reminder stays resolved after reload and another scheduled run while the packing-list reminder and the other case stay open. `E2E-15b` uploads without approval and keeps the review reminder open. Notifications omit RESOLVED and CANCELLED rows.
