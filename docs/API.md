# API

Base: `/api/v1`. Auth cookies via `/api/auth/*` (Better Auth).

Success: `{ data, meta: { requestId, page?, pageSize?, total? } }`

Error: `{ error: { code, message, details?, requestId } }` with 400/401/403/404/409/410/413/422/429.

## Health

`GET /api/v1/health` — API/DB readiness, upload mode, timezone. No secrets.

## Bootstrap

`GET /api/v1/auth/bootstrap-status`  
`POST /api/v1/auth/bootstrap` header `x-bootstrap-secret` — only when zero users.

## Authenticated coverage

`/me`, `/users`, `/roles`, `/customers`, `/export-cases`, invoices, document requirements/versions/reviews, bank/direct status, courier, bookings, containers, schedule, reminders, notifications, reminder-rules, tracking-links, files/uploads, reports, imports/exports, custom-fields, activity.

## Public

`GET /api/v1/public/track/:token` — safe projection or 410.

See `docs/openapi.yaml` for the route list.
