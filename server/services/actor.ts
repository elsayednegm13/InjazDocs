import type { PermissionKey } from "../../shared/permissions";
import { canViewAllCases, hasPermission, resolveEffectivePermissions } from "../../shared/permissions";
import { all } from "../db/sql";
import { errors } from "../http/errors";

export type Actor = {
  id: string;
  email: string;
  name: string;
  mustChangePassword: boolean;
  isActive: boolean;
  permissions: Set<PermissionKey>;
  roleKeys: string[];
};

export async function loadActor(db: D1Database, userId: string): Promise<Actor | null> {
  const user = await db
    .prepare("SELECT id, email, name, must_change_password, is_active FROM user WHERE id = ?")
    .bind(userId)
    .first<{
      id: string;
      email: string;
      name: string;
      must_change_password: number;
      is_active: number;
    }>();
  if (!user || !user.is_active) return null;

  const roles = await all<{ key: string }>(
    db,
    `SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`,
    userId,
  );
  const grants = await all<{ permission_key: string }>(
    db,
    `SELECT rp.permission_key
     FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     WHERE ur.user_id = ?`,
    userId,
  );
  const overrides = await all<{ permission_key: string; effect: "GRANT" | "DENY" }>(
    db,
    `SELECT permission_key, effect FROM user_permission_overrides WHERE user_id = ?`,
    userId,
  );

  return {
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

export function caseVisibilitySql(actor: Actor, alias = "c"): { sql: string; binds: string[] } {
  if (canViewAllCases(actor.permissions)) return { sql: "1=1", binds: [] };
  return { sql: `(${alias}.assigned_to = ? OR ${alias}.created_by = ?)`, binds: [actor.id, actor.id] };
}
