import type { DocumentRequirementStatus, DocumentRoute } from "../../shared/enums";
import { DOCUMENT_READY_STATUSES } from "../domain/reminders";
import { assertDocumentTransition, assertRouteChange, initialRouteStatus } from "../domain/transitions";
import { all, newId, nowIso, one } from "../db/sql";
import { errors } from "../http/errors";
import type { Actor } from "./actor";
import { assertCaseAccess, requirePermission } from "./actor";
import { writeAudit, writeCaseEvent } from "./audit";
import { retireReplacedVersions } from "./customer-files";
import { recomputeRemindersForCase } from "./reminders";

/**
 * Builds the document requirement rows for a template without writing them, so
 * a case creation can add them to its own D1 batch.
 */
export async function templateRequirementStatements(
  db: D1Database,
  caseId: string,
  templateId?: string,
): Promise<D1PreparedStatement[]> {
  const template = templateId
    ? await one<{ id: string }>(db, "SELECT id FROM document_template_sets WHERE id = ?", templateId)
    : await one<{ id: string }>(db, "SELECT id FROM document_template_sets WHERE is_default = 1 LIMIT 1");
  if (!template) return [];
  const items = await all<{ document_type_id: string; required: number }>(
    db,
    "SELECT document_type_id, required FROM document_template_items WHERE template_id = ?",
    template.id,
  );
  const now = nowIso();
  return items.map((item) =>
    db
      .prepare(
        `INSERT INTO operation_document_requirements (id, case_id, document_type_id, required, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'MISSING', ?, ?)`,
      )
      .bind(newId(), caseId, item.document_type_id, item.required, now, now),
  );
}

export async function applyTemplateToCase(db: D1Database, caseId: string, templateId?: string) {
  const statements = await templateRequirementStatements(db, caseId, templateId);
  if (statements.length) await db.batch(statements);
}

export async function addRequirement(
  db: D1Database,
  actor: Actor,
  env: Env,
  caseId: string,
  input: { documentTypeId: string; required: boolean; dueDate?: string },
  requestId: string,
) {
  requirePermission(actor, "documents.upload");
  await assertCaseAccess(db, actor, caseId);
  const typeId = String(input.documentTypeId ?? "").trim();
  if (!typeId) {
    throw errors.validation("Choose a document type before adding it.", { documentTypeId: "Choose a document type." }, "DOCUMENT_TYPE_REQUIRED");
  }
  const type = await one<{ id: string }>(db, "SELECT id FROM document_type_definitions WHERE id = ? AND active = 1", typeId);
  if (!type) {
    throw errors.validation("Choose a document type before adding it.", { documentTypeId: "Choose a document type." }, "DOCUMENT_TYPE_REQUIRED");
  }
  const duplicate = await one<{ id: string }>(
    db,
    "SELECT id FROM operation_document_requirements WHERE case_id = ? AND document_type_id = ?",
    caseId,
    typeId,
  );
  if (duplicate) {
    throw errors.conflict("This document is already on the operation. Open it or upload a new version.", "DOCUMENT_ALREADY_EXISTS");
  }
  const now = nowIso();
  const id = newId();
  try {
    await db
      .prepare(
        `INSERT INTO operation_document_requirements (id, case_id, document_type_id, required, due_date, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'MISSING', ?, ?)`,
      )
      .bind(id, caseId, typeId, input.required ? 1 : 0, input.dueDate ?? null, now, now)
      .run();
  } catch (error) {
    if (error instanceof Error && /NOT NULL|CONSTRAINT/i.test(error.message)) {
      throw errors.validation("Choose a document type before adding it.", { documentTypeId: "Choose a document type." }, "DOCUMENT_TYPE_REQUIRED");
    }
    throw error;
  }
  await writeAudit(db, { actorId: actor.id, entityType: "document_requirement", entityId: id, action: "requirement.add", requestId });
  await recomputeRemindersForCase(db, env, caseId);
  return { id };
}

