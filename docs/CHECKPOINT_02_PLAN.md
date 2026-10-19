# Checkpoint 02 plan

Evidence-linked plan written after reading the repository, not before the tests.

| Claim | Code | Verification | Risk | Outcome |
| --- | --- | --- | --- | --- |
| Local SPA + Hono on one origin | `vite.config.ts`, `worker/index.ts`, `server/http/app.ts` | Playwright against workerd | Dev DB overwrite | Isolated persist path |
| Login / bootstrap | `server/http/app.ts`, `src/features/auth/LoginPage.tsx` | E2E-01 | Session not refreshed; rate limit | Fixed earlier; rate limit raised and IP headers set |
| RBAC | `shared/permissions.ts`, `server/services/actor.ts` | E2E-02 | Custom role sign-in blocked by auth rate limit | Role created; employee signs in after limit change |
| Customers / bank last4 | `server/services/customers.ts` | E2E-03 | Full IBAN stored | Only last4 persisted |
| FOB / CFR totals | `server/domain/invoice.ts`, case wizard | E2E-04, E2E-05 | Silent total formula | Explicit totals asserted in the UI |
| Document checklist | `server/services/documents.ts` | E2E-06, E2E-07 | Upload never finalized | Multipart local R2 path exercised |
| Bank vs direct | `server/domain/transitions.ts` | E2E-08, E2E-09 | Invalid jump returned 500 | `TransitionError` mapped to 409 |
| Bookings / containers | `server/services/bookings.ts` | E2E-10 | Slot overwrite | Two different slots assigned |
| Case completion | `server/domain/case-completion.ts` | E2E-11 | Port arrival treated as delivery | Complete stays blocked |
| Public links | `server/services/tracking.ts` | E2E-12 | In-memory rate limit only | D1 bucket counter added; still not global |
| i18n / mobile | `src/app/shell.tsx` | E2E-13 | RTL button label | Shell uses `ع` |
| Search / CSV | `server/services/cases.ts`, `reports.ts` | E2E-14 | Shared stamp across workers | Stamp file under `.wrangler-e2e` |
| Reminders | `server/services/reminders.ts` | E2E-15 + unit T14 | Browser test skipped resolution | Snooze shown; auto-resolve remains a unit test |

Isolation: Vite `persistState.path` from `EXPORTFLOW_PERSIST`. E2E uses `.wrangler-e2e/state`. Dev data stays in `.wrangler/state`. Proven by the last Playwright test comparing emails and `EF-2026-0001`.
