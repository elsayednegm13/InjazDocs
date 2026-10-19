# Checkpoint 03 design audit

Verdict: READY FOR OWNER VISUAL REVIEW. Owner signoff: NOT YET PROVIDED.

The control-tower shell from checkpoint 02.2 is still the running UI: full-width maritime header, horizontal operations rail, Arabic dashboard queues, and no return to a left navy sidebar. Screenshots are from the isolated E2E browser on `127.0.0.1:43174`, not from the developer database and not from Cloudflare.

## Before

Copied from real checkpoint 02.2 captures into `docs/qa-screenshots/checkpoint-03/before/`:

- `ar-dashboard-1366.png`, `ar-dashboard-390.png`, `en-dashboard-1366.png`
- `ar-case-detail-1366.png`, `en-case-1366.png`, `ar-reminders-1366.png`

A before shot of the raw JSON import was NOT AVAILABLE. That screen was not photographed in 02.2.

## After (this run)

| File | What it shows |
| --- | --- |
| `after/ar-dashboard-1366.png` | Arabic control tower, live counts, urgent queue |
| `after/en-dashboard-1366.png` | Same layout in English |
| `after/ar-dashboard-390.png` | Mobile dashboard |
| `after/ar-case-1366.png`, `after/ar-case-390.png` | Case header |
| `after/ar-documents-1366.png`, `after/ar-documents-390.png` | Document checklist |
| `after/ar-bookings-1366.png`, `after/ar-bookings-390.png` | Booking tab at desktop and 390px |
| `after/ar-reminders-1366.png`, `after/ar-reminders-390.png` | Reminders |
| `after/ar-users-1366.png` | Users |
| `after/ar-public-tracking-390.png` | Customer tracking, no bank values in the shot |
| `after/ar-error-document-390.png` | Arabic field error when the document type is empty |
| `after/en-error-auth-1366.png` | English "Sign-in failed" without a status code |
| `after/ar-import-preview-1366.png` | Read-only CSV table, one ready row and one Arabic row error, no JSON |

## What changed

The reports import no longer prints `JSON.stringify`. It shows row counts, a table, and a sentence that nothing was saved. There is no commit button.

## Gaps that remain

- Latest activity often shows the generic label "نشاط مسجل" instead of the stored event summary when the event type has no translation key.
- The urgent queue in the E2E fixture is dense because the test database contains many open reminders. That is fixture data, not a production metric.
- Custom-field values are still a thin settings form.
- Bundle JS is about 510 kB minified (157 kB gzip). No code-splitting was added.
- No tablet-only 768px shot was added beyond the existing locale overflow check.
- This memo is not owner approval.
