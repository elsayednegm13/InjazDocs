import { Hono } from "hono";
import { createAuth } from "../auth";
import { newId } from "../db/sql";
import { loadActor } from "../services/actor";
import { authorizeReplay } from "../services/replay-policy";
import { assertSchemaReady, schemaReadiness } from "../services/schema";
import { processDueReminders } from "../services/reminders";
import { expireUploadSessions, remotePresignAvailable } from "../services/uploads";
import {
  beginIdempotent,
  cleanupIdempotencyKeys,
  completeIdempotent,
  hashIdempotentRequest,
  isIdempotencyExcluded,
  isIdempotentMutation,
  markIdempotentUnknown,
  parseIdempotencyKey,
  releaseIdempotent,
  replayIdempotentResponse,
} from "../services/idempotency";
import { errors, HttpError, jsonError, jsonSuccess, securityHeaders } from "./errors";
import { createIdentityRecovery } from "./identity-recovery";
import { mountBetterAuth, mountBootstrapRoutes, mountSessionRoutes } from "./routes/auth";
import { mountBrandRoutes, mountPublicBrand } from "./routes/brand";
import { mountCaseRoutes } from "./routes/cases";
import { mountFileRoutes } from "./routes/files";
import { mountOperationRoutes, mountPublicTracking } from "./routes/operations";
import { mountQuotationRoutes } from "./routes/quotations";
import { mountTradeRoutes } from "./routes/trade-documents";
import { mountReportRoutes } from "./routes/reports";
import { mountUserRoutes } from "./routes/users";
import type { AppDependencies, AppEnv } from "./types";

export type { AppDependencies } from "./types";

