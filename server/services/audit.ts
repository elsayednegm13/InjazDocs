import { newId, nowIso } from "../db/sql";

export function auditInsert(
  db: D1Database,
  input: {
    actorId?: string | null;
    entityType: string;
    entityId: string;
    action: string;
    before?: unknown;
    after?: unknown;
    reason?: string;
    requestId?: string;
  },
  guard?: { invoiceId: string; version: number },
) {
  const redactedBefore = redact(input.before);
  const redactedAfter = redact(input.after);
  const binds = [
    newId(),
    input.actorId ?? null,
    input.entityType,
    input.entityId,
    input.action,
    redactedBefore ? JSON.stringify(redactedBefore) : null,
    redactedAfter ? JSON.stringify(redactedAfter) : null,
    input.reason ?? null,
    input.requestId ?? null,
    nowIso(),
  ];
  if (!guard) {
    return db
      .prepare(
        `INSERT INTO audit_log (id, actor_id, entity_type, entity_id, action, before_json, after_json, reason, origin, request_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'API', ?, ?)`,
      )
      .bind(...binds);
  }
  return db
    .prepare(
      `INSERT INTO audit_log (id, actor_id, entity_type, entity_id, action, before_json, after_json, reason, origin, request_id, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'API', ?, ?
       WHERE (SELECT version FROM export_invoices WHERE id = ?) = ?`,
    )
    .bind(...binds, guard.invoiceId, guard.version);
}

export async function writeAudit(
  db: D1Database,
  input: {
    actorId?: string | null;
    entityType: string;
    entityId: string;
    action: string;
    before?: unknown;
    after?: unknown;
    reason?: string;
    requestId?: string;
  },
): Promise<void> {
  await auditInsert(db, input).run();
}

export async function writeCaseEvent(
  db: D1Database,
  caseId: string,
  eventType: string,
  summary: string,
  actorId?: string | null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO case_events (id, case_id, event_type, summary, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(newId(), caseId, eventType, summary, actorId ?? null, nowIso())
    .run();
}

function redact(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const clone = { ...(value as Record<string, unknown>) };
  for (const key of Object.keys(clone)) {
    if (/password|iban|account_number|swift|token|secret/i.test(key)) {
      clone[key] = "[redacted]";
    }
  }
  return clone;
}
