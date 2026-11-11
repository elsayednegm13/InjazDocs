import { normalizePage } from "../../shared/api";
import type { BankPathStatus, CaseStatus, DirectPathStatus, DocumentRoute, Incoterm } from "../../shared/enums";
import { minorToDecimalString, parseDecimalToMinor } from "../../shared/money";
import { toGrams, type WeightUnit } from "../../shared/weights";
import { canCompleteCase } from "../domain/case-completion";
import { customFieldsRequiredNow } from "../domain/custom-fields";
import { derivedGoodsPlusInvoicedFreight, validateInvoiceCommercials } from "../domain/invoice";
import { assertCaseTransition, initialRouteStatus } from "../domain/transitions";
import { all, newId, nowIso, one } from "../db/sql";
import { errors } from "../http/errors";
import type { Actor } from "./actor";
import { assertCaseAccess, caseVisibilitySql, requirePermission } from "./actor";
import { auditInsert, caseEventInsert, writeAudit, writeCaseEvent } from "./audit";
import { assertRequiredCustomFields, invoiceCustomFieldStatements, readCustomFields } from "./custom-fields";
import { templateRequirementStatements } from "./documents";
import { archivedVersionIds, customerSharesForCase, requirementIdsWithArchive, withCustomerShare } from "./customer-files";
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
  const term = query.q?.trim();
  if (term) {
    const like = `%${term}%`;
    filters.push(
      `(c.case_reference LIKE ? OR cu.legal_name LIKE ? OR cu.trade_name LIKE ? OR cu.customer_code LIKE ? OR i.invoice_number LIKE ?
        OR EXISTS (SELECT 1 FROM bookings b WHERE b.case_id = c.id AND b.booking_number LIKE ?)
        OR EXISTS (SELECT 1 FROM containers k WHERE k.case_id = c.id AND k.official_number LIKE ?))`,
    );
    binds.push(like, like, like, like, like, like, like);
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
  const [
    customerResult,
    contactResult,
    snapshotResult,
    invoiceResult,
    requirementResult,
    bookingResult,
    containerResult,
    reminderResult,
    versionResult,
  ] = await db.batch([
    db.prepare("SELECT id, legal_name, trade_name, customer_code, country_code FROM customers WHERE id = ?").bind(current.customer_id),
    db
      .prepare("SELECT phone FROM customer_contacts WHERE customer_id = ? AND phone IS NOT NULL AND trim(phone) != '' ORDER BY is_primary DESC LIMIT 1")
      .bind(current.customer_id),
    db.prepare("SELECT * FROM export_case_customer_snapshots WHERE case_id = ?").bind(id),
    db.prepare("SELECT * FROM export_invoices WHERE case_id = ? ORDER BY invoice_date").bind(id),
    db.prepare(
      `SELECT r.*, t.name_en, t.name_ar, t.key AS type_key
       FROM operation_document_requirements r
       JOIN document_type_definitions t ON t.id = r.document_type_id
       WHERE r.case_id = ?
       ORDER BY r.created_at ASC, r.id ASC`,
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
  const contact = (contactResult.results?.[0] as { phone: string | null } | undefined) ?? null;
  const customer = customerResult.results?.[0] as Record<string, unknown> | undefined;
  const [customerShares, archived, archivedRequirements, customFields] = await Promise.all([
    customerSharesForCase(db, id),
    archivedVersionIds(db, id),
    requirementIdsWithArchive(db, id),
    readCustomFields(db, actor, "EXPORT_CASE", id),
  ]);
  const documentVersions = ((versionResult.results ?? []) as Array<{ id: string }>)
    .filter((version) => !archived?.has(version.id))
    .map((version) => withCustomerShare(version, customerShares.rows.find((share) => share.version_id === version.id), customerShares.ready));
  const requirements = ((requirementResult.results ?? []) as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    has_previous_version: archivedRequirements?.has(String(row.id)) ? 1 : 0,
  }));
  return {
    case: current,
    customer: customer ? { ...customer, phone: contact?.phone ?? null } : null,
    snapshot: snapshotResult.results?.[0] ?? null,
    invoices: invoiceResult.results ?? [],
    requirements,
    bookings: bookingResult.results ?? [],
    containers: containerResult.results ?? [],
    reminders: reminderResult.results ?? [],
    documentVersions,
    customerFileShareReady: customerShares.ready,
    customFields,
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
  const now = nowIso();
  if (input.invoice) {
    // Validate before inserting the case: a rejected invoice must not leave a
    // half-created draft behind. createInvoice re-validates on write.
    priceInvoice(input.invoice, env.INCOTERMS_EDITION_DEFAULT);
    const duplicate = await one(db, "SELECT id FROM export_invoices WHERE invoice_number = ?", input.invoice.invoiceNumber);
    if (duplicate) throw errors.conflict("Invoice number already exists", "INVOICE_NUMBER_TAKEN");
  }
  const routeStatus = initialRouteStatus(input.documentRoute);
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
  const templateItems = await templateRequirementStatements(db, id, input.templateId);
  // One D1 batch writes the case, its customer snapshot, the document
  // checklist, the invoice, the case event and the audit rows. A failure at any
  // step leaves nothing behind, so a case can never exist without its invoice
  // or checklist.
  let caseReference = "";
  for (let attempt = 0; attempt < 8 && !caseReference; attempt += 1) {
    const last = await one<{ n: number | null }>(
      db,
      "SELECT MAX(CAST(substr(case_reference, 9) AS INTEGER)) AS n FROM export_cases WHERE case_reference LIKE ?",
      `EF-${year}-%`,
    );
    const candidate = `EF-${year}-${String((last?.n ?? 0) + 1).padStart(4, "0")}`;
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          `INSERT INTO export_cases (
            id, case_reference, customer_id, status, document_route, bank_path_status, direct_path_status,
            assigned_to, destination_country, next_action, version, created_at, updated_at, created_by
          ) VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, 'Complete commercial details and document checklist', 1, ?, ?, ?)`,
        )
        .bind(
          id,
          candidate,
          customer.id,
          input.documentRoute,
          routeStatus.bank,
          routeStatus.direct,
          input.assignedTo ?? actor.id,
          input.destinationCountry ?? customer.country_code,
          now,
          now,
          actor.id,
        ),
      db
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
        ),
      ...templateItems,
      caseEventInsert(db, id, "CASE_CREATED", `Created ${candidate}`, actor.id),
      auditInsert(db, { actorId: actor.id, entityType: "export_case", entityId: id, action: "case.create", requestId }),
    ];
    if (input.invoice) {
      const plan = planInvoiceInsert(db, env, input.invoice, customer.id, id, now);
      statements.splice(3, 0, plan.statement);
      statements.push(
        auditInsert(db, { actorId: actor.id, entityType: "invoice", entityId: plan.id, action: "invoice.create", requestId }),
      );
    }
    try {
      await db.batch(statements);
      caseReference = candidate;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/UNIQUE constraint failed: export_invoices\.invoice_number/i.test(message)) {
        throw errors.conflict("Invoice number already exists", "INVOICE_NUMBER_TAKEN");
      }
      if (!/UNIQUE constraint failed: export_cases\.case_reference/i.test(message) || attempt === 7) {
        throw error;
      }
    }
  }
  if (!caseReference) throw errors.conflict("Could not allocate a case reference. Try again.", "CASE_REFERENCE_BUSY");
  // Reminders are derived state: they are recomputed after the record exists.
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
  if (current.version !== input.version) throw errors.conflict("Case was updated by someone else");
  assertCaseTransition(current.status as CaseStatus, to);
  if (to === "COMPLETED") {
    requirePermission(actor, "export_cases.close");
    const containers = await all<{ status: import("../../shared/enums").ContainerStatus }>(db, "SELECT status FROM containers WHERE case_id = ?", id);
    const deliveredContainerCount = containers.filter((c) => c.status === "DELIVERED_TO_CUSTOMER").length;
    // Closure follows the live non-cancelled slots. A stale expected_containers
    // figure, left behind when a slot is cancelled or added, must not demand a
    // delivery for a container that is no longer active. Every remaining slot
    // still has to reach the customer.
    const expectedContainerCount = containers.filter((c) => c.status !== "CANCELLED").length;
    const requirements = await all<{ required: number; status: string }>(
      db,
      "SELECT required, status FROM operation_document_requirements WHERE case_id = ?",
      id,
    );
    // Customer acceptance stays outside this decision. Closing is a staff action
    // gated by export_cases.close and the internal document and goods tracks.
    const decision = canCompleteCase({
      status: current.status as CaseStatus,
      route: current.document_route as DocumentRoute,
      bankStatus: current.bank_path_status as BankPathStatus,
      directStatus: current.direct_path_status as DirectPathStatus | null,
      containers,
      requirements,
      exceptionReason: input.reason,
      hasClosePermission: actor.permissions.has("export_cases.close"),
      expectedContainerCount,
      deliveredContainerCount,
    });
    if (!decision.ok) throw errors.conflict(decision.message, decision.code);
  }
  if (to === "ACTIVE" && current.status === "COMPLETED") requirePermission(actor, "export_cases.reopen");
  if (!customFieldsRequiredNow("EXPORT_CASE", current.status) && customFieldsRequiredNow("EXPORT_CASE", to)) {
    await assertRequiredCustomFields(db, "EXPORT_CASE", id);
  }
  const now = nowIso();
  const updated = await db
    .prepare(
      `UPDATE export_cases SET status = ?, closed_at = ?, close_exception_reason = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND version = ?`,
    )
    .bind(to, to === "COMPLETED" ? now : null, input.reason ?? null, now, id, input.version)
    .run();
  if (!updated.meta.changes) throw errors.conflict("Case was updated by someone else");
  if (to === "COMPLETED") {
    await db
      .prepare("UPDATE export_invoices SET edit_open = 0, updated_at = ? WHERE case_id = ? AND edit_open != 0")
      .bind(now, id)
      .run();
    const closedBookings = await db
      .prepare(
        `UPDATE bookings SET status = 'CLOSED', version = version + 1, updated_at = ?
         WHERE case_id = ? AND status NOT IN ('CANCELLED', 'CLOSED')`,
      )
      .bind(now, id)
      .run();
    if (closedBookings.meta.changes) {
      await writeCaseEvent(db, id, "BOOKING_STATUS", "Sea bookings closed with the case", actor.id);
    }
  }
  await writeCaseEvent(db, id, "CASE_STATUS", `Status ${current.status} → ${to}`, actor.id);
  await writeAudit(db, { actorId: actor.id, entityType: "export_case", entityId: id, action: "case.status", after: { to, reason: input.reason }, requestId });
  await recomputeRemindersForCase(db, env, id);
}

