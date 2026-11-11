import type { PermissionKey } from "../../shared/permissions";
import { one } from "../db/sql";
import { errors } from "../http/errors";
import type { Actor } from "./actor";
import { assertCaseAccess, requireAny, requirePermission } from "./actor";

/**
 * Current-authorization policy for idempotent replays.
 *
 * The cached response is never returned just because it was a 2xx in the past.
 * Each replay is re-authorized against the current actor, the current route
 * permission and the current case scope. An unmapped route fails closed: the
 * witness remains, but no cached body is disclosed and the handler is not run.
 *
 * This map is deliberately explicit. Adding a new mutation route without a
 * policy entry makes its replay fail closed rather than silently bypassing
 * authorization.
 */
type CaseResolver = (db: D1Database, path: string, body: string) => Promise<string>;

type ReplayRule = {
  method: string;
  path: RegExp;
  permission?: PermissionKey;
  anyOf?: PermissionKey[];
  rootOnly?: boolean;
  caseResolver?: CaseResolver;
  extra?: (db: D1Database, actor: Actor, path: string, body: string) => Promise<void>;
};

function pathId(path: string, prefix: RegExp): string {
  const match = path.match(prefix);
  return match?.[1] ?? "";
}

async function caseIdFromTable(db: D1Database, table: string, id: string): Promise<string> {
  const row = await one<{ case_id: string }>(db, `SELECT case_id FROM ${table} WHERE id = ?`, id);
  if (!row) throw errors.notFound();
  return row.case_id;
}

const caseFromExportCase: CaseResolver = async (_db, path) => pathId(path, /\/export-cases\/([^/]+)/);
const caseFromInvoice: CaseResolver = async (db, path) => caseIdFromTable(db, "export_invoices", pathId(path, /\/invoices\/([^/]+)/));
const caseFromRequirement: CaseResolver = async (db, path) =>
  caseIdFromTable(db, "operation_document_requirements", pathId(path, /\/document-requirements\/([^/]+)/));
const caseFromRestore: CaseResolver = async (db, path) => {
  const documentId = pathId(path, /\/document-requirements\/([^/]+)/);
  const caseId = pathId(path, /\/export-cases\/([^/]+)/);
  const row = await one<{ case_id: string }>(db, "SELECT case_id FROM operation_document_requirements WHERE id = ? AND case_id = ?", documentId, caseId);
  if (!row) throw errors.notFound();
  return row.case_id;
};
const caseFromCourier: CaseResolver = async (db, path) => caseIdFromTable(db, "courier_shipments", pathId(path, /\/courier\/([^/]+)/));
const caseFromBooking: CaseResolver = async (db, path) => caseIdFromTable(db, "bookings", pathId(path, /\/bookings\/([^/]+)/));
const caseFromContainer: CaseResolver = async (db, path) => caseIdFromTable(db, "containers", pathId(path, /\/containers\/([^/]+)/));
const caseFromReminder: CaseResolver = async (db, path) =>
  caseIdFromTable(db, "reminder_instances", pathId(path, /\/reminders\/([^/]+)/));
const caseFromTrackingLink: CaseResolver = async (db, path) =>
  caseIdFromTable(db, "customer_tracking_links", pathId(path, /\/tracking-links\/([^/]+)/));
const caseFromDocumentVersion: CaseResolver = async (db, path) => {
  const row = await one<{ case_id: string }>(
    db,
    `SELECT r.case_id AS case_id
     FROM document_versions v
     JOIN operation_document_requirements r ON r.id = v.requirement_id
     WHERE v.id = ?`,
    pathId(path, /\/document-versions\/([^/]+)/),
  );
  if (!row) throw errors.notFound();
  return row.case_id;
};
const caseFromNotification: CaseResolver = async (db, path) => {
  const row = await one<{ case_id: string }>(
    db,
    `SELECT r.case_id AS case_id
     FROM notification_deliveries d
     JOIN reminder_instances r ON r.id = d.reminder_id
     WHERE d.id = ?`,
    pathId(path, /\/notifications\/([^/]+)/),
  );
  if (!row) throw errors.notFound();
  return row.case_id;
};
const caseFromBody: CaseResolver = async (_db, _path, body) => {
  try {
    const parsed = JSON.parse(body) as { caseId?: unknown };
    return typeof parsed.caseId === "string" ? parsed.caseId : "";
  } catch {
    return "";
  }
};

