import type { DocumentRequirementStatus } from "../../shared/enums";
import { normalizeCustomerFileDecision, type CustomerFileCard } from "../../shared/customer-file-share";
import { assertDocumentTransition } from "../domain/transitions";
import { all, newId, nowIso, one } from "../db/sql";
import { errors } from "../http/errors";
import type { Actor } from "./actor";
import { assertCaseAccess, requirePermission } from "./actor";
import { writeAudit, writeCaseEvent } from "./audit";
import { recomputeRemindersForCase } from "./reminders";
import { downloadObject } from "./uploads";
import { consumeRateLimit, hashToken, openTrackingLink } from "./tracking";

type ShareRow = {
  version_id: string;
  unpublished_at: string | null;
  decision: string | null;
  comment: string | null;
  first_viewed_at: string | null;
  decided_at: string | null;
  revision_open: number;
};

export async function customerSharesForCase(db: D1Database, caseId: string): Promise<{ ready: boolean; rows: ShareRow[] }> {
  try {
    const rows = await all<ShareRow>(
      db,
      `SELECT version_id, unpublished_at, decision, comment, first_viewed_at, decided_at, revision_open
       FROM customer_file_shares WHERE case_id = ?`,
      caseId,
    );
    return { ready: true, rows };
  } catch (error) {
    if (isMissingShareTable(error)) return { ready: false, rows: [] };
    if (!isMissingRevisionColumn(error)) throw error;
    const rows = await all<Omit<ShareRow, "revision_open">>(
      db,
      `SELECT version_id, unpublished_at, decision, comment, first_viewed_at, decided_at
       FROM customer_file_shares WHERE case_id = ?`,
      caseId,
    );
    return { ready: true, rows: rows.map((row) => ({ ...row, revision_open: 0 })) };
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
    customer_revision_open: share?.revision_open === 1 ? 1 : 0,
  };
}

const VISIBLE_FILE_SQL = `SELECT r.id AS requirement_id, v.id AS version_id, v.original_name, v.byte_size, v.version,
            d.name_en, d.name_ar
     FROM operation_document_requirements r
     JOIN document_type_definitions d ON d.id = r.document_type_id
     JOIN document_versions v ON v.requirement_id = r.id
     JOIN customer_file_shares s ON s.version_id = v.id AND s.unpublished_at IS NULL
     WHERE r.case_id = ?
       AND v.archived_at IS NULL
       AND v.version = (
         SELECT MAX(version) FROM document_versions
         WHERE requirement_id = r.id AND archived_at IS NULL
       )
     ORDER BY r.created_at ASC, r.id ASC`;

const VISIBLE_FILE_SQL_WITHOUT_ARCHIVE = `SELECT r.id AS requirement_id, v.id AS version_id, v.original_name, v.byte_size, v.version,
            d.name_en, d.name_ar
     FROM operation_document_requirements r
     JOIN document_type_definitions d ON d.id = r.document_type_id
     JOIN document_versions v ON v.requirement_id = r.id
     JOIN customer_file_shares s ON s.version_id = v.id AND s.unpublished_at IS NULL
     WHERE r.case_id = ?
       AND v.version = (SELECT MAX(version) FROM document_versions WHERE requirement_id = r.id)
     ORDER BY r.created_at ASC, r.id ASC`;

export async function publishedCustomerFiles(db: D1Database, caseId: string): Promise<CustomerFileCard[]> {
  const rows = await visibleFiles(db, caseId);
  const shares = await customerSharesForCase(db, caseId);
  const byVersion = new Map(shares.rows.map((share) => [share.version_id, share]));
  return rows.map((row) => {
    const share = byVersion.get(row.version_id);
    const decision = share?.decision === "ACCEPTED" || share?.decision === "CHANGES_REQUESTED" ? share.decision : null;
    return {
      requirementId: row.requirement_id,
      versionId: row.version_id,
      nameEn: row.name_en,
      nameAr: row.name_ar,
      fileName: row.original_name,
      byteSize: row.byte_size,
      version: row.version,
      decision,
      comment: share?.comment ?? null,
      viewed: Boolean(share?.first_viewed_at),
      revisionOpen: share?.revision_open === 1,
    };
  });
}

