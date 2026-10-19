# Checkpoint 03 requirements reconciliation

Statuses: IMPLEMENTED in code, VERIFIED by a local test in checkpoint 02.2 or this run, PARTIAL, MISSING, DEFERRED. Staging column is NOT RUN unless stated. Source of the business rule is the owner contract plus `docs/REQUIREMENTS_MATRIX.md`.

| Item | Route / service | Status | Evidence | Discrepancy / action |
| --- | --- | --- | --- | --- |
| Customer identity, contacts, addresses, tax | `/customers`, `customers.ts` | VERIFIED locally | E2E-03 | Staging not run |
| Bank last4 only | customer DTO, CSV | VERIFIED locally | E2E-03, E2E-14 | No encryption claim |
| Case snapshot | `export_case_customer_snapshots` | VERIFIED locally | domain + case header | — |
| Case, owner, next action | `/export-cases` | VERIFIED locally | E2E-04..15 | — |
| Multiple invoices | schema + create | IMPLEMENTED | invoice service | UI creates one at draft; more can be added by API |
| Ports, destination, payment terms T/T L/C D/P D/A | invoice form | VERIFIED locally | E2E-04/05 | — |
| FOB/CFR explicit total, minor units, grams | `validateInvoiceCommercials` | VERIFIED locally | E2E-04/05, domain T02 | — |
| Custom fields | settings + definitions API | PARTIAL | matrix T11 | Values API remains thin. Not expanded in this checkpoint |
| Dynamic checklist | document requirements | VERIFIED locally | E2E-06, T01 | Empty type is 422, not SQL |
| Versions, review, waiver | document review | VERIFIED locally | E2E-07 | Upload is not approval |
| Bank vs direct | bank/direct transitions | VERIFIED locally | E2E-08/09 | — |
| Manual DHL | courier + allowlist URL | VERIFIED locally | E2E-08/09 | Live API DEFERRED |
| Booking PDF, number, UCR, slots | bookings | VERIFIED locally | E2E-10 | — |
| ISO 6346 when a number is entered | container assign | IMPLEMENTED | domain/container | — |
| Port arrival is not customer delivery | `canCompleteCase` | VERIFIED locally | E2E-11 | — |
| Independent document and cargo tracks | case completion + dual lane UI | VERIFIED locally | E2E-11, screenshots | — |
| Reminders, snooze, cron resolve | reminders + scheduled | VERIFIED locally | E2E-15, E2E-15b | Staging cron NOT RUN |
| Public tracking revoke/rotate | `/track/:token` | VERIFIED locally | E2E-12 | — |
| No public signup, roles, last admin | bootstrap + users | VERIFIED locally | E2E-01, E2E-02, A3 | — |
| Case-scoped files | download 404 | VERIFIED locally | A2 | — |
| AR/EN human errors | locales + `publicMessage` | VERIFIED locally | T01, i18n test | — |
| Private R2 multipart, no D1 blobs | `uploads.ts` | IMPLEMENTED locally | A5 local parts | Remote presign NOT VERIFIED |
| 20/100/250/400 MiB | — | NOT RUN | no staging bucket | BLOCKED |
| CSV preview without raw JSON | reports page | IMPLEMENTED this checkpoint | visual import shot | No commit button added |
| `productionUploadReady` | `/api/v1/health` | FIXED | now hard false | Was true whenever R2 keys existed |

No live bank, live DHL, payments, or CRM features were added.