async function assertUploadParent(db: D1Database, actor: Actor, _path: string, body: string) {
  const parsed = JSON.parse(body) as { parentType?: string; parentId?: string };
  const parentId = String(parsed.parentId ?? "");
  if (parsed.parentType === "document_requirement") {
    await assertCaseAccess(db, actor, await caseIdFromTable(db, "operation_document_requirements", parentId));
    return;
  }
  if (parsed.parentType === "booking") {
    await assertCaseAccess(db, actor, await caseIdFromTable(db, "bookings", parentId));
    return;
  }
  throw errors.validation("Unsupported upload parent");
}

async function assertUploadSessionOwner(db: D1Database, actor: Actor, path: string) {
  const row = await one<{ owner_user_id: string }>(
    db,
    "SELECT owner_user_id FROM upload_sessions WHERE id = ?",
    pathId(path, /\/files\/uploads\/([^/]+)/),
  );
  if (!row || row.owner_user_id !== actor.id) throw errors.notFound();
}

// W2 quotation scope: a linked quotation follows the export-case scope; an
// unlinked quotation is creator-only — the same rule as its reads (D-09).
async function quoteReplayScope(db: D1Database, actor: Actor, path: string): Promise<void> {
  const id = pathId(path, /\/quotations\/([^/]+)/);
  const quote = await one<{ case_id: string | null; created_by: string }>(
    db,
    "SELECT case_id, created_by FROM quotations WHERE id = ?",
    id,
  );
  if (!quote) throw errors.notFound();
  if (quote.case_id) {
    await assertCaseAccess(db, actor, quote.case_id);
    return;
  }
  if (quote.created_by !== actor.id) throw errors.notFound();
}

// revise requires BOTH quotations.edit and quotations.issue (D-02); one rule
// permission cannot express the conjunction, so the extra enforces both.
async function quoteReviseReplay(db: D1Database, actor: Actor, path: string): Promise<void> {
  requirePermission(actor, "quotations.edit");
  requirePermission(actor, "quotations.issue");
  await quoteReplayScope(db, actor, path);
}

