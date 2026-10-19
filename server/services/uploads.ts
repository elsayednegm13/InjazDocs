import { AwsClient } from "aws4fetch";
import { all, newId, nowIso, one } from "../db/sql";
import { errors, HttpError } from "../http/errors";
import type { Actor } from "./actor";
import { assertCaseAccess, requirePermission } from "./actor";

const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);
const ALLOWED_EXT = new Set(["pdf", "jpg", "jpeg", "png"]);

export function remotePresignAvailable(env: Env): boolean {
  return Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET_NAME);
}

export async function createUploadSession(
  db: D1Database,
  env: Env,
  bucket: R2Bucket,
  actor: Actor,
  input: { parentType: string; parentId: string; filename: string; mime: string; expectedBytes: number },
) {
  requirePermission(actor, "documents.upload");
  const maxBytes = Number(env.MAX_UPLOAD_BYTES || 419430400);
  if (input.expectedBytes <= 0) throw errors.validation("Zero-byte files are rejected");
  if (input.expectedBytes > maxBytes) throw errors.payload(`File exceeds configured maximum of ${maxBytes} bytes`);
  if (!ALLOWED_MIME.has(input.mime)) throw errors.validation("Only PDF, JPEG, and PNG uploads are allowed");
  const ext = input.filename.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXT.has(ext)) throw errors.validation("File extension is not allowed");
  await assertUploadParent(db, actor, input.parentType, input.parentId);
  const objectKey = `docs/${input.parentType}/${input.parentId}/${newId()}/${sanitizeName(input.filename)}`;
  const id = newId();
  const expires = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  const multipart = await bucket.createMultipartUpload(objectKey);
  await db
    .prepare(
      `INSERT INTO upload_sessions (id, object_key, parent_type, parent_id, owner_user_id, filename, expected_bytes, mime, upload_id, state, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'INIT', ?, ?)`,
    )
    .bind(id, objectKey, input.parentType, input.parentId, actor.id, input.filename, input.expectedBytes, input.mime, multipart.uploadId, expires, nowIso())
    .run();
  return {
    id,
    objectKey,
    uploadId: multipart.uploadId,
    partSize: Number(env.UPLOAD_PART_SIZE_BYTES || 10 * 1024 * 1024),
    expiresAt: expires,
    mode: remotePresignAvailable(env) ? "R2_PRESIGNED" : "LOCAL_WORKER_PARTS",
  };
}

export async function signPart(
  db: D1Database,
  env: Env,
  actor: Actor,
  sessionId: string,
  partNumber: number,
) {
  const session = await requireSession(db, actor, sessionId);
  await db.prepare("UPDATE upload_sessions SET state = 'UPLOADING' WHERE id = ?").bind(sessionId).run();
  if (remotePresignAvailable(env)) {
    const client = new AwsClient({
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      service: "s3",
      region: "auto",
    });
    const endpoint = env.R2_S3_ENDPOINT || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    const url = new URL(`${endpoint}/${env.R2_BUCKET_NAME}/${session.object_key}`);
    url.searchParams.set("partNumber", String(partNumber));
    url.searchParams.set("uploadId", session.upload_id!);
    const signed = await client.sign(url.toString(), { method: "PUT" });
    return { url: signed.url, method: "PUT", mode: "R2_PRESIGNED" as const };
  }
  return {
    url: `/api/v1/files/uploads/${sessionId}/parts/${partNumber}`,
    method: "PUT",
    mode: "LOCAL_WORKER_PARTS" as const,
  };
}

export async function storeLocalPart(
  db: D1Database,
  bucket: R2Bucket,
  actor: Actor,
  sessionId: string,
  partNumber: number,
  body: ReadableStream | ArrayBuffer,
) {
  if (partNumber < 1) throw errors.validation("Part number must be positive");
  if (body instanceof ArrayBuffer && body.byteLength === 0) throw errors.validation("Zero-byte parts are rejected");
  const session = await requireSession(db, actor, sessionId);
  const upload = bucket.resumeMultipartUpload(session.object_key, session.upload_id!);
  const uploaded = await upload.uploadPart(partNumber, body);
  await db
    .prepare(`INSERT OR REPLACE INTO upload_parts (session_id, part_number, etag, size_bytes) VALUES (?, ?, ?, ?)`)
    .bind(sessionId, partNumber, uploaded.etag, 0)
    .run();
  return { etag: uploaded.etag };
}

export async function completeUpload(
  db: D1Database,
  bucket: R2Bucket,
  actor: Actor,
  sessionId: string,
  parts: { partNumber: number; etag: string }[],
) {
  const session = await requireSession(db, actor, sessionId);
  if (parts.length === 0) throw errors.validation("No parts");
  const upload = bucket.resumeMultipartUpload(session.object_key, session.upload_id!);
  try {
    await upload.complete(parts.map((part) => ({ partNumber: part.partNumber, etag: part.etag })));
  } catch {
    throw errors.conflict("The upload did not finish. Retry the remaining part or choose the file again.", "DOCUMENT_UPLOAD_INCOMPLETE");
  }
  const object = await bucket.head(session.object_key);
  if (!object || object.size !== session.expected_bytes) {
    await discardObject(bucket, session.object_key);
    await markSession(db, sessionId, "ABORTED");
    throw errors.conflict("The upload did not finish. Retry the remaining part or choose the file again.", "DOCUMENT_UPLOAD_INCOMPLETE");
  }
  try {
    await assertMagic(bucket, session.object_key, session.mime);
  } catch (error) {
    await discardObject(bucket, session.object_key);
    await markSession(db, sessionId, "ABORTED");
    throw error;
  }
  await db
    .prepare("UPDATE upload_sessions SET state = 'COMPLETED', finalized_at = ? WHERE id = ?")
    .bind(nowIso(), sessionId)
    .run();
  return { objectKey: session.object_key, byteSize: object.size, mime: session.mime, filename: session.filename, etag: object.etag };
}

