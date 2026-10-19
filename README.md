# ExportFlow

Internal export operations system for a single exporting company. It replaces daily Excel follow-up with structured cases, invoices, document routes, bookings, containers, reminders, and revocable customer tracking links.

This repository is a **local MVP**. It does not create Cloudflare resources, deploy, or migrate remote databases.

## Stack

- React + Vite + Tailwind CSS
- Hono API on a Cloudflare Worker (`/api/v1`)
- Cloudflare D1 (SQLite) via Wrangler local bindings
- Cloudflare R2 via local binding (presigned S3 multipart when owner-supplied credentials exist)
- Better Auth (email/password, HttpOnly cookies, no public signup)
- Drizzle adapter for Better Auth tables; domain SQL on D1

## Local run

1. `pnpm install`
2. Copy `.dev.vars.example` to `.dev.vars` and fill:

```
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=http://127.0.0.1:43173
BOOTSTRAP_SECRET=<openssl rand -base64 32>
```

3. Apply local D1 migrations:

```
pnpm db:migrate:local
```

4. Start the app:

```
pnpm dev
```

Open http://127.0.0.1:43173

5. First administrator (no demo password is shipped):

- Use the first-time setup form on `/login` with `BOOTSTRAP_SECRET`, or
- `BOOTSTRAP_SECRET=... ADMIN_EMAIL=... ADMIN_PASSWORD=... pnpm bootstrap-admin`

The first admin must change password after sign-in. Do not commit secrets.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Vite + workerd on port 43173 |
| `pnpm test` | Domain / unit tests |
| `pnpm test:e2e` | Playwright against an isolated workerd DB in `.wrangler-e2e` |
| `pnpm typecheck` | TypeScript project build |
| `pnpm lint` | Oxlint |
| `pnpm build` | Production Worker + SPA build |
| `pnpm db:migrate:local` | Apply D1 migrations to the local DB only |

Remote migrate/deploy scripts refuse to run. See `docs/CLOUDFLARE_SETUP.md`.

## Layout

- `src/` React SPA (AR/EN, RTL)
- `worker/` Worker entry
- `server/` domain, services, HTTP
- `shared/` DTOs and validation
- `drizzle/migrations/` D1 SQL
- `docs/` architecture, security, runbooks
- `tests/` automated checks

## Honest limits

- Courier/DHL is **manual only**. No carrier API is called.
- 400 MiB remote R2 presign is implemented but **not verified** against real Cloudflare until the owner supplies scoped S3 credentials and approves staging tests.
- Without those credentials, local uploads use the R2 binding + Worker part endpoints (streamed multipart, not a single 400 MiB Worker proxy).
- No email, DNS, or production deploy is configured.
