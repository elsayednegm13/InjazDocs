# Workflows

## Document requirement

`MISSING → UPLOADED → UNDER_REVIEW → APPROVED`

Correction: `UNDER_REVIEW|APPROVED → NEEDS_CORRECTION → UPLOADED`. Waiver: `MISSING|NEEDS_CORRECTION → WAIVED` with reason. Upload never auto-approves.

Required documents block route completion; optional do not.

## Bank route

`PREPARING → SCANNED → READY_FOR_PHYSICAL_HANDOVER → HANDED_TO_BANK → BANK_REVIEW → BANK_APPROVED → COURIER_DISPATCHED → DOCUMENTS_DELIVERED`

`BANK_REVIEW → CORRECTION_REQUESTED` can return to scan/handover. Digital copies are not bank delivery.

## Direct route

`PREPARING → SCANNED → INTERNAL_REVIEW → READY_FOR_DISPATCH → COURIER_DISPATCHED → DOCUMENTS_DELIVERED`

Bank approval is never required. Switching BANK→DIRECT is blocked while originals are with the bank or already dispatched.

## Courier

Manual only: `NOT_DISPATCHED → DISPATCHED → IN_TRANSIT → DELIVERED` with exception/return/cancel branches. Events are `source=MANUAL`.

## Booking / container

Booking: DRAFT/REQUESTED/CONFIRMED/LOADING_IN_PROGRESS/LOADED/DEPARTED/ARRIVED_PORT/CLOSED/CANCELLED.

Container: PLANNED → NUMBER_ASSIGNED → GATED_IN → LOADED → DEPARTED → ARRIVED_PORT → CUSTOMS_RELEASED → DELIVERED_TO_CUSTOMER.

Booking rollup is computed from containers. A booking marked conceptually loaded does not force all slots loaded.

## Case completion

Both tracks required: document route delivered **and** every non-cancelled container `DELIVERED_TO_CUSTOMER`, unless an authorized close exception reason is stored. Manager may reopen `COMPLETED → ACTIVE`.
