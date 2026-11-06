import { newId, nowIso, one } from "../db/sql";

export type CompensationOperation = "BOOTSTRAP" | "USER_CREATE";

/**
 * Records a failed compensation attempt with a correlation id and minimal,
 * redacted metadata. It never stores passwords, hashes, cookies, tokens, email
 * bodies or raw SQL. If the database itself is unavailable the insert also
 * fails; the caller must log the correlation id and fail closed.
 */
export async function recordCompensationIncident(
  db: D1Database,
  input: {
    operation: CompensationOperation;
    stage: string;
    residualUserId?: string | null;
    detail?: string | null;
  },
): Promise<{ id: string; correlationId: string; persisted: boolean }> {
  const id = newId();
  const correlationId = newId();
  let persisted = false;
  try {
    await db
      .prepare(
        `INSERT INTO auth_compensation_incidents
           (id, correlation_id, operation, stage, residual_user_id, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        correlationId,
        input.operation,
        input.stage.slice(0, 120),
        input.residualUserId ?? null,
        input.detail ? input.detail.slice(0, 300) : null,
        nowIso(),
      )
      .run();
    persisted = true;
  } catch (error) {
    // The incident store may be the thing that failed. The caller still gets a
    // correlation id and must surface it to the operator. `persisted: false`
    // tells the caller the incident is not on disk, so it must not be reported
    // as recorded evidence.
    console.error(
      "[auth-compensation] incident store unavailable",
      correlationId,
      error instanceof Error ? error.name : "unknown",
    );
  }
  return { id, correlationId, persisted };
}

export async function userStillExists(db: D1Database, userId: string): Promise<boolean> {
  const row = await one<{ id: string }>(db, "SELECT id FROM user WHERE id = ?", userId);
  return Boolean(row);
}