export function createApp(deps: AppDependencies = {}) {
  const app = new Hono<AppEnv>();
  const authFor = deps.createAuth ?? createAuth;
  const recovery = createIdentityRecovery(deps);

  // 1. Request log. Every /api path, including routes that never open a session.
  app.use("/api/*", async (c, next) => {
    const requestId = c.req.header("x-request-id") || newId();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    const started = Date.now();
    const trace = c.env.EXPORTFLOW_TRACE === "1";
    const known = new Set([
      "api", "v1", "health", "me", "dashboard", "export-cases", "bookings", "reminders", "reminder-rules", "schedule",
      "containers", "customers", "auth", "sign-in", "email", "password", "bootstrap", "bootstrap-status",
      "public", "track", "brand", "logo", "favicon", "settings", "whatsapp-template", "notifications", "reports", "users", "roles", "custom-fields", "document-types",
      "document-templates", "document-versions", "hide-from-customer", "customer-share", "customer-revision", "restore", "decision", "activity", "lookups", "files", "uploads", "invoices", "corrections", "revisions",
      // W2 independent quotations (D-10): literal path verbs of the quotations
      // routes. Any other segment (an id) keeps mapping to ":id".
      "quotations", "items", "issue", "response", "revise", "link", "unlink", "copy-items", "archive", "pdf",
      "proformas", "convert", "product-presets", "shipping-methods", "customer-print-profiles", "exporter-identity", "exporter-bank-accounts", "exporter-marks", "file",
      "packing-lines", "sync-totals", "reconciliation", "issue-trade", "lines", "trade-sheet", "trade-header",
      "commercial-pdf", "packing-pdf", "customs-pdf",
      "bank", "presentation-check",
    ]);
    const pattern = new URL(c.req.url).pathname.split("/").map((part) => (part && !known.has(part) ? ":id" : part)).join("/");
    if (trace) console.log(`[exportflow-handler] enter ${c.req.method} ${pattern}`);
    await next();
    if (trace) console.log(`[exportflow-handler] ${c.req.method} ${pattern} ${c.res.status} ${Date.now() - started}`);
  });

  app.onError((error, c) => {
    if (!(error instanceof HttpError) && error.name !== "TransitionError") {
      const text = error instanceof Error ? error.message : String(error);
      console.error("api error", /D1_|SQLITE_|CONSTRAINT/i.test(text) ? error.name : error instanceof Error ? error.stack : error);
    }
    return jsonError(error, c.get("requestId") || "unknown");
  });

  app.post("/api/v1/__test/d1-batch-probe", async (c) => {
    // Env only. A request header cannot open this route.
    if (c.env.EXPORTFLOW_TEST_FAULTS !== "d1-batch-probe") throw errors.notFound();
    const body = await c.req.json<{ size?: number; poison?: boolean }>();
    const size = body.size ?? 0;
    if (!Number.isInteger(size) || size < 1 || size > 2001) throw errors.badRequest("Probe size must be an integer from 1 to 2001.");
    if (size === 2001) return jsonSuccess({ size, poison: false, failed: false, refused: true, n: null }, c.get("requestId"));
    await c.env.DB.prepare("CREATE TABLE IF NOT EXISTS _cf0653_probe (id INTEGER PRIMARY KEY, n INTEGER)").run();
    await c.env.DB.prepare("DELETE FROM _cf0653_probe").run();
    await c.env.DB.prepare("INSERT INTO _cf0653_probe (id, n) VALUES (1, 0)").run();
    const statements: D1PreparedStatement[] = [];
    for (let i = 0; i < size; i += 1) statements.push(c.env.DB.prepare("UPDATE _cf0653_probe SET n = n + 1 WHERE id = 1"));
    if (body.poison) statements.push(c.env.DB.prepare("INSERT INTO _cf0653_missing_table (id) VALUES (1)"));
    let failed = false;
    try {
      await c.env.DB.batch(statements);
    } catch {
      failed = true;
    }
    const row = await c.env.DB.prepare("SELECT n FROM _cf0653_probe WHERE id = 1").first<{ n: number }>();
    return jsonSuccess({ size, poison: Boolean(body.poison), failed, n: row?.n ?? null }, c.get("requestId"));
  });

  app.post("/api/v1/__test/reminder-gate", async (c) => {
    if (c.env.EXPORTFLOW_FIXTURE !== "cp0654" && c.env.EXPORTFLOW_FIXTURE !== "cp0654b") throw errors.notFound();
    await c.env.DB.prepare("CREATE TABLE IF NOT EXISTS _cf0654_gate (id INTEGER PRIMARY KEY, open INTEGER NOT NULL)").run();
    await c.env.DB.prepare("INSERT INTO _cf0654_gate (id, open) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET open = 1").run();
    return jsonSuccess({ open: true }, c.get("requestId"));
  });

  app.get("/api/v1/__test/reminder-drain", async (c) => {
    if (c.env.EXPORTFLOW_FIXTURE !== "cp0654drain") throw errors.notFound();
    const now = new Date().toISOString();
    const eligible = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n
       FROM reminder_instances i
       JOIN reminder_rule_definitions d ON d.id = i.rule_id
       LEFT JOIN (
         SELECT reminder_id, COUNT(*) AS n, MAX(created_at) AS last_at
         FROM notification_deliveries GROUP BY reminder_id
       ) h ON h.reminder_id = i.id
       WHERE i.status = 'ACTIVE' AND i.due_at <= ? AND (i.snoozed_until IS NULL OR i.snoozed_until <= ?)
         AND (
           ((d.repeat_every_days IS NULL OR d.repeat_every_days <= 0) AND COALESCE(h.n, 0) = 0)
           OR (d.repeat_every_days > 0 AND (d.repeat_cap IS NULL OR COALESCE(h.n, 0) < d.repeat_cap)
             AND (h.last_at IS NULL OR (julianday(?) - julianday(h.last_at)) >= d.repeat_every_days))
         )`,
    ).bind(now, now, now).first<{ n: number }>();
    const deliveries = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM notification_deliveries").first<{ n: number }>();
    const dupes = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM (SELECT 1 FROM notification_deliveries GROUP BY reminder_id, cycle_key HAVING COUNT(*) > 1)",
    ).first<{ n: number }>();
    return jsonSuccess({ eligible: eligible?.n ?? null, deliveries: deliveries?.n ?? null, duplicateCycles: dupes?.n ?? null }, c.get("requestId"));
  });

  app.get("/api/v1/health/live", (c) =>
    jsonSuccess({ status: "ok", service: "exportflow", time: new Date().toISOString() }, c.get("requestId")),
  );

  app.get("/api/v1/health", async (c) => {
    let dbReady = false;
    try {
      await c.env.DB.prepare("SELECT 1 AS ok").first();
      dbReady = true;
    } catch {
      dbReady = false;
    }
    const schema = dbReady ? await schemaReadiness(c.env.DB) : { ready: false, missing: ["database"] };
    const ready = dbReady && schema.ready;
    const body = {
      // Readiness: the service is not ready while the primary database is
      // unreachable or the schema is older than this build, so a load balancer
      // must not send mutation traffic to this worker.
      status: ready ? "ok" : "unavailable",
      api: true,
      db: dbReady,
      schema: schema.ready ? "ready" : "upgrade_required",
      uploadMode: remotePresignAvailable(c.env) ? "R2_PRESIGNED" : "LOCAL_WORKER_PARTS",
      // Ready only when all four R2 signing variables are present.
      productionUploadReady: remotePresignAvailable(c.env),
      timezone: c.env.COMPANY_TIMEZONE,
      ...(c.env.EXPORTFLOW_FIXTURE ? { fixture: c.env.EXPORTFLOW_FIXTURE } : {}),
    };
    if (!ready) {
      return Response.json(
        { data: body, meta: { requestId: c.get("requestId") } },
        { status: 503, headers: securityHeaders() },
      );
    }
    return jsonSuccess(body, c.get("requestId"));
  });

  // Secret-gated and public routes. They are registered before the session
  // gate so bootstrap, password recovery and public tracking stay reachable
  // without a cookie.
  mountBetterAuth(app, authFor);
  mountBootstrapRoutes(app, authFor, recovery);
  mountPublicTracking(app);
  mountPublicBrand(app);

  const api = new Hono<AppEnv>();
  // 2–5. Origin, session, schema gate, then idempotency. This stack applies
  // only to the authenticated /api/v1 router mounted at the end.
  api.use("/*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const origin = c.req.header("origin");
      const allowed = c.env.BETTER_AUTH_URL;
      if (!origin || !allowed || origin !== allowed) throw errors.forbidden("Origin mismatch");
    }
    const auth = authFor(c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session?.user) throw errors.unauthorized();
    const actor = await loadActor(c.env.DB, session.user.id);
    if (!actor) throw errors.unauthorized("Account is disabled");
    c.set("actor", actor);
    c.set("sessionId", session.session.id);
    if (actor.mustChangePassword) {
      const path = new URL(c.req.url).pathname;
      const allowed =
        (c.req.method === "GET" && path.endsWith("/me")) ||
        (c.req.method === "POST" && path.endsWith("/me/password"));
      if (!allowed) {
        throw errors.coded(
          403,
          "PASSWORD_CHANGE_REQUIRED",
          "Change your temporary password before continuing.",
        );
      }
    }

    const method = c.req.method;
    // Fail closed before any mutation on a database older than this build.
    // GET/HEAD remain available so an operator can inspect the system.
    if (method !== "GET" && method !== "HEAD") {
      await assertSchemaReady(c.env.DB);
    }
    const url = new URL(c.req.url);
    const idempotencyKey = parseIdempotencyKey(c.req.header("idempotency-key"));
    if (idempotencyKey && isIdempotentMutation(method) && !isIdempotencyExcluded(url.pathname)) {
      const path = `${url.pathname}${url.search}`;
      const rawBody = await c.req.raw.clone().text();
      const requestHash = await hashIdempotentRequest(method, path, rawBody);
      const begun = await beginIdempotent(c.env.DB, actor.id, idempotencyKey, method, path, requestHash);

      if (begun.kind === "REPLAY") {
        // The cached body is protected data. Re-authorize the current actor,
        // route permission and case scope before returning a single byte.
        await authorizeReplay(c.env.DB, actor, method, url.pathname, rawBody);
        const response = replayIdempotentResponse(begun);
        c.res = response;
        return response;
      }
      if (begun.kind === "MISMATCH") {
        throw errors.coded(
          422,
          "IDEMPOTENCY_KEY_REUSED",
          "This Idempotency-Key was already used for a different request.",
        );
      }
      if (begun.kind === "IN_PROGRESS") {
        throw errors.conflict(
          "This request is already being processed. Retry with the same key.",
          "IDEMPOTENCY_IN_PROGRESS",
        );
      }
      if (begun.kind === "UNKNOWN") {
        throw errors.coded(
          409,
          "IDEMPOTENCY_RESULT_UNKNOWN",
          "The previous attempt may have succeeded. Refresh the record list and verify before starting again.",
        );
      }
      if (begun.kind === "EXPIRED") {
        throw errors.coded(
          409,
          "IDEMPOTENCY_RESULT_EXPIRED",
          "This operation already completed. The cached response has expired; check the record list instead of repeating it.",
        );
      }

      // Delay headers are ignored unless this Worker was started with the
      // explicit test var. Production wrangler vars do not set it.
      if (c.env.ALLOW_TEST_DELAY_HEADERS === "true") {
        const delay = Number(c.req.header("x-test-delay-ms"));
        if (Number.isFinite(delay) && delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 10_000)));
        }
      }
      if (c.env.EXPORTFLOW_TEST_FAULTS === "1") {
        if (c.req.header("x-test-fail-before-handler") === "1") {
          await releaseIdempotent(c.env.DB, begun.id);
          throw new Error("Induced transient failure before handler");
        }
      }

      try {
        await next();
      } catch (error) {
        if (error instanceof HttpError || (error instanceof Error && error.name === "TransitionError")) {
          const response = jsonError(error, c.get("requestId"));
          const stored = await response.clone().text();
          await completeIdempotent(
            c.env.DB,
            begun.id,
            response.status,
            stored,
            response.headers.get("content-type"),
          );
          c.res = response;
          return response;
        }
        // The handler may have committed part of its work before the unknown
        // failure. Do not execute it again automatically.
        await markIdempotentUnknown(c.env.DB, begun.id);
        throw error;
      }

      const response = c.res;
      if (response.status >= 500) {
        await markIdempotentUnknown(c.env.DB, begun.id);
        return response;
      }
      const stored = await response.clone().text();
      await completeIdempotent(
        c.env.DB,
        begun.id,
        response.status,
        stored,
        response.headers.get("content-type"),
      );
      if (c.env.ALLOW_TEST_DELAY_HEADERS === "true") {
        const afterDelay = Number(c.req.header("x-test-delay-after-commit-ms"));
        if (Number.isFinite(afterDelay) && afterDelay > 0) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(afterDelay, 10_000)));
        }
      }
      return response;
    }

    await next();
  });

  mountSessionRoutes(api, authFor);
  mountUserRoutes(api, authFor, recovery);
  mountCaseRoutes(api);
  mountQuotationRoutes(api);
  mountTradeRoutes(api);
  mountOperationRoutes(api);
  mountFileRoutes(api);
  mountReportRoutes(api);
  mountBrandRoutes(api);

  app.route("/api/v1", api);

  return app;
}

export async function handleScheduled(env: Env) {
  const reminders = await processDueReminders(env.DB, env);
  const expiredUploads = await expireUploadSessions(env.DB, env.DOCUMENTS);
  // Public tracking tokens create one short-lived bucket per client. Remove
  // buckets older than a day so the table cannot grow without bound.
  const staleLimits = await env.DB
    .prepare("DELETE FROM rate_limit_buckets WHERE window_start < ?")
    .bind(Date.now() - 24 * 60 * 60 * 1000)
    .run();
  const staleIdempotency = await cleanupIdempotencyKeys(env.DB);
  return { ...reminders, expiredUploads, staleRateLimits: staleLimits.meta.changes ?? 0, staleIdempotency };
}
