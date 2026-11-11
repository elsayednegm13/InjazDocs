import type { Hono } from "hono";
import { createAuth } from "../../auth";
import { all, one } from "../../db/sql";
import { requirePermission } from "../../services/actor";
import {
  actorIsRoot,
  createRole,
  listRoles,
  listUsers,
  replaceRolePermissions,
  setOverrides,
  setUserActive,
  setUserRoles,
} from "../../services/users";
import { errors, jsonSuccess } from "../errors";
import type { createIdentityRecovery } from "../identity-recovery";
import type { AppEnv } from "../types";

type AuthFactory = typeof createAuth;
type Recovery = ReturnType<typeof createIdentityRecovery>;

export function mountUserRoutes(api: Hono<AppEnv>, authFor: AuthFactory, recovery: Recovery) {
  api.get("/users", async (c) => {
    requirePermission(c.get("actor"), "users.manage");
    return jsonSuccess(await listUsers(c.env.DB), c.get("requestId"));
  });
  api.post("/users", async (c) => {
    requirePermission(c.get("actor"), "users.manage");
    // Only a root administrator can assign roles; validate that before writing
    // the user row so a role failure cannot leave an unusable account behind.
    if (!actorIsRoot(c.get("actor"))) {
      throw errors.forbidden("Only an active administrator can create users");
    }
    const body = await c.req.json<{ email: string; password: string; name: string; roleKeys: string[] }>();
    const email = body.email?.trim().toLowerCase() ?? "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw errors.validation("A valid email address is required", { email: "Enter a valid email address." });
    }
    if (typeof body.password !== "string" || body.password.length < 12 || body.password.length > 128) {
      throw errors.validation("The temporary password must be between 12 and 128 characters", {
        password: "Use at least 12 characters.",
      });
    }
    if (!body.name?.trim() || body.name.trim().length > 120) {
      throw errors.validation("A name is required", { name: "Enter the user's name." });
    }
    const requestedRoles = Array.isArray(body.roleKeys)
      ? [...new Set(body.roleKeys.filter((key) => typeof key === "string" && key.trim()))]
      : [];
    const roleKeys = requestedRoles.length > 0 ? requestedRoles : ["export_officer"];
    const roles = await all<{ key: string }>(
      c.env.DB,
      `SELECT key FROM roles WHERE key IN (${roleKeys.map(() => "?").join(",") || "NULL"})`,
      ...roleKeys,
    );
    if (roles.length !== roleKeys.length) throw errors.validation("Unknown role", { roleKeys: "Choose an existing role." });
    const exists = await one<{ id: string }>(c.env.DB, "SELECT id FROM user WHERE lower(email) = ?", email);
    if (exists) throw errors.conflict("A user with this email already exists", "EMAIL_TAKEN");
    const auth = authFor(c.env);
    const ctx = await auth.$context;
    let user: { id: string };
    try {
      user = await ctx.internalAdapter.createUser(
        { email, name: body.name.trim(), emailVerified: true },
        { method: "admin" },
      );
    } catch (error) {
      if (/unique|constraint/i.test(error instanceof Error ? error.message : String(error))) {
        throw errors.conflict("A user with this email already exists", "EMAIL_TAKEN");
      }
      throw error;
    }
    try {
      const hash = await ctx.password.hash(body.password);
      await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: hash });
      await c.env.DB.prepare("UPDATE user SET must_change_password = 1, is_active = 1 WHERE id = ?").bind(user.id).run();
      await setUserRoles(c.env.DB, c.get("actor"), user.id, roleKeys, c.get("requestId"));
    } catch (error) {
      // The account, the credential and the role assignment must succeed
      // together. If any of them fails the half built account is removed, so
      // no unusable user and no user without a role is left behind. If the
      // cleanup itself fails, the response is fail-closed and traceable.
      const compensation = await recovery.compensateUserCreation(c.env.DB, user.id);
      if (!compensation.ok) {
        console.error("[user-create] compensation requires operator review", compensation.correlationId);
        throw errors.coded(
          500,
          "USER_RECOVERY_REQUIRED",
          "The user was not created safely. Do not retry until an administrator reviews the incident.",
          { reference: compensation.correlationId },
        );
      }
      throw error;
    }
    return jsonSuccess({ id: user.id }, c.get("requestId"), {}, 201);
  });
  api.post("/users/:id/roles", async (c) => {
    requirePermission(c.get("actor"), "roles.manage");
    const body = await c.req.json<{ roleKeys: string[] }>();
    await setUserRoles(c.env.DB, c.get("actor"), c.req.param("id"), body.roleKeys, c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.put("/users/:id/roles", async (c) => {
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
  api.put("/users/:id/overrides", async (c) => {
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
  api.patch("/users/:id/status", async (c) => {
    requirePermission(c.get("actor"), "users.manage");
    const body = await c.req.json<{ active?: boolean; isActive?: boolean }>();
    const active = typeof body.active === "boolean" ? body.active : Boolean(body.isActive);
    await setUserActive(c.env.DB, c.get("actor"), c.req.param("id"), active, c.get("requestId"));
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
}
