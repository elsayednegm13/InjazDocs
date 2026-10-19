import { CUSTOM_FIELD_TARGETS, type CustomFieldTarget } from "../../shared/enums";
import type { PermissionKey } from "../../shared/permissions";
import { customFieldsRequiredNow, normalizeCustomFieldOptions, serializeCustomFieldValue, validateRequiredCustomFields, type CustomFieldDataType, type CustomFieldDefinition } from "../domain/custom-fields";
import { all, newId, nowIso, one } from "../db/sql";
import { errors } from "../http/errors";
import type { Actor } from "./actor";
import { assertCaseAccess, requireAny, requirePermission } from "./actor";
import { writeAudit } from "./audit";

const CUSTOM_FIELD_TYPES: CustomFieldDataType[] = ["TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT"];

function targetIsSupported(target: string): target is CustomFieldTarget {
  return (CUSTOM_FIELD_TARGETS as readonly string[]).includes(target);
}

export function authorizeCustomFieldCatalog(actor: Actor, targetEntity: string) {
  if (!targetIsSupported(targetEntity)) {
    throw errors.validation("Choose a supported entity.", { targetEntity: "CUSTOM_FIELD_TARGET" }, "CUSTOM_FIELD_TARGET_INVALID");
  }
  if (targetEntity === "CUSTOMER") requirePermission(actor, "customers.view");
  else if (targetEntity === "EXPORT_CASE") requireAny(actor, ["export_cases.view_all", "export_cases.view_assigned"]);
  else if (targetEntity === "INVOICE") requirePermission(actor, "invoices.view");
  else if (targetEntity === "BOOKING") requirePermission(actor, "bookings.view");
  else requirePermission(actor, "containers.view");
}

export async function listCustomFieldDefinitions(db: D1Database, targetEntity?: string) {
  const where = targetEntity ? "WHERE target_entity = ?" : "";
  return all<CustomFieldDefinition>(db, `SELECT * FROM custom_field_definitions ${where} ORDER BY position, created_at`, ...(targetEntity ? [targetEntity] : []));
}

export async function listAvailableCustomFieldDefinitions(db: D1Database, actor: Actor, targetEntity: string) {
  authorizeCustomFieldCatalog(actor, targetEntity);
  const definitions = await definitionsFor(db, targetEntity);
  const canSeeSensitive = actor.permissions.has("settings.manage");
  return definitions.map((definition) => {
    const redacted = definition.sensitive === 1 && !canSeeSensitive;
    return {
      id: definition.id,
      fieldKey: definition.field_key,
      labelEn: definition.label_en,
      labelAr: definition.label_ar,
      dataType: definition.data_type,
      required: Boolean(definition.required),
      sensitive: Boolean(definition.sensitive),
      redacted,
      options: redacted ? [] : normalizeCustomFieldOptions(definition),
      position: definition.position,
    };
  });
}

function collectCustomFieldWrites(actor: Actor, definitions: CustomFieldDefinition[], values: Record<string, unknown>) {
  const writes: Array<{ definition: CustomFieldDefinition; serialized: string | null }> = [];
  for (const definition of definitions) {
    if (!(definition.field_key in values)) continue;
    if (definition.sensitive && !actor.permissions.has("settings.manage")) requirePermission(actor, "settings.manage");
    writes.push({ definition, serialized: serializeCustomFieldValue(definition, values[definition.field_key]) });
  }
  return writes;
}

export function customFieldWriteStatements(
  db: D1Database,
  targetEntity: string,
  entityId: string,
  writes: Array<{ definition: { id: string }; serialized: string | null }>,
  guard?: { invoiceId: string; version: number },
) {
  return writes.map((write) => {
    if (write.serialized === null) {
      if (!guard) {
        return db.prepare("DELETE FROM custom_field_values WHERE definition_id = ? AND entity_id = ? AND entity_type = ?").bind(write.definition.id, entityId, targetEntity);
      }
      return db
        .prepare("DELETE FROM custom_field_values WHERE definition_id = ? AND entity_id = ? AND entity_type = ? AND (SELECT version FROM export_invoices WHERE id = ?) = ?")
        .bind(write.definition.id, entityId, targetEntity, guard.invoiceId, guard.version);
    }
    if (!guard) {
      return db
        .prepare(
          `INSERT INTO custom_field_values (id, definition_id, entity_type, entity_id, value_text)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(definition_id, entity_id) DO UPDATE SET value_text = excluded.value_text, entity_type = excluded.entity_type`,
        )
        .bind(newId(), write.definition.id, targetEntity, entityId, write.serialized);
    }
    return db
      .prepare(
        `INSERT INTO custom_field_values (id, definition_id, entity_type, entity_id, value_text)
         SELECT ?, ?, ?, ?, ?
         WHERE (SELECT version FROM export_invoices WHERE id = ?) = ?
         ON CONFLICT(definition_id, entity_id) DO UPDATE SET value_text = excluded.value_text, entity_type = excluded.entity_type`,
      )
      .bind(newId(), write.definition.id, targetEntity, entityId, write.serialized, guard.invoiceId, guard.version);
  });
}