const RULES: ReplayRule[] = [
  { method: "POST", path: /^\/api\/v1\/me\/password$/, extra: async () => undefined },

  { method: "POST", path: /^\/api\/v1\/users$/, permission: "users.manage", rootOnly: true },
  { method: "POST", path: /^\/api\/v1\/users\/[^/]+\/roles$/, permission: "roles.manage", rootOnly: true },
  { method: "PUT", path: /^\/api\/v1\/users\/[^/]+\/roles$/, permission: "roles.manage", rootOnly: true },
  { method: "POST", path: /^\/api\/v1\/users\/[^/]+\/overrides$/, permission: "roles.manage", rootOnly: true },
  { method: "PUT", path: /^\/api\/v1\/users\/[^/]+\/overrides$/, permission: "roles.manage", rootOnly: true },
  { method: "POST", path: /^\/api\/v1\/users\/[^/]+\/active$/, permission: "users.manage", rootOnly: true },
  { method: "PATCH", path: /^\/api\/v1\/users\/[^/]+\/status$/, permission: "users.manage", rootOnly: true },
  { method: "POST", path: /^\/api\/v1\/roles$/, permission: "roles.manage", rootOnly: true },
  { method: "PUT", path: /^\/api\/v1\/roles\/[^/]+\/permissions$/, permission: "roles.manage", rootOnly: true },

  { method: "POST", path: /^\/api\/v1\/customers$/, permission: "customers.create" },
  { method: "PUT", path: /^\/api\/v1\/customers\/[^/]+$/, permission: "customers.edit" },
  { method: "PUT", path: /^\/api\/v1\/customers\/[^/]+\/custom-fields$/, permission: "customers.edit" },

  { method: "POST", path: /^\/api\/v1\/export-cases$/, permission: "export_cases.create" },
  {
    method: "POST",
    path: /^\/api\/v1\/export-cases\/[^/]+\/status$/,
    anyOf: ["export_cases.edit", "export_cases.close", "export_cases.reopen"],
    caseResolver: caseFromExportCase,
  },
  { method: "POST", path: /^\/api\/v1\/export-cases\/[^/]+\/route$/, permission: "export_cases.edit", caseResolver: caseFromExportCase },
  { method: "POST", path: /^\/api\/v1\/export-cases\/[^/]+\/invoices$/, permission: "invoices.edit", caseResolver: caseFromExportCase },
  { method: "PUT", path: /^\/api\/v1\/export-cases\/[^/]+\/custom-fields$/, permission: "export_cases.edit", caseResolver: caseFromExportCase },
  { method: "PUT", path: /^\/api\/v1\/invoices\/[^/]+$/, anyOf: ["invoices.edit", "invoices.correct_completed"], caseResolver: caseFromInvoice },
  { method: "POST", path: /^\/api\/v1\/invoices\/[^/]+\/edit-window$/, permission: "invoices.correct_completed", caseResolver: caseFromInvoice },
  { method: "POST", path: /^\/api\/v1\/invoices\/[^/]+\/corrections$/, permission: "invoices.correct_completed", caseResolver: caseFromInvoice },
  { method: "PUT", path: /^\/api\/v1\/invoices\/[^/]+\/custom-fields$/, anyOf: ["invoices.edit", "invoices.correct_completed"], caseResolver: caseFromInvoice },

  // W2 independent quotations / proforma (owner-approved allowlist, D-10).
  // Re-applying authorization on every replay: permission + quotation scope.
  { method: "POST", path: /^\/api\/v1\/quotations$/, permission: "quotations.create" },
  { method: "PUT", path: /^\/api\/v1\/quotations\/[^/]+$/, permission: "quotations.edit", extra: quoteReplayScope },
  { method: "POST", path: /^\/api\/v1\/quotations\/[^/]+\/items$/, permission: "quotations.edit", extra: quoteReplayScope },
  { method: "PUT", path: /^\/api\/v1\/quotations\/[^/]+\/items\/[^/]+$/, permission: "quotations.edit", extra: quoteReplayScope },
  { method: "DELETE", path: /^\/api\/v1\/quotations\/[^/]+\/items\/[^/]+$/, permission: "quotations.edit", extra: quoteReplayScope },
  { method: "POST", path: /^\/api\/v1\/quotations\/[^/]+\/issue$/, permission: "quotations.issue", extra: quoteReplayScope },
  { method: "POST", path: /^\/api\/v1\/quotations\/[^/]+\/revise$/, extra: quoteReviseReplay },
  { method: "POST", path: /^\/api\/v1\/quotations\/[^/]+\/response$/, permission: "quotations.record_response", extra: quoteReplayScope },
  { method: "POST", path: /^\/api\/v1\/quotations\/[^/]+\/link$/, permission: "quotations.edit", extra: quoteReplayScope },
  { method: "POST", path: /^\/api\/v1\/quotations\/[^/]+\/unlink$/, permission: "quotations.edit", extra: quoteReplayScope },
  { method: "POST", path: /^\/api\/v1\/quotations\/[^/]+\/copy-items$/, permission: "quotations.edit", extra: quoteReplayScope },
  { method: "POST", path: /^\/api\/v1\/quotations\/[^/]+\/archive$/, permission: "quotations.edit", extra: quoteReplayScope },

  { method: "POST", path: /^\/api\/v1\/export-cases\/[^/]+\/document-requirements$/, permission: "documents.upload", caseResolver: caseFromExportCase },
  { method: "DELETE", path: /^\/api\/v1\/document-requirements\/[^/]+$/, permission: "documents.upload", caseResolver: caseFromRequirement },
  { method: "POST", path: /^\/api\/v1\/document-requirements\/[^/]+\/versions$/, permission: "documents.upload", caseResolver: caseFromRequirement },
  { method: "POST", path: /^\/api\/v1\/document-requirements\/[^/]+\/review$/, permission: "documents.review", caseResolver: caseFromRequirement },

  { method: "POST", path: /^\/api\/v1\/export-cases\/[^/]+\/bank\/status$/, permission: "bank.manage", caseResolver: caseFromExportCase },
  { method: "POST", path: /^\/api\/v1\/export-cases\/[^/]+\/direct\/status$/, permission: "export_cases.edit", caseResolver: caseFromExportCase },
  { method: "POST", path: /^\/api\/v1\/export-cases\/[^/]+\/courier$/, permission: "courier.manage", caseResolver: caseFromExportCase },
  { method: "POST", path: /^\/api\/v1\/courier\/[^/]+\/status$/, permission: "courier.manage", caseResolver: caseFromCourier },

  { method: "POST", path: /^\/api\/v1\/bookings$/, permission: "bookings.manage", caseResolver: caseFromBody },
  { method: "PUT", path: /^\/api\/v1\/bookings\/[^/]+$/, permission: "bookings.manage", caseResolver: caseFromBooking },
  { method: "POST", path: /^\/api\/v1\/bookings\/[^/]+\/confirmation$/, permission: "bookings.manage", caseResolver: caseFromBooking },
  { method: "POST", path: /^\/api\/v1\/bookings\/[^/]+\/slots$/, permission: "bookings.manage", caseResolver: caseFromBooking },
  { method: "PUT", path: /^\/api\/v1\/bookings\/[^/]+\/custom-fields$/, permission: "bookings.manage", caseResolver: caseFromBooking },

  { method: "POST", path: /^\/api\/v1\/containers\/[^/]+\/number$/, permission: "containers.manage", caseResolver: caseFromContainer },
  { method: "POST", path: /^\/api\/v1\/containers\/[^/]+\/status$/, permission: "containers.manage", caseResolver: caseFromContainer },
  { method: "PUT", path: /^\/api\/v1\/containers\/[^/]+\/custom-fields$/, permission: "containers.manage", caseResolver: caseFromContainer },

  { method: "POST", path: /^\/api\/v1\/reminders\/[^/]+\/snooze$/, permission: "reminders.manage_own", caseResolver: caseFromReminder },
  { method: "POST", path: /^\/api\/v1\/notifications\/[^/]+\/read$/, permission: "reminders.view", caseResolver: caseFromNotification },
  { method: "PATCH", path: /^\/api\/v1\/reminder-rules\/[^/]+$/, permission: "reminders.manage_rules" },

  { method: "POST", path: /^\/api\/v1\/export-cases\/[^/]+\/tracking-links$/, permission: "tracking_links.manage", caseResolver: caseFromExportCase },
  { method: "POST", path: /^\/api\/v1\/tracking-links\/[^/]+\/revoke$/, permission: "tracking_links.manage", caseResolver: caseFromTrackingLink },
  { method: "POST", path: /^\/api\/v1\/tracking-links\/[^/]+\/rotate$/, permission: "tracking_links.manage", caseResolver: caseFromTrackingLink },

  { method: "POST", path: /^\/api\/v1\/files\/uploads$/, permission: "documents.upload", extra: assertUploadParent },
  { method: "POST", path: /^\/api\/v1\/files\/uploads\/[^/]+\/complete$/, permission: "documents.upload", extra: assertUploadSessionOwner },
  { method: "POST", path: /^\/api\/v1\/files\/uploads\/[^/]+\/abort$/, permission: "documents.upload", extra: assertUploadSessionOwner },

  { method: "POST", path: /^\/api\/v1\/imports\/customers\/commit$/, permission: "customers.create" },
  { method: "POST", path: /^\/api\/v1\/settings\/whatsapp-template$/, permission: "settings.manage" },
  { method: "POST", path: /^\/api\/v1\/export-cases\/[^/]+\/document-requirements\/[^/]+\/restore$/, permission: "documents.restore_version", caseResolver: caseFromRestore },
  { method: "POST", path: /^\/api\/v1\/document-requirements\/[^/]+\/hide-from-customer$/, permission: "documents.review", caseResolver: caseFromRequirement },
  { method: "POST", path: /^\/api\/v1\/document-versions\/[^/]+\/customer-share$/, permission: "customer_files.manage", caseResolver: caseFromDocumentVersion },
  { method: "POST", path: /^\/api\/v1\/document-versions\/[^/]+\/customer-revision$/, permission: "customer_files.manage", caseResolver: caseFromDocumentVersion },
  { method: "DELETE", path: /^\/api\/v1\/document-versions\/[^/]+$/, permission: "documents.upload", caseResolver: caseFromDocumentVersion },
  { method: "PUT", path: /^\/api\/v1\/settings\/exporter-identity$/, permission: "settings.manage" },
  { method: "POST", path: /^\/api\/v1\/settings\/exporter-bank-accounts$/, permission: "exporter.bank_accounts.manage" },
  { method: "PATCH", path: /^\/api\/v1\/settings\/exporter-bank-accounts\/[^/]+$/, permission: "exporter.bank_accounts.manage" },
  { method: "PUT", path: /^\/api\/v1\/settings\/exporter-marks$/, permission: "settings.manage" },
  { method: "POST", path: /^\/api\/v1\/settings\/exporter-marks\/[^/]+$/, anyOf: ["settings.manage", "trade.stamp.manage"] },
  { method: "POST", path: /^\/api\/v1\/product-presets$/, permission: "catalog.products.manage" },
  { method: "PATCH", path: /^\/api\/v1\/product-presets\/[^/]+$/, permission: "catalog.products.manage" },
  { method: "DELETE", path: /^\/api\/v1\/product-presets\/[^/]+$/, permission: "catalog.products.manage" },
  { method: "POST", path: /^\/api\/v1\/shipping-methods$/, permission: "catalog.shipping.manage" },
  { method: "PATCH", path: /^\/api\/v1\/shipping-methods\/[^/]+$/, permission: "catalog.shipping.manage" },
  { method: "DELETE", path: /^\/api\/v1\/shipping-methods\/[^/]+$/, permission: "catalog.shipping.manage" },
  { method: "POST", path: /^\/api\/v1\/proformas$/, permission: "proformas.edit" },
  { method: "PUT", path: /^\/api\/v1\/proformas\/[^/]+$/, permission: "proformas.edit" },
  { method: "POST", path: /^\/api\/v1\/proformas\/[^/]+\/issue$/, permission: "proformas.issue" },
  { method: "POST", path: /^\/api\/v1\/proformas\/[^/]+\/convert$/, permission: "proformas.edit" },
  { method: "DELETE", path: /^\/api\/v1\/proformas\/[^/]+$/, permission: "proformas.delete" },
  { method: "PUT", path: /^\/api\/v1\/invoices\/[^/]+\/trade-header$/, permission: "invoices.edit", caseResolver: caseFromInvoice },
  { method: "PUT", path: /^\/api\/v1\/invoices\/[^/]+\/lines$/, permission: "invoices.edit", caseResolver: caseFromInvoice },
  { method: "PUT", path: /^\/api\/v1\/invoices\/[^/]+\/packing-lines$/, permission: "packing.edit", caseResolver: caseFromInvoice },
  { method: "POST", path: /^\/api\/v1\/invoices\/[^/]+\/sync-totals$/, permission: "packing.edit", caseResolver: caseFromInvoice },
  { method: "POST", path: /^\/api\/v1\/invoices\/[^/]+\/issue-trade$/, permission: "invoices.issue", caseResolver: caseFromInvoice },
  { method: "POST", path: /^\/api\/v1\/custom-fields$/, permission: "settings.manage" },
  { method: "PATCH", path: /^\/api\/v1\/custom-fields\/[^/]+$/, permission: "settings.manage" },
];