/**
 * Builds the invoice insert statement without writing it, so a case creation
 * can include the invoice in the same D1 batch as the case itself.
 */
function planInvoiceInsert(
  db: D1Database,
  env: Env,
  input: InvoiceWrite,
  customerId: string,
  caseId: string,
  now: string,
) {
  const priced = priceInvoice(input, env.INCOTERMS_EDITION_DEFAULT);
  const id = newId();
  const statement = db
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
      customerId,
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
    );
  return { id, statement };
}

export async function createInvoice(db: D1Database, actor: Actor, env: Env, caseId: string, input: InvoiceWrite, requestId: string) {
  requirePermission(actor, "invoices.edit");
  const current = await assertCaseAccess(db, actor, caseId);
  // The same lock that protects ordinary edits must also protect creation:
  // otherwise a completed operation could grow a brand-new invoice.
  await assertInvoiceOrdinaryWrite(db, caseId);
  const onCase = await one(db, "SELECT id FROM export_invoices WHERE case_id = ?", caseId);
  if (onCase) throw errors.conflict("This export operation already has its invoice.", "CASE_HAS_INVOICE");
  if (!input.invoiceNumber?.trim()) {
    throw errors.validation("Invoice number is required", { invoiceNumber: "Enter the invoice number." });
  }
  const existing = await one(db, "SELECT id FROM export_invoices WHERE invoice_number = ?", input.invoiceNumber.trim());
  if (existing) throw errors.conflict("This invoice number is already used. Enter a different number.", "INVOICE_NUMBER_TAKEN");
  const now = nowIso();
  // The invoice and its audit row are written together: a failure cannot leave
  // an invoice without its audit trail.
  const plan = planInvoiceInsert(db, env, { ...input, invoiceNumber: input.invoiceNumber.trim() }, current.customer_id, caseId, now);
  try {
    await db.batch([
      plan.statement,
      auditInsert(db, {
        actorId: actor.id,
        entityType: "invoice",
        entityId: plan.id,
        action: "invoice.create",
        requestId,
      }),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed: export_invoices\.invoice_number/i.test(message)) {
      throw errors.conflict("This invoice number is already used. Enter a different number.", "INVOICE_NUMBER_TAKEN");
    }
    if (/export_invoices_one_case_idx|UNIQUE constraint failed: export_invoices\.case_id/i.test(message)) {
      throw errors.conflict("This export operation already has its invoice.", "CASE_HAS_INVOICE");
    }
    throw error;
  }
  return { id: plan.id };
}

export async function updateInvoice(
  db: D1Database,
  actor: Actor,
  invoiceId: string,
  input: InvoiceWrite & { version: number },
  requestId: string,
) {
  const invoice = await one<Record<string, unknown> & { id: string; case_id: string; version: number; customer_id: string; edit_open: number }>(
    db,
    "SELECT * FROM export_invoices WHERE id = ?",
    invoiceId,
  );
  if (!invoice) throw errors.notFound("Invoice not found");
  await assertCaseAccess(db, actor, invoice.case_id);
  await assertInvoiceMutable(db, actor, invoice.case_id, invoice.edit_open);
  if (invoice.version !== input.version) throw errors.conflict("The invoice changed since you opened it. Refresh and review the correction again.", "INVOICE_VERSION");
  if (!input.invoiceNumber?.trim()) {
    throw errors.validation("Invoice number is required", { invoiceNumber: "Enter the invoice number." });
  }
  const duplicate = await one(
    db,
    "SELECT id FROM export_invoices WHERE invoice_number = ? AND id != ?",
    input.invoiceNumber,
    invoiceId,
  );
  if (duplicate) throw errors.conflict("Invoice number already exists", "INVOICE_NUMBER_TAKEN");
  const priced = priceInvoice(input, "Incoterms 2020");
  const now = nowIso();
  const afterInvoice = {
    ...invoice,
    invoice_number: input.invoiceNumber,
    invoice_date: input.invoiceDate,
    port_of_loading: input.portOfLoading ?? null,
    port_of_discharge: input.portOfDischarge ?? null,
    destination_country: input.destinationCountry ?? null,
    payment_term_code: input.paymentTermCode,
    payment_term_details: input.paymentTermDetails ?? null,
    due_days: input.dueDays ?? null,
    due_date: input.dueDate ?? null,
    incoterm: input.incoterm,
    incoterms_edition: input.incotermsEdition ?? "Incoterms 2020",
    named_place: input.namedPlace ?? null,
    currency: priced.goods.currency,
    currency_decimals: priced.goods.decimals,
    goods_value_minor: Number(priced.goods.minorUnits),
    invoiced_freight_minor: Number(priced.invoicedFreight.minorUnits),
    actual_freight_expense_minor: Number(priced.actualFreight.minorUnits),
    invoice_total_minor: Number(priced.total.minorUnits),
    gross_weight_grams: priced.gross,
    net_weight_grams: priced.net,
    units: input.units ?? null,
    notes: input.notes ?? null,
    version: invoice.version + 1,
  };
  const changes = invoiceFieldChanges(invoice, afterInvoice);
  const revisionRow = await one<{ n: number }>(db, "SELECT COALESCE(MAX(revision), 0) AS n FROM invoice_revisions WHERE invoice_id = ?", invoiceId);
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
  ];
  if (changes.length) {
    statements.push(
      db.prepare(
        `INSERT INTO invoice_revisions (id, invoice_id, case_id, revision, reason, actor_id, before_json, after_json, created_at)
         SELECT ?, ?, ?, ?, 'EDIT', ?, ?, ?, ?
         WHERE changes() = 1`,
      ).bind(
        newId(),
        invoiceId,
        invoice.case_id,
        (revisionRow?.n ?? 0) + 1,
        actor.id,
        JSON.stringify({ invoice }),
        JSON.stringify({ invoice: afterInvoice }),
        now,
      ),
    );
  }
  const [updated] = await db.batch(statements);
  if (!updated?.meta.changes) {
    throw errors.conflict("The invoice changed since you opened it. Refresh and review the correction again.", "INVOICE_VERSION");
  }
  await writeAudit(db, { actorId: actor.id, entityType: "invoice", entityId: invoiceId, action: "invoice.update", before: { invoice }, after: { invoice: afterInvoice }, requestId });
}

