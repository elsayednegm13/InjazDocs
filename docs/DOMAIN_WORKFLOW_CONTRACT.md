# Domain workflow contract

Source of truth for transitions is `server/domain/transitions.ts` and `server/domain/case-completion.ts`. The UI may only call the API.

## Customer → case → invoice → document

1. Staff create a customer. Bank identifiers are reduced to last four before insert.
2. Creating a case copies a snapshot into `export_case_customer_snapshots` and clones the default document template. Status starts `DRAFT`.
3. An invoice may be attached immediately. Goods value, invoiced freight, actual freight expense, and invoice total are separate minor-unit amounts. Gross weight must be at least net weight after conversion to grams. FOB rejects seller-invoiced ocean freight. The total is not rewritten as goods + freight.
4. A required document moves `MISSING → UPLOADED → UNDER_REVIEW → APPROVED`. Upload does not approve. Waiver needs a reason.

## Bank route vs direct route

Bank: preparing, scanned, ready for handover, handed to bank, review or correction, bank approved, courier dispatched, documents delivered.

Direct: preparing, scanned, internal review, ready for dispatch, courier dispatched, documents delivered. Bank stages are not required.

Route change bank → direct is rejected while originals are with the bank or already dispatched (`ROUTE_CHANGE_BLOCKED`).

Courier events are manual. The UI may open an allowlisted carrier URL. No DHL API is called.

## Booking → slot → container → delivery

A booking has `expected_containers` slots created as `PLANNED` with null official numbers. Numbers are optional and ISO 6346 checked unless an explicit override is stored. Each container has its own status history. Booking aggregate status is derived from the slot counts, not the first event. Port arrival is `ARRIVED_PORT`. Customer delivery is `DELIVERED_TO_CUSTOMER`.

Case `COMPLETED` requires the document track delivered and every non-cancelled container delivered, or an authorized close exception. `COMPLETED → ACTIVE` needs reopen permission.

## Custom fields

Definitions: `CUSTOMER`, `EXPORT_CASE`, `INVOICE`, `BOOKING`, `CONTAINER`. Types: `TEXT`, `NUMBER`, `DATE`, `BOOLEAN`, `SELECT`.

Required enforcement:

| Target | Required now |
| --- | --- |
| Customer, invoice | On every value save |
| Export case | When leaving draft/cancelled for an active status |
| Booking | When status is no longer draft/cancelled |
| Container | When status is no longer planned/cancelled |

Disabling a definition does not delete `custom_field_values`. Inactive definitions with a stored value stay visible and read-only. Sensitive values are returned only to `settings.manage`. Writes of sensitive values require that permission. Value rows are keyed by definition plus entity id and entity type, and the type comes from the route, not the client.

## Reminders

Rules live in D1. Cron and domain writes recompute instances. Snooze is not resolution. If the condition becomes false (for example a required document is approved), the open instance resolves even if `snoozed_until` is still in the future. Company zone is `Africa/Cairo`.

## Public share

Create stores a hash, not the raw token. Rotate and revoke invalidate the previous token. The public DTO omits bank fields, amounts, files, and staff notes. Invalid or expired tokens use the same unavailable response.

## Example

Draft case `EF-2026-0007`, direct route, invoice FOB, booking of 5 slots with 2 numbers. File-number custom field is required but empty: activation returns `CUSTOM_FIELD_REQUIRED` and the case stays draft. After the value is saved, activation proceeds. A viewer who is not assigned gets 403 on that case's custom fields. A sensitive customer note is null for that viewer.
