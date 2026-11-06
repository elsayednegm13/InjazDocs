import { newId, nowIso, one } from "../db/sql";
import { errors, securityHeaders } from "../http/errors";

/**
 * Idempotency-Key contract (ET-2026-10-21)
 *
 * - The row in `idempotency_keys` is the durable effect witness. It is scoped
 *   to the authenticated actor with UNIQUE (actor_id, idempotency_key) and is
 *   never deleted merely because a role, override or activation changed.
 * - The cached response has its own, much shorter lifetime
 *   (`response_expires_at`). Once it expires the response body is purged and a
 *   retry receives 409 IDEMPOTENCY_RESULT_EXPIRED. The witness remains, so the
 *   same logical operation cannot create a second business effect inside the
 *   witness window.
 * - The witness itself has a finite lifetime (`expires_at`). This is a bounded
 *   guarantee, not "exactly once forever"; the boundary is documented and
 *   tested rather than hidden.
 * - Replay authorization is not inferred from the cached 2xx. The HTTP
 *   middleware re-checks the current actor, permission and case scope before
 *   any cached body is returned (see replay-policy.ts). Deleting witnesses on
 *   role edits was an unsafe substitute and has been removed.
 * - A request that throws an unknown error is marked UNKNOWN. A retry is not
 *   executed automatically: the client must reconcile before a new operation.
 * - IN_PROGRESS claims have a short lease. An expired lease becomes UNKNOWN,
 *   never an automatic second execution.
 */
export const IDEMPOTENCY_RESPONSE_TTL_MS = 60 * 60 * 1000;
export const IDEMPOTENCY_WITNESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LEASE_MS = 2 * 60 * 1000;

export const IDEMPOTENCY_HEADER = "idempotency-key";

export type BeginIdempotentResult =
  | { kind: "NEW"; id: string }
  | { kind: "REPLAY"; status: number; body: string; contentType: string | null }
  | { kind: "IN_PROGRESS" }
  | { kind: "UNKNOWN" }
  | { kind: "EXPIRED" }
  | { kind: "MISMATCH" };