export async function restorePreviousDocument(db: D1Database, actor: Actor, caseId: string, documentId: string, requestId: string) {
  requirePermission(actor, "documents.restore_version");
  const requirement = await one<{ id: string; case_id: string }>(
    db,
    "SELECT id, case_id FROM operation_document_requirements WHERE id = ? AND case_id = ?",
    documentId,
    caseId,
  );
  if (!requirement) throw errors.notFound("Document not found");
  await assertCaseAccess(db, actor, requirement.case_id);
  let current: { id: string } | null;
  let previous: { id: string } | null;
  try {
    current = await one<{ id: string }>(
      db,
      `SELECT id FROM document_versions
       WHERE requirement_id = ? AND archived_at IS NULL
       ORDER BY version DESC LIMIT 1`,
      documentId,
    );
    previous = await one<{ id: string }>(
      db,
      `SELECT id FROM document_versions
       WHERE requirement_id = ? AND archived_at IS NOT NULL
       ORDER BY version DESC LIMIT 1`,
      documentId,
    );
  } catch (error) {
    if (isMissingArchiveColumn(error)) {
      throw errors.coded(503, "SCHEMA_UPGRADE_REQUIRED", "This deployment is waiting for a database upgrade. No change was saved.");
    }
    throw error;
  }
  if (!current) throw errors.validation("There is no current file to keep.");
  if (!previous) throw errors.validation("There is no previous version to restore.");
  const now = nowIso();
  const [swapped] = await db.batch([
    db
      .prepare(
        `UPDATE document_versions
            SET archived_at = CASE id WHEN ? THEN ? ELSE NULL END
          WHERE requirement_id = ?
            AND id IN (?, ?)
            AND ((id = ? AND archived_at IS NULL) OR (id = ? AND archived_at IS NOT NULL))
            AND EXISTS (
              SELECT 1 FROM document_versions
              WHERE id = ? AND requirement_id = ? AND archived_at IS NULL
            )
            AND EXISTS (
              SELECT 1 FROM document_versions
              WHERE id = ? AND requirement_id = ? AND archived_at IS NOT NULL
            )`,
      )
      .bind(current.id, now, documentId, current.id, previous.id, current.id, previous.id, current.id, documentId, previous.id, documentId),
  ]);
  if ((swapped?.meta?.changes ?? 0) !== 2) {
    throw errors.conflict("The document changed while the previous version was being restored. Reload it and try again.", "DOCUMENT_CHANGED");
  }
  await writeAudit(db, {
    actorId: actor.id,
    entityType: "document_requirement",
    entityId: documentId,
    action: "document.restore",
    after: { archivedVersionId: current.id, restoredVersionId: previous.id },
    requestId,
  });
  return { archivedVersionId: current.id, restoredVersionId: previous.id };
}

function isMissingArchiveColumn(error: unknown) {
  const text = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
  return /no such column/i.test(text) && /archived_at/i.test(text);
}

export async function removeRequirement(db: D1Database, actor: Actor, env: Env, requirementId: string, requestId: string) {
  const req = await one<{ id: string; case_id: string }>(
    db,
    "SELECT id, case_id FROM operation_document_requirements WHERE id = ?",
    requirementId,
  );
  if (!req) throw errors.notFound("Requirement not found");
  requirePermission(actor, "documents.upload");
  await assertCaseAccess(db, actor, req.case_id);
  // Fail-closed guard: never physically delete a requirement that already carries
  // uploaded document versions or review evidence. The check is part of the
  // DELETE statement itself so a concurrent attachVersion can never slip a
  // version in between a check and the delete. Physical destruction policy for
  // unused requirements remains OD-08 pending; until then this path rejects
  // deletion instead of cascading loss.
  const deleted = await db
    .prepare(
      `DELETE FROM operation_document_requirements
        WHERE id = ?
          AND NOT EXISTS (SELECT 1 FROM document_versions WHERE requirement_id = ?)
          AND NOT EXISTS (
            SELECT 1 FROM document_reviews r
            JOIN document_versions v ON v.id = r.version_id
            WHERE v.requirement_id = ?
          )`,
    )
    .bind(requirementId, requirementId, requirementId)
    .run();
  if ((deleted.meta.changes ?? 0) === 0) {
    const stillThere = await one<{ id: string }>(
      db,
      "SELECT id FROM operation_document_requirements WHERE id = ?",
      requirementId,
    );
    if (!stillThere) throw errors.notFound("Requirement not found");
    throw errors.conflict(
      "Cannot delete a document requirement that already has uploaded document versions or review history.",
      "REQUIREMENT_HAS_VERSIONS",
    );
  }
  await writeAudit(db, { actorId: actor.id, entityType: "document_requirement", entityId: requirementId, action: "requirement.remove", requestId });
  await recomputeRemindersForCase(db, env, req.case_id);
}