export async function abortUpload(db: D1Database, bucket: R2Bucket, actor: Actor, sessionId: string) {
  const session = await requireSession(db, actor, sessionId);
  try {
    await bucket.resumeMultipartUpload(session.object_key, session.upload_id!).abort();
  } catch {
    /* already aborted */
  }
  await db.prepare("UPDATE upload_sessions SET state = 'ABORTED' WHERE id = ?").bind(sessionId).run();
}

export async function authorizeObjectKey(db: D1Database, actor: Actor, key: string) {
  const version = await one<{ case_id: string }>(
    db,
    `SELECT r.case_id AS case_id
     FROM document_versions v
     JOIN operation_document_requirements r ON r.id = v.requirement_id
     WHERE v.r2_key = ?`,
    key,
  );
  const booking = version
    ? null
    : await one<{ case_id: string }>(
        db,
        `SELECT b.case_id AS case_id FROM booking_attachments a JOIN bookings b ON b.id = a.booking_id WHERE a.r2_key = ?`,
        key,
      );
  const session = version || booking
    ? null
    : await one<{ parent_type: string; parent_id: string; state: string }>(
        db,
        "SELECT parent_type, parent_id, state FROM upload_sessions WHERE object_key = ? AND state = 'COMPLETED'",
        key,
      );
  try {
    if (version) {
      await assertCaseAccess(db, actor, version.case_id);
      return;
    }
    if (booking) {
      await assertCaseAccess(db, actor, booking.case_id);
      return;
    }
    if (session) {
      await assertUploadParent(db, actor, session.parent_type, session.parent_id);
      return;
    }
  } catch (error) {
    if (error instanceof HttpError && (error.status === 403 || error.status === 404)) {
      throw errors.notFound("File not found");
    }
    throw error;
  }
  throw errors.notFound("File not found");
}

export async function expireUploadSessions(db: D1Database, bucket: R2Bucket) {
  const now = nowIso();
  const stale = await all<{ id: string; object_key: string; upload_id: string | null }>(
    db,
    `SELECT id, object_key, upload_id FROM upload_sessions
     WHERE state IN ('INIT', 'UPLOADING') AND expires_at < ?`,
    now,
  );
  for (const session of stale) {
    if (session.upload_id) {
      try {
        await bucket.resumeMultipartUpload(session.object_key, session.upload_id).abort();
      } catch {
        /* already gone */
      }
    }
    await markSession(db, session.id, "EXPIRED");
  }
  return stale.length;
}

async function assertUploadParent(db: D1Database, actor: Actor, parentType: string, parentId: string) {
  if (parentType === "document_requirement") {
    const row = await one<{ case_id: string }>(
      db,
      "SELECT case_id FROM operation_document_requirements WHERE id = ?",
      parentId,
    );
    if (!row) throw errors.notFound("Document requirement not found");
    await assertCaseAccess(db, actor, row.case_id);
    return;
  }
  if (parentType === "booking") {
    const row = await one<{ case_id: string }>(db, "SELECT case_id FROM bookings WHERE id = ?", parentId);
    if (!row) throw errors.notFound("Booking not found");
    await assertCaseAccess(db, actor, row.case_id);
    return;
  }
  throw errors.validation("Unsupported upload parent");
}

async function assertMagic(bucket: R2Bucket, key: string, mime: string) {
  const head = await bucket.get(key);
  if (!head) throw errors.conflict("Uploaded object was not found after finalize");
  const reader = head.body.getReader();
  const first = await reader.read();
  await reader.cancel();
  const bytes = first.value ?? new Uint8Array();
  const ok =
    (mime === "application/pdf" && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) ||
    (mime === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (mime === "image/png" && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47);
  if (!ok) throw errors.validation("Choose a valid PDF, JPEG, or PNG and try again.", undefined, "INVALID_PDF");
}

export async function downloadObject(bucket: R2Bucket, key: string) {
  const object = await bucket.get(key);
  if (!object) throw errors.notFound("File not found");
  return object;
}

async function requireSession(db: D1Database, actor: Actor, sessionId: string) {
  const session = await one<{
    id: string;
    object_key: string;
    owner_user_id: string;
    expected_bytes: number;
    mime: string;
    filename: string;
    state: string;
    expires_at: string;
    upload_id: string | null;
  }>(db, "SELECT * FROM upload_sessions WHERE id = ?", sessionId);
  if (!session) throw errors.notFound("Upload session not found");
  if (session.owner_user_id !== actor.id) throw errors.notFound("Upload session not found");
  if (session.expires_at < nowIso()) throw errors.conflict("The upload session expired. Choose the file again.", "DOCUMENT_UPLOAD_INCOMPLETE");
  if (session.state !== "INIT" && session.state !== "UPLOADING") throw errors.conflict("The upload is not active. Choose the file again.", "DOCUMENT_UPLOAD_INCOMPLETE");
  return session;
}

async function markSession(db: D1Database, sessionId: string, state: string) {
  await db.prepare("UPDATE upload_sessions SET state = ? WHERE id = ?").bind(state, sessionId).run();
}

async function discardObject(bucket: R2Bucket, key: string) {
  try {
    await bucket.delete(key);
  } catch {
    /* best-effort cleanup of a rejected object */
  }
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
}
