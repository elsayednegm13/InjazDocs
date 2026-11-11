import { Hono, type Hono as HonoType } from "hono";
import { createAuth } from "../../auth";
import { one } from "../../db/sql";
import { invalidateActorCache } from "../../services/actor";
import { writeAudit } from "../../services/audit";
import { assertSchemaReady } from "../../services/schema";
import { consumeRateLimit } from "../../services/tracking";
import { ensureAdminRole } from "../../services/users";
import { rateLimitSubject } from "../client-ip";
import { errors, jsonSuccess } from "../errors";
import type { createIdentityRecovery } from "../identity-recovery";
import { secretsEqual } from "../secret-equal";
import type { AppEnv } from "../types";

type AuthFactory = typeof createAuth;
type Recovery = ReturnType<typeof createIdentityRecovery>;

/** Better Auth cookie handler. It is not behind the application session gate. */
export function mountBetterAuth(app: HonoType<AppEnv>, authFor: AuthFactory) {
  const authRoutes = new Hono<AppEnv>();
  authRoutes.all("/*", (c) => {
    const auth = authFor(c.env);
    return auth.handler(c.req.raw);
  });
  app.route("/api/auth", authRoutes);
}

/**
 * Secret-gated bootstrap and break-glass reset. These stay outside the
 * session middleware: there is no user before bootstrap, and reset is the
 * recovery path when the session itself is lost.
 */
