import { Hono } from "hono";
import type { CustomFieldTarget } from "../../shared/enums";
import { createAuth } from "../auth";
import { all, newId, one } from "../db/sql";
import { loadActor, requirePermission, type Actor } from "../services/actor";
import { writeAudit } from "../services/audit";
import { transitionBank, createCourier, listCourier, transitionDirect, updateCourierStatus } from "../services/bank-courier";
import {
  addContainerSlots,
  assignContainerNumber,
  attachBookingConfirmation,
  createBooking,
  getBooking,
  listBookings,
  listContainers,
  listSchedule,
  transitionContainer,
  updateBooking,
} from "../services/bookings";
import {
  createCase,
  createInvoice,
  getCaseOverview,
  listCases,
  transitionCase,
  updateInvoice,
  correctCompletedInvoice,
  listInvoiceRevisions,
  assertInvoiceOrdinaryWrite,
} from "../services/cases";
import { createCustomer, getCustomer, listCustomers, updateCustomer } from "../services/customers";
import {
  addRequirement,
  attachVersion,
  changeDocumentRoute,
  listDocumentTypes,
  listTemplates,
  removeRequirement,
  reviewDocument,
} from "../services/documents";
import { casesCsv, delayReport, overview, previewCustomerImport } from "../services/reports";
import {
  listNotifications,
  listReminders,
  listRules,
  markNotificationRead,
  processDueReminders,
  snoozeReminder,
  updateRule,
} from "../services/reminders";
import {
  createTrackingLink,
  listTrackingLinks,
  publicTracking,
  revokeTrackingLink,
  rotateTrackingLink,
} from "../services/tracking";
import {
  abortUpload,
  authorizeObjectKey,
  completeUpload,
  createUploadSession,
  downloadObject,
  expireUploadSessions,
  remotePresignAvailable,
  signPart,
  storeLocalPart,
} from "../services/uploads";
import {
  createRole,
  ensureAdminRole,
  listRoles,
  listUsers,
  replaceRolePermissions,
  setOverrides,
  setUserActive,
  setUserRoles,
} from "../services/users";
import { rateLimitSubject } from "./client-ip";
import { errors, HttpError, jsonError, jsonSuccess } from "./errors";
import { assertCustomFieldEntityAccess, createCustomFieldDefinition, entityRequiresCustomFields, listAvailableCustomFieldDefinitions, listCustomFieldDefinitions, readCustomFields, saveCustomFields, updateCustomFieldDefinition } from "../services/custom-fields";

type AppEnv = {
  Bindings: Env;
  Variables: {
    requestId: string;
    actor: Actor;
  };
};

