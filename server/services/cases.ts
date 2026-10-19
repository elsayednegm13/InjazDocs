import { normalizePage } from "../../shared/api";
import type { BankPathStatus, CaseStatus, DirectPathStatus, DocumentRoute, Incoterm } from "../../shared/enums";
import { parseDecimalToMinor } from "../../shared/money";
import { toGrams, type WeightUnit } from "../../shared/weights";
import { canCompleteCase } from "../domain/case-completion";
import { customFieldsRequiredNow } from "../domain/custom-fields";
import { validateInvoiceCommercials } from "../domain/invoice";
import { assertCaseTransition, initialRouteStatus } from "../domain/transitions";
import { all, newId, nowIso, one } from "../db/sql";
import { errors } from "../http/errors";
import type { Actor } from "./actor";
import { assertCaseAccess, caseVisibilitySql, requirePermission } from "./actor";
import { auditInsert, writeAudit, writeCaseEvent } from "./audit";
import { assertRequiredCustomFields, invoiceCustomFieldStatements, readCustomFields } from "./custom-fields";
import { applyTemplateToCase } from "./documents";
import { recomputeRemindersForCase } from "./reminders";

type InvoiceWrite = {
  invoiceNumber: string;
  invoiceDate: string;
  paymentTermCode: string;
  paymentTermDetails?: string;
  incoterm: Incoterm;
  incotermsEdition?: string;
  namedPlace?: string;
  currency: string;
  goodsValue: string;
  invoicedFreight?: string;
  actualFreightExpense?: string;
  invoiceTotal: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  destinationCountry?: string;
  dueDays?: number;
  dueDate?: string;
  grossWeight: number;
  netWeight: number;
  weightUnit?: WeightUnit;
  units?: number;
  notes?: string;
};