export async function invoiceCustomFieldStatements(
  db: D1Database,
  actor: Actor,
  invoiceId: string,
  input: Record<string, unknown> | undefined,
  expectedVersion: number,
) {
  if (!input) return [];
  const definitions = await definitionsFor(db, "INVOICE");
  const unknown = Object.keys(input).find((key) => !definitions.some((definition) => definition.field_key === key));
  if (unknown) throw errors.validation("Custom field is not defined or is inactive.", { [unknown]: "CUSTOM_FIELD_UNAVAILABLE" }, "CUSTOM_FIELD_UNAVAILABLE");
  validateRequiredCustomFields(definitions, input);
  return customFieldWriteStatements(db, "INVOICE", invoiceId, collectCustomFieldWrites(actor, definitions, input), {
    invoiceId,
    version: expectedVersion,
  });
}

async function definitionsFor(db: D1Database, targetEntity: string, includeInactive = false) {
  return all<CustomFieldDefinition>(
    db,
    `SELECT * FROM custom_field_definitions WHERE target_entity = ? ${includeInactive ? "" : "AND active = 1"} ORDER BY position, created_at`,
    targetEntity,
  );
}

export async function readCustomFields(db: D1Database, actor: Actor, targetEntity: string, entityId: string) {
  const definitions = await definitionsFor(db, targetEntity, true);
  const values = await all<{ field_key: string; value_text: string | null }>(
    db,
    `SELECT d.field_key, v.value_text
     FROM custom_field_definitions d
     LEFT JOIN custom_field_values v ON v.definition_id = d.id AND v.entity_id = ? AND v.entity_type = ?
     WHERE d.target_entity = ?
     ORDER BY d.position, d.created_at`,
    entityId,
    targetEntity,
    targetEntity,
  );
  const byKey = new Map(values.map((value) => [value.field_key, value.value_text]));
  const canSeeSensitive = actor.permissions.has("settings.manage");
  return definitions
    .filter((definition) => definition.active === 1 || (byKey.get(definition.field_key) ?? "") !== "")
    .map((definition) => {
      const redacted = definition.sensitive === 1 && !canSeeSensitive;
      const stored = byKey.get(definition.field_key) ?? null;
      return {
        id: definition.id,
        key: definition.field_key,
        labelEn: definition.label_en,
        labelAr: definition.label_ar,
        dataType: definition.data_type,
        required: Boolean(definition.required),
        sensitive: Boolean(definition.sensitive),
        active: definition.active === 1,
        redacted,
        options: redacted ? [] : normalizeCustomFieldOptions(definition),
        value: redacted ? null : stored,
      };
    });
}

export async function saveCustomFields(
  db: D1Database,
  actor: Actor,
  targetEntity: string,
  entityId: string,
  input: Record<string, unknown> | undefined,
  options: { enforceRequired?: boolean; requestId?: string } = {},
) {
  if (!targetIsSupported(targetEntity)) throw errors.validation("Choose a supported entity.", { targetEntity: "CUSTOM_FIELD_TARGET" }, "CUSTOM_FIELD_TARGET_INVALID");
  if (input === undefined) {
    if (options.enforceRequired) await assertRequiredCustomFields(db, targetEntity, entityId);
    return;
  }
  const definitions = await definitionsFor(db, targetEntity);
  const values = input;
  const keys = Object.keys(values);
  const knownKeys = new Set(definitions.map((definition) => definition.field_key));
  const unknown = keys.find((key) => !knownKeys.has(key));
  if (unknown) throw errors.validation("Custom field is not defined or is inactive.", { [unknown]: "CUSTOM_FIELD_UNAVAILABLE" }, "CUSTOM_FIELD_UNAVAILABLE");
  if (options.enforceRequired) validateRequiredCustomFields(definitions, values);
  const writes = collectCustomFieldWrites(actor, definitions, values);
  const statements = customFieldWriteStatements(db, targetEntity, entityId, writes);
  if (statements.length) await db.batch(statements);
  if (writes.length && options.requestId) {
    await writeAudit(db, {
      actorId: actor.id,
      entityType: "custom_field",
      entityId,
      action: "custom_field.save",
      after: { targetEntity, keys: writes.map((write) => write.definition.field_key) },
      requestId: options.requestId,
    });
  }
}

