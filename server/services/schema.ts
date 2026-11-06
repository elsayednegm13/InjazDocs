import { errors } from "../http/errors";

/**
 * Narrow, non-mutating schema readiness probes, grouped by scope.
 *
 * It checks the columns this build actually uses, never the developer store and
 * never the migration history table. It does not auto-migrate. A missing
 * column or table produces a stable 503 SCHEMA_UPGRADE_REQUIRED instead of an
 * obscure 500 on the first idempotent write.
 *
 * Scope rules:
 *  - "core" is the frozen readiness definition (idempotency witness, import
 *    file identity, compensation incidents): it gates every mutation through
 *    the global middleware and decides the /api/v1/health readiness verdict.
 *  - "quotations" (W2, migration 0010) is enforced by the quotation endpoints
 *    themselves: a store that has not applied 0010 keeps serving health and
 *    unrelated mutations, while any quotation read or mutation fails closed
 *    with 503 SCHEMA_UPGRADE_REQUIRED instead of an obscure 500.
 */
const PROBE_GROUPS = {
  core: [
    { key: "idempotency_witness", sql: "SELECT response_expires_at, outcome_class, effect_ref FROM idempotency_keys LIMIT 1" },
    { key: "import_file_identity", sql: "SELECT file_fingerprint, parser_version FROM customer_import_operations LIMIT 1" },
    { key: "compensation_incidents", sql: "SELECT id FROM auth_compensation_incidents LIMIT 1" },
  ],
  quotations: [
    { key: "quotations", sql: "SELECT id, status, valid_until, active_revision FROM quotations LIMIT 1" },
    { key: "quotation_items", sql: "SELECT id, revision, position, line_total_minor FROM quotation_items LIMIT 1" },
    { key: "quotation_revisions", sql: "SELECT id, revision, snapshot_json FROM quotation_revisions LIMIT 1" },
  ],
} as const;

export type SchemaScope = keyof typeof PROBE_GROUPS;

const CACHE_TTL_MS = 30_000;
const cache = new WeakMap<D1Database, Map<SchemaScope, { ready: boolean; checkedAt: number; missing: string[] }>>();

export async function schemaReadiness(
  db: D1Database,
  scope: SchemaScope = "core",
): Promise<{ ready: boolean; missing: string[] }> {
  const missing: string[] = [];
  for (const probe of PROBE_GROUPS[scope]) {
    try {
      await db.prepare(probe.sql).first();
    } catch {
      missing.push(probe.key);
    }
  }
  return { ready: missing.length === 0, missing };
}

export async function assertSchemaReady(db: D1Database, scope: SchemaScope = "core"): Promise<void> {
  const now = Date.now();
  const cached = cache.get(db)?.get(scope);
  if (cached && now - cached.checkedAt < CACHE_TTL_MS) {
    if (!cached.ready) throw upgradeRequired();
    return;
  }
  const result = await schemaReadiness(db, scope);
  let perScope = cache.get(db);
  if (!perScope) {
    perScope = new Map();
    cache.set(db, perScope);
  }
  perScope.set(scope, { ready: result.ready, checkedAt: now, missing: result.missing });
  if (!result.ready) {
    console.error("[schema-readiness] upgrade required", scope, result.missing.join(","));
    throw upgradeRequired();
  }
}

function upgradeRequired() {
  return errors.coded(
    503,
    "SCHEMA_UPGRADE_REQUIRED",
    "This deployment is waiting for a database upgrade. No change was saved.",
  );
}

export function resetSchemaReadinessCache(db?: D1Database) {
  if (db) cache.delete(db);
}
