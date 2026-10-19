import { PERMISSIONS, type PermissionKey } from "../../shared/permissions";
import { all, newId, nowIso, one } from "../db/sql";
import { errors } from "../http/errors";
import type { Actor } from "./actor";
import { loadActor, requirePermission } from "./actor";
import { writeAudit } from "./audit";

const ROOT_PERMISSIONS = ["users.manage", "roles.manage"] as const;

export function actorIsRoot(actor: Actor): boolean {
  return ROOT_PERMISSIONS.every((key) => actor.permissions.has(key));
}

export async function countRootAdmins(db: D1Database): Promise<number> {
  const users = await all<{ id: string }>(db, "SELECT id FROM user WHERE is_active = 1");
  let count = 0;
  for (const user of users) {
    const loaded = await loadActor(db, user.id);
    if (loaded && actorIsRoot(loaded)) count += 1;
  }
  return count;
}

export async function countActiveAdmins(db: D1Database): Promise<number> {
  return countRootAdmins(db);
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
  return all(
    db,
    `SELECT u.id, u.name, u.email, u.is_active, u.must_change_password, u.created_at,
            GROUP_CONCAT(r.key) AS roles
     FROM user u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     GROUP BY u.id
     ORDER BY u.created_at DESC`,
  );
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
  await db.prepare("DELETE FROM user_roles WHERE user_id = ?").bind(userId).run();
  for (const role of roles) {
    await db.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)").bind(userId, role.id).run();
  }
  await restoreIfLastRootRemoved(db, async () => {
    await db.prepare("DELETE FROM user_roles WHERE user_id = ?").bind(userId).run();
    for (const row of previous) {
      await db.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)").bind(userId, row.role_id).run();
    }
  });
  await writeAudit(db, {
    actorId: actor.id,
    entityType: "user",
    entityId: userId,
    action: "roles.set",
    after: { roleKeys },
    requestId,
  });
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
  await db.prepare("DELETE FROM user_permission_overrides WHERE user_id = ?").bind(userId).run();
  for (const item of overrides) {
    await db
      .prepare("INSERT INTO user_permission_overrides (user_id, permission_key, effect) VALUES (?, ?, ?)")
    .bind(userId, item.permissionKey, item.effect)
    .run();
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
  await writeAudit(db, {
    actorId: actor.id,
    entityType: "user",
    entityId: userId,
    action: "overrides.set",
    after: overrides,
    requestId,
  });
}

export async function setUserActive(db: D1Database, actor: Actor, userId: string, active: boolean, requestId: string) {
  assertActorMayEditPrivileges(actor);
  if (!active) {
    const target = await loadActor(db, userId);
    if (target && actorIsRoot(target) && (await countRootAdmins(db)) <= 1) {
      throw errors.conflict("The last active administrator cannot be removed or disabled.", "LAST_ADMIN");
    }
  }
  await db
    .prepare("UPDATE user SET is_active = ?, disabled_at = ?, updated_at = ? WHERE id = ?")
    .bind(active ? 1 : 0, active ? null : Date.now(), Date.now(), userId)
    .run();
  if (!active) {
    await db.prepare("DELETE FROM session WHERE user_id = ?").bind(userId).run();
  }
  await writeAudit(db, {
    actorId: actor.id,
    entityType: "user",
    entityId: userId,
    action: active ? "user.enable" : "user.disable",
    requestId,
  });
}

export async function listRoles(db: D1Database) {
  const roles = await all<{ id: string; key: string; name_en: string; name_ar: string }>(
    db,
    "SELECT id, key, name_en, name_ar FROM roles ORDER BY key",
  );
  const result = [];
  for (const role of roles) {
    const perms = await all<{ permission_key: string }>(
      db,
      "SELECT permission_key FROM role_permissions WHERE role_id = ?",
      role.id,
    );
    result.push({ ...role, permissions: perms.map((p) => p.permission_key) });
  }
  return result;
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
  await db.prepare("DELETE FROM role_permissions WHERE role_id = ?").bind(roleId).run();
  for (const key of keys) {
    await db.prepare("INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)").bind(roleId, key).run();
  }
  await restoreIfLastRootRemoved(db, async () => {
    await db.prepare("DELETE FROM role_permissions WHERE role_id = ?").bind(roleId).run();
    for (const row of previous) {
      await db.prepare("INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)").bind(roleId, row.permission_key).run();
    }
  });
  await writeAudit(db, {
    actorId: actor.id,
    entityType: "role",
    entityId: roleId,
    action: "role.permissions.set",
    after: { keys },
    requestId,
  });
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
  try {
    await db
      .prepare("INSERT INTO roles (id, key, name_en, name_ar, is_system, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)")
      .bind(id, input.key, input.nameEn, input.nameAr, now, now)
      .run();
  } catch {
    throw errors.conflict("Role key already exists");
  }
  await replaceRolePermissions(db, actor, id, input.permissions, requestId);
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
  void newId;
}
