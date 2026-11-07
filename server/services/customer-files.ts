import { normalizeCustomerFileDecision, type CustomerFileCard } from "../../shared/customer-file-share";
import { all, newId, nowIso, one } from "../db/sql";
import { errors } from "../http/errors";
import type { Actor } from "./actor";
import { assertCaseAccess, requirePermission } from "./actor";
import { writeAudit } from "./audit";
import { downloadObject } from "./uploads";
import { consumeRateLimit, hashToken, openTrackingLink } from "./tracking";

type ShareRow = {
  version_id: string;
  unpublished_at: string | null;
  decision: string | null;
  comment: string | null;
  first_viewed_at: string | null;
  decided_at: string | null;
};

export async function customerSharesForCase(db: D1Database, caseId: string): Promise<{ ready: boolean; rows: ShareRow[] }> {
  try {
    const rows = await all<ShareRow>(
      db,
      `SELECT version_id, unpublished_at, decision, comment, first_viewed_at, decided_at
       FROM customer_file_shares WHERE case_id = ?`,
      caseId,
    );
    return { ready: true, rows };
  } catch (error) {
    if (isMissingShareTable(error)) return { ready: false, rows: [] };
    throw error;
  }
}

export function withCustomerShare<T extends { id: string }>(version: T, share: ShareRow | undefined, ready: boolean) {
  if (!ready) return version;
  return {
    ...version,
    customer_published: share && !share.unpublished_at ? 1 : 0,
    customer_decision: share?.decision ?? null,
    customer_comment: share?.comment ?? null,
    customer_first_viewed_at: share?.first_viewed_at ?? null,
    customer_decided_at: share?.decided_at ?? null,
  };
}

export async function publishedCustomerFiles(db: D1Database, caseId: string): Promise<CustomerFileCard[]> {
  try {
    const rows = await all<{
      version_id: string;
      original_name: string;
      byte_size: number;
      version: number;
      name_en: string;
      name_ar: string;
      decision: string | null;
      comment: string | null;
      first_viewed_at: string | null;
    }>(
      db,
      `SELECT v.id AS version_id, v.original_name, v.byte_size, v.version,
              d.name_en, d.name_ar, s.decision, s.comment, s.first_viewed_at
       FROM customer_file_shares s
       JOIN document_versions v ON v.id = s.version_id
       JOIN operation_document_requirements r ON r.id = v.requirement_id
       JOIN document_type_definitions d ON d.id = r.document_type_id
       WHERE s.case_id = ? AND s.unpublished_at IS NULL
         AND v.version = (
           SELECT MAX(v2.version)
           FROM document_versions v2
           JOIN customer_file_shares s2 ON s2.version_id = v2.id
           WHERE v2.requirement_id = r.id AND s2.unpublished_at IS NULL
         )
       ORDER BY d.name_en`,
      caseId,
    );
    return rows.map((row) => ({
      versionId: row.version_id,
      nameEn: row.name_en,
      nameAr: row.name_ar,
      fileName: row.original_name,
      byteSize: row.byte_size,
      version: row.version,
      decision: row.decision === "ACCEPTED" || row.decision === "CHANGES_REQUESTED" ? row.decision : null,
      comment: row.comment,
      viewed: Boolean(row.first_viewed_at),
    }));
  } catch (error) {
    if (isMissingShareTable(error)) return [];
    throw error;
  }
}

export async function setCustomerFileShare(
  db: D1Database,
  actor: Actor,
  versionId: string,
  publish: boolean,
  requestId: string,
) {
  requirePermission(actor, "tracking_links.manage");
  const version = await one<{ id: string; requirement_id: string; case_id: string; version: number }>(
    db,
    `SELECT v.id, v.requirement_id, v.version, r.case_id
     FROM document_versions v
     JOIN operation_document_requirements r ON r.id = v.requirement_id
     WHERE v.id = ?`,
    versionId,
  );
  if (!version) throw errors.notFound("File not found");
  await assertCaseAccess(db, actor, version.case_id);
  if (!(await customerSharesForCase(db, version.case_id)).ready) {
    throw errors.coded(503, "SCHEMA_UPGRADE_REQUIRED", "This deployment is waiting for a database upgrade. No change was saved.");
  }
  const now = nowIso();
  if (!publish) {
    await db
      .prepare("UPDATE customer_file_shares SET unpublished_at = COALESCE(unpublished_at, ?), updated_at = ? WHERE version_id = ?")
      .bind(now, now, versionId)
      .run();
    await writeAudit(db, {
      actorId: actor.id,
      entityType: "document_version",
      entityId: versionId,
      action: "customer_file.unpublish",
      requestId,
    });
    return { published: false };
  }
  const latest = await one<{ version: number }>(
    db,
    "SELECT MAX(version) AS version FROM document_versions WHERE requirement_id = ?",
    version.requirement_id,
  );
  if ((latest?.version ?? 0) !== version.version) {
    throw errors.validation("Publish the latest file. An older version stays in the record and is not sent to the customer.", {
      versionId: "Choose the latest version.",
    });
  }
  await db
    .prepare(
      `UPDATE customer_file_shares
          SET unpublished_at = ?, updated_at = ?
        WHERE case_id = ? AND unpublished_at IS NULL AND version_id IN (
          SELECT id FROM document_versions WHERE requirement_id = ? AND id != ?
        )`,
    )
    .bind(now, now, version.case_id, version.requirement_id, versionId)
    .run();
  await db
    .prepare(
      `INSERT INTO customer_file_shares (
         id, version_id, case_id, published_at, published_by, unpublished_at, view_count, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?)
       ON CONFLICT(version_id) DO UPDATE SET
         unpublished_at = NULL,
         published_at = excluded.published_at,
         published_by = excluded.published_by,
         updated_at = excluded.updated_at`,
    )
    .bind(newId(), versionId, version.case_id, now, actor.id, now, now)
    .run();
  await writeAudit(db, {
    actorId: actor.id,
    entityType: "document_version",
    entityId: versionId,
    action: "customer_file.publish",
    requestId,
  });
  return { published: true };
}

