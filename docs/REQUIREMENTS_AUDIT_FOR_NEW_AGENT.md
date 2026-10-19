# Requirements audit for the next agent

Statuses: AGREED, IMPLEMENTED, VERIFIED LOCALLY, PARTIAL, MISSING, DEFERRED, BLOCKED, UNKNOWN.
Local verification means a test or code path exercised on this machine. Nothing below is remotely verified or owner-signed.

| ID | Owner intent | Implementation | Evidence | Status | Next fix |
| --- | --- | --- | --- | --- | --- |
| 5A | Customer profile, snapshot, bank last4, extra fields | `customers.ts`, snapshot on case create, custom fields on customer form/detail | E2E-03; custom-fields spec | VERIFIED LOCALLY for last4 and customer fields | Full IBAN storage stays blocked until encryption is approved |
| 5B | Case + many invoices, explicit total, weights, incoterms | `cases.ts`, `domain/invoice.ts` | E2E-04, E2E-05, unit T02/T03 | VERIFIED LOCALLY | `cases.ts` had been emptied; keep the restored file |
| 5C | Typed custom fields on five entities; checklist not global | Definitions/values for five targets; templates cloned per case | `e2e/custom-fields.spec.ts`, unit custom-fields | VERIFIED LOCALLY for the five targets. `MONEY` type MISSING on purpose | Do not add a sixth type without a currency rule |
| 5D | Bank vs direct, manual courier | `transitions.ts`, `bank-courier.ts` | E2E-08, E2E-09 | VERIFIED LOCALLY | No live DHL |
| 5E | Booking slots vs numbers, ISO, schedule | `bookings.ts`, schedule page | E2E-10 | VERIFIED LOCALLY | UCR is a nullable column, shown on the booking page |
| 5F | Independent document and goods tracks | `canCompleteCase` | E2E-11 | VERIFIED LOCALLY | Do not complete on port arrival |
| 5G | Condition reminders, snooze is not done | `reminders.ts`, cron in `worker/index.ts` | E2E-15, E2E-15b | VERIFIED LOCALLY | Business-day and timezone logic exists in domain tests; production cron delivery is not cloud-proven |
| 5H | Revocable public link, no bank/money/files | `tracking.ts` | E2E-12, errors T05 | VERIFIED LOCALLY | Token must stay hashed |
| 5I | No public signup, RBAC, last admin, case scope | `users.ts`, `actor.ts` | E2E-02, A2, A3, custom-fields viewer | VERIFIED LOCALLY | Case scope must stay on nested custom fields |
| 5J | Large private files, CSV preview, activity labels | R2 local parts; `shared/csv.ts`; activity map | A5, unit CSV, activity keys | PARTIAL | Remote 400 MiB BLOCKED. Known audit actions are labeled; unknown actions stay generic |
| 5K | Control-tower UI, AR/EN, friendly errors | Locales + command tower shell | locale spec, visual spec, error spec | VERIFIED LOCALLY as behavior, not design signoff | Owner must review screenshots |

## Custom-field matrix

| Entity | Define | Read/write API | UI | Required rule | Test |
| --- | --- | --- | --- | --- | --- |
| CUSTOMER | Yes | `/api/v1/customers/:id/custom-fields` and create body | Create + detail | Always | UI + API |
| EXPORT_CASE | Yes | `/api/v1/export-cases/:id/custom-fields` | Case overview | Draft/cancelled deferred | API activation 422 then success |
| INVOICE | Yes | `/api/v1/invoices/:id/custom-fields` | Invoice tab | Always on value save | UI select |
| BOOKING | Yes | `/api/v1/bookings/:id/custom-fields` | Booking page | After draft | UI reload |
| CONTAINER | Yes | `/api/v1/containers/:id/custom-fields` | Slot card | After planned | UI reload |

Cross-id customer update with a case id returns 404. Disabled definitions keep historical values. Sensitive values are redacted without `settings.manage`.
