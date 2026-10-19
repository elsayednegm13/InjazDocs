# New agent baseline

Captured 2026-10-13 on `I:\WORK\InjazDocs`. Secret values were not printed.

## Workspace

- Node v24.19.0. `pnpm` is not on PATH. `corepack pnpm` is 12.11.2 and re-linked the existing lockfile (264 packages, no lockfile change intended).
- Wrangler 4.149.0, Vite 7.3.7, Vitest 3.2.7, TypeScript 5.9.3, Playwright 1.64.0, React 19.3.0, Hono 4.13.13.
- No `.git` directory.
- `.dev.vars` exists and contains the names `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BOOTSTRAP_SECRET`. Example file also names optional `R2_*` keys. Those R2 names are absent from `.dev.vars`.
- `wrangler.jsonc` has no `env.staging`. Database id is the local placeholder.
- `.wrangler` exists and was not deleted, migrated, or listed for user rows. `.wrangler-e2e` is recreated by the E2E script.

## Commands before the case-service restore

`corepack pnpm typecheck` exit 2:

```
server/http/app.ts: Module '"../services/cases"' has no exported member 'createCase' (and the other five case exports).
```

`server/services/cases.ts` length was 0. `corepack pnpm test` then: 5 files, 19 tests, exit 0. `corepack pnpm lint` exit 0.

## Commands after the local slice

`corepack pnpm typecheck` exit 0.
`corepack pnpm lint` exit 0 with one oxlint warning: `CustomFieldsPanel.tsx` also exports helpers (`react(only-export-components)`).
`corepack pnpm test`: 5 files, 21 tests, exit 0. Added custom-field and CSV cases.

After the slice, on 2026-10-13:

- `corepack pnpm typecheck` exit 0
- `corepack pnpm lint` exit 0 (oxlint warning only: `CustomFieldsPanel.tsx` exports helpers)
- `corepack pnpm test` exit 0: 5 files, 21 tests
- `corepack pnpm exec playwright test` exit 0: 27 passed in 9.1m (includes setup, custom fields, operations, security, visual). An earlier full run the same night was 26 passed and 1 failed before the custom-fields user-provision assertion was corrected; that failure is not the final count.
- `corepack pnpm build` exit 0 in about 45s. Client bundle `dist/client/assets/index-CdY0bP6L.js` is 524.18 kB (gzip 160.47 kB). Vite warned that the chunk exceeds 500 kB.

## Not run

Remote Wrangler, D1, R2, deploy, WAF, live DHL, email, and any command that would migrate `.wrangler/state`.