export async function attachVersion(
  db: D1Database,
  actor: Actor,
  env: Env,
  requirementId: string,
  input: { r2Key: string; originalName: string; contentType: string; byteSize: number; checksum?: string },
  requestId: string,
) {
  requirePermission(actor, "documents.upload");
  const req = await one<{ id: string; case_id: string; status: DocumentRequirementStatus }>(
    db,
    "SELECT id, case_id, status FROM operation_document_requirements WHERE id = ?",
    requirementId,
  );
  if (!req) throw errors.notFound("Requirement not found");
  await assertCaseAccess(db, actor, req.case_id);
  const owned = await one<{ id: string; filename: string; mime: string; expected_bytes: number }>(
    db,
    `SELECT id, filename, mime, expected_bytes FROM upload_sessions
     WHERE object_key = ? AND owner_user_id = ? AND parent_type = 'document_requirement' AND parent_id = ? AND state = 'COMPLETED'`,
    input.r2Key,
    actor.id,
    requirementId,
  );
  if (!owned) throw errors.notFound("Upload is not a completed session for this document");
  const nextStatus: DocumentRequirementStatus = "UPLOADED";
  // A newly attached file has not been reviewed. It must never inherit a
  // previous version's APPROVED / WAIVED / UNDER_REVIEW state, otherwise an
  // unreviewed upload would satisfy the "documents complete" gate.
  if (req.status !== nextStatus) assertDocumentTransition(req.status, nextStatus);
  // The upload session is the source of truth for name, MIME and size. Client
  // metadata is only a claim and must not be able to relabel a stored object.
  const id = newId();
  let version = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const last = await one<{ version: number }>(
      db,
      "SELECT MAX(version) AS version FROM document_versions WHERE requirement_id = ?",
      requirementId,
    );
    version = (last?.version ?? 0) + 1;
    try {
      await db
        .prepare(
          `INSERT INTO document_versions (id, requirement_id, version, r2_key, original_name, content_type, byte_size, checksum, uploaded_by, review_state, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'UPLOADED', ?)`,
        )
        .bind(id, requirementId, version, input.r2Key, owned.filename, owned.mime, owned.expected_bytes, input.checksum ?? null, actor.id, nowIso())
        .run();
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      version = 0;
      if (attempt === 2 || !/UNIQUE constraint failed: document_versions\.requirement_id, document_versions\.version/i.test(message)) {
        throw error;
      }
    }
  }
  if (!version) throw errors.conflict("Another version was uploaded at the same time. Try again.", "DOCUMENT_VERSION_BUSY");
  await retireReplacedVersions(db, env.DOCUMENTS, requirementId, id);
  await db
    .prepare("UPDATE operation_document_requirements SET status = ?, updated_at = ? WHERE id = ?")
    .bind(nextStatus, nowIso(), requirementId)
    .run();
  await writeCaseEvent(db, req.case_id, "DOCUMENT_UPLOADED", `Version ${version} uploaded`, actor.id);
  await writeAudit(db, { actorId: actor.id, entityType: "document_version", entityId: id, action: "document.upload", requestId });
  await recomputeRemindersForCase(db, env, req.case_id);
  return { id, version };
}