export async function setCustomerFileShare(db: D1Database, actor: Actor, versionId: string, publish: boolean, requestId: string) {
  requirePermission(actor, "customer_files.manage");
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
  const archived = await archivedVersionIds(db, version.case_id);
  if (archived?.has(versionId)) throw errors.validation("This file is archived. Send the current file for review.");
  const now = nowIso();
  if (!publish) {
    await db
      .prepare("UPDATE customer_file_shares SET unpublished_at = COALESCE(unpublished_at, ?), updated_at = ? WHERE version_id = ?")
      .bind(now, now, versionId)
      .run();
    await writeAudit(db, { actorId: actor.id, entityType: "document_version", entityId: versionId, action: "customer_file.unpublish", requestId });
    return { published: false };
  }
  const latest = await one<{ id: string }>(
    db,
    archived === null
      ? "SELECT id FROM document_versions WHERE requirement_id = ? ORDER BY version DESC LIMIT 1"
      : "SELECT id FROM document_versions WHERE requirement_id = ? AND archived_at IS NULL ORDER BY version DESC LIMIT 1",
    version.requirement_id,
  );
  if (latest?.id !== versionId) throw errors.validation("Send the current file for the customer's review.");
  await db
    .prepare(
      `UPDATE customer_file_shares SET unpublished_at = ?, updated_at = ?
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
  await writeAudit(db, { actorId: actor.id, entityType: "document_version", entityId: versionId, action: "customer_file.publish", requestId });
  return { published: true };
}

export async function reopenCustomerRevision(db: D1Database, actor: Actor, versionId: string, requestId: string) {
  requirePermission(actor, "customer_files.manage");
  const version = await one<{ id: string; case_id: string }>(
    db,
    `SELECT v.id, r.case_id
     FROM document_versions v
     JOIN operation_document_requirements r ON r.id = v.requirement_id
     WHERE v.id = ?`,
    versionId,
  );
  if (!version) throw errors.notFound("File not found");
  await assertCaseAccess(db, actor, version.case_id);
  const now = nowIso();
  try {
    const saved = await db
      .prepare(
        `UPDATE customer_file_shares
            SET revision_open = 1, updated_at = ?
          WHERE version_id = ? AND case_id = ? AND decision = 'ACCEPTED'`,
      )
      .bind(now, versionId, version.case_id)
      .run();
    if ((saved.meta?.changes ?? 0) !== 1) {
      throw errors.validation("The customer has not accepted this file, so there is nothing to open.");
    }
  } catch (error) {
    if (isMissingRevisionColumn(error) || isMissingShareTable(error)) {
      throw errors.coded(503, "SCHEMA_UPGRADE_REQUIRED", "This deployment is waiting for a database upgrade. No change was saved.");
    }
    throw error;
  }
  await writeAudit(db, { actorId: actor.id, entityType: "document_version", entityId: versionId, action: "customer_file.reopen", requestId });
  return { revisionOpen: true };
}

export async function requirementIdsWithArchive(db: D1Database, caseId: string): Promise<Set<string> | null> {
  try {
    const rows = await all<{ requirement_id: string }>(
      db,
      `SELECT DISTINCT v.requirement_id AS requirement_id
       FROM document_versions v
       JOIN operation_document_requirements r ON r.id = v.requirement_id
       WHERE r.case_id = ? AND v.archived_at IS NOT NULL`,
      caseId,
    );
    return new Set(rows.map((row) => row.requirement_id));
  } catch (error) {
    if (isMissingArchiveColumn(error)) return null;
    throw error;
  }
}

export async function archivedVersionIds(db: D1Database, caseId: string): Promise<Set<string> | null> {
  try {
    const rows = await all<{ id: string }>(
      db,
      `SELECT v.id FROM document_versions v
       JOIN operation_document_requirements r ON r.id = v.requirement_id
       WHERE r.case_id = ? AND v.archived_at IS NOT NULL`,
      caseId,
    );
    return new Set(rows.map((row) => row.id));
  } catch (error) {
    if (isMissingArchiveColumn(error)) return null;
    throw error;
  }
}

export async function retireReplacedVersions(db: D1Database, bucket: R2Bucket, requirementId: string, keepVersionId: string) {
  let older: Array<{ id: string; r2_key: string; review_state: string }>;
  try {
    older = await all(
      db,
      `SELECT id, r2_key, review_state FROM document_versions
       WHERE requirement_id = ? AND id != ? AND archived_at IS NULL`,
      requirementId,
      keepVersionId,
    );
  } catch (error) {
    if (isMissingArchiveColumn(error)) return;
    throw error;
  }
  const now = nowIso();
  for (const row of older) {
    const review = await one<{ id: string }>(db, "SELECT id FROM document_reviews WHERE version_id = ?", row.id);
    const share = await customerDecision(db, row.id);
    if (!review && row.review_state === "UPLOADED" && !share) {
      const removed = await db
        .prepare(
          `DELETE FROM document_versions
            WHERE id = ? AND review_state = 'UPLOADED'
              AND NOT EXISTS (SELECT 1 FROM document_reviews WHERE version_id = ?)`,
        )
        .bind(row.id, row.id)
        .run();
      if ((removed.meta?.changes ?? 0) === 1) {
        try {
          await bucket.delete(row.r2_key);
        } catch {
          /* The row is already gone. */
        }
        continue;
      }
    }
    await db.prepare("UPDATE document_versions SET archived_at = ? WHERE id = ? AND archived_at IS NULL").bind(now, row.id).run();
    try {
      await db
        .prepare("UPDATE customer_file_shares SET unpublished_at = COALESCE(unpublished_at, ?), updated_at = ? WHERE version_id = ?")
        .bind(now, now, row.id)
        .run();
    } catch (error) {
      if (!isMissingShareTable(error)) throw error;
    }
  }
}

export async function hideApprovedFileFromCustomer(db: D1Database, actor: Actor, env: Env, requirementId: string, requestId: string) {
  requirePermission(actor, "documents.review");
  const requirement = await one<{ id: string; case_id: string; status: DocumentRequirementStatus }>(
    db,
    "SELECT id, case_id, status FROM operation_document_requirements WHERE id = ?",
    requirementId,
  );
  if (!requirement) throw errors.notFound("Requirement not found");
  await assertCaseAccess(db, actor, requirement.case_id);
  if (requirement.status !== "APPROVED") {
    throw errors.validation("Only an approved file can be taken off the customer page.");
  }
  assertDocumentTransition(requirement.status, "UPLOADED");
  const now = nowIso();
  const saved = await db
    .prepare("UPDATE operation_document_requirements SET status = 'UPLOADED', updated_at = ? WHERE id = ? AND status = 'APPROVED'")
    .bind(now, requirementId)
    .run();
  if ((saved.meta?.changes ?? 0) !== 1) {
    throw errors.conflict("The document changed. Reload it and try again.", "DOCUMENT_CHANGED");
  }
  await writeCaseEvent(db, requirement.case_id, "DOCUMENT_REVIEW", "File hidden from the customer until it is approved again", actor.id);
  await writeAudit(db, {
    actorId: actor.id,
    entityType: "document_requirement",
    entityId: requirementId,
    action: "customer_file.hide",
    requestId,
  });
  await recomputeRemindersForCase(db, env, requirement.case_id);
  return { status: "UPLOADED" as const };
}

export async function deleteUnreviewedVersion(db: D1Database, bucket: R2Bucket, actor: Actor, env: Env, versionId: string, requestId: string) {
  requirePermission(actor, "documents.upload");
  const version = await one<{
    id: string;
    requirement_id: string;
    case_id: string;
    version: number;
    review_state: string;
    r2_key: string;
    status: DocumentRequirementStatus;
  }>(
    db,
    `SELECT v.id, v.requirement_id, v.version, v.review_state, v.r2_key, r.case_id, r.status
     FROM document_versions v
     JOIN operation_document_requirements r ON r.id = v.requirement_id
     WHERE v.id = ?`,
    versionId,
  );
  if (!version) throw errors.notFound("File not found");
  await assertCaseAccess(db, actor, version.case_id);
  const latest = await one<{ version: number }>(
    db,
    "SELECT MAX(version) AS version FROM document_versions WHERE requirement_id = ?",
    version.requirement_id,
  );
  if ((latest?.version ?? 0) !== version.version) {
    throw errors.validation("Only the latest unreviewed file can be deleted.");
  }
  if (version.review_state !== "UPLOADED" || version.status === "APPROVED") {
    throw errors.conflict("A reviewed file stays in the record. Upload a replacement instead of deleting it.", "VERSION_HAS_REVIEW");
  }
  const review = await one<{ id: string }>(db, "SELECT id FROM document_reviews WHERE version_id = ?", versionId);
  if (review) {
    throw errors.conflict("A reviewed file stays in the record. Upload a replacement instead of deleting it.", "VERSION_HAS_REVIEW");
  }
  const shares = await customerSharesForCase(db, version.case_id);
  const share = shares.rows.find((row) => row.version_id === versionId);
  if (share?.decision) {
    throw errors.conflict("The customer already answered this file. Upload a replacement instead of deleting it.", "VERSION_HAS_REVIEW");
  }
  const removed = await db
    .prepare(
      `DELETE FROM document_versions
        WHERE id = ? AND review_state = 'UPLOADED'
          AND NOT EXISTS (SELECT 1 FROM document_reviews WHERE version_id = ?)`,
    )
    .bind(versionId, versionId)
    .run();
  if ((removed.meta?.changes ?? 0) !== 1) {
    throw errors.conflict("The file changed while it was being deleted. Reload it and try again.", "DOCUMENT_CHANGED");
  }
  try {
    await bucket.delete(version.r2_key);
  } catch {
    /* The row is already gone. A leftover object is not shown to the customer. */
  }
  const remaining = await one<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM document_versions WHERE requirement_id = ?",
    version.requirement_id,
  );
  if ((remaining?.n ?? 0) === 0 && version.status === "UPLOADED") {
    assertDocumentTransition(version.status, "MISSING");
    await db
      .prepare("UPDATE operation_document_requirements SET status = 'MISSING', updated_at = ? WHERE id = ? AND status = 'UPLOADED'")
      .bind(nowIso(), version.requirement_id)
      .run();
  }
  await writeAudit(db, {
    actorId: actor.id,
    entityType: "document_version",
    entityId: versionId,
    action: "customer_file.delete",
    requestId,
  });
  await recomputeRemindersForCase(db, env, version.case_id);
  return { deleted: true };
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
  if (await ensureCustomerShare(db, versionId, link.case_id, now)) {
    await db
      .prepare(
        `UPDATE customer_file_shares
            SET first_viewed_at = COALESCE(first_viewed_at, ?),
                last_viewed_at = ?,
                view_count = view_count + 1,
                link_id = COALESCE(link_id, ?),
                updated_at = ?
          WHERE version_id = ?`,
      )
      .bind(now, now, link.id, now, versionId)
      .run();
  }
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
  if (!(await ensureCustomerShare(db, versionId, link.case_id, now))) {
    throw errors.coded(503, "SCHEMA_UPGRADE_REQUIRED", "This deployment is waiting for a database upgrade. No change was saved.");
  }
  const current = await shareDecisionState(db, versionId);
  if (current.decision === "ACCEPTED" && current.revisionOpen !== 1) {
    throw errors.conflict("This file is closed after your approval. The company can open it again.", "CUSTOMER_REVIEW_CLOSED");
  }
  const saved = await saveCustomerDecision(db, {
    decision: normalized.decision,
    comment: normalized.comment,
    now,
    linkId: link.id,
    versionId,
    caseId: link.case_id,
  });
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
  const sql = `SELECT v.r2_key, v.original_name, v.content_type
     FROM document_versions v
     JOIN operation_document_requirements r ON r.id = v.requirement_id
     JOIN customer_file_shares s ON s.version_id = v.id AND s.unpublished_at IS NULL
     WHERE v.id = ? AND r.case_id = ?
       AND v.archived_at IS NULL
       AND v.version = (
         SELECT MAX(version) FROM document_versions
         WHERE requirement_id = r.id AND archived_at IS NULL
       )`;
  const fallback = `SELECT v.r2_key, v.original_name, v.content_type
     FROM document_versions v
     JOIN operation_document_requirements r ON r.id = v.requirement_id
     JOIN customer_file_shares s ON s.version_id = v.id AND s.unpublished_at IS NULL
     WHERE v.id = ? AND r.case_id = ?
       AND v.version = (SELECT MAX(version) FROM document_versions WHERE requirement_id = r.id)`;
  try {
    return await one<{ r2_key: string; original_name: string; content_type: string }>(db, sql, versionId, caseId);
  } catch (error) {
    if (!isMissingArchiveColumn(error)) throw error;
    return one<{ r2_key: string; original_name: string; content_type: string }>(db, fallback, versionId, caseId);
  }
}

async function visibleFiles(db: D1Database, caseId: string) {
  try {
    return await all<{
      requirement_id: string;
      version_id: string;
      original_name: string;
      byte_size: number;
      version: number;
      name_en: string;
      name_ar: string;
    }>(db, VISIBLE_FILE_SQL, caseId);
  } catch (error) {
    if (isMissingShareTable(error)) return [];
    if (!isMissingArchiveColumn(error)) throw error;
    try {
      return await all<{
        requirement_id: string;
        version_id: string;
        original_name: string;
        byte_size: number;
        version: number;
        name_en: string;
        name_ar: string;
      }>(db, VISIBLE_FILE_SQL_WITHOUT_ARCHIVE, caseId);
    } catch (inner) {
      if (isMissingShareTable(inner)) return [];
      throw inner;
    }
  }
}

async function customerDecision(db: D1Database, versionId: string) {
  try {
    const row = await one<{ decision: string | null }>(db, "SELECT decision FROM customer_file_shares WHERE version_id = ?", versionId);
    return row?.decision ?? null;
  } catch (error) {
    if (isMissingShareTable(error)) return null;
    throw error;
  }
}

async function ensureCustomerShare(db: D1Database, versionId: string, caseId: string, now: string) {
  try {
    await db
      .prepare(
        `INSERT INTO customer_file_shares (
           id, version_id, case_id, published_at, published_by, unpublished_at, view_count, created_at, updated_at
         ) VALUES (?, ?, ?, ?, NULL, NULL, 0, ?, ?)
         ON CONFLICT(version_id) DO NOTHING`,
      )
      .bind(newId(), versionId, caseId, now, now, now)
      .run();
    return true;
  } catch (error) {
    if (isMissingShareTable(error)) return false;
    throw error;
  }
}

async function shareDecisionState(db: D1Database, versionId: string) {
  try {
    const row = await one<{ decision: string | null; revision_open: number | null }>(
      db,
      "SELECT decision, revision_open FROM customer_file_shares WHERE version_id = ?",
      versionId,
    );
    return { decision: row?.decision ?? null, revisionOpen: row?.revision_open ?? 0 };
  } catch (error) {
    if (!isMissingRevisionColumn(error) && !isMissingShareTable(error)) throw error;
    return { decision: await customerDecision(db, versionId), revisionOpen: 0 };
  }
}

async function saveCustomerDecision(
  db: D1Database,
  input: { decision: "ACCEPTED" | "CHANGES_REQUESTED"; comment: string | null; now: string; linkId: string; versionId: string; caseId: string },
) {
  const revisionOpen = input.decision === "ACCEPTED" ? 0 : 1;
  try {
    return await db
      .prepare(
        `UPDATE customer_file_shares
            SET decision = ?, comment = ?, decided_at = ?, link_id = ?, revision_open = ?, updated_at = ?
          WHERE version_id = ? AND case_id = ?`,
      )
      .bind(input.decision, input.comment, input.now, input.linkId, revisionOpen, input.now, input.versionId, input.caseId)
      .run();
  } catch (error) {
    if (!isMissingRevisionColumn(error)) throw error;
    return db
      .prepare(
        `UPDATE customer_file_shares
            SET decision = ?, comment = ?, decided_at = ?, link_id = ?, updated_at = ?
          WHERE version_id = ? AND case_id = ?`,
      )
      .bind(input.decision, input.comment, input.now, input.linkId, input.now, input.versionId, input.caseId)
      .run();
  }
}

function isMissingShareTable(error: unknown) {
  const text = errorText(error);
  return /no such table/i.test(text) && /customer_file_shares/i.test(text);
}

function isMissingRevisionColumn(error: unknown) {
  const text = errorText(error);
  return /no such column/i.test(text) && /revision_open/i.test(text);
}

function isMissingArchiveColumn(error: unknown) {
  const text = errorText(error);
  return /no such column/i.test(text) && /archived_at/i.test(text);
}

function errorText(error: unknown) {
  return error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
}
