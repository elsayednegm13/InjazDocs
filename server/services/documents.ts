import type { DocumentRequirementStatus, DocumentRoute } from "../../shared/enums";
import { DOCUMENT_READY_STATUSES } from "../domain/reminders";
import { assertDocumentTransition, assertRouteChange, initialRouteStatus } from "../domain/transitions";
import { all, newId, nowIso, one } from "../db/sql";
import { errors } from "../http/errors";
import type { Actor } from "./actor";
import { assertCaseAccess, requirePermission } from "./actor";
import { writeAudit, writeCaseEvent } from "./audit";
import { recomputeRemindersForCase } from "./reminders";

export async function applyTemplateToCase(db: D1Database, caseId: string, templateId?: string) {
  const template = templateId
    ? await one<{ id: string }>(db, "SELECT id FROM document_template_sets WHERE id = ?", templateId)
    : await one<{ id: string }>(db, "SELECT id FROM document_template_sets WHERE is_default = 1 LIMIT 1");
  if (!template) return;
  const items = await all<{ document_type_id: string; required: number }>(
    db,
    "SELECT document_type_id, required FROM document_template_items WHERE template_id = ?",
    template.id,
  );
  const now = nowIso();
  for (const item of items) {
    await db
      .prepare(
        `INSERT INTO operation_document_requirements (id, case_id, document_type_id, required, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'MISSING', ?, ?)`,
      )
      .bind(newId(), caseId, item.document_type_id, item.required, now, now)
      .run();
  }
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

export async function removeRequirement(db: D1Database, actor: Actor, env: Env, requirementId: string, requestId: string) {
  const req = await one<{ id: string; case_id: string }>(
    db,
    "SELECT id, case_id FROM operation_document_requirements WHERE id = ?",
    requirementId,
  );
  if (!req) throw errors.notFound("Requirement not found");
  requirePermission(actor, "documents.upload");
  await assertCaseAccess(db, actor, req.case_id);
  await db.prepare("DELETE FROM operation_document_requirements WHERE id = ?").bind(requirementId).run();
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
  const owned = await one(
    db,
    `SELECT id FROM upload_sessions
     WHERE object_key = ? AND owner_user_id = ? AND parent_type = 'document_requirement' AND parent_id = ? AND state = 'COMPLETED'`,
    input.r2Key,
    actor.id,
    requirementId,
  );
  if (!owned) throw errors.notFound("Upload is not a completed session for this document");
  const nextStatus: DocumentRequirementStatus = req.status === "NEEDS_CORRECTION" || req.status === "MISSING" || req.status === "UPLOADED"
    ? "UPLOADED"
    : req.status;
  if (req.status !== nextStatus) assertDocumentTransition(req.status, nextStatus);
  const last = await one<{ version: number }>(
    db,
    "SELECT MAX(version) AS version FROM document_versions WHERE requirement_id = ?",
    requirementId,
  );
  const version = (last?.version ?? 0) + 1;
  const id = newId();
  await db
    .prepare(
      `INSERT INTO document_versions (id, requirement_id, version, r2_key, original_name, content_type, byte_size, checksum, uploaded_by, review_state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'UPLOADED', ?)`,
    )
    .bind(id, requirementId, version, input.r2Key, input.originalName, input.contentType, input.byteSize, input.checksum ?? null, actor.id, nowIso())
    .run();
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
  requirePermission(actor, input.decision === "WAIVED" ? "documents.review" : "documents.review");
  const req = await one<{ id: string; case_id: string; status: DocumentRequirementStatus }>(
    db,
    "SELECT id, case_id, status FROM operation_document_requirements WHERE id = ?",
    requirementId,
  );
  if (!req) throw errors.notFound("Requirement not found");
  await assertCaseAccess(db, actor, req.case_id);
  assertDocumentTransition(req.status, input.decision);
  if (input.decision === "WAIVED" && !input.reason) throw errors.validation("Waiver requires a reason");
  await db
    .prepare("UPDATE operation_document_requirements SET status = ?, waived_reason = ?, updated_at = ? WHERE id = ?")
    .bind(input.decision, input.decision === "WAIVED" ? input.reason ?? null : null, nowIso(), requirementId)
    .run();
  const latest = await one<{ id: string }>(
    db,
    "SELECT id FROM document_versions WHERE requirement_id = ? ORDER BY version DESC LIMIT 1",
    requirementId,
  );
  if (latest) {
    await db
      .prepare("INSERT INTO document_reviews (id, version_id, reviewer_id, decision, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(newId(), latest.id, actor.id, input.decision, input.comment ?? null, nowIso())
      .run();
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
