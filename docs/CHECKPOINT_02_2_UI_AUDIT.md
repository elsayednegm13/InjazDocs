# Checkpoint 02.2 UI audit

## Before

Genuine Checkpoint 02.1 browser captures were copied to `docs/qa-screenshots/checkpoint-02-2/before/`:

- navy left column + white cards
- six equal KPI tiles
- document / goods tracks as two plain boxes
- schedule as one wide table
- English status enums in EN mode (`MISSING`, `UNDER_REVIEW`)
- activity codes and `name_en` on settings

Those files are real screenshots, not generated art.

## Design ideas implemented on live routes

1. **Command tower** — full-width maritime ink header + operational pill rail. The navy sidebar is gone.
2. **Two independent lanes** — documents vs cargo milestones on case detail and public tracking. No fabricated map or percentage.
3. **Attention queue** — Urgent / Today / Upcoming from real D1 reminder due timestamps and statuses.

Tokens: ink `#0b1c24`, paper `#f3efe4`, sea-glass `#14a39a`, amber risk, coral blocker, green delivered.

## Screen by screen

| Route | Change | Evidence |
| --- | --- | --- |
| Login | Tower kicker, dual-track language, safe sign-in copy only | `en-login-1366.png` after |
| Dashboard | Compact KPI strip + three live queues | `ar/en-dashboard-1366.png`, `ar-dashboard-390.png` |
| Cases list | Desktop table + mobile cards | case list in after shots |
| Case detail | DualLane + `data-tab` workspace | `ar-case-1366.png`, `en-case-1366.png` |
| Documents | Empty type inline error, review decisions labeled | `ar-documents-1366.png`, `ar-document-validation-390.png` |
| Bookings / schedule | Date-grouped agenda + mobile cards | `ar-bookings-1366.png`, schedule after |
| Reminders | Human status chips, same snooze actions | `ar-reminders-1366.png` |
| Public tracking | Dual lanes, no HTTP status in the expired message | tracking after if captured |
| Users / settings | Localized system rule names; activity verbs mapped | settings page |

## Accessibility / RTL

- Language toggle persists via existing i18n preference.
- Field errors use `role="alert"` and `aria-describedby` on document type.
- IDs, invoice numbers, IBAN, tracking numbers remain `dir="ltr"`.
- Horizontal nav remains available at 390px (E2E-13).
- `prefers-reduced-motion` still disables transitions.

## Residual

Reports import preview is still a structured preview object. No dark mode. No new icon kit or remote fonts.
