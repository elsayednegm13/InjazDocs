# Requirements matrix

| Req | Implementation | Tests | Status |
| --- | --- | --- | --- |
| Case aggregate | `export_cases` + child tables | domain + API | DONE |
| Customer snapshot | `export_case_customer_snapshots` | T01 domain/service | DONE |
| Invoice FOB/CFR + explicit total | `export_invoices` + `validateInvoiceCommercials` | T02 | DONE |
| Weights gross>=net | CHECK + domain | T03 | DONE |
| Dynamic documents | templates cloned per case | T04/T05 | DONE |
| Bank vs direct routes | guarded transitions | T06 | DONE |
| Manual courier + allowlist URL | `carrierTrackingUrl` | T07 | DONE |
| N container slots | bookings + containers | T08 | DONE |
| Optional UCR | bookings.ucr nullable | T09 | DONE |
| Independent tracks / completion | `canCompleteCase` | T10 | DONE |
| Custom fields | definitions/values for CUSTOMER, EXPORT_CASE, INVOICE, BOOKING, CONTAINER | unit + e2e/custom-fields.spec.ts | VERIFIED LOCALLY for those five. MONEY type not implemented |
| RBAC + last admin | effective `users.manage` + `roles.manage`, restore on 409 | T12, A3 | DONE locally |
| Tracking links | SHA-256 token, revoke/rotate. Public GET is registered before the session middleware so an anonymous caller reaches `publicTracking` | T13, E2E-12, T05. Checkpoint 06.4 suites 32/32 twice; anonymous unknown token is 410 | DONE locally |
| Reminder snooze auto-resolve | evaluator + item-specific reason. 06.5.4 saves a seeded rule only when the caller sends the field snapshot it loaded; a stale snapshot is 409 | T14, E2E-15. 06.5.4 run 2: E2E-15 passed in 57.0s; poisoned batch kept offset 2; lost confirmation moved offset 2→3 without a retry | DONE locally for seeded families under 2000 statements. Same-rule overlap inside the worker was not reached. CUSTOM_FOLLOWUP is still unimplemented |
| Booking date generation | generation hash | T15 | DONE (unit) |
| Cron idempotent notify | `notification_deliveries` unique. 06.5.4 drained active deliverable rows on a copy of the 500-case store from 1250 eligible to 0 | Counted ticks raised deliveries 900→2150 with duplicateCycles 0. A later tick still scanned 100 and delivered 0 | PARTIAL. Active delivery reached a terminal count; the worker is not idle afterward. Container follow-up stays ineligible without an ISO number |
| Authz/CSRF/IDOR | generic file 404 + case scope | T17, A2 | DONE locally |
| Optimistic versions | version columns | T18 | DONE |
| Public DTO | `publicTracking` | T19 | DONE |
| Import preview no commit | `/imports/customers/preview` | T20 | DONE |
| 400 MiB remote proof | presign path present | — | NOT STARTED (needs owner creds) |
| Invoice rule C | ordinary write 409 when case COMPLETED; correction is one D1 batch with custom fields, revision, and audit | `e2e/invoice-lock.spec.ts` inside both green 06.2 full suites (32/32, exit 0) | DONE on isolated E2E. Developer `d1_migrations` already shows `0004` at `2026-10-14 19:35:55`; this continuation did not run a migration |