export async function assertRequiredCustomFields(db: D1Database, targetEntity: string, entityId: string) {
  const definitions = await definitionsFor(db, targetEntity);
  const values = await all<{ field_key: string; value_text: string | null }>(
    db,
    `SELECT d.field_key, v.value_text
     FROM custom_field_definitions d
     LEFT JOIN custom_field_values v ON v.definition_id = d.id AND v.entity_id = ? AND v.entity_type = ?
     WHERE d.target_entity = ? AND d.active = 1`,
    entityId,
    targetEntity,
    targetEntity,
  );
  validateRequiredCustomFields(definitions, Object.fromEntries(values.map((value) => [value.field_key, value.value_text])));
}

export async function entityRequiresCustomFields(db: D1Database, targetEntity: string, entityId: string) {
  if (targetEntity === "EXPORT_CASE") {
    const row = await one<{ status: string }>(db, "SELECT status FROM export_cases WHERE id = ?", entityId);
    return customFieldsRequiredNow(targetEntity, row?.status);
  }
  if (targetEntity === "BOOKING") {
    const row = await one<{ status: string }>(db, "SELECT status FROM bookings WHERE id = ?", entityId);
    return customFieldsRequiredNow(targetEntity, row?.status);
  }
  if (targetEntity === "CONTAINER") {
    const row = await one<{ status: string }>(db, "SELECT status FROM containers WHERE id = ?", entityId);
    return customFieldsRequiredNow(targetEntity, row?.status);
  }
  return customFieldsRequiredNow(targetEntity);
}

export async function createCustomFieldDefinition(
  db: D1Database,
  actor: Actor,
  input: { targetEntity: string; fieldKey: string; labelEn: string; labelAr: string; dataType: string; required?: boolean; sensitive?: boolean; options?: string[] },
  requestId?: string,
) {
  requirePermission(actor, "settings.manage");
  if (!targetIsSupported(input.targetEntity)) throw errors.validation("Choose a supported entity.", { targetEntity: "CUSTOM_FIELD_TARGET" }, "CUSTOM_FIELD_TARGET_INVALID");
  if (!/^[a-z][a-z0-9_]{1,48}$/.test(input.fieldKey)) throw errors.validation("Field key is invalid.", { fieldKey: "CUSTOM_FIELD_KEY" }, "CUSTOM_FIELD_KEY_INVALID");
  if (!CUSTOM_FIELD_TYPES.includes(input.dataType as CustomFieldDataType)) throw errors.validation("Field type is invalid.", { dataType: "CUSTOM_FIELD_TYPE" }, "CUSTOM_FIELD_TYPE_INVALID");
  if (!input.labelEn?.trim() || !input.labelAr?.trim()) throw errors.validation("Labels are required.", { labelEn: "CUSTOM_FIELD_LABEL", labelAr: "CUSTOM_FIELD_LABEL" }, "CUSTOM_FIELD_LABEL_INVALID");
  const options = input.options ?? [];
  if (input.dataType === "SELECT" && (!options.length || options.some((option) => !option.trim()))) throw errors.validation("Select field options are required.", { options: "CUSTOM_FIELD_OPTIONS" }, "CUSTOM_FIELD_OPTIONS_INVALID");
  const duplicate = await one(db, "SELECT id FROM custom_field_definitions WHERE target_entity = ? AND field_key = ?", input.targetEntity, input.fieldKey);
  if (duplicate) throw errors.conflict("This field key already exists for the entity.", "CUSTOM_FIELD_DUPLICATE", { fieldKey: "CUSTOM_FIELD_DUPLICATE" });
  const id = newId();
  await db.prepare(
    `INSERT INTO custom_field_definitions (id, target_entity, field_key, label_en, label_ar, data_type, required, options_json, sensitive, active, position, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, COALESCE((SELECT MAX(position) + 1 FROM custom_field_definitions WHERE target_entity = ?), 0), ?)`,
  ).bind(id, input.targetEntity, input.fieldKey, input.labelEn.trim(), input.labelAr.trim(), input.dataType, input.required ? 1 : 0, JSON.stringify(input.dataType === "SELECT" ? options.map((option) => option.trim()) : []), input.sensitive ? 1 : 0, input.targetEntity, nowIso()).run();
  await writeAudit(db, { actorId: actor.id, entityType: "custom_field_definition", entityId: id, action: "custom_field.create", after: { targetEntity: input.targetEntity, fieldKey: input.fieldKey }, requestId });
  return { id };
}

