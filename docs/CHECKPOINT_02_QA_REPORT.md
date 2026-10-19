# Checkpoint 02 QA report

Command: `pnpm exec playwright test`  
Exit: 0  
Result line: `17 passed (43.1s)`  
Browser: Google Chrome 154.0.8037.92 via Playwright `executablePath`  
URL: `http://127.0.0.1:43174`  
Database: `.wrangler-e2e/state/v3/d1` (wiped at the start of `scripts/e2e-server.mjs`)  
Dev database left in place: `.wrangler/state` still has `ops@exportflow.local` and `EF-2026-0001`

| Scenario | Result | Assertion | Test | Notes |
| --- | --- | --- | --- | --- |
| E2E-01 | PASS | One of two parallel bootstraps succeeds; the next call is 409; missing secret is 403; bad password stays on login; dashboard loads; logout blocks `/customers` | `e2e/setup.spec.ts` | Two tests |
| E2E-02 | PASS | Custom role is in the role select; employee reaches the dashboard; Bookings and Users links are absent; customer create returns 403; disabling the last admin returns 409 | `e2e/operations.spec.ts` | User created through `POST /api/v1/users` after the role is created in the UI |
| E2E-03 | PASS | Two contacts, two addresses, tax reference, bank last4 `6789`, full IBAN absent | same file | |
| E2E-04 | PASS | FOB invoice shows `$12,500.00` and separate `$900.00` actual freight, gross `12.500 kg`, net `11.200 kg` | same | |
| E2E-05 | PASS | CFR shows `$1,500.00` invoiced freight, `$1,600.00` actual freight, `$11,500.00` total; gross &lt; net shows an error | same | |
| E2E-06 | PASS | Commercial Invoice checklist item is visible; waive shows `WAIVED` | same | |
| E2E-07 | PASS | PDF upload, correction, second version, approval; authorized download starts with `%PDF`; anonymous `fetch` gets 401; zero-byte session is 422 | same | `e2e/fixtures/sample.pdf` |
| E2E-08 | PASS | Jump to `BANK_APPROVED` is 409; ordered bank loop reaches `BANK APPROVED`; manual DHL shows `Source: MANUAL` | same | Server logs the expected `TransitionError` |
| E2E-09 | PASS | Direct route copy says bank stages are not required; carrier href is `dhl.com` and not a DHL API host | same | |
| E2E-10 | PASS | UCR, `sample.pdf`, five slots, `CSQU3054383` and `MSCU1234566`, schedule shows the booking and `2026-11-02` | same | |
| E2E-11 | PASS | Active case complete shows an alert and does not become `COMPLETED` | same | |
| E2E-12 | PASS | Public page shows the invoice number and not `$` or bank text; rotated token dies; revoked token dies; unknown token is 410; `cache-control: no-store` and `referrer-policy: no-referrer` | same | |
| E2E-13 | PASS | `dir=rtl` then `dir=ltr`; mobile width still shows Dashboard; search input can take focus | same | |
| E2E-14 | PASS | Header search URL contains `q=` and the FOB customer row is visible; CSV has a BOM and no IBAN | same | |
| E2E-15 | PASS | Reminder text and next action are visible; snooze shows `SNOOZED` | same | Browser test does not upload the document and assert auto-resolve. That rule is unit test T14 |

Other commands from this checkpoint:

- `pnpm test` — 13 passed
- `pnpm typecheck` — exit 0
- `pnpm lint` — exit 0, two react refresh warnings in `src/app/session.tsx`
- `pnpm build` — exit 0
- `curl http://127.0.0.1:43173/cdn-cgi/local/scheduled?format=json` — `{"outcome":"ok","noRetry":false}`
- Anonymous `GET /api/v1/customers` and `GET /api/v1/files/download` on the E2E port — 401 JSON