export async function setInvoiceEditWindow(
  db: D1Database,
  actor: Actor,
  invoiceId: string,
  input: { open: boolean; version: number },
  requestId: string,
) {
  requirePermission(actor, "invoices.correct_completed");
  const invoice = await one<Record<string, unknown> & { id: string; case_id: string; version: number; edit_open: number }>(
    db,
    "SELECT * FROM export_invoices WHERE id = ?",
    invoiceId,
  );
  if (!invoice) throw errors.notFound("Invoice not found");
  await assertCaseAccess(db, actor, invoice.case_id);
  const parent = await one<{ status: string }>(db, "SELECT status FROM export_cases WHERE id = ?", invoice.case_id);
  if (parent?.status !== "COMPLETED") {
    throw errors.conflict("Only a completed export operation has a locked invoice to open.", "INVOICE_NOT_LOCKED");
  }
  if (invoice.version !== input.version) throw errors.conflict("The invoice changed since you opened it. Refresh and review the correction again.", "INVOICE_VERSION");
  const open = input.open ? 1 : 0;
  if (invoice.edit_open === open) {
    throw errors.conflict(open ? "This invoice is already open for editing." : "This invoice is already locked.", open ? "INVOICE_ALREADY_OPEN" : "INVOICE_ALREADY_LOCKED");
  }
  const now = nowIso();
  const after = { ...invoice, edit_open: open, version: invoice.version + 1 };
  const revisionRow = await one<{ n: number }>(db, "SELECT COALESCE(MAX(revision), 0) AS n FROM invoice_revisions WHERE invoice_id = ?", invoiceId);
  const [updated] = await db.batch([
    db.prepare("UPDATE export_invoices SET edit_open = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?").bind(open, now, invoiceId, invoice.version),
    db.prepare(
      `INSERT INTO invoice_revisions (id, invoice_id, case_id, revision, reason, actor_id, before_json, after_json, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE changes() = 1`,
    ).bind(
      newId(),
      invoiceId,
      invoice.case_id,
      (revisionRow?.n ?? 0) + 1,
      open ? "OPEN" : "LOCK",
      actor.id,
      JSON.stringify({ invoice }),
      JSON.stringify({ invoice: after }),
      now,
    ),
  ]);
  if (!updated?.meta.changes) throw errors.conflict("The invoice changed since you opened it. Refresh and review the correction again.", "INVOICE_VERSION");
  await writeAudit(db, {
    actorId: actor.id,
    entityType: "invoice",
    entityId: invoiceId,
    action: open ? "invoice.open" : "invoice.lock",
    before: { editOpen: invoice.edit_open },
    after: { editOpen: open },
    requestId,
  });
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

export async function assertInvoiceMutable(db: D1Database, actor: Actor, caseId: string, editOpen: number) {
  const row = await one<{ status: string }>(db, "SELECT status FROM export_cases WHERE id = ?", caseId);
  if (row?.status === "COMPLETED") {
    if (editOpen === 1 && actor.permissions.has("invoices.correct_completed")) return;
    throw errors.conflict(
      "This invoice is locked because the export operation is completed. Open it for editing first.",
      "INVOICE_LOCKED",
    );
  }
  requirePermission(actor, "invoices.edit");
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
  const rows = await all<{ id: string; revision: number; reason: string; actor_id: string | null; actor_name: string | null; before_json: string; after_json: string; created_at: string }>(
    db,
    `SELECT r.id, r.revision, r.reason, r.actor_id, u.name AS actor_name, r.before_json, r.after_json, r.created_at
     FROM invoice_revisions r
     LEFT JOIN user u ON u.id = r.actor_id
     WHERE r.invoice_id = ?
     ORDER BY r.revision DESC`,
    invoiceId,
  );
  const withChanges = (row: (typeof rows)[number], beforeJson: string, afterJson: string) => ({
    ...row,
    before_json: beforeJson,
    after_json: afterJson,
    changes: changesFromRevision(beforeJson, afterJson),
  });
  if (actor.permissions.has("settings.manage")) return rows.map((row) => withChanges(row, row.before_json, row.after_json));
  const sensitive = new Set(
    (await all<{ field_key: string }>(db, "SELECT field_key FROM custom_field_definitions WHERE target_entity = 'INVOICE' AND sensitive = 1")).map((row) => row.field_key),
  );
  return rows.map((row) => {
    const beforeJson = redactRevisionJson(row.before_json, sensitive);
    const afterJson = redactRevisionJson(row.after_json, sensitive);
    return withChanges(row, beforeJson, afterJson);
  });
}

const INVOICE_DIFF_FIELDS = [
  "invoice_number",
  "invoice_date",
  "incoterm",
  "currency",
  "payment_term_code",
  "payment_term_details",
  "named_place",
  "port_of_loading",
  "port_of_discharge",
  "destination_country",
  "notes",
  "goods_value_minor",
  "invoiced_freight_minor",
  "actual_freight_expense_minor",
  "invoice_total_minor",
  "gross_weight_grams",
  "net_weight_grams",
  "edit_open",
] as const;

function invoiceFieldChanges(before: Record<string, unknown>, after: Record<string, unknown>) {
  const changes: { field: string; before: string; after: string }[] = [];
  for (const field of INVOICE_DIFF_FIELDS) {
    const left = displayInvoiceField(field, before);
    const right = displayInvoiceField(field, { ...before, ...after, [field]: field in after ? after[field] : before[field] });
    if (left !== right) changes.push({ field, before: left, after: right });
  }
  return changes;
}

function changesFromRevision(beforeJson: string, afterJson: string) {
  try {
    const before = JSON.parse(beforeJson) as { invoice?: Record<string, unknown> };
    const after = JSON.parse(afterJson) as { invoice?: Record<string, unknown> };
    if (!before.invoice || !after.invoice) return [];
    return invoiceFieldChanges(before.invoice, after.invoice);
  } catch {
    return [];
  }
}

function displayInvoiceField(field: string, row: Record<string, unknown>) {
  const value = row[field];
  if (value == null || value === "") return "";
  if (field.endsWith("_minor")) {
    const decimals = Number(row.currency_decimals ?? 2);
    return `${minorToDecimalString(value as number, Number.isFinite(decimals) ? decimals : 2)} ${String(row.currency ?? "")}`.trim();
  }
  if (field.endsWith("_grams")) return `${Number(value) / 1000} kg`;
  if (field === "edit_open") return Number(value) === 1 ? "1" : "0";
  return String(value);
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

function parseMoney(value: string, currency: string) {
  try {
    return parseDecimalToMinor(value, currency);
  } catch {
    throw errors.validation(
      "Enter the amount with digits only, for example 140000.00 or 140,000.00.",
      { amount: "Use digits, with a dot for the fraction and a comma for thousands." },
      "INVOICE_AMOUNT_INVALID",
    );
  }
}

function parseWeight(value: number, unit: WeightUnit) {
  if (unit !== "G" && unit !== "KG" && unit !== "T") {
    throw errors.validation("Choose a supported weight unit.", { weightUnit: "Use G, KG, or T." }, "INVOICE_WEIGHT_INVALID");
  }
  try {
    return toGrams(value, unit);
  } catch {
    throw errors.validation(
      "Enter a valid non-negative weight.",
      { weight: "Enter zero or a positive number." },
      "INVOICE_WEIGHT_INVALID",
    );
  }
}

function priceInvoice(input: InvoiceWrite, editionDefault: string | undefined) {
  const goods = parseMoney(input.goodsValue, input.currency);
  const invoicedFreight = parseMoney(input.invoicedFreight ?? "0", input.currency);
  const actualFreight = parseMoney(input.actualFreightExpense ?? "0", input.currency);
  // The commercial total is always goods + freight written on the invoice.
  // Actual freight stays an internal cost and is not added again.
  const total = {
    minorUnits: derivedGoodsPlusInvoicedFreight(goods.minorUnits, invoicedFreight.minorUnits),
    currency: goods.currency,
    decimals: goods.decimals,
  };
  const unit = input.weightUnit ?? "KG";
  const gross = parseWeight(input.grossWeight, unit);
  const net = parseWeight(input.netWeight, unit);
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