export function mountBootstrapRoutes(app: HonoType<AppEnv>, authFor: AuthFactory, recovery: Recovery) {
  app.get("/api/v1/auth/bootstrap-status", async (c) => {
    const row = await one<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM user");
    return jsonSuccess({ required: (row?.n ?? 0) === 0 }, c.get("requestId"));
  });

  app.post("/api/v1/auth/bootstrap", async (c) => {
    const supplied = c.req.header("x-bootstrap-secret") || "";
    if (!(await secretsEqual(supplied, c.env.BOOTSTRAP_SECRET))) throw errors.forbidden("Invalid bootstrap secret");
    await assertSchemaReady(c.env.DB);
    const body = await c.req.json<{ email: string; password: string; name: string }>();
    const email = body.email?.trim().toLowerCase() ?? "";
    const name = body.name?.trim() || "Administrator";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !body.password || body.password.length < 12 || body.password.length > 128) {
      throw errors.validation("Email and a password between 12 and 128 characters are required");
    }
    if (name.length > 120) throw errors.validation("The administrator name is too long");
    const consumed = await c.env.DB
      .prepare("UPDATE company_settings SET bootstrap_consumed = 1 WHERE id = 'default' AND bootstrap_consumed = 0")
      .run();
    if (!consumed.meta.changes) throw errors.conflict("Bootstrap is no longer available");
    const auth = authFor(c.env);
    const ctx = await auth.$context;
    let createdUserId: string | null = null;
    try {
      const user = await ctx.internalAdapter.createUser({
        email,
        name,
        emailVerified: true,
      }, { method: "admin" });
      createdUserId = user.id;
      const hash = await ctx.password.hash(body.password);
      await ctx.internalAdapter.linkAccount({
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: hash,
      });
      await c.env.DB.prepare("UPDATE user SET must_change_password = 0, is_active = 1 WHERE id = ?").bind(user.id).run();
      await ensureAdminRole(c.env.DB, user.id);
      await writeAudit(c.env.DB, { actorId: user.id, entityType: "user", entityId: user.id, action: "bootstrap.admin", requestId: c.get("requestId") });
      return jsonSuccess({ userId: user.id, mustChangePassword: false }, c.get("requestId"), {}, 201);
    } catch (error) {
      const compensation = await recovery.compensateBootstrap(c.env.DB, createdUserId);
      if (!compensation.ok) {
        console.error("[bootstrap] compensation requires operator review", compensation.correlationId);
        throw errors.coded(
          500,
          "BOOTSTRAP_RECOVERY_REQUIRED",
          "Bootstrap did not complete safely. Do not retry until an administrator reviews the incident.",
          { reference: compensation.correlationId },
        );
      }
      throw error;
    }
  });

  // Break-glass recovery. It stays available after bootstrap so an operator
  // who still holds BOOTSTRAP_SECRET can rotate a lost password (D3-13).
  // It is not a login route: five attempts per minute per client, every
  // session is deleted, and the next sign-in must change the password.
  app.post("/api/v1/auth/reset-password", async (c) => {
    const supplied = c.req.header("x-bootstrap-secret") || "";
    if (!(await secretsEqual(supplied, c.env.BOOTSTRAP_SECRET))) throw errors.forbidden("Invalid bootstrap secret");
    await assertSchemaReady(c.env.DB);
    await consumeRateLimit(c.env.DB, `auth-reset:${rateLimitSubject(c.req.raw, c.env)}`, 5, 60_000);
    const body = await c.req.json<{ email: string; password: string }>();
    if (!body.email || !body.password || body.password.length < 12) {
      throw errors.validation("Email and a password of at least 12 characters are required");
    }
    const auth = authFor(c.env);
    const ctx = await auth.$context;
    const found = await ctx.internalAdapter.findUserByEmail(body.email.toLowerCase());
    const hash = await ctx.password.hash(body.password);
    // Same status and body whether or not the email exists. The hash above
    // still runs so a missing account is not obvious from a fast 404.
    if (!found?.user) return jsonSuccess({ ok: true }, c.get("requestId"));
    await ctx.internalAdapter.updatePassword(found.user.id, hash);
    await c.env.DB.prepare("UPDATE user SET must_change_password = 1, is_active = 1 WHERE id = ?").bind(found.user.id).run();
    // Recovery rotates the credential; every session issued under the old
    // password must be revoked, including sessions on other devices.
    await c.env.DB.prepare("DELETE FROM session WHERE user_id = ?").bind(found.user.id).run();
    invalidateActorCache(c.env.DB, found.user.id);
    await writeAudit(c.env.DB, {
      actorId: found.user.id,
      entityType: "user",
      entityId: found.user.id,
      action: "password.bootstrap_reset",
      requestId: c.get("requestId"),
    });
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
}

/** Signed-in session profile and password rotation. Runs behind the session gate. */
export function mountSessionRoutes(api: HonoType<AppEnv>, authFor: AuthFactory) {
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

  api.post("/me/profile", async (c) => {
    const body = await c.req.json<{ name?: string }>();
    const name = body.name?.trim() ?? "";
    if (!name || name.length > 120) throw errors.validation("Enter a name of 120 characters or fewer.", { name: "Enter your name." });
    const actor = c.get("actor");
    await c.env.DB.prepare("UPDATE user SET name = ?, updated_at = ? WHERE id = ?").bind(name, Date.now(), actor.id).run();
    invalidateActorCache(c.env.DB, actor.id);
    await writeAudit(c.env.DB, { actorId: actor.id, entityType: "user", entityId: actor.id, action: "profile.name", requestId: c.get("requestId") });
    return jsonSuccess({ ok: true, name }, c.get("requestId"));
  });

  api.post("/me/email", async (c) => {
    const body = await c.req.json<{ email?: string; currentPassword?: string }>();
    const email = body.email?.trim().toLowerCase() ?? "";
    const actor = c.get("actor");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
      throw errors.validation("Enter a valid email.", { email: "Enter a valid email." });
    }
    if (email === actor.email.toLowerCase()) {
      throw errors.validation("This is already your email.", { email: "Choose a different email." });
    }
    await consumeRateLimit(c.env.DB, `profile-email:${actor.id}`, 8, 60_000);
    const auth = authFor(c.env);
    if (!(await passwordMatches(auth, actor.id, body.currentPassword ?? ""))) {
      throw errors.validation("Current password is incorrect.", { currentPassword: "Enter your current password." }, "INVALID_PASSWORD");
    }
    const taken = await one<{ id: string }>(c.env.DB, "SELECT id FROM user WHERE email = ? AND id != ?", email, actor.id);
    if (taken) throw errors.conflict("This email is already in use.", "EMAIL_IN_USE", { email: "Choose a different email." });
    await c.env.DB.prepare("UPDATE user SET email = ?, email_verified = 1, updated_at = ? WHERE id = ?").bind(email, Date.now(), actor.id).run();
    invalidateActorCache(c.env.DB, actor.id);
    await writeAudit(c.env.DB, {
      actorId: actor.id,
      entityType: "user",
      entityId: actor.id,
      action: "profile.email",
      after: { email },
      requestId: c.get("requestId"),
    });
    return jsonSuccess({ ok: true, email }, c.get("requestId"));
  });

  api.post("/me/password", async (c) => {
    const body = await c.req.json<{ currentPassword: string; newPassword: string }>();
    if (!body.newPassword || body.newPassword.length < 12 || body.newPassword.length > 128) {
      throw errors.validation("Use a new password between 12 and 128 characters.", { newPassword: "Use at least 12 characters." });
    }
    if (body.newPassword === body.currentPassword) {
      throw errors.validation("Choose a password that is different from the current one.", { newPassword: "Choose a different password." });
    }
    const auth = authFor(c.env);
    await auth.api.changePassword({
      body: { currentPassword: body.currentPassword, newPassword: body.newPassword },
      headers: c.req.raw.headers,
    });
    await c.env.DB.prepare("UPDATE user SET must_change_password = 0 WHERE id = ?").bind(c.get("actor").id).run();
    invalidateActorCache(c.env.DB, c.get("actor").id);
    // A password change invalidates every other session. The session that made
    // the change stays signed in; all older cookies stop working.
    const sessionId = c.get("sessionId");
    if (sessionId) {
      await c.env.DB
        .prepare("DELETE FROM session WHERE user_id = ? AND id != ?")
        .bind(c.get("actor").id, sessionId)
        .run();
    }
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
}

async function passwordMatches(auth: ReturnType<AuthFactory>, userId: string, password: string) {
  if (!password || password.length > 128) return false;
  const ctx = await auth.$context;
  const account = await ctx.internalAdapter.findCredentialAccount(userId);
  if (!account?.password) return false;
  return ctx.password.verify({ hash: account.password, password });
}
