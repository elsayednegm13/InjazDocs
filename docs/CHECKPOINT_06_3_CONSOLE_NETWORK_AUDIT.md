# Checkpoint 06.3 console and network audit

Probe filter: `console.error`, `console.warn`, and `pageerror` during the warm dev journeys in `baseline-dev2-browser.json`. Request URLs are stored as pathnames only.

## Unique browser issues

| ID | Where | Signature | Count in the warm journey file | Reproducible | Severity |
| --- | --- | --- | --- | --- | --- |
| CON-01 | `/login` before sign-in | `Failed to load resource: the server responded with a status of 401 (Unauthorized)` | 1 per fresh login | Yes | Expected. `SessionProvider` calls `GET /api/v1/me`. With no cookie the Worker returns 401 `SESSION_EXPIRED`. Chrome logs failed HTTP statuses even when the page handles them. `pageerror` count was 0. The login form still appeared and sign-in reached the dashboard. |
| CON-02 | none in the warm baseline | React key, hydration, missing i18n key, invalid aria | 0 | Not seen | — |

No probe journey showed a Vite HTML body in the page, and no journey recorded `fetch failed` in the browser console. The 401 is not an application crash and was not reclassified as one.

Calling `/api/auth/get-session` first would avoid the 401 (that endpoint returns HTTP 200 `null` when anonymous) but would add a serial request before every authenticated `/me`. That trade was not taken, because the checkpoint’s complaint is slowness and this 401 does not block the form.

## Network

Login journey, in order: `GET /api/v1/me` 401, `GET /api/v1/auth/bootstrap-status` 200, `POST /api/auth/sign-in/email` 200, `GET /api/v1/me` 200, `GET /api/v1/auth/bootstrap-status` 200, `GET /api/v1/dashboard` 200.

Each full reload of an authenticated page sends `GET /api/v1/me` again because the provider blocks the tree until that query settles (`Loading workspace…`). Dashboard reload then sends `GET /api/v1/dashboard`. Counts for the whole warm session: `/me` 14, `/dashboard` 9, `/export-cases` 2, `/bookings` 1, `/schedule` 1, `/reminders` 1, `/custom-fields` 1, `/reminder-rules` 1. There is no polling loop. React Query’s default `staleTime` is 0, so a newly mounted page refetches. The in-app return to a page that is already cached painted in about 100 ms without waiting for a new response.

List pages render their `<h1>` before the list query finishes, so a heading timestamp is not list-data time. The dashboard heading is rendered only after the dashboard query succeeds.

## Unexpected HTTP

| Event | Status | Body | Handler reached |
| --- | --- | --- | --- |
| Clean health and authenticated matrices | 200 | JSON | Yes |
| Parallel bootstrap on a fresh database | 201 and 409 | JSON | Yes |
| Playwright reuse, 12 sequential + 8 parallel dashboard | 200 | JSON | Yes |
| Bootstrap retry after the first discarded server, and again on built preview | 500 | HTML containing `fetch failed` | No. Stack stops in Miniflare `dispatchFetch` |
| Built preview bootstrap | 403 | JSON | Yes. Secret loaded by preview did not match the E2E secret |
| Anonymous `/api/v1/me` | 401 | JSON `SESSION_EXPIRED` | Yes |

`src/lib/api.ts` treats a body that starts with `<` or contains `fetch failed` as `SERVER_TEMPORARILY_UNAVAILABLE` and does not return the HTML to the caller. That path was already present. It was not changed, and it does not convert the failure into HTTP 200.

## Server log lines that are not browser console errors

Better Auth, on the E2E Worker: “Rate limiting could not determine a client IP and is falling back to a single shared per-path bucket.” This is a Worker log, not a page exception. No 429 was observed in the probe samples.