interface IdempotencyRow {
  id: string;
  method: string;
  path: string;
  request_hash: string;
  state: "IN_PROGRESS" | "COMPLETED" | "UNKNOWN";
  status_code: number | null;
  response_body: string | null;
  response_type: string | null;
  response_expires_at: string | null;
  outcome_class: string | null;
  effect_ref: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export function isIdempotentMutation(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

/**
 * Only JSON/empty-body mutations use the ledger. Binary chunk uploads already
 * have natural idempotency (a part number is overwritten, never appended).
 */
export function isIdempotencyExcluded(pathname: string): boolean {
  return (
    /\/files\/uploads\/[^/]+\/parts\/[^/]+$/.test(pathname) ||
    /\/files\/uploads\/[^/]+\/sign$/.test(pathname) ||
    /\/imports\/customers\/preview$/.test(pathname)
  );
}

export function parseIdempotencyKey(raw: string | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim();
  if (key.length < 8 || key.length > 200) {
    throw errors.badRequest("Idempotency-Key must be between 8 and 200 characters.");
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw errors.badRequest("Idempotency-Key contains unsupported characters.");
  }
  return key;
}

export async function hashIdempotentRequest(method: string, path: string, body: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${method}\n${path}\n${body}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function replay(result: Extract<BeginIdempotentResult, { kind: "REPLAY" }>): Response {
  const headers = new Headers(securityHeaders());
  if (result.contentType) headers.set("content-type", result.contentType);
  headers.set("idempotent-replayed", "true");
  return new Response(result.status === 204 || result.status === 205 ? null : result.body, {
    status: result.status,
    headers,
  });
}

export { replay as replayIdempotentResponse };

function responseIsReplayable(row: IdempotencyRow, now: number): boolean {
  if (row.state !== "COMPLETED") return false;
  if (row.response_body === null || row.status_code === null) return false;
  if (!row.response_expires_at) return false;
  const expires = Date.parse(row.response_expires_at);
  return Number.isFinite(expires) && expires > now;
}

export async function beginIdempotent(
  db: D1Database,
  actorId: string,
  key: string,
  method: string,
  path: string,
  requestHash: string,
): Promise<BeginIdempotentResult> {
  const now = Date.now();
  const createdAt = new Date(now).toISOString();

  // Only a witness that has outlived its finite retention window is removed.
  // A cached-response expiry never deletes the witness.
  await db
    .prepare("DELETE FROM idempotency_keys WHERE actor_id = ? AND idempotency_key = ? AND expires_at <= ?")
    .bind(actorId, key, createdAt)
    .run();

  const id = newId();
  const witnessExpiresAt = new Date(now + IDEMPOTENCY_WITNESS_TTL_MS).toISOString();
  const insert = () =>
    db
      .prepare(
        `INSERT INTO idempotency_keys
           (id, actor_id, idempotency_key, method, path, request_hash, state, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, 'IN_PROGRESS', ?, ?, ?)
         ON CONFLICT(actor_id, idempotency_key) DO NOTHING`,
      )
      .bind(id, actorId, key, method, path, requestHash, createdAt, createdAt, witnessExpiresAt)
      .run();

  const inserted = await insert();
  if ((inserted.meta.changes ?? 0) > 0) return { kind: "NEW", id };

  const row = await one<IdempotencyRow>(
    db,
    "SELECT * FROM idempotency_keys WHERE actor_id = ? AND idempotency_key = ?",
    actorId,
    key,
  );

  // The conflicting row was removed between INSERT and SELECT. Retry the atomic
  // claim once; the UNIQUE constraint still guarantees a single winner.
  if (!row) {
    const retried = await insert();
    if ((retried.meta.changes ?? 0) > 0) return { kind: "NEW", id };
    return { kind: "IN_PROGRESS" };
  }

  // Safety net: this row is the one this request just wrote, so the claim is
  // ours even if the driver did not report the change count.
  if (row.id === id) return { kind: "NEW", id };

  if (row.method !== method || row.path !== path || row.request_hash !== requestHash) {
    return { kind: "MISMATCH" };
  }

  if (row.state === "COMPLETED") {
    if (responseIsReplayable(row, now)) {
      return {
        kind: "REPLAY",
        status: row.status_code ?? 200,
        body: row.response_body ?? "",
        contentType: row.response_type,
      };
    }
    // The witness is still valid but the protected response has been purged,
    // or this is a legacy row with no independent response-retention stamp.
    // Fail closed: do not execute the handler again and do not invent data.
    return { kind: "EXPIRED" };
  }

  if (row.state === "UNKNOWN") return { kind: "UNKNOWN" };

  const updatedAt = Date.parse(row.updated_at);
  if (!Number.isFinite(updatedAt) || now - updatedAt > LEASE_MS) {
    // The original request was interrupted or is taking too long to prove its
    // outcome. Never run the handler a second time automatically.
    await db
      .prepare("UPDATE idempotency_keys SET state = 'UNKNOWN', updated_at = ? WHERE id = ? AND state = 'IN_PROGRESS'")
      .bind(nowIso(), row.id)
      .run();
    return { kind: "UNKNOWN" };
  }

  return { kind: "IN_PROGRESS" };
}

function effectRefFromBody(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { data?: { id?: unknown; importId?: unknown } };
    const candidate = parsed.data?.id ?? parsed.data?.importId;
    return typeof candidate === "string" && candidate.length <= 200 ? candidate : null;
  } catch {
    return null;
  }
}

export async function completeIdempotent(
  db: D1Database,
  id: string,
  status: number,
  body: string,
  contentType: string | null,
  effectRef?: string | null,
): Promise<void> {
  const now = Date.now();
  const outcomeClass = status >= 200 && status < 300 ? "COMMITTED" : "REJECTED";
  await db
    .prepare(
      `UPDATE idempotency_keys
       SET state = 'COMPLETED', status_code = ?, response_body = ?, response_type = ?,
           response_expires_at = ?, outcome_class = ?, effect_ref = ?, updated_at = ?
       WHERE id = ? AND state IN ('IN_PROGRESS', 'UNKNOWN')`,
    )
    .bind(
      status,
      body,
      contentType,
      new Date(now + IDEMPOTENCY_RESPONSE_TTL_MS).toISOString(),
      outcomeClass,
      effectRef === undefined ? effectRefFromBody(body) : effectRef,
      new Date(now).toISOString(),
      id,
    )
    .run();
}

export async function markIdempotentUnknown(db: D1Database, id: string): Promise<void> {
  await db
    .prepare("UPDATE idempotency_keys SET state = 'UNKNOWN', updated_at = ? WHERE id = ? AND state = 'IN_PROGRESS'")
    .bind(nowIso(), id)
    .run();
}

/**
 * Used only by a pre-handler test fault that proves no business work happened.
 * Normal failures must go through markIdempotentUnknown instead.
 */
export async function releaseIdempotent(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM idempotency_keys WHERE id = ?").bind(id).run();
}

/**
 * Purges expired protected response bodies while keeping the durable witness,
 * then removes witnesses whose finite retention window has ended.
 */
export async function cleanupIdempotencyKeys(db: D1Database): Promise<number> {
  const now = nowIso();
  await db
    .prepare(
      `UPDATE idempotency_keys
       SET response_body = NULL, response_type = NULL, status_code = NULL,
           response_expires_at = NULL, updated_at = ?
       WHERE state = 'COMPLETED' AND response_expires_at IS NOT NULL AND response_expires_at <= ?`,
    )
    .bind(now, now)
    .run();
  const result = await db.prepare("DELETE FROM idempotency_keys WHERE expires_at <= ?").bind(now).run();
  return result.meta.changes ?? 0;
}