export async function publishedCustomerFilesForToken(db: D1Database, token: string) {
  const link = await openTrackingLink(db, token);
  return publishedCustomerFiles(db, link.case_id);
}

export async function openPublishedCustomerFile(db: D1Database, bucket: R2Bucket, token: string, versionId: string, ip: string) {
  await consumeRateLimit(db, `public-file:${await hashToken(ip || "unknown")}`, 20, 60_000);
  const link = await openTrackingLink(db, token);
  const share = await publishedLatest(db, link.case_id, versionId);
  if (!share) throw errors.notFound("This file is not available on this link.");
  const object = await downloadObject(bucket, share.r2_key);
  const now = nowIso();
  await db
    .prepare(
      `UPDATE customer_file_shares
          SET first_viewed_at = COALESCE(first_viewed_at, ?),
              last_viewed_at = ?,
              view_count = view_count + 1,
              link_id = COALESCE(link_id, ?),
              updated_at = ?
        WHERE version_id = ? AND unpublished_at IS NULL`,
    )
    .bind(now, now, link.id, now, versionId)
    .run();
  await db
    .prepare("INSERT INTO tracking_link_access_events (id, link_id, accessed_at, ip_hash, user_agent) VALUES (?, ?, ?, ?, ?)")
    .bind(newId(), link.id, now, await hashToken(ip || "unknown"), "file")
    .run();
  return {
    filename: share.original_name,
    contentType: share.content_type,
    body: object.body,
    objectType: object.httpMetadata?.contentType,
  };
}

export async function decideCustomerFile(
  db: D1Database,
  token: string,
  versionId: string,
  input: { decision?: unknown; comment?: unknown },
  ip: string,
) {
  await consumeRateLimit(db, `public-file-decision:${await hashToken(ip || "unknown")}`, 10, 60_000);
  const link = await openTrackingLink(db, token);
  const share = await publishedLatest(db, link.case_id, versionId);
  if (!share) throw errors.notFound("This file is not available on this link.");
  const normalized = normalizeCustomerFileDecision(input.decision, input.comment);
  if ("error" in normalized) {
    const message = normalized.error === "too_long"
      ? "Keep the note within 1000 characters."
      : normalized.error === "comment_required"
        ? "Write what should change in the file."
        : "Choose accept or request another review.";
    throw errors.validation(message, { comment: message });
  }
  const now = nowIso();
  const saved = await db
    .prepare(
      `UPDATE customer_file_shares
          SET decision = ?, comment = ?, decided_at = ?, link_id = ?, updated_at = ?
        WHERE version_id = ? AND case_id = ? AND unpublished_at IS NULL`,
    )
    .bind(normalized.decision, normalized.comment, now, link.id, now, versionId, link.case_id)
    .run();
  if ((saved.meta?.changes ?? 0) !== 1) {
    const stillThere = await publishedLatest(db, link.case_id, versionId);
    if (!stillThere) {
      throw errors.conflict("A newer file was published. Reload the page and review that file.", "DOCUMENT_CHANGED");
    }
  }
  await writeAudit(db, {
    actorId: null,
    entityType: "document_version",
    entityId: versionId,
    action: "customer_file.decision",
    after: { decision: normalized.decision, comment: normalized.comment },
  });
  return { decision: normalized.decision };
}

async function publishedLatest(db: D1Database, caseId: string, versionId: string) {
  try {
    return await one<{ r2_key: string; original_name: string; content_type: string }>(
      db,
      `SELECT v.r2_key, v.original_name, v.content_type
       FROM customer_file_shares s
       JOIN document_versions v ON v.id = s.version_id
       JOIN operation_document_requirements r ON r.id = v.requirement_id
       WHERE s.version_id = ? AND s.case_id = ? AND s.unpublished_at IS NULL
         AND v.version = (
           SELECT MAX(v2.version)
           FROM document_versions v2
           JOIN customer_file_shares s2 ON s2.version_id = v2.id
           WHERE v2.requirement_id = r.id AND s2.unpublished_at IS NULL
         )`,
      versionId,
      caseId,
    );
  } catch (error) {
    if (isMissingShareTable(error)) return null;
    throw error;
  }
}

function isMissingShareTable(error: unknown) {
  const text = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
  return /no such table/i.test(text) && /customer_file_shares/i.test(text);
}
