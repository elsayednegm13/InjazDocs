import { PERMISSIONS, resolveEffectivePermissions, type OverrideEffect, type PermissionKey } from "../../shared/permissions";
import { all, newId, nowIso, one } from "../db/sql";
import { errors } from "../http/errors";
import { edgeCache } from "../lib/cache";
import type { Actor } from "./actor";
import { invalidateActorCache, invalidateAllActorsCache, requirePermission } from "./actor";
import { writeAudit } from "./audit";

const ROOT_PERMISSIONS = ["users.manage", "roles.manage"] as const;

export function actorIsRoot(actor: Actor): boolean {
  return ROOT_PERMISSIONS.every((key) => actor.permissions.has(key));
}

/**
 * SQL twin of `resolveEffectivePermissions` restricted to the root
 * permissions: the keys granted by a role or by a GRANT override, minus any
 * DENY override. `alias` must expose an `id` column and, for an active-root
 * test, is combined with `is_active = 1` here so the two definitions cannot
 * drift. Only table, column and constant permission names are interpolated;
 * every caller value is still bound as a parameter.
 */
export function effectiveRootCondition(alias: string): string {
  const granted = ROOT_PERMISSIONS.map(
    (key) => `EXISTS (SELECT 1 FROM (
        SELECT rp.permission_key AS permission_key
          FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
         WHERE ur.user_id = ${alias}.id
        UNION
        SELECT o.permission_key AS permission_key
          FROM user_permission_overrides o
         WHERE o.user_id = ${alias}.id AND o.effect = 'GRANT'
      ) g WHERE g.permission_key = '${key}')`,
  ).join("\n          AND ");
  const denied = ROOT_PERMISSIONS.map(
    (key) => `NOT EXISTS (SELECT 1 FROM user_permission_overrides d
                  WHERE d.user_id = ${alias}.id AND d.effect = 'DENY' AND d.permission_key = '${key}')`,
  ).join("\n          AND ");
  return `(${alias}.is_active = 1
          AND ${granted}
          AND ${denied})`;
}