export function replayPolicyFor(method: string, pathname: string): ReplayRule | null {
  return RULES.find((rule) => rule.method === method && rule.path.test(pathname)) ?? null;
}

export async function authorizeReplay(
  db: D1Database,
  actor: Actor,
  method: string,
  pathname: string,
  body: string,
): Promise<void> {
  const rule = replayPolicyFor(method, pathname);
  if (!rule) {
    // Fail closed. The witness stays; the client must start a new operation
    // rather than receive a body this deployment cannot re-authorize.
    throw errors.coded(
      403,
      "IDEMPOTENCY_REPLAY_POLICY_MISSING",
      "This response cannot be replayed safely. Start a new operation.",
    );
  }
  if (rule.permission) requirePermission(actor, rule.permission);
  if (rule.anyOf) requireAny(actor, rule.anyOf);
  if (rule.rootOnly) {
    const root =
      actor.permissions.has("users.manage") &&
      actor.permissions.has("roles.manage");
    if (!root) throw errors.forbidden("Only an active administrator can replay this operation");
  }
  if (rule.caseResolver) {
    const caseId = await rule.caseResolver(db, pathname, body);
    if (!caseId) throw errors.notFound();
    await assertCaseAccess(db, actor, caseId);
  }
  if (rule.extra) await rule.extra(db, actor, pathname, body);
}

export const REPLAY_POLICY_RULE_COUNT = RULES.length;
