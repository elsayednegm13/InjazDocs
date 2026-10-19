# Implementation plan

Inspected an empty repository (seeded prompt only). Scaffolded Vite React TS, then added the current Cloudflare Vite plugin, Hono, D1, R2, Better Auth.

Order executed:

1. Shared enums, money/weight/container/carrier, permission resolver
2. Domain state machines and reminder evaluator
3. D1 SQL migrations + seed lookups/roles/rules
4. Services + `/api/v1` routes
5. SPA screens against live APIs
6. Unit tests for commercial, route, reminder, and completion rules
7. Local-only runbooks

No remote Cloudflare mutations are in scope.