export async function countRootAdmins(db: D1Database): Promise<number> {
  const row = await one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM user u WHERE ${effectiveRootCondition("u")}`);
  return Number(row?.n ?? 0);
}

export async function countActiveAdmins(db: D1Database): Promise<number> {
  return countRootAdmins(db);
}

/**
 * SQL guard used by every privilege mutation. It binds the actor id as its
 * last parameter and is evaluated inside the same D1 batch as the writes, so a
 * privilege revoked after the request's Actor was loaded cannot be used to
 * write. The session `Actor` check remains as a fast, readable rejection; this
 * is the authoritative check.
 */
function actorRootGuardSql(alias = "actor"): string {
  return `EXISTS (SELECT 1 FROM user ${alias} WHERE ${alias}.id = ? AND ${effectiveRootCondition(alias)})`;
}

/**
 * The first statement of every guarded batch is `SELECT <guard> AS is_root`.
 * It records whether the actor was root at transaction start, which is the same
 * value every following statement's guard sees inside that transaction. A batch
 * that reports zero writes for a stale actor is therefore rejected explicitly
 * instead of being confused with an authorized no-op.
 */
function batchActorIsRoot(results: D1Result[]): boolean {
  const row = results[0]?.results?.[0] as { is_root?: number } | undefined;
  return Number(row?.is_root ?? 0) === 1;
}

function assertActorMayEditPrivileges(actor: Actor) {
  if (!actorIsRoot(actor)) {
    throw errors.forbidden("Only an active administrator can change administrative privileges");
  }
}

async function restoreIfLastRootRemoved(db: D1Database, restore: () => Promise<void>) {
  if ((await countRootAdmins(db)) >= 1) return;
  await restore();
  throw errors.conflict("The last active administrator cannot be removed or disabled.", "LAST_ADMIN");
}

export async function listUsers(db: D1Database) {
  const users = await all<{
    id: string;
    name: string;
    email: string;
    is_active: number;
    must_change_password: number;
    created_at: number | string;
    roles: string | null;
  }>(
    db,
    `SELECT u.id, u.name, u.email, u.is_active, u.must_change_password, u.created_at,
            GROUP_CONCAT(r.key) AS roles
     FROM user u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     GROUP BY u.id
     ORDER BY u.created_at DESC`,
  );

  const roleGrantRows = await all<{ user_id: string; permission_key: string }>(
    db,
    `SELECT ur.user_id, rp.permission_key
     FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id`,
  );

  const overrideRows = await all<{ user_id: string; permission_key: string; effect: OverrideEffect }>(
    db,
    `SELECT user_id, permission_key, effect
     FROM user_permission_overrides
     ORDER BY permission_key ASC`,
  );

  const roleGrantsByUser = new Map<string, Set<PermissionKey>>();
  for (const row of roleGrantRows) {
    if (!(PERMISSIONS as readonly string[]).includes(row.permission_key)) continue;
    let set = roleGrantsByUser.get(row.user_id);
    if (!set) {
      set = new Set<PermissionKey>();
      roleGrantsByUser.set(row.user_id, set);
    }
    set.add(row.permission_key as PermissionKey);
  }

  const overridesByUser = new Map<string, Array<{ permissionKey: PermissionKey; effect: OverrideEffect }>>();
  for (const row of overrideRows) {
    if (!(PERMISSIONS as readonly string[]).includes(row.permission_key)) continue;
    let list = overridesByUser.get(row.user_id);
    if (!list) {
      list = [];
      overridesByUser.set(row.user_id, list);
    }
    list.push({ permissionKey: row.permission_key as PermissionKey, effect: row.effect });
  }

  return users.map((u) => {
    const roleKeys = String(u.roles ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    const rolePermissions = [...(roleGrantsByUser.get(u.id) ?? new Set<PermissionKey>())];
    const overrides = overridesByUser.get(u.id) ?? [];
    const effectiveSet = resolveEffectivePermissions({
      roleGrants: rolePermissions,
      overrides,
    });
    const effectivePermissions = [...effectiveSet];
    return {
      ...u,
      roleKeys,
      rolePermissions,
      overrides,
      effectivePermissions,
      effectivePermissionsCount: effectivePermissions.length,
    };
  });
}

export async function setUserRoles(db: D1Database, actor: Actor, userId: string, roleKeys: string[], requestId: string) {
  assertActorMayEditPrivileges(actor);
  const previous = await all<{ role_id: string }>(db, "SELECT role_id FROM user_roles WHERE user_id = ?", userId);
  const roles = await all<{ id: string; key: string }>(
    db,
    `SELECT id, key FROM roles WHERE key IN (${roleKeys.map(() => "?").join(",") || "NULL"})`,
    ...roleKeys,
  );
  if (roles.length !== roleKeys.length) throw errors.validation("Unknown role");
  // The probe, every insert and every delete carry the same actor-root guard and
  // run in one D1 batch (one transaction). If the actor lost root after the
  // request's Actor was loaded, the whole batch is a no-op and the request is
  // rejected; there is no read-to-write window in which a stale actor can grant
  // a role. Inserts are ordered BEFORE the delete: a self-demotion would
  // otherwise remove the actor's own admin role first and make its own insert
  // guard fail, leaving a partial write instead of the expected 409.
  const guard = actorRootGuardSql();
  const previousIds = new Set(previous.map((row) => row.role_id));
  const nextIds = new Set(roles.map((role) => role.id));
  const added = roles.filter((role) => !previousIds.has(role.id));
  const removed = previous.filter((row) => !nextIds.has(row.role_id));
  const writes = [
    db.prepare(`SELECT ${guard} AS is_root`).bind(actor.id),
    ...added.map((role) =>
      db.prepare(`INSERT INTO user_roles (user_id, role_id) SELECT ?, ? WHERE ${guard}`).bind(userId, role.id, actor.id),
    ),
    ...removed.map((row) =>
      db
        .prepare(`DELETE FROM user_roles WHERE user_id = ? AND role_id = ? AND ${guard}`)
        .bind(userId, row.role_id, actor.id),
    ),
  ];
  const results = await db.batch(writes);
  if (!batchActorIsRoot(results)) {
    throw errors.forbidden("Only an active administrator can change administrative privileges");
  }
  await restoreIfLastRootRemoved(db, async () => {
    await db.prepare("DELETE FROM user_roles WHERE user_id = ?").bind(userId).run();
    for (const row of previous) {
      await db.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)").bind(userId, row.role_id).run();
    }
  });
  // A stored response may contain data the user was allowed to see a moment
  // ago. The durable idempotency witness is intentionally NOT deleted here:
  // replay re-checks the current actor, permission and case scope before any
  // cached body is returned. Deleting the witness would allow a second effect.
  await writeAudit(db, {
    actorId: actor.id,
    entityType: "user",
    entityId: userId,
    action: "roles.set",
    after: { roleKeys },
    requestId,
  });
  invalidateActorCache(db, userId);
}

export async function setOverrides(
  db: D1Database,
  actor: Actor,
  userId: string,
  overrides: { permissionKey: PermissionKey; effect: "GRANT" | "DENY" }[],
  requestId: string,
) {
  assertActorMayEditPrivileges(actor);
  for (const item of overrides) {
    if (!(PERMISSIONS as readonly string[]).includes(item.permissionKey)) {
      throw errors.validation("Unknown permission");
    }
  }
  const previous = await all<{ permission_key: string; effect: "GRANT" | "DENY" }>(
    db,
    "SELECT permission_key, effect FROM user_permission_overrides WHERE user_id = ?",
    userId,
  );
  // Same guarded transaction as role assignment: a stale actor cannot write a
  // GRANT or DENY after its own root permission was revoked. The upsert comes
  // before the delete so an actor that revokes its own root override still
  // applies the rest of the requested set inside the same transaction.
  const guard = actorRootGuardSql();
  const nextKeys = new Set<string>(overrides.map((item) => item.permissionKey));
  const removed = previous.filter((row) => !nextKeys.has(row.permission_key));
  const writes = [
    db.prepare(`SELECT ${guard} AS is_root`).bind(actor.id),
    ...overrides.map((item) =>
      db
        .prepare(
          `INSERT OR REPLACE INTO user_permission_overrides (user_id, permission_key, effect) SELECT ?, ?, ? WHERE ${guard}`,
        )
        .bind(userId, item.permissionKey, item.effect, actor.id),
    ),
    ...removed.map((row) =>
      db
        .prepare(`DELETE FROM user_permission_overrides WHERE user_id = ? AND permission_key = ? AND ${guard}`)
        .bind(userId, row.permission_key, actor.id),
    ),
  ];
  const results = await db.batch(writes);
  if (!batchActorIsRoot(results)) {
    throw errors.forbidden("Only an active administrator can change administrative privileges");
  }
  await restoreIfLastRootRemoved(db, async () => {
    await db.prepare("DELETE FROM user_permission_overrides WHERE user_id = ?").bind(userId).run();
    for (const row of previous) {
      await db
        .prepare("INSERT INTO user_permission_overrides (user_id, permission_key, effect) VALUES (?, ?, ?)")
        .bind(userId, row.permission_key, row.effect)
        .run();
    }
  });
  // The witness is kept; replay authorization is re-evaluated on every replay.
  await writeAudit(db, {
    actorId: actor.id,
    entityType: "user",
    entityId: userId,
    action: "overrides.set",
    after: overrides,
    requestId,
  });
  invalidateActorCache(db, userId);
}

export async function setUserActive(db: D1Database, actor: Actor, userId: string, active: boolean, requestId: string) {
  assertActorMayEditPrivileges(actor);
  const target = await one<{ is_active: number }>(db, "SELECT is_active FROM user WHERE id = ?", userId);
  if (!target) throw errors.notFound("User not found");

  if (active) {
    // Re-enabling is a privilege change too: a stale actor must not be able to
    // restore an account after its own root permission was revoked.
    const result = await db
      .prepare(
        `UPDATE user SET is_active = 1, disabled_at = NULL, updated_at = ?
          WHERE id = ? AND ${actorRootGuardSql()}`,
      )
      .bind(Date.now(), userId, actor.id)
      .run();
    if ((result.meta.changes ?? 0) === 0) {
      const targetRow = await one<{ id: string }>(db, "SELECT id FROM user WHERE id = ?", userId);
      if (!targetRow) throw errors.notFound("User not found");
      throw errors.forbidden("Only an active administrator can change administrative privileges");
    }
  } else {
    // BR-A1 / UAT-24: the write itself carries the invariant, and it now uses
    // the same effective-root definition as authorization. A target that is
    // not an effective root cannot reduce the root count, so it is admitted; a
    // target that is an effective root is admitted only while another active
    // effective root exists. The actor's own root-ness is re-checked in the
    // same statement, so a privilege revoked between authorization and this
    // write cannot be used to disable the last root.
    const result = await db
      .prepare(
        `UPDATE user
            SET is_active = 0, disabled_at = ?, updated_at = ?
          WHERE id = ?
            AND (
              NOT ${effectiveRootCondition("user")}
              OR EXISTS (SELECT 1 FROM user other
                          WHERE other.id != user.id AND ${effectiveRootCondition("other")})
            )
            AND EXISTS (SELECT 1 FROM user actor
                         WHERE actor.id = ? AND ${effectiveRootCondition("actor")})`,
      )
      .bind(Date.now(), Date.now(), userId, actor.id)
      .run();
    if ((result.meta.changes ?? 0) === 0) {
      // A stale authorization and a genuine last-root refusal must not share a
      // message. The failed write is already fail-closed; this read only
      // selects the response code.
      const actorRow = await one<{ is_root: number }>(
        db,
        `SELECT CASE WHEN ${effectiveRootCondition("u")} THEN 1 ELSE 0 END AS is_root FROM user u WHERE u.id = ?`,
        actor.id,
      );
      if (!actorRow || Number(actorRow.is_root) === 0) {
        throw errors.forbidden("Only an active administrator can change administrative privileges");
      }
      throw errors.conflict("The last active administrator cannot be removed or disabled.", "LAST_ADMIN");
    }
  }
  if (!active) {
    await db.prepare("DELETE FROM session WHERE user_id = ?").bind(userId).run();
  }
  // Disabled actors are rejected by the auth middleware before replay; the
  // witness is kept so re-enabling cannot create a duplicate effect.
  await writeAudit(db, {
    actorId: actor.id,
    entityType: "user",
    entityId: userId,
    action: active ? "user.enable" : "user.disable",
    requestId,
  });
  invalidateActorCache(db, userId);
}

export async function listRoles(db: D1Database) {
  return edgeCache.getOrLoad(
    db,
    "rbac:roles",
    async () => {
      const roles = await all<{ id: string; key: string; name_en: string; name_ar: string }>(
        db,
        "SELECT id, key, name_en, name_ar FROM roles ORDER BY key",
      );
      const allPerms = await all<{ role_id: string; permission_key: string }>(
        db,
        "SELECT role_id, permission_key FROM role_permissions",
      );
      const permsByRole = new Map<string, string[]>();
      for (const row of allPerms) {
        let list = permsByRole.get(row.role_id);
        if (!list) {
          list = [];
          permsByRole.set(row.role_id, list);
        }
        list.push(row.permission_key);
      }
      return roles.map((role) => ({
        ...role,
        permissions: permsByRole.get(role.id) ?? [],
      }));
    },
    300_000,
  );
}

export async function replaceRolePermissions(
  db: D1Database,
  actor: Actor,
  roleId: string,
  keys: string[],
  requestId: string,
) {
  assertActorMayEditPrivileges(actor);
  const role = await one<{ id: string; key: string }>(db, "SELECT id, key FROM roles WHERE id = ?", roleId);
  if (!role) throw errors.notFound("Role not found");
  for (const key of keys) {
    if (!(PERMISSIONS as readonly string[]).includes(key)) throw errors.validation("Unknown permission");
  }
  const previous = await all<{ permission_key: string }>(db, "SELECT permission_key FROM role_permissions WHERE role_id = ?", roleId);
  // A role's permissions are a privilege boundary. The guarded batch makes the
  // actor's current root state part of the write itself, so a stale actor
  // cannot elevate a role after losing root. Inserts come before the delete so
  // the statement that adds the new permissions is not disabled by the delete.
  const guard = actorRootGuardSql();
  const previousKeys = new Set(previous.map((row) => row.permission_key));
  const nextKeys = new Set(keys);
  const added = keys.filter((key) => !previousKeys.has(key));
  const removed = previous.filter((row) => !nextKeys.has(row.permission_key));
  const writes = [
    db.prepare(`SELECT ${guard} AS is_root`).bind(actor.id),
    ...added.map((key) =>
      db
        .prepare(`INSERT INTO role_permissions (role_id, permission_key) SELECT ?, ? WHERE ${guard}`)
        .bind(roleId, key, actor.id),
    ),
    ...removed.map((row) =>
      db
        .prepare(`DELETE FROM role_permissions WHERE role_id = ? AND permission_key = ? AND ${guard}`)
        .bind(roleId, row.permission_key, actor.id),
    ),
  ];
  const results = await db.batch(writes);
  if (!batchActorIsRoot(results)) {
    throw errors.forbidden("Only an active administrator can change administrative privileges");
  }
  await restoreIfLastRootRemoved(db, async () => {
    await db.prepare("DELETE FROM role_permissions WHERE role_id = ?").bind(roleId).run();
    for (const row of previous) {
      await db.prepare("INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)").bind(roleId, row.permission_key).run();
    }
  });
  // Role changes do not erase witnesses. Replay is re-authorized against the
  // current role permissions, so a restored role still cannot duplicate work.
  await writeAudit(db, {
    actorId: actor.id,
    entityType: "role",
    entityId: roleId,
    action: "role.permissions.set",
    after: { keys },
    requestId,
  });
  edgeCache.del(db, "rbac:roles");
  invalidateAllActorsCache(db);
}

export async function createRole(
  db: D1Database,
  actor: Actor,
  input: { key: string; nameEn: string; nameAr: string; permissions: string[] },
  requestId: string,
) {
  requirePermission(actor, "roles.manage");
  assertActorMayEditPrivileges(actor);
  if (!/^[a-z][a-z0-9_]{2,40}$/.test(input.key) || input.key === "administrator") {
    throw errors.validation("Role key must be a lowercase identifier and cannot replace administrator");
  }
  const id = newId();
  const now = nowIso();
  let insertedChanges = 0;
  try {
    const inserted = await db
      .prepare(
        `INSERT INTO roles (id, key, name_en, name_ar, is_system, created_at, updated_at)
         SELECT ?, ?, ?, ?, 0, ?, ? WHERE ${actorRootGuardSql()}`,
      )
      .bind(id, input.key, input.nameEn, input.nameAr, now, now, actor.id)
      .run();
    insertedChanges = Number(inserted.meta.changes ?? 0);
  } catch {
    throw errors.conflict("Role key already exists");
  }
  if (insertedChanges === 0) {
    throw errors.forbidden("Only an active administrator can change administrative privileges");
  }
  try {
    await replaceRolePermissions(db, actor, id, input.permissions, requestId);
  } catch (error) {
    // The role row must not survive a rejected permission write. It has no
    // users yet, so deleting it cannot remove an assignment.
    await db.prepare("DELETE FROM roles WHERE id = ?").bind(id).run().catch(() => undefined);
    edgeCache.del(db, "rbac:roles");
    throw error;
  }
  edgeCache.del(db, "rbac:roles");
  return { id, key: input.key };
}

export async function ensureAdminRole(db: D1Database, userId: string) {
  await db
    .prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'role-admin')")
    .bind(userId)
    .run();
  await db
    .prepare("INSERT OR REPLACE INTO user_preferences (user_id, language, timezone, updated_at) VALUES (?, 'en', 'Africa/Cairo', ?)")
    .bind(userId, nowIso())
    .run();
  invalidateActorCache(db, userId);
  void newId;
}