export async function updateCustomFieldDefinition(
  db: D1Database,
  actor: Actor,
  id: string,
  input: { labelEn?: string; labelAr?: string; required?: boolean; sensitive?: boolean; active?: boolean; position?: number; options?: string[] },
  requestId?: string,
) {
  requirePermission(actor, "settings.manage");
  const existing = await one<CustomFieldDefinition>(db, "SELECT * FROM custom_field_definitions WHERE id = ?", id);
  if (!existing) throw errors.notFound("Custom field not found");
  const options = input.options ?? normalizeCustomFieldOptions(existing);
  if (existing.data_type === "SELECT" && !options.length) throw errors.validation("Select field options are required.", { options: "CUSTOM_FIELD_OPTIONS" }, "CUSTOM_FIELD_OPTIONS_INVALID");
  await db.prepare(
    `UPDATE custom_field_definitions
     SET label_en = ?, label_ar = ?, required = ?, options_json = ?, sensitive = ?, active = ?, position = ?
     WHERE id = ?`,
  ).bind(
    input.labelEn?.trim() || existing.label_en,
    input.labelAr?.trim() || existing.label_ar,
    input.required === undefined ? existing.required : input.required ? 1 : 0,
    JSON.stringify(existing.data_type === "SELECT" ? options : []),
    input.sensitive === undefined ? existing.sensitive : input.sensitive ? 1 : 0,
    input.active === undefined ? existing.active : input.active ? 1 : 0,
    input.position === undefined ? existing.position : Math.max(0, Math.floor(input.position)),
    id,
  ).run();
  await writeAudit(db, { actorId: actor.id, entityType: "custom_field_definition", entityId: id, action: "custom_field.update", after: { active: input.active, position: input.position }, requestId });
}

export async function assertCustomFieldEntityAccess(db: D1Database, actor: Actor, targetEntity: string, entityId: string, mode: "view" | "edit") {
  if (!targetIsSupported(targetEntity)) throw errors.validation("Choose a supported entity.", { targetEntity: "CUSTOM_FIELD_TARGET" }, "CUSTOM_FIELD_TARGET_INVALID");
  if (targetEntity === "CUSTOMER") {
    requirePermission(actor, mode === "edit" ? "customers.edit" : "customers.view");
    const customer = await one(db, "SELECT id FROM customers WHERE id = ?", entityId);
    if (!customer) throw errors.notFound("Customer not found");
    return;
  }
  if (targetEntity === "EXPORT_CASE") {
    if (mode === "edit") requirePermission(actor, "export_cases.edit");
    else requireAny(actor, ["export_cases.view_all", "export_cases.view_assigned"]);
  } else {
    requirePermission(actor, permissionFor(targetEntity, mode));
  }
  const caseId = await caseIdFor(db, targetEntity, entityId);
  await assertCaseAccess(db, actor, caseId);
}

function permissionFor(target: Exclude<CustomFieldTarget, "CUSTOMER" | "EXPORT_CASE">, mode: "view" | "edit"): PermissionKey {
  if (target === "INVOICE") return mode === "edit" ? "invoices.edit" : "invoices.view";
  if (target === "BOOKING") return mode === "edit" ? "bookings.manage" : "bookings.view";
  return mode === "edit" ? "containers.manage" : "containers.view";
}

async function caseIdFor(db: D1Database, target: CustomFieldTarget, entityId: string) {
  if (target === "EXPORT_CASE") return entityId;
  if (target === "INVOICE") {
    const row = await one<{ case_id: string }>(db, "SELECT case_id FROM export_invoices WHERE id = ?", entityId);
    if (!row) throw errors.notFound("Invoice not found");
    return row.case_id;
  }
  if (target === "BOOKING") {
    const row = await one<{ case_id: string }>(db, "SELECT case_id FROM bookings WHERE id = ?", entityId);
    if (!row) throw errors.notFound("Booking not found");
    return row.case_id;
  }
  const row = await one<{ case_id: string }>(db, "SELECT case_id FROM containers WHERE id = ?", entityId);
  if (!row) throw errors.notFound("Container not found");
  return row.case_id;
}
