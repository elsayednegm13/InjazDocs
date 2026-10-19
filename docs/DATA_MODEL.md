# Data model

Primary keys are UUID text. Business numbers (`case_reference`, `invoice_number`, `booking_number`, official container numbers) are unique in their operational scope.

## Money and weight

- Money: integer **minor units** + `currency` + `currency_decimals`. Default 2. JPY 0, KWD 3.
- Rounding: reject extra fraction digits on input; no silent float math.
- Weight: integer **grams**. UI converts KG/T.
- `gross_weight_grams >= net_weight_grams` enforced in SQL and domain.

## Time

- Instants: ISO-8601 UTC text.
- Business dates: `YYYY-MM-DD` interpreted in company timezone (`Africa/Cairo` default).
- Cron: UTC. Reminder due instants stored in UTC.

## Core relations

Customer 1—* cases. Case 1—* invoices, document requirements, bank submissions, courier shipments, bookings, reminders, tracking links. Booking 1—* container slots. Container 1—* events.

Sensitive bank identifiers: last4 + SWIFT only. Full PAN/IBAN are not persisted.

Audit log is append-only. Soft archive on customers (`archived_at`). Users are disabled, not deleted.
