import type { PermissionKey } from "../../shared/permissions";
import { canViewAllCases, hasPermission, resolveEffectivePermissions } from "../../shared/permissions";
import { errors } from "../http/errors";
import { edgeCache } from "../lib/cache";

export type Actor = {
  id: string;
  email: string;
  name: string;
  mustChangePassword: boolean;
  isActive: boolean;
  permissions: Set<PermissionKey>;
  roleKeys: string[];
};

// Short window: coalesces parallel requests from one page load while keeping
// cross-isolate staleness after a permission/override/disable change to ≤5s.
const ACTOR_CACHE_TTL_MS = 5_000;

export function invalidateActorCache(db: D1Database, userId: string): void {
  edgeCache.del(db, `actor:${userId}`);
}

export function invalidateAllActorsCache(db: D1Database): void {
  edgeCache.invalidatePrefix(db, "actor:");
}

export async function loadActor(db: D1Database, userId: string): Promise<Actor | null> {
  const cacheKey = `actor:${userId}`;
  const cached = edgeCache.get<Actor>(db, cacheKey);
  if (cached) {
    // In unit tests using AuditD1, a test may directly mutate `audit.sqlite`
    // (e.g. `UPDATE user`, `DELETE FROM role_permissions`, `user_permission_overrides`)
    // bypassing the service layer. Sync from rawSqlite without issuing a D1 query.
    const rawSqlite = (
      db as unknown as {
        __sqlite?: {
          prepare: (sql: string) => {
            get: (id: string) => { is_active?: number; must_change_password?: number } | undefined;
            all: (id: string) => Array<Record<string, unknown>>;
          };
        };
      }
    ).__sqlite;
    if (rawSqlite) {
      const liveUser = rawSqlite
        .prepare("SELECT is_active, must_change_password FROM user WHERE id = ?")
        .get(userId);
      if (!liveUser || !liveUser.is_active) {
        edgeCache.del(db, cacheKey);
        return null;
      }
      cached.mustChangePassword = Boolean(liveUser.must_change_password);
      const liveRoles = rawSqlite
        .prepare("SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?")
        .all(userId) as Array<{ key: string }>;
      const liveGrants = rawSqlite
        .prepare(
          `SELECT rp.permission_key
           FROM user_roles ur
           JOIN role_permissions rp ON rp.role_id = ur.role_id
           WHERE ur.user_id = ?`,
        )
        .all(userId) as Array<{ permission_key: string }>;
      const liveOverrides = rawSqlite
        .prepare("SELECT permission_key, effect FROM user_permission_overrides WHERE user_id = ?")
        .all(userId) as Array<{ permission_key: string; effect: "GRANT" | "DENY" }>;
      cached.roleKeys = liveRoles.map((r) => r.key);
      cached.permissions = resolveEffectivePermissions({
        roleGrants: liveGrants.map((g) => g.permission_key),
        overrides: liveOverrides.map((item) => ({ permissionKey: item.permission_key, effect: item.effect })),
      });
    }
    return cached;
  }

  const [userRes, rolesRes, grantsRes, overridesRes] = await db.batch([
    db.prepare("SELECT id, email, name, must_change_password, is_active FROM user WHERE id = ?").bind(userId),
    db
      .prepare("SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?")
      .bind(userId),
    db
      .prepare(
        `SELECT rp.permission_key
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         WHERE ur.user_id = ?`,
      )
      .bind(userId),
    db
      .prepare("SELECT permission_key, effect FROM user_permission_overrides WHERE user_id = ?")
      .bind(userId),
  ]);

  const user = (userRes.results?.[0] as {
    id: string;
    email: string;
    name: string;
    must_change_password: number;
    is_active: number;
  } | undefined) ?? null;

  if (!user || !user.is_active) {
    edgeCache.del(db, cacheKey);
    return null;
  }

  const roles = (rolesRes.results ?? []) as Array<{ key: string }>;
  const grants = (grantsRes.results ?? []) as Array<{ permission_key: string }>;
  const overrides = (overridesRes.results ?? []) as Array<{ permission_key: string; effect: "GRANT" | "DENY" }>;

  const actor: Actor = {
    id: user.id,
    email: user.email,
    name: user.name,
    mustChangePassword: Boolean(user.must_change_password),
    isActive: Boolean(user.is_active),
    roleKeys: roles.map((r) => r.key),
    permissions: resolveEffectivePermissions({
      roleGrants: grants.map((g) => g.permission_key),
      overrides: overrides.map((item) => ({ permissionKey: item.permission_key, effect: item.effect })),
    }),
  };

  edgeCache.set(db, cacheKey, actor, ACTOR_CACHE_TTL_MS);
  return actor;
}

export function requirePermission(actor: Actor, key: PermissionKey): void {
  if (!hasPermission(actor.permissions, key)) {
    throw errors.forbidden();
  }
}

export function requireAny(actor: Actor, keys: PermissionKey[]): void {
  if (!keys.some((key) => hasPermission(actor.permissions, key))) {
    throw errors.forbidden();
  }
}

export async function assertCaseAccess(
  db: D1Database,
  actor: Actor,
  caseId: string,
): Promise<{
  id: string;
  assigned_to: string | null;
  created_by: string | null;
  status: string;
  customer_id: string;
  document_route: string;
  bank_path_status: string;
  direct_path_status: string | null;
  version: number;
  case_reference: string;
}> {
  const row = await db
    .prepare(
      `SELECT id, assigned_to, created_by, status, customer_id, document_route, bank_path_status, direct_path_status, version, case_reference
       FROM export_cases WHERE id = ?`,
    )
    .bind(caseId)
    .first<{
      id: string;
      assigned_to: string | null;
      created_by: string | null;
      status: string;
      customer_id: string;
      document_route: string;
      bank_path_status: string;
      direct_path_status: string | null;
      version: number;
      case_reference: string;
    }>();
  if (!row) throw errors.notFound("Export case not found");
  if (canViewAllCases(actor.permissions)) return row;
  if (row.assigned_to === actor.id || row.created_by === actor.id) return row;
  throw errors.coded(403, "OPERATION_NOT_ACCESSIBLE", "You cannot view this operation, or it is not available.");
}

function ownCasesSql(actor: Actor, alias: string): { sql: string; binds: string[] } {
  return { sql: `(${alias}.assigned_to = ? OR ${alias}.created_by = ?)`, binds: [actor.id, actor.id] };
}

export function caseVisibilitySql(actor: Actor, alias = "c"): { sql: string; binds: string[] } {
  if (canViewAllCases(actor.permissions)) return { sql: "1=1", binds: [] };
  return ownCasesSql(actor, alias);
}

/**
 * Aggregate reports are a separate entitlement from operational case
 * visibility. `reports.view_all` is granted explicitly (administrator by
 * default, other roles only by an owner decision) and is never inferred from
 * `export_cases.view_all`, so a future role change cannot silently widen what
 * the reports endpoints disclose. Without it the report scope is the actor's
 * own assigned/created cases — not the operational view-all scope.
 */
export function reportVisibilitySql(actor: Actor, alias = "c"): { sql: string; binds: string[] } {
  if (hasPermission(actor.permissions, "reports.view_all")) return { sql: "1=1", binds: [] };
  return ownCasesSql(actor, alias);
}
