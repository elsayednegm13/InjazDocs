# Checkpoint 02.2 plan alignment

Status meanings: IMPLEMENTED = code + test evidence in this repo. PARTIAL = exists but leak/gap remains. MISSING = not built. DEFERRED BY OWNER = future checkpoint.

| Requirement / source | Route / API | Current behavior & evidence | Status | Risk | This checkpoint | Test / screenshot |
| --- | --- | --- | --- | --- | --- | --- |
| Customer + contacts/addresses/tax; last4 bank | `/customers`, `/api/v1/customers` | Snapshot on case create. Bank last4. E2E-03 | IMPLEMENTED | Bank full numbers never stored | Keep; clearer errors | E2E-03 |
| Historic customer snapshot | `export_case_customer_snapshots` | Written in `createCase` | IMPLEMENTED | — | Preserve | domain T01 |
| Export case + next action + owner | `/export-cases`, `/api/v1/export-cases` | D1 rows, assignment | IMPLEMENTED | Dashboard counts not case-scoped | Dual-lane + attention, no new CRM | E2E-04..15 |
| Invoice FOB/CFR, explicit total, weights | invoice create/update | `validateInvoiceCommercials`; E2E-04/05 | IMPLEMENTED | GROSS_LT_NET was raw | Localized GROSS_LT_NET | E2E-05, T04 |
| Custom fields | `/custom-fields` | Definitions exist; values API thin | PARTIAL | Do not invent columns | Keep mechanism; do not expand | Settings UI |
| Dynamic document checklist | requirements + templates | Empty type is 422 DOCUMENT_TYPE_REQUIRED. Valid Technical Certificate persists after reload | IMPLEMENTED | — | Client + server validation; no SQL leak | T01, E2E-06/07 |
| Upload ≠ approved | versions + review | Upload → UPLOADED; E2E-07, E2E-15b | IMPLEMENTED | — | Keep | E2E-07, E2E-15b |
| Bank vs DIRECT routes | bank/direct status | Guarded transitions; E2E-08/09 | IMPLEMENTED | TransitionError leaks enums | Safe 409 copy | E2E-08/09, T05 |
| Manual courier + allowlist URL | courier + `carrierTrackingUrl` | Source MANUAL; E2E-08/09 | IMPLEMENTED | — | Keep MANUAL label localized | E2E-08 |
| Booking + UCR + N slots | bookings | 5 slots, 2 numbers; E2E-10 | IMPLEMENTED | — | Schedule as agenda | E2E-10 |
| Container lifecycle ≠ port arrival | containers | `canCompleteCase`; E2E-11 | IMPLEMENTED | — | Dual-lane labels | E2E-11, T11 |
| Independent tracks | case completion | Both tracks required | IMPLEMENTED | — | Visual lanes | Case screenshots |
| Reminders snooze + auto-resolve | reminders + cron | E2E-15 and E2E-15b passed inside a clean full suite | IMPLEMENTED | Vite fetch failed still appears in server logs | Keep predicate; do not weaken | E2E-15, E2E-15b |
| Public tracking token | `/track/:token` | SHA-256, 410, no bank/$ ; E2E-12 | IMPLEMENTED | — | Neutral expired copy | E2E-12, T05 |
| RBAC + last effective admin | users/roles | A3 409 restore | IMPLEMENTED | — | Human 409/403 | A3, T05 |
| Object-level file access | `/files/download` | Case scope + generic 404; A2 | IMPLEMENTED | — | Keep | A2, T10 |
| Rate limit local D1 | public track | 30/60s atomic; A4 | IMPLEMENTED | 40-at-once Worker crash | Do not raise limit | A4 |
| Upload session consistency | multipart | A5 | IMPLEMENTED | 400 MiB unverified | Friendly upload errors | A5, T06 |
| CSV / import preview | `/exports/csv`, import preview | BOM, no IBAN; E2E-14 | IMPLEMENTED | — | Localized empty/export copy | E2E-14 |
| Auth bootstrap, no public signup | `/auth/bootstrap` | E2E-01 | IMPLEMENTED | Vite 500 HTML on first miss | Safe 403; retry flake | E2E-01 |
| AR/EN + RTL | i18n + shell | Shared keys; human status labels; activity/rule maps; tests use data-* | IMPLEMENTED | User-created names stay as entered | Dictionaries both ways | C4, tests/i18n.test.ts |
| Human errors | API + UI | `{ error: { code, message, fieldErrors, requestId } }`; UI maps by code | IMPLEMENTED | Import preview still structured JSON for staff | publicMessage + fail() | T01, T05, tests/errors.test.ts |
| Distinctive control-tower UI | all staff routes | Ink command header + rail; dual lanes; Urgent/Today/Upcoming | IMPLEMENTED | Import JSON preview remains utilitarian | Live routes, not a gallery | T08 after screenshots |
| 20–400 MiB real R2 / WAF / DHL API / email reset | remote | Paths only | DEFERRED BY OWNER | — | Document only | — |