function mountCustomFields(api: Hono<AppEnv>, prefix: string, target: CustomFieldTarget) {
  api.get(`${prefix}/custom-fields`, async (c) => {
    const id = c.req.param("id") ?? "";
    await assertCustomFieldEntityAccess(c.env.DB, c.get("actor"), target, id, "view");
    return jsonSuccess(await readCustomFields(c.env.DB, c.get("actor"), target, id), c.get("requestId"));
  });
  api.put(`${prefix}/custom-fields`, async (c) => {
    const id = c.req.param("id") ?? "";
    await assertCustomFieldEntityAccess(c.env.DB, c.get("actor"), target, id, "edit");
    if (target === "INVOICE") {
      const parent = await one<{ case_id: string }>(c.env.DB, "SELECT case_id FROM export_invoices WHERE id = ?", id);
      if (parent) await assertInvoiceOrdinaryWrite(c.env.DB, parent.case_id);
    }
    const enforceRequired = await entityRequiresCustomFields(c.env.DB, target, id);
    await saveCustomFields(c.env.DB, c.get("actor"), target, id, await c.req.json<Record<string, unknown>>(), {
      enforceRequired,
      requestId: c.get("requestId"),
    });
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
}

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("/api/*", async (c, next) => {
    const requestId = c.req.header("x-request-id") || newId();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    const started = Date.now();
    const trace = c.env.EXPORTFLOW_TRACE === "1";
    const known = new Set([
      "api", "v1", "health", "me", "dashboard", "export-cases", "bookings", "reminders", "reminder-rules", "schedule",
      "containers", "customers", "auth", "sign-in", "email", "password", "bootstrap", "bootstrap-status",
      "public", "track", "notifications", "reports", "users", "roles", "custom-fields", "document-types",
      "document-templates", "activity", "lookups", "files", "uploads", "invoices", "corrections", "revisions",
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
    const probeAllowed = c.env.EXPORTFLOW_TEST_FAULTS === "d1-batch-probe"
      || (c.env.EXPORTFLOW_FIXTURE === "cp0654" && c.req.header("x-exportflow-fault") === "d1-batch-probe");
    if (!probeAllowed) throw errors.notFound();
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

  app.get("/api/v1/health", async (c) => {
    let dbReady = false;
    try {
      await c.env.DB.prepare("SELECT 1 AS ok").first();
      dbReady = true;
    } catch {
      dbReady = false;
    }
    return jsonSuccess(
      {
        status: "ok",
        api: true,
        db: dbReady,
        uploadMode: remotePresignAvailable(c.env) ? "R2_PRESIGNED" : "LOCAL_WORKER_PARTS",
        // Presence of R2 keys is not proof. This stays false until a real staging upload is verified.
        productionUploadReady: false,
        timezone: c.env.COMPANY_TIMEZONE,
        ...(c.env.EXPORTFLOW_FIXTURE ? { fixture: c.env.EXPORTFLOW_FIXTURE } : {}),
      },
      c.get("requestId"),
    );
  });

  const authRoutes = new Hono<AppEnv>();
  authRoutes.all("/*", (c) => {
    const auth = createAuth(c.env);
    return auth.handler(c.req.raw);
  });
  app.route("/api/auth", authRoutes);

  app.get("/api/v1/auth/bootstrap-status", async (c) => {
    const row = await one<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM user");
    return jsonSuccess({ required: (row?.n ?? 0) === 0 }, c.get("requestId"));
  });

  app.post("/api/v1/auth/bootstrap", async (c) => {
    const supplied = c.req.header("x-bootstrap-secret") || "";
    if (!c.env.BOOTSTRAP_SECRET || supplied !== c.env.BOOTSTRAP_SECRET) throw errors.forbidden("Invalid bootstrap secret");
    const consumed = await c.env.DB
      .prepare("UPDATE company_settings SET bootstrap_consumed = 1 WHERE id = 'default' AND bootstrap_consumed = 0")
      .run();
    if (!consumed.meta.changes) throw errors.conflict("Bootstrap is no longer available");
    const body = await c.req.json<{ email: string; password: string; name: string }>();
    if (!body.email || !body.password || body.password.length < 12) {
      throw errors.validation("Email and a password of at least 12 characters are required");
    }
    const auth = createAuth(c.env);
    const ctx = await auth.$context;
    const user = await ctx.internalAdapter.createUser({
      email: body.email,
      name: body.name || "Administrator",
      emailVerified: true,
    }, { method: "admin" });
    const hash = await ctx.password.hash(body.password);
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password: hash,
    });
    await c.env.DB.prepare("UPDATE user SET must_change_password = 1, is_active = 1 WHERE id = ?").bind(user.id).run();
    await ensureAdminRole(c.env.DB, user.id);
    await writeAudit(c.env.DB, { actorId: user.id, entityType: "user", entityId: user.id, action: "bootstrap.admin", requestId: c.get("requestId") });
    return jsonSuccess({ userId: user.id, mustChangePassword: true }, c.get("requestId"), {}, 201);
  });

  app.post("/api/v1/auth/reset-password", async (c) => {
    const supplied = c.req.header("x-bootstrap-secret") || "";
    if (!c.env.BOOTSTRAP_SECRET || supplied !== c.env.BOOTSTRAP_SECRET) throw errors.forbidden("Invalid bootstrap secret");
    const body = await c.req.json<{ email: string; password: string }>();
    if (!body.email || !body.password || body.password.length < 12) {
      throw errors.validation("Email and a password of at least 12 characters are required");
    }
    const auth = createAuth(c.env);
    const ctx = await auth.$context;
    const found = await ctx.internalAdapter.findUserByEmail(body.email.toLowerCase());
    if (!found?.user) throw errors.notFound("User not found");
    const hash = await ctx.password.hash(body.password);
    await ctx.internalAdapter.updatePassword(found.user.id, hash);
    await c.env.DB.prepare("UPDATE user SET must_change_password = 0, is_active = 1 WHERE id = ?").bind(found.user.id).run();
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });

  app.get("/api/v1/public/track/:token", async (c) => {
    try {
      const data = await publicTracking(c.env.DB, c.env, c.req.param("token"), rateLimitSubject(c.req.raw, c.env));
      return jsonSuccess(data, c.get("requestId"));
    } catch (error) {
      return jsonError(error instanceof Error ? error : new Error("unavailable"), c.get("requestId"));
    }
  });

  const api = new Hono<AppEnv>();
  api.use("/*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const origin = c.req.header("origin");
      const allowed = c.env.BETTER_AUTH_URL;
      if (origin && allowed && origin !== allowed) throw errors.forbidden("Origin mismatch");
    }
    const auth = createAuth(c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session?.user) throw errors.unauthorized();
    const actor = await loadActor(c.env.DB, session.user.id);
    if (!actor) throw errors.unauthorized("Account is disabled");
    c.set("actor", actor);
    await next();
  });

  api.get("/me", (c) => {
    const actor = c.get("actor");
    return jsonSuccess(
      {
        id: actor.id,
        email: actor.email,
        name: actor.name,
        mustChangePassword: actor.mustChangePassword,
        permissions: [...actor.permissions],
        roles: actor.roleKeys,
      },
      c.get("requestId"),
    );
  });

  api.post("/me/password", async (c) => {
    const body = await c.req.json<{ currentPassword: string; newPassword: string }>();
    const auth = createAuth(c.env);
    await auth.api.changePassword({
      body: { currentPassword: body.currentPassword, newPassword: body.newPassword },
      headers: c.req.raw.headers,
    });
    await c.env.DB.prepare("UPDATE user SET must_change_password = 0 WHERE id = ?").bind(c.get("actor").id).run();
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });

  api.get("/lookups", async (c) => {
    const ports = await all(c.env.DB, "SELECT * FROM ports ORDER BY name");
    const paymentTerms = await all(c.env.DB, "SELECT * FROM payment_term_types");
    const settings = await one(c.env.DB, "SELECT * FROM company_settings WHERE id = 'default'");
    return jsonSuccess({ ports, paymentTerms, settings }, c.get("requestId"));
  });

  api.get("/dashboard", async (c) => jsonSuccess(await overview(c.env.DB, c.get("actor")), c.get("requestId")));

  api.get("/users", async (c) => {
    requirePermission(c.get("actor"), "users.manage");
    return jsonSuccess(await listUsers(c.env.DB), c.get("requestId"));
  });
  api.post("/users", async (c) => {
    requirePermission(c.get("actor"), "users.manage");
    const body = await c.req.json<{ email: string; password: string; name: string; roleKeys: string[] }>();
    const auth = createAuth(c.env);
    const ctx = await auth.$context;
    const user = await ctx.internalAdapter.createUser({ email: body.email, name: body.name, emailVerified: true }, { method: "admin" });
    const hash = await ctx.password.hash(body.password);
    await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: hash });
    await c.env.DB.prepare("UPDATE user SET must_change_password = 1, is_active = 1 WHERE id = ?").bind(user.id).run();
    await setUserRoles(c.env.DB, c.get("actor"), user.id, body.roleKeys ?? ["export_officer"], c.get("requestId"));
    return jsonSuccess({ id: user.id }, c.get("requestId"), {}, 201);
  });
  api.post("/users/:id/roles", async (c) => {
    requirePermission(c.get("actor"), "roles.manage");
    const body = await c.req.json<{ roleKeys: string[] }>();
    await setUserRoles(c.env.DB, c.get("actor"), c.req.param("id"), body.roleKeys, c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.post("/users/:id/overrides", async (c) => {
    requirePermission(c.get("actor"), "roles.manage");
    const body = await c.req.json<{ overrides: { permissionKey: never; effect: "GRANT" | "DENY" }[] }>();
    await setOverrides(c.env.DB, c.get("actor"), c.req.param("id"), body.overrides, c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.post("/users/:id/active", async (c) => {
    requirePermission(c.get("actor"), "users.manage");
    const body = await c.req.json<{ active: boolean }>();
    await setUserActive(c.env.DB, c.get("actor"), c.req.param("id"), body.active, c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.post("/roles", async (c) => {
    const body = await c.req.json<{ key: string; nameEn: string; nameAr: string; permissions: string[] }>();
    return jsonSuccess(await createRole(c.env.DB, c.get("actor"), body, c.get("requestId")), c.get("requestId"), {}, 201);
  });
  api.get("/roles", async (c) => {
    requirePermission(c.get("actor"), "roles.manage");
    return jsonSuccess(await listRoles(c.env.DB), c.get("requestId"));
  });
  api.put("/roles/:id/permissions", async (c) => {
    requirePermission(c.get("actor"), "roles.manage");
    const body = await c.req.json<{ permissions: string[] }>();
    await replaceRolePermissions(c.env.DB, c.get("actor"), c.req.param("id"), body.permissions, c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });

  api.get("/customers", async (c) => {
    requirePermission(c.get("actor"), "customers.view");
    const result = await listCustomers(c.env.DB, {
      page: Number(c.req.query("page") ?? 1),
      pageSize: Number(c.req.query("pageSize") ?? 20),
      q: c.req.query("q") ?? undefined,
    });
    return jsonSuccess(result.rows, c.get("requestId"), { page: result.page, pageSize: result.pageSize, total: result.total });
  });
  api.post("/customers", async (c) => jsonSuccess(await createCustomer(c.env.DB, c.get("actor"), await c.req.json(), c.get("requestId")), c.get("requestId"), {}, 201));
  api.get("/customers/:id", async (c) => {
    requirePermission(c.get("actor"), "customers.view");
    return jsonSuccess(await getCustomer(c.env.DB, c.get("actor"), c.req.param("id")), c.get("requestId"));
  });
  api.put("/customers/:id", async (c) => {
    await updateCustomer(c.env.DB, c.get("actor"), c.req.param("id"), await c.req.json(), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  mountCustomFields(api, "/customers/:id", "CUSTOMER");

  api.get("/export-cases", async (c) => {
    const result = await listCases(c.env.DB, c.get("actor"), {
      page: Number(c.req.query("page") ?? 1),
      pageSize: Number(c.req.query("pageSize") ?? 20),
      q: c.req.query("q") ?? undefined,
      status: c.req.query("status") ?? undefined,
      country: c.req.query("country") ?? undefined,
    });
    return jsonSuccess(result.rows, c.get("requestId"), { page: result.page, pageSize: result.pageSize, total: result.total });
  });
  api.post("/export-cases", async (c) => jsonSuccess(await createCase(c.env.DB, c.get("actor"), c.env, await c.req.json(), c.get("requestId")), c.get("requestId"), {}, 201));
  api.get("/export-cases/:id", async (c) => jsonSuccess(await getCaseOverview(c.env.DB, c.get("actor"), c.req.param("id")), c.get("requestId")));
  mountCustomFields(api, "/export-cases/:id", "EXPORT_CASE");
  mountCustomFields(api, "/invoices/:id", "INVOICE");
  mountCustomFields(api, "/bookings/:id", "BOOKING");
  mountCustomFields(api, "/containers/:id", "CONTAINER");
  api.post("/export-cases/:id/status", async (c) => {
    const body = await c.req.json<{ to: never; reason?: string; version: number }>();
    await transitionCase(c.env.DB, c.get("actor"), c.env, c.req.param("id"), body.to, body, c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.post("/export-cases/:id/route", async (c) => {
    const body = await c.req.json<{ to: never }>();
    await changeDocumentRoute(c.env.DB, c.get("actor"), c.env, c.req.param("id"), body.to, c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.post("/export-cases/:id/invoices", async (c) => jsonSuccess(await createInvoice(c.env.DB, c.get("actor"), c.env, c.req.param("id"), await c.req.json(), c.get("requestId")), c.get("requestId"), {}, 201));
  api.put("/invoices/:id", async (c) => {
    await updateInvoice(c.env.DB, c.get("actor"), c.req.param("id"), await c.req.json(), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.get("/invoices/:id/revisions", async (c) => jsonSuccess(await listInvoiceRevisions(c.env.DB, c.get("actor"), c.req.param("id")), c.get("requestId")));
  api.post("/invoices/:id/corrections", async (c) =>
    jsonSuccess(
      await correctCompletedInvoice(c.env.DB, c.get("actor"), c.req.param("id"), await c.req.json(), c.get("requestId"), {
        allowTestFault: c.env.EXPORTFLOW_TEST_FAULTS === "1",
      }),
      c.get("requestId"),
    ),
  );

  api.get("/document-types", async (c) => jsonSuccess(await listDocumentTypes(c.env.DB), c.get("requestId")));
  api.get("/document-templates", async (c) => jsonSuccess(await listTemplates(c.env.DB), c.get("requestId")));
  api.post("/export-cases/:id/document-requirements", async (c) => jsonSuccess(await addRequirement(c.env.DB, c.get("actor"), c.env, c.req.param("id"), await c.req.json(), c.get("requestId")), c.get("requestId"), {}, 201));
  api.delete("/document-requirements/:id", async (c) => {
    await removeRequirement(c.env.DB, c.get("actor"), c.env, c.req.param("id"), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.post("/document-requirements/:id/versions", async (c) => jsonSuccess(await attachVersion(c.env.DB, c.get("actor"), c.env, c.req.param("id"), await c.req.json(), c.get("requestId")), c.get("requestId"), {}, 201));
  api.post("/document-requirements/:id/review", async (c) => {
    await reviewDocument(c.env.DB, c.get("actor"), c.env, c.req.param("id"), await c.req.json(), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });

  api.post("/export-cases/:id/bank/status", async (c) => {
    const body = await c.req.json<{ to: never; bankName?: string; reason?: string }>();
    await transitionBank(c.env.DB, c.get("actor"), c.env, c.req.param("id"), body.to, body, c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.post("/export-cases/:id/direct/status", async (c) => {
    const body = await c.req.json<{ to: never }>();
    await transitionDirect(c.env.DB, c.get("actor"), c.env, c.req.param("id"), body.to, c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.get("/export-cases/:id/courier", async (c) => jsonSuccess(await listCourier(c.env.DB, c.get("actor"), c.req.param("id")), c.get("requestId")));
  api.post("/export-cases/:id/courier", async (c) => jsonSuccess(await createCourier(c.env.DB, c.get("actor"), c.env, c.req.param("id"), await c.req.json(), c.get("requestId")), c.get("requestId"), {}, 201));
  api.post("/courier/:id/status", async (c) => {
    await updateCourierStatus(c.env.DB, c.get("actor"), c.env, c.req.param("id"), await c.req.json(), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });

  api.get("/bookings", async (c) => {
    const result = await listBookings(c.env.DB, c.get("actor"), { page: Number(c.req.query("page") ?? 1), q: c.req.query("q") ?? undefined });
    return jsonSuccess(result.rows, c.get("requestId"), { page: result.page, pageSize: result.pageSize });
  });
  api.post("/bookings", async (c) => jsonSuccess(await createBooking(c.env.DB, c.get("actor"), c.env, await c.req.json(), c.get("requestId")), c.get("requestId"), {}, 201));
  api.get("/bookings/:id", async (c) => jsonSuccess(await getBooking(c.env.DB, c.get("actor"), c.req.param("id")), c.get("requestId")));
  api.put("/bookings/:id", async (c) => {
    await updateBooking(c.env.DB, c.get("actor"), c.env, c.req.param("id"), await c.req.json(), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.post("/bookings/:id/confirmation", async (c) => jsonSuccess(await attachBookingConfirmation(c.env.DB, c.get("actor"), c.req.param("id"), await c.req.json(), c.get("requestId")), c.get("requestId"), {}, 201));
  api.post("/bookings/:id/slots", async (c) => {
    const body = await c.req.json<{ count: number }>();
    await addContainerSlots(c.env.DB, c.get("actor"), c.req.param("id"), body.count);
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.post("/containers/:id/number", async (c) => {
    await assignContainerNumber(c.env.DB, c.get("actor"), c.env, c.req.param("id"), await c.req.json(), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.post("/containers/:id/status", async (c) => {
    await transitionContainer(c.env.DB, c.get("actor"), c.env, c.req.param("id"), await c.req.json(), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.get("/containers", async (c) => jsonSuccess(await listContainers(c.env.DB, c.get("actor"), { q: c.req.query("q") ?? undefined, status: c.req.query("status") ?? undefined }), c.get("requestId")));
  api.get("/schedule", async (c) => jsonSuccess(await listSchedule(c.env.DB, c.get("actor"), { from: c.req.query("from") ?? undefined, to: c.req.query("to") ?? undefined }), c.get("requestId")));

  api.get("/reminders", async (c) => jsonSuccess(await listReminders(c.env.DB, c.get("actor"), c.req.query("filter") ?? "open"), c.get("requestId")));
  api.post("/reminders/:id/snooze", async (c) => {
    const body = await c.req.json<{ until: string }>();
    await snoozeReminder(c.env.DB, c.get("actor"), c.req.param("id"), body.until);
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.get("/notifications", async (c) => jsonSuccess(await listNotifications(c.env.DB, c.get("actor")), c.get("requestId")));
  api.post("/notifications/:id/read", async (c) => {
    await markNotificationRead(c.env.DB, c.get("actor"), c.req.param("id"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.get("/reminder-rules", async (c) => {
    requirePermission(c.get("actor"), "reminders.manage_rules");
    return jsonSuccess(await listRules(c.env.DB), c.get("requestId"));
  });
  api.patch("/reminder-rules/:id", async (c) => {
    const faultHeader = c.req.header("x-exportflow-fault");
    await updateRule(c.env.DB, c.get("actor"), c.env, c.req.param("id"), await c.req.json(), faultHeader);
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });

  api.get("/export-cases/:id/tracking-links", async (c) => jsonSuccess(await listTrackingLinks(c.env.DB, c.get("actor"), c.req.param("id")), c.get("requestId")));
  api.post("/export-cases/:id/tracking-links", async (c) => jsonSuccess(await createTrackingLink(c.env.DB, c.get("actor"), c.req.param("id"), await c.req.json(), c.get("requestId")), c.get("requestId"), {}, 201));
  api.post("/tracking-links/:id/revoke", async (c) => {
    await revokeTrackingLink(c.env.DB, c.get("actor"), c.req.param("id"), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.post("/tracking-links/:id/rotate", async (c) => jsonSuccess(await rotateTrackingLink(c.env.DB, c.get("actor"), c.req.param("id"), c.get("requestId")), c.get("requestId")));

  api.post("/files/uploads", async (c) => jsonSuccess(await createUploadSession(c.env.DB, c.env, c.env.DOCUMENTS, c.get("actor"), await c.req.json()), c.get("requestId"), {}, 201));
  api.post("/files/uploads/:id/sign", async (c) => {
    const body = await c.req.json<{ partNumber: number }>();
    return jsonSuccess(await signPart(c.env.DB, c.env, c.get("actor"), c.req.param("id"), body.partNumber), c.get("requestId"));
  });
  api.put("/files/uploads/:id/parts/:part", async (c) => {
    const body = await c.req.arrayBuffer();
    return jsonSuccess(await storeLocalPart(c.env.DB, c.env.DOCUMENTS, c.get("actor"), c.req.param("id"), Number(c.req.param("part")), body), c.get("requestId"));
  });
  api.post("/files/uploads/:id/complete", async (c) => jsonSuccess(await completeUpload(c.env.DB, c.env.DOCUMENTS, c.get("actor"), c.req.param("id"), (await c.req.json<{ parts: { partNumber: number; etag: string }[] }>()).parts), c.get("requestId")));
  api.post("/files/uploads/:id/abort", async (c) => {
    await abortUpload(c.env.DB, c.env.DOCUMENTS, c.get("actor"), c.req.param("id"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.get("/files/download", async (c) => {
    requirePermission(c.get("actor"), "documents.view");
    const key = c.req.query("key");
    if (!key) throw errors.badRequest("key is required");
    await authorizeObjectKey(c.env.DB, c.get("actor"), key);
    const stored = await one<{ original_name: string; content_type: string }>(
      c.env.DB,
      "SELECT original_name, content_type FROM document_versions WHERE r2_key = ? ORDER BY created_at DESC LIMIT 1",
      key,
    );
    const object = await downloadObject(c.env.DOCUMENTS, key);
    const filename = stored?.original_name || "document";
    const contentType = object.httpMetadata?.contentType || stored?.content_type || "application/octet-stream";
    const canInline = contentType === "application/pdf" || contentType.startsWith("image/");
    const asciiName = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
    return new Response(object.body, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${canInline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  api.get("/reports/overview", async (c) => jsonSuccess(await overview(c.env.DB, c.get("actor")), c.get("requestId")));
  api.get("/reports/delays", async (c) => jsonSuccess(await delayReport(c.env.DB, c.get("actor")), c.get("requestId")));
  api.get("/exports/csv", async (c) => {
    const csv = await casesCsv(c.env.DB, c.get("actor"));
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="exportflow-cases.csv"',
        "Cache-Control": "no-store",
      },
    });
  });
  api.post("/imports/customers/preview", async (c) => {
    requirePermission(c.get("actor"), "customers.create");
    const body = await c.req.json<{ rows: Record<string, string>[] }>();
    return jsonSuccess(await previewCustomerImport(body.rows), c.get("requestId"));
  });
  api.post("/imports/customers/commit", async (c) => {
    requirePermission(c.get("actor"), "customers.create");
    const body = await c.req.json<{ rows: Record<string, string>[] }>();
    const preview = await previewCustomerImport(body.rows);
    if (!preview.canCommit) throw new HttpError(409, "IMPORT_INVALID", "The import preview has errors, so nothing was saved.");
    for (const row of preview.valid) {
      await createCustomer(c.env.DB, c.get("actor"), { legalName: row.legalName, countryCode: row.countryCode, contacts: row.phone ? [{ fullName: row.legalName, phone: row.phone }] : [] }, c.get("requestId"));
    }
    return jsonSuccess({ imported: preview.valid.length }, c.get("requestId"));
  });

  api.get("/custom-fields", async (c) => {
    const targetEntity = c.req.query("targetEntity");
    if (targetEntity) {
      return jsonSuccess(await listAvailableCustomFieldDefinitions(c.env.DB, c.get("actor"), targetEntity), c.get("requestId"));
    }
    requirePermission(c.get("actor"), "settings.manage");
    return jsonSuccess(await listCustomFieldDefinitions(c.env.DB), c.get("requestId"));
  });
  api.post("/custom-fields", async (c) => {
    return jsonSuccess(await createCustomFieldDefinition(c.env.DB, c.get("actor"), await c.req.json(), c.get("requestId")), c.get("requestId"), {}, 201);
  });
  api.patch("/custom-fields/:id", async (c) => {
    await updateCustomFieldDefinition(c.env.DB, c.get("actor"), c.req.param("id"), await c.req.json(), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });

  api.get("/activity", async (c) => {
    requirePermission(c.get("actor"), "audit.view");
    const rows = await all(c.env.DB, "SELECT id, actor_id, entity_type, entity_id, action, created_at FROM audit_log ORDER BY created_at DESC LIMIT 200");
    return jsonSuccess(rows, c.get("requestId"));
  });

  app.route("/api/v1", api);

  return app;
}

export async function handleScheduled(env: Env) {
  const reminders = await processDueReminders(env.DB, env);
  const expiredUploads = await expireUploadSessions(env.DB, env.DOCUMENTS);
  return { ...reminders, expiredUploads };
}
