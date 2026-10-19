# Checkpoint 06.3 runtime root cause

## Request path

```
Browser or Playwright
  → Vite listen socket (43174 E2E dev, or 43175 preview)
  → @cloudflare/vite-plugin createRequestHandler (dist/index.mjs:56320)
  → Miniflare.dispatchFetch (miniflare dist fetch4 around line 90260, dispatchFetch around 134947)
  → undici fetch to the local workerd
  → Hono / Better Auth / D1
  → response back through the same hops
```

`createRequestHandler` awaits `handler(...)`. On throw it calls `next(error)` unless the incoming request was already aborted. Vite then logs `Internal server error: fetch failed` and returns an HTML error page. That HTML is not a Hono JSON body. A Worker exception that returns HTTP 500 with an error-stack header is a different path (Miniflare revives it after a completed fetch). This failure is the undici read failing before a Worker response.

## Reproduction matrix, 2026-10-16

| Condition | Result |
| --- | --- |
| Dev health, sequential 8 and parallel 2/4/8, after ready | 200 JSON, 0 resets |
| Dev health, keep-alive and fresh agents | 200 JSON, 0 resets |
| Dev parallel bootstrap, fresh database | 201 and 409, 0 resets, both handlers ran |
| Dev Playwright request context reused for 12 sequential and 8 parallel `GET /api/v1/dashboard` | 200 JSON, 0 resets. Parallel median 2918 ms |
| Dev bootstrap retry on the first server after both race calls were already 409 | HTTP 500, body classified as reset (`fetch failed`), 64 ms. Vite log: the stack above at 12:26:01 |
| Built preview, two bootstrap calls | 403 JSON (handler ran, secret mismatch) |
| Built preview, bootstrap retry | HTTP 500 HTML `fetch failed`. Same stack at 09:38:32Z. The next sign-in request reached Better Auth (`Invalid origin`) |
| Playwright webServer startup, 12:48:17 local | Two `fetch failed` stacks at the same hop, then Better Auth “Invalid password” on a later request. Setup continued |

The official suite’s setup spec races two bootstrap posts and still expects one success and one 409. The two startup `fetch failed` lines are the same class of proxy failure. They are not proof that the Worker committed a partial bootstrap.

## What is proven

The HTML `fetch failed` page is produced when `dispatchFetch` throws inside the Vite plugin, before Hono writes a response. The same stack appeared three times this session: one discarded dev server, built preview, and the Playwright server start. The next request on that process can still enter the Worker, so workerd is not dead. A reused Playwright context doing dashboard reads did not reproduce it. Parallel health did not reproduce it. So the failure is intermittent at the Vite → workerd hop, more visible around a burst, and not an application SQL or auth exception.

`error.cause.code` was not printed this session. Vite logs `error.message` (`fetch failed`). Undici’s `processResponse` wraps the socket error as that TypeError. Checkpoint 06.2 logged the cause as `read ECONNRESET` on this same stack. This session’s evidence matches that hop. Confidence that the failing hop is Vite/Miniflare/undici rather than Hono: high. Confidence that every instance is specifically `ECONNRESET` rather than another undici socket error: medium, because the cause code was not captured again.

## What was not done

No retry was added in the Worker, the client, or the Vite config. A retry would hide a dropped connection and could repeat a mutation that had already committed. No dependency upgrade and no `node_modules` patch. The existing E2E comment in `e2e/invoice-lock.spec.ts` still opens a fresh browser context for the first correction POST. That remains a test workaround, not a product fix.

Both full Playwright runs on 2026-10-16 logged four `Internal server error: fetch failed` lines each and still finished 32 passed, exit 0. The suite does not fail when the proxy resets a dispatch that a later request or an existing workaround recovers. That green result is not a stability pass.

Status: `ENVIRONMENT_RISK_OPEN`. `RUNTIME_STABILITY` is not PASS.