export async function listCases(
  db: D1Database,
  actor: Actor,
  query: { page?: number; pageSize?: number; q?: string; status?: string; country?: string },
) {
  requirePermission(actor, actor.permissions.has("export_cases.view_all") ? "export_cases.view_all" : "export_cases.view_assigned");
  const page = normalizePage(query.page, query.pageSize);
  const vis = caseVisibilitySql(actor);
  const filters = [vis.sql];
  const binds: unknown[] = [...vis.binds];
  if (query.status) {
    filters.push("c.status = ?");
    binds.push(query.status);
  }
  if (query.country) {
    filters.push("c.destination_country = ?");
    binds.push(query.country);
  }
  if (query.q) {
    filters.push("(c.case_reference LIKE ? OR cu.legal_name LIKE ? OR i.invoice_number LIKE ?)");
    binds.push(`%${query.q}%`, `%${query.q}%`, `%${query.q}%`);
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  const total = await one<{ n: number }>(
    db,
    `SELECT COUNT(DISTINCT c.id) AS n
     FROM export_cases c
     JOIN customers cu ON cu.id = c.customer_id
     LEFT JOIN export_invoices i ON i.case_id = c.id
     ${where}`,
    ...binds,
  );
  const rows = await all(
    db,
    `SELECT c.id, c.case_reference, c.status, c.document_route, c.bank_path_status, c.direct_path_status,
            c.destination_country, c.next_action, c.updated_at, c.assigned_to,
            cu.legal_name AS customer_name,
            GROUP_CONCAT(DISTINCT i.invoice_number) AS invoice_numbers
     FROM export_cases c
     JOIN customers cu ON cu.id = c.customer_id
     LEFT JOIN export_invoices i ON i.case_id = c.id
     ${where}
     GROUP BY c.id
     ORDER BY c.updated_at DESC
     LIMIT ? OFFSET ?`,
    ...binds,
    page.pageSize,
    page.offset,
  );
  return { rows, total: total?.n ?? 0, ...page };
}

export async function getCaseOverview(db: D1Database, actor: Actor, id: string) {
  const current = await assertCaseAccess(db, actor, id);
  const [customerResult, snapshotResult, invoiceResult, requirementResult, bookingResult, containerResult, reminderResult, versionResult] = await db.batch([
    db.prepare("SELECT id, legal_name, trade_name, country_code FROM customers WHERE id = ?").bind(current.customer_id),
    db.prepare("SELECT * FROM export_case_customer_snapshots WHERE case_id = ?").bind(id),
    db.prepare("SELECT * FROM export_invoices WHERE case_id = ? ORDER BY invoice_date").bind(id),
    db.prepare(
      `SELECT r.*, t.name_en, t.name_ar, t.key AS type_key
       FROM operation_document_requirements r
       JOIN document_type_definitions t ON t.id = r.document_type_id
       WHERE r.case_id = ?`,
    ).bind(id),
    db.prepare("SELECT * FROM bookings WHERE case_id = ?").bind(id),
    db.prepare("SELECT * FROM containers WHERE case_id = ?").bind(id),
    db.prepare(
      "SELECT * FROM reminder_instances WHERE case_id = ? AND status IN ('PENDING','ACTIVE','SNOOZED','ACKNOWLEDGED') ORDER BY due_at",
    ).bind(id),
    db.prepare(
      `SELECT v.id, v.requirement_id, v.version, v.r2_key, v.original_name, v.content_type, v.byte_size, v.review_state, v.created_at, u.name AS uploaded_by_name
       FROM document_versions v
       JOIN operation_document_requirements r ON r.id = v.requirement_id
       LEFT JOIN user u ON u.id = v.uploaded_by
       WHERE r.case_id = ?
       ORDER BY v.created_at DESC`,
    ).bind(id),
  ]);
  return {
    case: current,
    customer: customerResult.results?.[0] ?? null,
    snapshot: snapshotResult.results?.[0] ?? null,
    invoices: invoiceResult.results ?? [],
    requirements: requirementResult.results ?? [],
    bookings: bookingResult.results ?? [],
    containers: containerResult.results ?? [],
    reminders: reminderResult.results ?? [],
    documentVersions: versionResult.results ?? [],
    customFields: await readCustomFields(db, actor, "EXPORT_CASE", id),
  };
}

export async function createCase(
  db: D1Database,
  actor: Actor,
  env: Env,
  input: {
    customerId: string;
    documentRoute: DocumentRoute;
    destinationCountry?: string;
    assignedTo?: string;
    contactId?: string;
    addressId?: string;
    templateId?: string;
    invoice?: InvoiceWrite;
  },
  requestId: string,
) {
  requirePermission(actor, "export_cases.create");
  const customer = await one<{ id: string; legal_name: string; trade_name: string | null; country_code: string | null }>(
    db,
    "SELECT id, legal_name, trade_name, country_code FROM customers WHERE id = ?",
    input.customerId,
  );
  if (!customer) throw errors.notFound("Customer not found");
  const id = newId();
  const year = new Date().getUTCFullYear();
  const count = await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM export_cases");
  const caseReference = `EF-${year}-${String((count?.n ?? 0) + 1).padStart(4, "0")}`;
  const now = nowIso();
  const routeStatus = initialRouteStatus(input.documentRoute);
  await db
    .prepare(
      `INSERT INTO export_cases (
        id, case_reference, customer_id, status, document_route, bank_path_status, direct_path_status,
        assigned_to, destination_country, next_action, version, created_at, updated_at, created_by
      ) VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, 'Complete commercial details and document checklist', 1, ?, ?, ?)`,
    )
    .bind(
      id,
      caseReference,
      customer.id,
      input.documentRoute,
      routeStatus.bank,
      routeStatus.direct,
      input.assignedTo ?? actor.id,
      input.destinationCountry ?? customer.country_code,
      now,
      now,
      actor.id,
    )
    .run();
  const contact = input.contactId
    ? await one<{ full_name: string; phone: string | null; email: string | null }>(
        db,
        "SELECT full_name, phone, email FROM customer_contacts WHERE id = ? AND customer_id = ?",
        input.contactId,
        customer.id,
      )
    : await one<{ full_name: string; phone: string | null; email: string | null }>(
        db,
        "SELECT full_name, phone, email FROM customer_contacts WHERE customer_id = ? ORDER BY is_primary DESC LIMIT 1",
        customer.id,
      );
  const address = input.addressId
    ? await one<{ line1: string; city: string | null; country_code: string | null }>(
        db,
        "SELECT line1, city, country_code FROM customer_addresses WHERE id = ? AND customer_id = ?",
        input.addressId,
        customer.id,
      )
    : await one<{ line1: string; city: string | null; country_code: string | null }>(
        db,
        "SELECT line1, city, country_code FROM customer_addresses WHERE customer_id = ? ORDER BY is_primary DESC LIMIT 1",
        customer.id,
      );
  await db
    .prepare(
      `INSERT INTO export_case_customer_snapshots (
        case_id, legal_name, trade_name, contact_name, contact_phone, contact_email, address_line1, city, country_code, captured_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      customer.legal_name,
      customer.trade_name,
      contact?.full_name ?? null,
      contact?.phone ?? null,
      contact?.email ?? null,
      address?.line1 ?? null,
      address?.city ?? null,
      address?.country_code ?? customer.country_code,
      now,
    )
    .run();
  await applyTemplateToCase(db, id, input.templateId);
  if (input.invoice) {
    await createInvoice(db, actor, env, id, input.invoice, requestId);
  }
  await writeCaseEvent(db, id, "CASE_CREATED", `Created ${caseReference}`, actor.id);
  await writeAudit(db, { actorId: actor.id, entityType: "export_case", entityId: id, action: "case.create", requestId });
  await recomputeRemindersForCase(db, env, id);
  return { id, caseReference };
}

export async function transitionCase(
  db: D1Database,
  actor: Actor,
  env: Env,
  id: string,
  to: CaseStatus,
  input: { reason?: string; version: number },
  requestId: string,
) {
  const current = await assertCaseAccess(db, actor, id);
  assertCaseTransition(current.status as CaseStatus, to);
  if (to === "COMPLETED") {
    requirePermission(actor, "export_cases.close");
    const containers = await all<{ status: import("../../shared/enums").ContainerStatus }>(db, "SELECT status FROM containers WHERE case_id = ?", id);
    const requirements = await all<{ required: number; status: string }>(
      db,
      "SELECT required, status FROM operation_document_requirements WHERE case_id = ?",
      id,
    );
    const decision = canCompleteCase({
      status: current.status as CaseStatus,
      route: current.document_route as DocumentRoute,
      bankStatus: current.bank_path_status as BankPathStatus,
      directStatus: current.direct_path_status as DirectPathStatus | null,
      containers,
      requirements,
      exceptionReason: input.reason,
      hasClosePermission: actor.permissions.has("export_cases.close"),
    });
    if (!decision.ok) throw errors.conflict(decision.message, decision.code);
  }
  if (to === "ACTIVE" && current.status === "COMPLETED") requirePermission(actor, "export_cases.reopen");
  if (!customFieldsRequiredNow("EXPORT_CASE", current.status) && customFieldsRequiredNow("EXPORT_CASE", to)) {
    await assertRequiredCustomFields(db, "EXPORT_CASE", id);
  }
  if (current.version !== input.version) throw errors.conflict("Case was updated by someone else");
  await db
    .prepare(
      `UPDATE export_cases SET status = ?, closed_at = ?, close_exception_reason = ?, version = version + 1, updated_at = ? WHERE id = ?`,
    )
    .bind(to, to === "COMPLETED" ? nowIso() : null, input.reason ?? null, nowIso(), id)
    .run();
  await writeCaseEvent(db, id, "CASE_STATUS", `Status ${current.status} → ${to}`, actor.id);
  await writeAudit(db, { actorId: actor.id, entityType: "export_case", entityId: id, action: "case.status", after: { to, reason: input.reason }, requestId });
  await recomputeRemindersForCase(db, env, id);
}

export async function createInvoice(db: D1Database, actor: Actor, env: Env, caseId: string, input: InvoiceWrite, requestId: string) {
  requirePermission(actor, "invoices.edit");
  const current = await assertCaseAccess(db, actor, caseId);
  const existing = await one(db, "SELECT id FROM export_invoices WHERE invoice_number = ?", input.invoiceNumber);
  if (existing) throw errors.conflict("Invoice number already exists");
  const priced = priceInvoice(input, env.INCOTERMS_EDITION_DEFAULT);
  const id = newId();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO export_invoices (
        id, case_id, invoice_number, invoice_date, customer_id, port_of_loading, port_of_discharge, destination_country,
        payment_term_code, payment_term_details, due_days, due_date, incoterm, incoterms_edition, named_place,
        currency, currency_decimals, goods_value_minor, invoiced_freight_minor, actual_freight_expense_minor, invoice_total_minor,
        gross_weight_grams, net_weight_grams, units, notes, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(
      id,
      caseId,
      input.invoiceNumber,
      input.invoiceDate,
      current.customer_id,
      input.portOfLoading ?? null,
      input.portOfDischarge ?? null,
      input.destinationCountry ?? null,
      input.paymentTermCode,
      input.paymentTermDetails ?? null,
      input.dueDays ?? null,
      input.dueDate ?? null,
      input.incoterm,
      priced.edition,
      input.namedPlace ?? null,
      priced.goods.currency,
      priced.goods.decimals,
      Number(priced.goods.minorUnits),
      Number(priced.invoicedFreight.minorUnits),
      Number(priced.actualFreight.minorUnits),
      Number(priced.total.minorUnits),
      priced.gross,
      priced.net,
      input.units ?? null,
      input.notes ?? null,
      now,
      now,
    )
    .run();
  await writeAudit(db, { actorId: actor.id, entityType: "invoice", entityId: id, action: "invoice.create", requestId });
  return { id };
}

export async function updateInvoice(
  db: D1Database,
  actor: Actor,
  invoiceId: string,
  input: InvoiceWrite & { version: number },
  requestId: string,
) {
  requirePermission(actor, "invoices.edit");
  const invoice = await one<{ id: string; case_id: string; version: number; customer_id: string }>(
    db,
    "SELECT id, case_id, version, customer_id FROM export_invoices WHERE id = ?",
    invoiceId,
  );
  if (!invoice) throw errors.notFound("Invoice not found");
  await assertCaseAccess(db, actor, invoice.case_id);
  await assertInvoiceOrdinaryWrite(db, invoice.case_id);
  if (invoice.version !== input.version) throw errors.conflict("The invoice changed since you opened it. Refresh and review the correction again.", "INVOICE_VERSION");
  const priced = priceInvoice(input, "Incoterms 2020");
  await db
    .prepare(
      `UPDATE export_invoices SET
        invoice_number=?, invoice_date=?, port_of_loading=?, port_of_discharge=?, destination_country=?,
        payment_term_code=?, payment_term_details=?, due_days=?, due_date=?, incoterm=?, incoterms_edition=?, named_place=?,
        currency=?, currency_decimals=?, goods_value_minor=?, invoiced_freight_minor=?, actual_freight_expense_minor=?, invoice_total_minor=?,
        gross_weight_grams=?, net_weight_grams=?, units=?, notes=?, version=version+1, updated_at=?
       WHERE id=?`,
    )
    .bind(
      input.invoiceNumber,
      input.invoiceDate,
      input.portOfLoading ?? null,
      input.portOfDischarge ?? null,
      input.destinationCountry ?? null,
      input.paymentTermCode,
      input.paymentTermDetails ?? null,
      input.dueDays ?? null,
      input.dueDate ?? null,
      input.incoterm,
      input.incotermsEdition ?? "Incoterms 2020",
      input.namedPlace ?? null,
      priced.goods.currency,
      priced.goods.decimals,
      Number(priced.goods.minorUnits),
      Number(priced.invoicedFreight.minorUnits),
      Number(priced.actualFreight.minorUnits),
      Number(priced.total.minorUnits),
      priced.gross,
      priced.net,
      input.units ?? null,
      input.notes ?? null,
      nowIso(),
      invoiceId,
    )
    .run();
  await writeAudit(db, { actorId: actor.id, entityType: "invoice", entityId: invoiceId, action: "invoice.update", requestId });
}

export async function assertInvoiceOrdinaryWrite(db: D1Database, caseId: string) {
  const row = await one<{ status: string }>(db, "SELECT status FROM export_cases WHERE id = ?", caseId);
  if (row?.status === "COMPLETED") {
    throw errors.conflict(
      "This invoice is locked because the export operation is completed. An exceptional correction is required.",
      "INVOICE_LOCKED",
    );
  }
}

export async function correctCompletedInvoice(
  db: D1Database,
  actor: Actor,
  invoiceId: string,
  input: InvoiceWrite & { version: number; reason?: string; customFields?: Record<string, unknown>; testFault?: string },
  requestId: string,
  options?: { allowTestFault?: boolean },
) {
  requirePermission(actor, "invoices.correct_completed");
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 3 || reason.length > 500) {
    throw errors.validation("Write the correction reason before saving.", { reason: "INVOICE_CORRECTION_REASON" }, "INVOICE_CORRECTION_REASON");
  }
  const invoice = await one<Record<string, unknown> & { id: string; case_id: string; version: number }>(
    db,
    "SELECT * FROM export_invoices WHERE id = ?",
    invoiceId,
  );
  if (!invoice) throw errors.notFound("Invoice not found");
  await assertCaseAccess(db, actor, invoice.case_id);
  const parent = await one<{ status: string }>(db, "SELECT status FROM export_cases WHERE id = ?", invoice.case_id);
  if (parent?.status !== "COMPLETED") {
    throw errors.conflict("Exceptional correction is only for a completed export operation.", "INVOICE_NOT_LOCKED");
  }
  if (invoice.version !== input.version) throw errors.conflict("The invoice changed since you opened it. Refresh and review the correction again.", "INVOICE_VERSION");
  const priced = priceInvoice(input, "Incoterms 2020");
  const priorValues = await all<{ field_key: string; value_text: string | null }>(
    db,
    `SELECT d.field_key, v.value_text
     FROM custom_field_values v
     JOIN custom_field_definitions d ON d.id = v.definition_id
     WHERE v.entity_type = 'INVOICE' AND v.entity_id = ?`,
    invoiceId,
  );
  const before = { invoice, customFields: priorValues };
  const fieldStatements = await invoiceCustomFieldStatements(db, actor, invoiceId, input.customFields, invoice.version + 1);
  const revisionRow = await one<{ n: number }>(db, "SELECT COALESCE(MAX(revision), 0) AS n FROM invoice_revisions WHERE invoice_id = ?", invoiceId);
  const revision = (revisionRow?.n ?? 0) + 1;
  const now = nowIso();
  const afterFields = input.customFields
    ? Object.entries(input.customFields).map(([field_key, value]) => ({ field_key, value_text: value == null ? null : String(value) }))
    : priorValues;
  const afterInvoice = {
    ...invoice,
    invoice_number: input.invoiceNumber,
    invoice_date: input.invoiceDate,
    goods_value_minor: Number(priced.goods.minorUnits),
    invoiced_freight_minor: Number(priced.invoicedFreight.minorUnits),
    actual_freight_expense_minor: Number(priced.actualFreight.minorUnits),
    invoice_total_minor: Number(priced.total.minorUnits),
    gross_weight_grams: priced.gross,
    net_weight_grams: priced.net,
    notes: input.notes ?? null,
    version: invoice.version + 1,
  };
  const after = { invoice: afterInvoice, customFields: afterFields };
  const nextVersion = invoice.version + 1;
  const statements = [
    db.prepare(
      `UPDATE export_invoices SET
        invoice_number=?, invoice_date=?, port_of_loading=?, port_of_discharge=?, destination_country=?,
        payment_term_code=?, payment_term_details=?, due_days=?, due_date=?, incoterm=?, incoterms_edition=?, named_place=?,
        currency=?, currency_decimals=?, goods_value_minor=?, invoiced_freight_minor=?, actual_freight_expense_minor=?, invoice_total_minor=?,
        gross_weight_grams=?, net_weight_grams=?, units=?, notes=?, version=version+1, updated_at=?
       WHERE id=? AND version=?`,
    ).bind(
      input.invoiceNumber,
      input.invoiceDate,
      input.portOfLoading ?? null,
      input.portOfDischarge ?? null,
      input.destinationCountry ?? null,
      input.paymentTermCode,
      input.paymentTermDetails ?? null,
      input.dueDays ?? null,
      input.dueDate ?? null,
      input.incoterm,
      input.incotermsEdition ?? "Incoterms 2020",
      input.namedPlace ?? null,
      priced.goods.currency,
      priced.goods.decimals,
      Number(priced.goods.minorUnits),
      Number(priced.invoicedFreight.minorUnits),
      Number(priced.actualFreight.minorUnits),
      Number(priced.total.minorUnits),
      priced.gross,
      priced.net,
      input.units ?? null,
      input.notes ?? null,
      now,
      invoiceId,
      invoice.version,
    ),
    db.prepare(
      `INSERT INTO invoice_revisions (id, invoice_id, case_id, revision, reason, actor_id, before_json, after_json, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE changes() = 1`,
    ).bind(newId(), invoiceId, invoice.case_id, revision, reason, actor.id, JSON.stringify(before), JSON.stringify(after), now),
    ...fieldStatements,
  ];
  if (options?.allowTestFault && input.testFault === "constraint") {
    statements.push(
      db.prepare(
        `INSERT INTO invoice_revisions (id, invoice_id, case_id, revision, reason, actor_id, before_json, after_json, created_at)
         VALUES ('fault-revision', 'missing-invoice', 'missing-case', 1, 'fault', NULL, '{}', '{}', ?)`,
      ).bind(now),
    );
  }
  statements.push(
    auditInsert(db, { actorId: actor.id, entityType: "invoice", entityId: invoiceId, action: "invoice.correct", reason, before, after, requestId }, { invoiceId, version: nextVersion }),
  );
  const [updated] = await db.batch(statements);
  if (!updated?.meta.changes) {
    throw errors.conflict("The invoice changed since you opened it. Refresh and review the correction again.", "INVOICE_VERSION");
  }
  return { revision };
}

export async function listInvoiceRevisions(db: D1Database, actor: Actor, invoiceId: string) {
  requirePermission(actor, "invoices.view");
  const invoice = await one<{ case_id: string }>(db, "SELECT case_id FROM export_invoices WHERE id = ?", invoiceId);
  if (!invoice) throw errors.notFound("Invoice not found");
  await assertCaseAccess(db, actor, invoice.case_id);
  const rows = await all<{ id: string; revision: number; reason: string; actor_id: string | null; before_json: string; after_json: string; created_at: string }>(
    db,
    `SELECT id, revision, reason, actor_id, before_json, after_json, created_at
     FROM invoice_revisions WHERE invoice_id = ? ORDER BY revision DESC`,
    invoiceId,
  );
  if (actor.permissions.has("settings.manage")) return rows;
  const sensitive = new Set(
    (await all<{ field_key: string }>(db, "SELECT field_key FROM custom_field_definitions WHERE target_entity = 'INVOICE' AND sensitive = 1")).map((row) => row.field_key),
  );
  return rows.map((row) => ({
    ...row,
    before_json: redactRevisionJson(row.before_json, sensitive),
    after_json: redactRevisionJson(row.after_json, sensitive),
  }));
}

function redactRevisionJson(raw: string, sensitive: Set<string>) {
  try {
    const parsed = JSON.parse(raw) as { customFields?: unknown };
    const fields = parsed.customFields;
    if (Array.isArray(fields)) {
      parsed.customFields = fields.map((field) => {
        if (!field || typeof field !== "object") return field;
        const row = field as { field_key?: string; value_text?: string | null };
        return sensitive.has(String(row.field_key)) ? { ...row, value_text: null } : row;
      });
    }
    return JSON.stringify(parsed);
  } catch {
    return raw;
  }
}

function priceInvoice(input: InvoiceWrite, editionDefault: string | undefined) {
  const goods = parseDecimalToMinor(input.goodsValue, input.currency);
  const invoicedFreight = parseDecimalToMinor(input.invoicedFreight ?? "0", input.currency);
  const actualFreight = parseDecimalToMinor(input.actualFreightExpense ?? "0", input.currency);
  const total = parseDecimalToMinor(input.invoiceTotal, input.currency);
  const unit = input.weightUnit ?? "KG";
  const gross = toGrams(input.grossWeight, unit);
  const net = toGrams(input.netWeight, unit);
  const check = validateInvoiceCommercials({
    incoterm: input.incoterm,
    goodsValueMinor: goods.minorUnits,
    invoicedFreightMinor: invoicedFreight.minorUnits,
    actualFreightExpenseMinor: actualFreight.minorUnits,
    invoiceTotalMinor: total.minorUnits,
    currency: input.currency,
    grossWeightGrams: gross,
    netWeightGrams: net,
  });
  if (!check.ok) throw errors.validation(check.message, check.code === "GROSS_LT_NET" ? { grossWeight: check.message } : undefined, check.code);
  return { goods, invoicedFreight, actualFreight, total, gross, net, edition: input.incotermsEdition ?? editionDefault ?? "Incoterms 2020" };
}