export async function reviewDocument(
  db: D1Database,
  actor: Actor,
  env: Env,
  requirementId: string,
  input: { decision: "APPROVED" | "NEEDS_CORRECTION" | "UNDER_REVIEW" | "WAIVED"; comment?: string; reason?: string },
  requestId: string,
) {
  requirePermission(actor, "documents.review");
  const req = await one<{ id: string; case_id: string; status: DocumentRequirementStatus }>(
    db,
    "SELECT id, case_id, status FROM operation_document_requirements WHERE id = ?",
    requirementId,
  );
  if (!req) throw errors.notFound("Requirement not found");
  await assertCaseAccess(db, actor, req.case_id);
  assertDocumentTransition(req.status, input.decision);
  if (input.decision === "WAIVED" && !input.reason) throw errors.validation("Waiver requires a reason");
  // The requirement already carries this decision. Repeating it would create a
  // second review row for the same version, so the request is a no-op.
  if (req.status === input.decision) return;
  // The decision belongs to the latest version as well as the requirement.
  // Both writes and the review row are one batch so the requirement status,
  // the review history and document_versions.review_state cannot diverge if a
  // write fails. WAIVED is a requirement-level decision: an existing version
  // keeps its own last review state instead of being relabelled as waived.
  const latest = await one<{ id: string; version: number }>(
    db,
    "SELECT id, version FROM document_versions WHERE requirement_id = ? ORDER BY version DESC LIMIT 1",
    requirementId,
  );
  const now = nowIso();
  // The batch is the guard, not the read above: a review reads the requirement
  // and the latest version, then writes. Because another request can attach a
  // version inside that window, every write re-checks that the requirement is
  // still in the state that was reviewed AND that no newer version exists.
  // Both predicates are evaluated by the write itself, so an approval can never
  // land on a requirement whose latest file was never reviewed. A false guard
  // changes no row, and the caller then returns 409 without side effects.
  const noNewerVersion = "AND NOT EXISTS (SELECT 1 FROM document_versions v2 WHERE v2.requirement_id = ? AND v2.version > ?)";
  const guardBinds = latest ? [requirementId, latest.version] : [];
  const statements = [
    db
      .prepare(
        `UPDATE operation_document_requirements
            SET status = ?, waived_reason = ?, updated_at = ?
          WHERE id = ? AND status = ? ${latest ? noNewerVersion : ""}`,
      )
      .bind(
        input.decision,
        input.decision === "WAIVED" ? input.reason ?? null : null,
        now,
        requirementId,
        req.status,
        ...guardBinds,
      ),
  ];
  if (latest) {
    statements.push(
      db
        .prepare(
          `INSERT INTO document_reviews (id, version_id, reviewer_id, decision, comment, created_at)
           SELECT ?, ?, ?, ?, ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM document_versions v2 WHERE v2.requirement_id = ? AND v2.version > ?)`,
        )
        .bind(newId(), latest.id, actor.id, input.decision, input.comment ?? null, now, ...guardBinds),
    );
    if (input.decision !== "WAIVED") {
      statements.push(
        db
          .prepare(
            `UPDATE document_versions SET review_state = ?
              WHERE id = ? ${noNewerVersion}`,
          )
          .bind(input.decision, latest.id, ...guardBinds),
      );
    }
  }
  const batch = await db.batch(statements);
  const requirementChanged = (batch[0]?.meta?.changes ?? 0) === 1;
  const reviewRecorded = !latest || (batch[1]?.meta?.changes ?? 0) === 1;
  if (!requirementChanged || !reviewRecorded) {
    throw errors.conflict(
      "The document changed while the review was being saved. Reload it and review the latest version.",
      "DOCUMENT_CHANGED",
    );
  }
  await writeCaseEvent(db, req.case_id, "DOCUMENT_REVIEW", `Document ${input.decision}`, actor.id);
  await writeAudit(db, { actorId: actor.id, entityType: "document_requirement", entityId: requirementId, action: "document.review", after: input, requestId });
  await recomputeRemindersForCase(db, env, req.case_id);
}

export async function changeDocumentRoute(
  db: D1Database,
  actor: Actor,
  env: Env,
  caseId: string,
  to: DocumentRoute,
  requestId: string,
) {
  requirePermission(actor, "export_cases.edit");
  const current = await assertCaseAccess(db, actor, caseId);
  assertRouteChange(current.document_route as DocumentRoute, to, current.bank_path_status as never);
  // Re-selecting the route that is already active must not reset the path
  // status or write a second route event.
  if ((current.document_route as DocumentRoute) === to) return;
  const next = initialRouteStatus(to);
  await db
    .prepare("UPDATE export_cases SET document_route = ?, bank_path_status = ?, direct_path_status = ?, version = version + 1, updated_at = ? WHERE id = ?")
    .bind(to, next.bank, next.direct, nowIso(), caseId)
    .run();
  await writeCaseEvent(db, caseId, "ROUTE_CHANGED", `Document route → ${to}`, actor.id);
  await writeAudit(db, { actorId: actor.id, entityType: "export_case", entityId: caseId, action: "case.route", after: { to }, requestId });
  await recomputeRemindersForCase(db, env, caseId);
}

export function requiredDocumentsReady(requirements: { required: number; status: string }[]): boolean {
  return requirements.filter((r) => r.required).every((r) => DOCUMENT_READY_STATUSES.has(r.status));
}

export async function listDocumentTypes(db: D1Database) {
  return all(db, "SELECT * FROM document_type_definitions WHERE active = 1 ORDER BY name_en");
}

export async function listTemplates(db: D1Database) {
  const sets = await all<{ id: string; name_en: string; name_ar: string; is_default: number }>(
    db,
    "SELECT id, name_en, name_ar, is_default FROM document_template_sets",
  );
  const result = [];
  for (const set of sets) {
    const items = await all(
      db,
      `SELECT i.id, i.document_type_id, i.required, t.name_en, t.name_ar
       FROM document_template_items i JOIN document_type_definitions t ON t.id = i.document_type_id
       WHERE i.template_id = ?`,
      set.id,
    );
    result.push({ ...set, items });
  }
  return result;
}
