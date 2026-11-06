import { recordCompensationIncident, userStillExists } from "../services/compensation";
import type { AppDependencies } from "./types";

/**
 * Bootstrap compensation is deliberately two-phase:
 *   1. remove the identity and verify it is gone,
 *   2. only then re-arm the one-use bootstrap flag.
 * A failure at either phase leaves the flag consumed and records a redacted
 * incident. The secret is never re-armed while a privileged user may exist.
 */
export function createIdentityRecovery(deps: AppDependencies) {
  async function removeIdentity(
    db: D1Database,
    operation: "BOOTSTRAP" | "USER_CREATE",
    userId: string,
  ): Promise<{ ok: false; correlationId: string; incidentPersisted: boolean } | null> {
    const statements = [
      db.prepare("DELETE FROM account WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM session WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM user_roles WHERE user_id = ?").bind(userId),
    ];
    if (operation === "USER_CREATE") {
      statements.push(db.prepare("DELETE FROM user_permission_overrides WHERE user_id = ?").bind(userId));
    }
    statements.push(
      db.prepare("DELETE FROM user_preferences WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM user WHERE id = ?").bind(userId),
    );
    try {
      await db.batch(statements);
    } catch {
      const incident = await recordCompensationIncident(db, {
        operation,
        stage: "IDENTITY_CLEANUP_FAILED",
        residualUserId: userId,
      });
      return { ok: false, correlationId: incident.correlationId, incidentPersisted: incident.persisted };
    }
    if (await userStillExists(db, userId)) {
      const incident = await recordCompensationIncident(db, {
        operation,
        stage: "RESIDUAL_USER_AFTER_CLEANUP",
        residualUserId: userId,
      });
      return { ok: false, correlationId: incident.correlationId, incidentPersisted: incident.persisted };
    }
    return null;
  }

  async function compensateBootstrap(db: D1Database, createdUserId: string | null) {
    if (deps.failBootstrapCompensation) {
      const incident = await recordCompensationIncident(db, {
        operation: "BOOTSTRAP",
        stage: "INDUCED_COMPENSATION_FAILURE",
        residualUserId: createdUserId,
        detail: "test-injected",
      });
      return { ok: false as const, correlationId: incident.correlationId, incidentPersisted: incident.persisted };
    }
    if (createdUserId) {
      const removed = await removeIdentity(db, "BOOTSTRAP", createdUserId);
      if (removed) return removed;
    }
    try {
      await db
        .prepare("UPDATE company_settings SET bootstrap_consumed = 0 WHERE id = 'default' AND bootstrap_consumed = 1")
        .run();
    } catch {
      const incident = await recordCompensationIncident(db, {
        operation: "BOOTSTRAP",
        stage: "SECRET_REARM_FAILED",
        residualUserId: createdUserId,
      });
      return { ok: false as const, correlationId: incident.correlationId, incidentPersisted: incident.persisted };
    }
    return { ok: true as const };
  }

  async function compensateUserCreation(db: D1Database, userId: string) {
    if (deps.failUserCompensation) {
      const incident = await recordCompensationIncident(db, {
        operation: "USER_CREATE",
        stage: "INDUCED_COMPENSATION_FAILURE",
        residualUserId: userId,
        detail: "test-injected",
      });
      return { ok: false as const, correlationId: incident.correlationId, incidentPersisted: incident.persisted };
    }
    const removed = await removeIdentity(db, "USER_CREATE", userId);
    if (removed) return removed;
    return { ok: true as const };
  }

  return { compensateBootstrap, compensateUserCreation };
}
