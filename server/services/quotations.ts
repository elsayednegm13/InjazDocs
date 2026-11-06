import { renderQuotationPdf, type QuotationPdfItem, type QuotationPdfSnapshot } from "./quotation-pdf";
import { all, newId, nowIso, one } from "../db/sql";
import { errors } from "../http/errors";
import type { Actor } from "./actor";
import { assertCaseAccess, caseVisibilitySql, requirePermission } from "./actor";
import { csvCell } from "./reports";
import { assertSchemaReady } from "./schema";

/**
 * Fail closed on any quotation access when the store has not applied 0010
 * (W2, CR-11): 503 SCHEMA_UPGRADE_REQUIRED instead of an obscure 500.
 */
function assertQuotationSchemaReady(db: D1Database): Promise<void> {
  return assertSchemaReady(db, "quotations");
}

/**
 * W2 independent quotations / proforma (owner-approved scope D-10).
 *
 * A quotation is a separate commercial document with its own manual number and
 * its own lifecycle (D-02). It is created without an export case and can be
 * linked to at most one case later (D-09). Once issued, its items are frozen:
 * every subsequent change goes through a new immutable revision whose issued
 * snapshot also backs the PDF (D-06), so a later case link can never rewrite an
 * already issued document.
 *
 * Money (D-05): USD only; quantities up to 3 fractional digits, unit prices up
 * to 4. Every line total is ROUND_HALF_UP to integer cents and the subtotal is
 * the sum of the line cents. All arithmetic is bigint; binary floats never
 * decide money here.
 *
 * Atomicity: every mutation writes its business row(s) and the audit row in the
 * same `db.batch`. Statements after the first are guarded with
 * `WHERE changes() = 1`, so a stale optimistic version rolls back the whole
 * batch and leaves no orphan rows (same pattern as correctCompletedInvoice).
 */

const QUOTE_NUMBER_PATTERN = /^[A-Z0-9/_-]{1,40}$/;

const EASTERN_ARABIC_DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};
const PERSIAN_DIGITS: Record<string, string> = {
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

export type QuoteNumber = { number: string; display: string };

/**
 * D-03 normalization: trim; Arabic-Indic/Persian digits become Latin for the
 * canonical number; interior whitespace is refused with 422; then ASCII
 * uppercase. `display` keeps the trimmed text the operator entered.
 */
export function normalizeQuoteNumber(raw: unknown): QuoteNumber {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) {
    throw errors.validation("The quotation number is required", { quoteNumber: "Enter the quotation number." }, "QUOTE_NUMBER_REQUIRED");
  }
  let latin = "";
  for (const ch of text) {
    latin += EASTERN_ARABIC_DIGITS[ch] ?? PERSIAN_DIGITS[ch] ?? ch;
  }
  if (/\s/.test(latin)) {
    throw errors.validation(
      "Remove the spaces inside the quotation number",
      { quoteNumber: "The number must be one word of letters, digits, / _ or -." },
      "QUOTE_NUMBER_INVALID_FORMAT",
    );
  }
  const upper = latin.toUpperCase();
  if (!QUOTE_NUMBER_PATTERN.test(upper)) {
    throw errors.validation(
      "The quotation number format is not supported",
      { quoteNumber: "Use 1–40 letters, digits, / _ or -." },
      "QUOTE_NUMBER_INVALID_FORMAT",
    );
  }
  return { number: upper, display: text };
}

export type QuotationItemWrite = {
  description: string;
  quantity: string;
  unitLabel?: string | null;
  unitPrice: string;
};

export type QuotationWrite = {
  quoteNumber: string;
  customerId: string;
  title?: string | null;
  incoterm?: string | null;
  paymentTerms?: string | null;
  notes?: string | null;
  validityDays?: number;
  items?: QuotationItemWrite[];
};

export type QuoteStatus =
  | "DRAFT"
  | "ISSUED"
  | "ACCEPTED"
  | "REJECTED"
  | "EXPIRED";

/**
 * Expiry is effective: the stored status stays "ISSUED" after validity ends;
 * every read and every mutating guard computes the effective status instead,
 * so no cron and no background DB rewrite are ever needed (CR-3).
 */
export function effectiveQuoteStatus(
  quote: { status: string; valid_until: string | null },
  now: Date = new Date(),
): QuoteStatus {
  if (quote.status === "ISSUED" && quote.valid_until && new Date(quote.valid_until) < now) {
    return "EXPIRED";
  }
  return quote.status as QuoteStatus;
}

function utcEndOfDayPlus(issuedAtIso: string, days: number): string {
  const day = new Date(issuedAtIso).toISOString().slice(0, 10);
  const end = new Date(`${day}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + days);
  return `${end.toISOString().slice(0, 10)}T23:59:59.000Z`;
}

/** qty3/price4 are the exact decimal values scaled by 10^3/10^4; result is integer cents, ROUND_HALF_UP. */
export function lineTotalMinorOf(qty3: bigint, price4: bigint): bigint {
  const value = qty3 * price4; // exact value scaled by 10^7
  const base = 100000n;
  const quotient = value / base;
  const remainder = value % base;
  return remainder * 2n >= base ? quotient + 1n : quotient;
}

type PreparedItem = {
  write: QuotationItemWrite;
  qty3: bigint;
  price4: bigint;
  total: bigint;
  source?: { quotationId: string; itemId: string; lineTotal: number };
};

function parseExactDecimal(raw: unknown, field: "quantity" | "unitPrice", maxFrac: number): { text: string; minor: bigint } {
  const text = typeof raw === "string" ? raw.trim() : "";
  const code = field === "quantity" ? "QUOTE_LINE_QUANTITY_INVALID" : "QUOTE_LINE_PRICE_INVALID";
  const digits = text.includes(".") ? text.split(".")[0] : text;
  if (!/^\d+(\.\d{1,4})?$/.test(text) || digits.length > 12) {
    throw errors.validation(
      field === "quantity" ? "Enter a positive quantity" : "Enter a positive price",
      { [field]: "Use digits only." },
      code,
    );
  }
  const [wholeRaw, fracRaw = ""] = text.split(".");
  if (fracRaw.length > maxFrac) {
    throw errors.validation(
      field === "quantity" ? "Up to 3 fractional digits" : "Up to 4 fractional digits",
      { [field]: field === "quantity" ? "Use up to 3 fractional digits." : "Use up to 4 fractional digits." },
      code,
    );
  }
  const frac = fracRaw.padEnd(maxFrac, "0");
  const minor = BigInt(wholeRaw) * 10n ** BigInt(maxFrac) + BigInt(frac || "0");
  return { text, minor };
}

function prepareItems(items: QuotationItemWrite[] | undefined): PreparedItem[] {
  if (items == null) return [];
  if (!Array.isArray(items)) throw errors.validation("Items must be a list", {}, "QUOTE_ITEMS_INVALID");
  return items.map((item) => {
    if (typeof item?.description !== "string" || !item.description.trim() || item.description.length > 500) {
      throw errors.validation("Each item needs a description of at most 500 characters", {}, "QUOTE_ITEMS_INVALID");
    }
    const qty = parseExactDecimal(item.quantity, "quantity", 3);
    const price = parseExactDecimal(item.unitPrice, "unitPrice", 4);
    const unitLabel = typeof item.unitLabel === "string" ? item.unitLabel.trim() || null : null;
    return {
      write: { description: item.description.trim(), quantity: qty.text, unitLabel, unitPrice: price.text },
      qty3: qty.minor,
      price4: price.minor,
      total: lineTotalMinorOf(qty.minor, price.minor),
    };
  });
}

type QuoteRow = {
  id: string;
  quote_number: string;
  quote_number_display: string;
  customer_id: string;
  title: string | null;
  currency: string;
  incoterm: string | null;
  payment_terms: string | null;
  notes: string | null;
  status: string;
  validity_days: number;
  issued_at: string | null;
  valid_until: string | null;
  client_response: string | null;
  client_response_at: string | null;
  client_response_by: string | null;
  case_id: string | null;
  created_by: string;
  archived_at: string | null;
  archived_by: string | null;
  archived_reason: string | null;
  subtotal_minor: number;
  active_revision: number;
  version: number;
  created_at: string;
  updated_at: string;
};

type CustomerRow = {
  id: string;
  legal_name: string;
  trade_name: string | null;
};

type ItemRow = {
  id: string;
  quotation_id: string;
  revision: number;
  position: number;
  description: string;
  quantity_text: string;
  quantity_minor: number;
  unit_label: string | null;
  unit_price_text: string;
  unit_price_minor_4: number;
  currency: string;
  line_total_minor: number;
  source_quotation_id: string | null;
  source_item_id: string | null;
  source_line_total_minor: number | null;
};

const ITEM_COLUMNS =
  "id, quotation_id, revision, position, description, quantity_text, quantity_minor, unit_label, unit_price_text, unit_price_minor_4, currency, line_total_minor, source_quotation_id, source_item_id, source_line_total_minor";

async function loadQuote(db: D1Database, id: string): Promise<QuoteRow> {
  const quote = await one<QuoteRow>(db, "SELECT * FROM quotations WHERE id = ?", id);
  if (!quote) throw errors.notFound("Quotation not found");
  return quote;
}

function notFound() {
  return errors.notFound("Quotation not found");
}

function staleVersion() {
  return errors.conflict("The quotation changed since you opened it. Refresh and retry.", "QUOTE_VERSION");
}

function isUniqueConstraint(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /unique|constraint/i.test(text);
}

/**
 * D-04 / D-09 visibility, checked server-side in the request itself:
 *   - quotations.view is required in every case;
 *   - holders of quotations.view_all see everything;
 *   - unlinked quotations are creator-only;
 *   - linked quotations additionally need the export-case scope.
 */
export async function assertQuoteReadAccess(db: D1Database, actor: Actor, quote: QuoteRow): Promise<void> {
  requirePermission(actor, "quotations.view");
  if (actor.permissions.has("quotations.view_all")) return;
  if (!quote.case_id) {
    if (quote.created_by === actor.id) return;
    throw errors.coded(403, "OPERATION_NOT_ACCESSIBLE", "You cannot view this quotation, or it is not available.");
  }
  await assertCaseAccess(db, actor, quote.case_id);
}

function assertDraftEditable(quote: QuoteRow): void {
  if (quote.status !== "DRAFT") {
    throw errors.conflict("Only a draft quotation can be edited. Issue a revision instead.", "QUOTE_NOT_EDITABLE");
  }
}

/** Link/relink needs quotations.edit + export_cases.edit on the target case and its actual scope (D-09). */
export async function assertQuoteCaseEditAccess(db: D1Database, actor: Actor, caseId: string): Promise<void> {
  requirePermission(actor, "export_cases.edit");
  await assertCaseAccess(db, actor, caseId);
}

async function companyDisplayName(db: D1Database): Promise<string> {
  const settings = await one<{ exporter_display_name: string }>(
    db,
    "SELECT exporter_display_name FROM company_settings WHERE id = 'default'",
  );
  return settings?.exporter_display_name || "ExportFlow";
}

type AddressRow = {
  line1: string;
  line2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country_code: string | null;
};

async function commercialAddress(db: D1Database, customerId: string): Promise<string | null> {
  const row = (await one<AddressRow>(
    db,
    `SELECT line1, line2, city, region, postal_code, country_code
     FROM customer_addresses
     WHERE customer_id = ? AND kind = 'BILLING'
     ORDER BY is_primary DESC, id
     LIMIT 1`,
    customerId,
  )) ??
    (await one<AddressRow>(
      db,
      `SELECT line1, line2, city, region, postal_code, country_code
       FROM customer_addresses
       WHERE customer_id = ? AND kind = 'SHIPPING'
       ORDER BY is_primary DESC, id
       LIMIT 1`,
      customerId,
    ));
  if (!row) return null;
  const text = [
    row.line1,
    row.line2,
    row.city,
    row.region,
    row.postal_code,
    row.country_code,
  ]
    .filter((part) => part && String(part).trim())
    .map((part) => String(part).trim())
    .join(", ")
    .slice(0, 500);
  return text || null;
}

async function buyerIdentity(db: D1Database, customerId: string): Promise<{ name: string; address: string | null }> {
  const customer = await one<CustomerRow>(db, "SELECT id, legal_name, trade_name FROM customers WHERE id = ?", customerId);
  return {
    name: customer?.trade_name || customer?.legal_name || "",
    address: await commercialAddress(db, customerId),
  };
}

async function caseReferenceOf(db: D1Database, caseId: string | null): Promise<string | null> {
  if (!caseId) return null;
  const row = await one<{ case_reference: string }>(db, "SELECT case_reference FROM export_cases WHERE id = ?", caseId);
  return row?.case_reference ?? null;
}

function pdfItem(item: ItemRow): QuotationPdfItem {
  return {
    position: item.position,
    description: item.description,
    quantityText: item.quantity_text,
    unitLabel: item.unit_label ?? "",
    unitPriceText: item.unit_price_text,
    lineTotalMinor: Number(item.line_total_minor),
    sourceQuotationId: item.source_quotation_id ?? undefined,
    sourceItemId: item.source_item_id ?? undefined,
    sourceLineTotalMinor: item.source_line_total_minor == null ? undefined : Number(item.source_line_total_minor),
  };
}

function snapshotFromQuote(
  quote: QuoteRow,
  revision: number,
  companyName: string,
  buyer: { name: string; address: string | null },
  caseReference: string | null,
  items: ItemRow[],
): QuotationPdfSnapshot {
  const subtotal = items.reduce((sum, item) => sum + Number(item.line_total_minor), 0);
  return {
    quoteNumber: quote.quote_number_display,
    revision,
    status: quote.status,
    issuedAt: quote.issued_at ?? "",
    validUntil: quote.valid_until ?? "",
    companyName,
    customerName: buyer.name,
    customerAddress: buyer.address ?? "",
    caseReference: caseReference ?? "",
    currency: "USD",
    subtotalMinor: subtotal,
    paymentTerms: quote.payment_terms ?? "",
    notes: quote.notes ?? "",
    incoterm: quote.incoterm ?? "",
    items: items.map(pdfItem),
  };
}

function normalizeReason(raw: unknown, fallback: string): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  const value = text || fallback;
  if (value.length < 3 || value.length > 500) {
    throw errors.validation("Write a reason of 3–500 characters", { reason: "3–500 characters." }, "QUOTE_REASON");
  }
  return value;
}

function itemInsertStatement(db: D1Database, quotationId: string, revision: number, prepared: PreparedItem, position: number, now: string, conditional: boolean): D1PreparedStatement {
  const columns = `id, quotation_id, revision, position, description, quantity_text, quantity_minor, unit_label,
        unit_price_text, unit_price_minor_4, currency, line_total_minor,
        source_quotation_id, source_item_id, source_line_total_minor, created_at, updated_at`;
  const sql = conditional
    ? `INSERT INTO quotation_items (${columns})
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ? WHERE changes() = 1`
    : `INSERT INTO quotation_items (${columns})
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?)`;
  return db.prepare(sql).bind(
    newId(),
    quotationId,
    revision,
    position,
    prepared.write.description,
    prepared.write.quantity,
    Number(prepared.qty3),
    prepared.write.unitLabel,
    prepared.write.unitPrice,
    Number(prepared.price4),
    Number(prepared.total),
    prepared.source?.quotationId ?? null,
    prepared.source?.itemId ?? null,
    prepared.source?.lineTotal ?? null,
    now,
    now,
  );
}

function preparedCopy(item: ItemRow): PreparedItem {
  return {
    write: {
      description: item.description,
      quantity: item.quantity_text,
      unitLabel: item.unit_label,
      unitPrice: item.unit_price_text,
    },
    qty3: BigInt(item.quantity_minor),
    price4: BigInt(item.unit_price_minor_4),
    total: BigInt(item.line_total_minor),
    source: {
      quotationId: item.quotation_id,
      itemId: item.id,
      lineTotal: Number(item.line_total_minor),
    },
  };
}

function quoteAuditStatement(
  db: D1Database,
  actor: Actor,
  entityId: string,
  action: string,
  requestId: string,
  now: string,
  payload?: { after?: unknown; before?: unknown; reason?: string },
  conditional = false,
): D1PreparedStatement {
  const body = JSON.stringify({
    ...(payload?.before !== undefined ? { before: payload.before } : {}),
    ...(payload?.after !== undefined ? { after: payload.after } : {}),
  });
  const sql = conditional
    ? `INSERT INTO audit_log (id, actor_id, entity_type, entity_id, action, after_json, reason, origin, request_id, created_at)
       SELECT ?, ?, 'quotation', ?, ?, ?, ?, 'API', ?, ? WHERE changes() = 1`
    : `INSERT INTO audit_log (id, actor_id, entity_type, entity_id, action, after_json, reason, origin, request_id, created_at)
       VALUES (?, ?, 'quotation', ?, ?, ?, ?, 'API', ?, ?)`;
  return db.prepare(sql).bind(
    newId(),
    actor.id,
    entityId,
    action,
    body,
    payload?.reason ?? null,
    requestId,
    now,
  );
}

/* ------------------------------------------------------------------ reads -- */

export async function listQuotations(
  db: D1Database,
  actor: Actor,
  query: { page?: unknown; pageSize?: unknown; q?: string; status?: string; archived?: string },
) {
  await assertQuotationSchemaReady(db);
  requirePermission(actor, "quotations.view");
  const pageSizeRaw = Number(query.pageSize);
  const pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? Math.min(100, Math.floor(pageSizeRaw)) : 20;
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const showArchived = query.archived === "1" || query.archived === "true";
  const viewAll = actor.permissions.has("quotations.view_all");
  const vis = caseVisibilitySql(actor, "c");
  const filters: string[] = [showArchived ? "1=1" : "q.archived_at IS NULL"];
  const binds: unknown[] = [];
  if (!viewAll) {
    filters.push(
      `((q.case_id IS NOT NULL AND (${vis.sql})) OR (q.case_id IS NULL AND q.created_by = ?))`,
    );
    binds.push(...vis.binds, actor.id);
  }
  if (query.q?.trim()) {
    const like = `%${query.q.trim()}%`;
    filters.push("(q.quote_number LIKE ? OR q.quote_number_display LIKE ? OR COALESCE(q.title, '') LIKE ?)");
    binds.push(like, like, like);
  }
  if (query.status?.trim()) {
    filters.push("q.status = ?");
    binds.push(query.status.trim().toUpperCase());
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  const rows = await all<Record<string, unknown>>(
    db,
    `SELECT q.id, q.quote_number, q.quote_number_display, q.title, q.customer_id, cu.legal_name AS customer_name,
            q.status, q.validity_days, q.issued_at, q.valid_until, q.client_response, q.case_id, c.case_reference,
            q.archived_at, q.subtotal_minor, q.active_revision, q.created_by, q.created_at, q.updated_at
     FROM quotations q
     LEFT JOIN export_cases c ON c.id = q.case_id
     LEFT JOIN customers cu ON cu.id = q.customer_id
     ${where}
     ORDER BY COALESCE(q.issued_at, q.created_at) DESC
     LIMIT ? OFFSET ?`,
    ...binds,
    pageSize,
    (page - 1) * pageSize,
  );
  const count = await one<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n
     FROM quotations q
     LEFT JOIN export_cases c ON c.id = q.case_id
     ${where}`,
    ...binds,
  );
  return { rows, page, pageSize, total: count?.n ?? 0 };
}

export async function getQuotation(db: D1Database, actor: Actor, id: string) {
  await assertQuotationSchemaReady(db);
  const quote = await loadQuote(db, id);
  await assertQuoteReadAccess(db, actor, quote);
  const [customer, items, revisions] = await Promise.all([
    one<CustomerRow>(db, "SELECT id, legal_name, trade_name FROM customers WHERE id = ?", quote.customer_id),
    all<ItemRow>(
      db,
      `SELECT ${ITEM_COLUMNS} FROM quotation_items WHERE quotation_id = ? AND revision = ? ORDER BY position`,
      id,
      quote.active_revision,
    ),
    all<Record<string, unknown>>(
      db,
      `SELECT id, revision, reason, actor_id, issued_at, valid_until, company_name, customer_name, customer_address,
              case_reference, currency, subtotal_minor, created_at
       FROM quotation_revisions
       WHERE quotation_id = ?
       ORDER BY revision`,
      id,
    ),
  ]);
  return { quote, customer, items, revisions, effectiveStatus: effectiveQuoteStatus(quote) };
}

export async function listQuotationRevisions(db: D1Database, actor: Actor, id: string) {
  await assertQuotationSchemaReady(db);
  const quote = await loadQuote(db, id);
  await assertQuoteReadAccess(db, actor, quote);
  const rows = await all<Record<string, unknown>>(
    db,
    `SELECT id, revision, reason, actor_id, issued_at, valid_until, company_name, customer_name, customer_address,
            case_reference, currency, subtotal_minor, created_at
     FROM quotation_revisions
     WHERE quotation_id = ?
     ORDER BY revision`,
    id,
  );
  return { rows };
}

/* ---------------------------------------------------------------- mutations */

export async function createQuotation(
  db: D1Database,
  actor: Actor,
  input: QuotationWrite,
  requestId: string,
) {
  await assertQuotationSchemaReady(db);
  requirePermission(actor, "quotations.create");
  const normalized = normalizeQuoteNumber(input.quoteNumber);
  const customerId = typeof input.customerId === "string" ? input.customerId.trim() : "";
  if (!customerId) throw errors.validation("The customer is required", { customerId: "Choose a customer." });
  const customer = await one<CustomerRow>(
    db,
    "SELECT id, legal_name, trade_name FROM customers WHERE id = ? AND archived_at IS NULL",
    customerId,
  );
  if (!customer) throw errors.validation("Choose an existing customer", { customerId: "Choose an existing customer." });
  const prepared = prepareItems(input.items);
  const now = nowIso();
  const id = newId();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO quotations (
          id, quote_number, quote_number_display, customer_id, title, currency, incoterm, payment_terms, notes,
          status, validity_days, case_id, created_by, subtotal_minor, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'USD', ?, ?, ?, 'DRAFT', ?, NULL, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        normalized.number,
        normalized.display,
        customerId,
        typeof input.title === "string" ? input.title.trim() || null : null,
        typeof input.incoterm === "string" ? input.incoterm.trim() || null : null,
        typeof input.paymentTerms === "string" ? input.paymentTerms.trim() || null : null,
        typeof input.notes === "string" ? input.notes.trim() || null : null,
        typeof input.validityDays === "number" && Number.isInteger(input.validityDays)
          ? Math.min(365, Math.max(1, input.validityDays))
          : 30,
        actor.id,
        prepared.reduce((sum, item) => sum + Number(item.total), 0),
        now,
        now,
      ),
    ...prepared.map((item, index) => itemInsertStatement(db, id, 0, item, index + 1, now, false)),
    quoteAuditStatement(
      db,
      actor,
      id,
      "quotation.create",
      requestId,
      now,
      { after: { quoteNumber: normalized.number, customerId, itemCount: prepared.length } },
      false,
    ),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    if (isUniqueConstraint(error)) {
      throw errors.conflict("A quotation with this number already exists", "QUOTE_NUMBER_TAKEN");
    }
    throw error;
  }
  return { id, quoteNumber: normalized.number, revision: 0 };
}

export async function updateQuotation(
  db: D1Database,
  actor: Actor,
  id: string,
  input: QuotationWrite & { version: number },
  requestId: string,
) {
  await assertQuotationSchemaReady(db);
  requirePermission(actor, "quotations.edit");
  const quote = await loadQuote(db, id);
  await assertQuoteReadAccess(db, actor, quote);
  assertDraftEditable(quote);
  if (quote.version !== input.version) {
    throw staleVersion();
  }
  const normalized = normalizeQuoteNumber(input.quoteNumber);
  const duplicate = await one<{ id: string }>(
    db,
    "SELECT id FROM quotations WHERE quote_number = ? AND id != ?",
    normalized.number,
    id,
  );
  if (duplicate) throw errors.conflict("A quotation with this number already exists", "QUOTE_NUMBER_TAKEN");
  const customerId = typeof input.customerId === "string" ? input.customerId.trim() : "";
  if (customerId && customerId !== quote.customer_id) {
    const customer = await one<CustomerRow>(
      db,
      "SELECT id, legal_name, trade_name FROM customers WHERE id = ? AND archived_at IS NULL",
      customerId,
    );
    if (!customer) throw errors.validation("Choose an existing customer", { customerId: "Choose an existing customer." });
  }
  const now = nowIso();
  const [updated] = await db.batch([
    db
      .prepare(
        `UPDATE quotations SET
          quote_number=?, quote_number_display=?, customer_id=?, title=?, incoterm=?, payment_terms=?, notes=?,
          validity_days=?, version=version+1, updated_at=?
         WHERE id=? AND version=? AND status='DRAFT'`,
      )
      .bind(
        normalized.number,
        normalized.display,
        customerId || quote.customer_id,
        typeof input.title === "string" ? input.title.trim() || null : quote.title,
        typeof input.incoterm === "string" ? input.incoterm.trim() || null : quote.incoterm,
        typeof input.paymentTerms === "string" ? input.paymentTerms.trim() || null : quote.payment_terms,
        typeof input.notes === "string" ? input.notes.trim() || null : quote.notes,
        typeof input.validityDays === "number" && Number.isInteger(input.validityDays)
          ? Math.min(365, Math.max(1, input.validityDays))
          : quote.validity_days,
        now,
        id,
        quote.version,
      ),
    quoteAuditStatement(db, actor, id, "quotation.update", requestId, now, { before: { version: quote.version } }, true),
  ]);
  if (!updated?.meta.changes) {
    throw staleVersion();
  }
  return { ok: true };
}

async function loadActiveItems(db: D1Database, quote: QuoteRow): Promise<ItemRow[]> {
  return all<ItemRow>(
    db,
    `SELECT ${ITEM_COLUMNS} FROM quotation_items WHERE quotation_id = ? AND revision = ? ORDER BY position`,
    quote.id,
    quote.active_revision,
  );
}

function assertIssueableItems(items: ItemRow[]): void {
  if (!items.length) {
    throw errors.validation("Add at least one item before issuing.", { items: "Add at least one item." }, "QUOTE_ITEMS_EMPTY");
  }
  for (const item of items) {
    if (Number(item.quantity_minor) <= 0) {
      throw errors.validation(
        `Item ${item.position}: quantity must be greater than zero before issuing.`,
        {},
        "QUOTE_LINE_QUANTITY_ZERO",
      );
    }
    if (Number(item.unit_price_minor_4) <= 0) {
      throw errors.validation(
        `Item ${item.position}: unit price must be greater than zero before issuing.`,
        {},
        "QUOTE_LINE_PRICE_ZERO",
      );
    }
  }
}

function resolveValidityDays(quote: QuoteRow, requested: unknown): number {
  const days = typeof requested === "number" && Number.isInteger(requested) ? requested : quote.validity_days;
  if (days < 1 || days > 365) {
    throw errors.validation("Validity must be between 1 and 365 days", { validityDays: "Enter 1–365." }, "QUOTE_VALIDITY_INVALID");
  }
  return days;
}

export async function issueQuotation(
  db: D1Database,
  actor: Actor,
  id: string,
  input: { reason?: string; validityDays?: number },
  requestId: string,
) {
  await assertQuotationSchemaReady(db);
  requirePermission(actor, "quotations.issue");
  const quote = await loadQuote(db, id);
  await assertQuoteReadAccess(db, actor, quote);
  if (quote.status !== "DRAFT") {
    throw errors.conflict("Only a draft quotation can be issued.", "QUOTE_NOT_DRAFT");
  }
  const items = await loadActiveItems(db, quote);
  assertIssueableItems(items);
  const validityDays = resolveValidityDays(quote, input?.validityDays);
  const reason = normalizeReason(input?.reason, "First issue");
  const now = nowIso();
  const validUntil = utcEndOfDayPlus(now, validityDays);
  const buyer = await buyerIdentity(db, quote.customer_id);
  const snapshot = snapshotFromQuote(quote, 1, await companyDisplayName(db), buyer, await caseReferenceOf(db, quote.case_id), items);
  snapshot.status = "ISSUED";
  snapshot.issuedAt = now;
  snapshot.validUntil = validUntil;
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE quotations SET
          status='ISSUED', validity_days=?, issued_at=?, valid_until=?, subtotal_minor=?,
          active_revision=1, version=version+1, updated_at=?
         WHERE id=? AND version=? AND status='DRAFT'`,
      )
      .bind(validityDays, now, validUntil, snapshot.subtotalMinor, now, id, quote.version),
    db
      .prepare(
        `INSERT INTO quotation_revisions (
          id, quotation_id, revision, reason, actor_id, issued_at, valid_until, company_name, customer_name,
          customer_address, case_reference, currency, subtotal_minor, snapshot_json, before_json, created_at
        ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?)`,
      )
      .bind(
        newId(),
        id,
        reason,
        actor.id,
        now,
        validUntil,
        snapshot.companyName,
        snapshot.customerName,
        snapshot.customerAddress || null,
        snapshot.caseReference || null,
        snapshot.subtotalMinor,
        JSON.stringify(snapshot),
        JSON.stringify({ version: quote.version, status: "DRAFT", issuedAt: null, validUntil: null }),
        now,
      ),
    quoteAuditStatement(db, actor, id, "quotation.issue", requestId, now, { after: { revision: 1, validUntil }, reason }, true),
  ];
  items.forEach((item, index) => {
    statements.push(itemInsertStatement(db, id, 1, preparedCopy(item), index + 1, now, true));
  });
  const [updated] = await db.batch(statements);
  if (!updated?.meta.changes) {
    throw staleVersion();
  }
  return { ok: true, revision: 1, validUntil };
}

export async function recordQuotationResponse(
  db: D1Database,
  actor: Actor,
  id: string,
  input: { response: string },
  requestId: string,
) {
  await assertQuotationSchemaReady(db);
  requirePermission(actor, "quotations.record_response");
  const quote = await loadQuote(db, id);
  await assertQuoteReadAccess(db, actor, quote);
  const response = typeof input.response === "string" ? input.response.trim().toUpperCase() : "";
  if (response !== "ACCEPTED" && response !== "REJECTED") {
    throw errors.validation("The client response must be ACCEPTED or REJECTED", { response: "ACCEPTED or REJECTED." }, "QUOTE_RESPONSE_INVALID");
  }
  const effective = effectiveQuoteStatus(quote);
  if (effective === "EXPIRED") {
    throw errors.conflict("The quotation validity has ended. Issue a revision to send it again.", "QUOTE_EXPIRED");
  }
  if (effective !== "ISSUED") {
    throw errors.conflict(
      "The client response is already recorded. Issue a revision to send the quotation again.",
      "QUOTE_RESPONSE_RECORDED",
    );
  }
  const now = nowIso();
  const [updated] = await db.batch([
    db
      .prepare(
        `UPDATE quotations SET
          status=?, client_response=?, client_response_at=?, client_response_by=?,
          version=version+1, updated_at=?
         WHERE id=? AND version=? AND status='ISSUED' AND (valid_until IS NULL OR valid_until >= ?)`,
      )
      .bind(response, response, now, actor.id, now, id, quote.version, now),
    quoteAuditStatement(db, actor, id, "quotation.response", requestId, now, { after: { response } }, true),
  ]);
  if (!updated?.meta.changes) {
    throw staleVersion();
  }
  return { ok: true, response };
}

export async function reviseQuotation(
  db: D1Database,
  actor: Actor,
  id: string,
  input: { reason: string; items?: QuotationItemWrite[]; validityDays?: number; version: number },
  requestId: string,
) {
  await assertQuotationSchemaReady(db);
  requirePermission(actor, "quotations.issue");
  requirePermission(actor, "quotations.edit");
  const quote = await loadQuote(db, id);
  await assertQuoteReadAccess(db, actor, quote);
  const reason = normalizeReason(input?.reason, "");
  const effective = effectiveQuoteStatus(quote);
  if (effective !== "ISSUED" && effective !== "ACCEPTED" && effective !== "EXPIRED") {
    throw errors.conflict("Only an issued quotation can be revised.", "QUOTE_NOT_ISSUED");
  }
  if (quote.version !== input.version) {
    throw staleVersion();
  }
  const currentItems = await loadActiveItems(db, quote);
  // Without an explicit list the new revision starts as an exact copy of the
  // current revision's items (fresh rows, old rows untouched).
  const prepared: PreparedItem[] = input.items == null
    ? currentItems.map((item) => preparedCopy(item))
    : prepareItems(input.items);
  assertIssueableRows(prepared);
  const validityDays = resolveValidityDays(quote, input?.validityDays);
  const now = nowIso();
  const validUntil = utcEndOfDayPlus(now, validityDays);
  const nextRevision = quote.active_revision + 1;
  const buyer = await buyerIdentity(db, quote.customer_id);
  const subtotal = prepared.reduce((sum, item) => sum + Number(item.total), 0);
  const snapshot: QuotationPdfSnapshot = {
    quoteNumber: quote.quote_number_display,
    revision: nextRevision,
    status: "ISSUED",
    issuedAt: now,
    validUntil,
    companyName: await companyDisplayName(db),
    customerName: buyer.name,
    customerAddress: buyer.address ?? "",
    caseReference: (await caseReferenceOf(db, quote.case_id)) ?? "",
    currency: "USD",
    subtotalMinor: subtotal,
    paymentTerms: quote.payment_terms ?? "",
    notes: quote.notes ?? "",
    incoterm: quote.incoterm ?? "",
    items: prepared.map((item, index) => ({
      position: index + 1,
      description: item.write.description,
      quantityText: item.write.quantity,
      unitLabel: item.write.unitLabel ?? "",
      unitPriceText: item.write.unitPrice,
      lineTotalMinor: Number(item.total),
    })),
  };
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE quotations SET
          status='ISSUED', validity_days=?, issued_at=?, valid_until=?, subtotal_minor=?,
          active_revision=?, client_response=NULL, client_response_at=NULL, client_response_by=NULL,
          version=version+1, updated_at=?
         WHERE id=? AND version=? AND status IN ('ISSUED','ACCEPTED')`,
      )
      .bind(validityDays, now, validUntil, subtotal, nextRevision, now, id, quote.version),
    db
      .prepare(
        `INSERT INTO quotation_revisions (
          id, quotation_id, revision, reason, actor_id, issued_at, valid_until, company_name, customer_name,
          customer_address, case_reference, currency, subtotal_minor, snapshot_json, before_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?)`,
      )
      .bind(
        newId(),
        id,
        nextRevision,
        reason,
        actor.id,
        now,
        validUntil,
        snapshot.companyName,
        snapshot.customerName,
        snapshot.customerAddress || null,
        snapshot.caseReference || null,
        subtotal,
        JSON.stringify(snapshot),
        JSON.stringify({ version: quote.version, status: quote.status, revision: quote.active_revision, validUntil: quote.valid_until }),
        now,
      ),
    quoteAuditStatement(db, actor, id, "quotation.revise", requestId, now, { after: { revision: nextRevision, validUntil }, reason }, true),
  ];
  for (const [index, item] of prepared.entries()) {
    statements.push(itemInsertStatement(db, id, nextRevision, item, index + 1, now, true));
  }
  const [updated] = await db.batch(statements);
  if (!updated?.meta.changes) {
    throw staleVersion();
  }
  return { ok: true, revision: nextRevision, validUntil };
}

function assertIssueableRows(items: PreparedItem[]): void {
  if (!items.length) {
    throw errors.validation("Add at least one item before issuing.", { items: "Add at least one item." }, "QUOTE_ITEMS_EMPTY");
  }
  for (const [index, item] of items.entries()) {
    if (item.qty3 <= 0n) {
      throw errors.validation(`Item ${index + 1}: quantity must be greater than zero before issuing.`, {}, "QUOTE_LINE_QUANTITY_ZERO");
    }
    if (item.price4 <= 0n) {
      throw errors.validation(`Item ${index + 1}: unit price must be greater than zero before issuing.`, {}, "QUOTE_LINE_PRICE_ZERO");
    }
  }
}

async function loadItemOrThrow(db: D1Database, quote: QuoteRow, itemId: string): Promise<ItemRow> {
  const item = await one<ItemRow>(
    db,
    `SELECT ${ITEM_COLUMNS} FROM quotation_items WHERE id = ? AND quotation_id = ?`,
    itemId,
    quote.id,
  );
  if (!item || item.revision !== quote.active_revision) throw notFound();
  return item;
}

export async function addQuotationItem(
  db: D1Database,
  actor: Actor,
  id: string,
  input: QuotationItemWrite,
  requestId: string,
) {
  await assertQuotationSchemaReady(db);
  requirePermission(actor, "quotations.edit");
  const quote = await loadQuote(db, id);
  await assertQuoteReadAccess(db, actor, quote);
  assertDraftEditable(quote);
  const existing = await loadActiveItems(db, quote);
  const [prepared] = prepareItems([input]);
  const total = prepared.total;
  const position = (existing.at(-1)?.position ?? 0) + 1;
  const now = nowIso();
  const itemId = newId();
  const [updated] = await db.batch([
    db
      .prepare(
        `UPDATE quotations SET subtotal_minor = subtotal_minor + ?, version = version + 1, updated_at = ?
         WHERE id = ? AND version = ? AND status = 'DRAFT'`,
      )
      .bind(Number(total), now, id, quote.version),
    db
      .prepare(
        `INSERT INTO quotation_items (
          id, quotation_id, revision, position, description, quantity_text, quantity_minor, unit_label,
          unit_price_text, unit_price_minor_4, currency, line_total_minor, created_at, updated_at
        ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ? WHERE changes() = 1`,
      )
      .bind(
        itemId,
        id,
        quote.active_revision,
        position,
        prepared.write.description,
        prepared.write.quantity,
        Number(prepared.qty3),
        prepared.write.unitLabel,
        prepared.write.unitPrice,
        Number(prepared.price4),
        Number(prepared.total),
        now,
        now,
      ),
    quoteAuditStatement(db, actor, id, "quotation.item.add", requestId, now, { after: { position } }, true),
  ]);
  if (!updated?.meta.changes) throw staleVersion();
  return { ok: true, itemId, position };
}

export async function updateQuotationItem(
  db: D1Database,
  actor: Actor,
  id: string,
  itemId: string,
  input: QuotationItemWrite,
  requestId: string,
) {
  await assertQuotationSchemaReady(db);
  requirePermission(actor, "quotations.edit");
  const quote = await loadQuote(db, id);
  await assertQuoteReadAccess(db, actor, quote);
  assertDraftEditable(quote);
  const item = await loadItemOrThrow(db, quote, itemId);
  const [prepared] = prepareItems([input]);
  const now = nowIso();
  const [updated] = await db.batch([
    db
      .prepare(
        `UPDATE quotations SET subtotal_minor = subtotal_minor - ? + ?, version = version + 1, updated_at = ?
         WHERE id = ? AND version = ? AND status = 'DRAFT'`,
      )
      .bind(Number(item.line_total_minor), Number(prepared.total), now, id, quote.version),
    db
      .prepare(
        `UPDATE quotation_items SET description=?, quantity_text=?, quantity_minor=?, unit_label=?,
          unit_price_text=?, unit_price_minor_4=?, line_total_minor=?, updated_at=?
         WHERE id = ? AND changes() = 1`,
      )
      .bind(
        prepared.write.description,
        prepared.write.quantity,
        Number(prepared.qty3),
        prepared.write.unitLabel,
        prepared.write.unitPrice,
        Number(prepared.price4),
        Number(prepared.total),
        now,
        itemId,
      ),
    quoteAuditStatement(db, actor, id, "quotation.item.update", requestId, now, { after: { itemId } }, true),
  ]);
  if (!updated?.meta.changes) throw staleVersion();
  return { ok: true };
}

export async function deleteQuotationItem(
  db: D1Database,
  actor: Actor,
  id: string,
  itemId: string,
  requestId: string,
) {
  await assertQuotationSchemaReady(db);
  requirePermission(actor, "quotations.edit");
  const quote = await loadQuote(db, id);
  await assertQuoteReadAccess(db, actor, quote);
  assertDraftEditable(quote);
  const item = await loadItemOrThrow(db, quote, itemId);
  const now = nowIso();
  const [updated] = await db.batch([
    db
      .prepare(
        `UPDATE quotations SET subtotal_minor = MAX(subtotal_minor - ?, 0), version = version + 1, updated_at = ?
         WHERE id = ? AND version = ? AND status = 'DRAFT'`,
      )
      .bind(Number(item.line_total_minor), now, id, quote.version),
    db
      .prepare(`DELETE FROM quotation_items WHERE id = ? AND changes() = 1`)
      .bind(itemId),
    quoteAuditStatement(db, actor, id, "quotation.item.delete", requestId, now, { after: { itemId } }, true),
  ]);
  if (!updated?.meta.changes) throw staleVersion();
  return { ok: true };
}

export async function linkQuotationToCase(
  db: D1Database,
  actor: Actor,
  id: string,
  input: { caseId: string; reason?: string },
  requestId: string,
) {
  await assertQuotationSchemaReady(db);
  requirePermission(actor, "quotations.edit");
  const quote = await loadQuote(db, id);
  // Reads of an unlinked quotation stay creator-only. Linking is an edit: an
  // editor may attach one before that read rule applies, then the case scope
  // governs who can see it. A quotation that already has a case keeps the
  // read check so a stranger cannot move it.
  if (quote.case_id) await assertQuoteReadAccess(db, actor, quote);
  const caseId = typeof input?.caseId === "string" ? input.caseId.trim() : "";
  if (!caseId) throw errors.validation("The export case is required", { caseId: "Choose an export case." });
  const targetCase = await one<{ id: string }>(db, "SELECT id FROM export_cases WHERE id = ?", caseId);
  if (!targetCase) throw errors.notFound("Export case not found");
  await assertQuoteCaseEditAccess(db, actor, caseId);
  const relink = Boolean(quote.case_id) && quote.case_id !== caseId;
  if (relink) normalizeReason(input.reason, "");
  const now = nowIso();
  const [updated] = await db.batch([
    db
      .prepare(
        `UPDATE quotations SET case_id=?, version=version+1, updated_at=?
         WHERE id=? AND version=? AND status IN ('DRAFT','ISSUED')`,
      )
      .bind(caseId, now, id, quote.version),
    quoteAuditStatement(db, actor, id, "quotation.link", requestId, now, { after: { caseId } }, true),
  ]);
  if (!updated?.meta.changes) {
    throw staleVersion();
  }
  return { ok: true, caseId };
}

export async function unlinkQuotationFromCase(
  db: D1Database,
  actor: Actor,
  id: string,
  input: { reason: string },
  requestId: string,
) {
  await assertQuotationSchemaReady(db);
  requirePermission(actor, "quotations.edit");
  const quote = await loadQuote(db, id);
  await assertQuoteReadAccess(db, actor, quote);
  const reason = normalizeReason(input?.reason, "");
  if (!quote.case_id) {
    throw errors.conflict("This quotation is not linked to an export case.", "QUOTE_NOT_LINKED");
  }
  const now = nowIso();
  const [updated] = await db.batch([
    db
      .prepare(
        `UPDATE quotations SET case_id=NULL, version=version+1, updated_at=?
         WHERE id=? AND version=? AND status IN ('DRAFT','ISSUED') AND case_id IS NOT NULL`,
      )
      .bind(now, id, quote.version),
    quoteAuditStatement(db, actor, id, "quotation.unlink", requestId, now, { after: { caseId: null }, reason }, true),
  ]);
  if (!updated?.meta.changes) {
    throw staleVersion();
  }
  return { ok: true };
}

export async function copyQuotationItems(
  db: D1Database,
  actor: Actor,
  id: string,
  input: { sourceQuotationId: string },
  requestId: string,
) {
  await assertQuotationSchemaReady(db);
  requirePermission(actor, "quotations.edit");
  const target = await loadQuote(db, id);
  await assertQuoteReadAccess(db, actor, target);
  assertDraftEditable(target);
  const sourceId = typeof input?.sourceQuotationId === "string" ? input.sourceQuotationId.trim() : "";
  if (!sourceId) throw errors.validation("The source quotation is required", { sourceQuotationId: "Choose a source quotation." });
  if (sourceId === id) throw errors.conflict("Choose a different source quotation", "QUOTE_COPY_SELF");
  const source = await loadQuote(db, sourceId);
  // Copying is only allowed once the actor is allowed to see the source (D-09);
  // the target never re-prices the copied rows.
  await assertQuoteReadAccess(db, actor, source);
  const sourceItems = await all<ItemRow>(
    db,
    `SELECT ${ITEM_COLUMNS} FROM quotation_items WHERE quotation_id = ? AND revision = ? ORDER BY position`,
    sourceId,
    source.active_revision,
  );
  if (!sourceItems.length) throw errors.conflict("The source quotation has no items", "QUOTE_COPY_EMPTY");
  const now = nowIso();
  const subtotal = sourceItems.reduce((sum, item) => sum + Number(item.line_total_minor), 0);
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE quotations SET subtotal_minor = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND version = ? AND status = 'DRAFT'`,
      )
      .bind(subtotal, now, id, target.version),
    db
      .prepare(`DELETE FROM quotation_items WHERE quotation_id = ? AND revision = ? AND changes() = 1`)
      .bind(id, target.active_revision),
  ];
  sourceItems.forEach((sourceItem, index) => {
    statements.push(
      itemInsertStatement(db, id, target.active_revision, {
        write: {
          description: sourceItem.description,
          quantity: sourceItem.quantity_text,
          unitLabel: sourceItem.unit_label,
          unitPrice: sourceItem.unit_price_text,
        },
        qty3: BigInt(sourceItem.quantity_minor),
        price4: BigInt(sourceItem.unit_price_minor_4),
        total: BigInt(sourceItem.line_total_minor),
        source: {
          quotationId: sourceItem.quotation_id,
          itemId: sourceItem.id,
          lineTotal: Number(sourceItem.line_total_minor),
        },
      }, index + 1, now, true),
    );
  });
  statements.push(quoteAuditStatement(db, actor, id, "quotation.copy_items", requestId, now, { after: { sourceId, count: sourceItems.length } }, true));
  const [updated] = await db.batch(statements);
  if (!updated?.meta.changes) {
    throw staleVersion();
  }
  return { ok: true, count: sourceItems.length };
}

export async function archiveQuotation(
  db: D1Database,
  actor: Actor,
  id: string,
  input: { reason: string },
  requestId: string,
) {
  await assertQuotationSchemaReady(db);
  requirePermission(actor, "quotations.edit");
  const quote = await loadQuote(db, id);
  await assertQuoteReadAccess(db, actor, quote);
  const reason = normalizeReason(input?.reason, "");
  if (quote.archived_at) throw errors.conflict("This quotation is already archived.", "QUOTE_ALREADY_ARCHIVED");
  const now = nowIso();
  const [updated] = await db.batch([
    db
      .prepare(
        `UPDATE quotations SET archived_at=?, archived_by=?, archived_reason=?, version=version+1, updated_at=?
         WHERE id=? AND version=? AND archived_at IS NULL`,
      )
      .bind(now, actor.id, reason, now, id, quote.version),
    quoteAuditStatement(db, actor, id, "quotation.archive", requestId, now, { after: { archivedAt: now }, reason }, true),
  ]);
  if (!updated?.meta.changes) {
    throw staleVersion();
  }
  return { ok: true };
}

export async function exportQuotationsCsv(db: D1Database, actor: Actor) {
  await assertQuotationSchemaReady(db);
  requirePermission(actor, "quotations.export");
  const viewAll = actor.permissions.has("quotations.view_all");
  const vis = caseVisibilitySql(actor, "c");
  const filters: string[] = [];
  const binds: unknown[] = [];
  if (!viewAll) {
    filters.push(`(q.created_by = ? OR (${vis.sql}))`);
    binds.push(actor.id, ...vis.binds);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const rows = await all<Record<string, unknown>>(
    db,
    `SELECT q.quote_number, q.quote_number_display, q.title, cu.legal_name AS customer_name, q.status,
            q.validity_days, q.issued_at, q.valid_until, q.client_response, c.case_reference, q.archived_at,
            q.subtotal_minor, q.active_revision, q.created_at
     FROM quotations q
     LEFT JOIN export_cases c ON c.id = q.case_id
     LEFT JOIN customers cu ON cu.id = q.customer_id
     ${where}
     ORDER BY q.created_at`,
    ...binds,
  );
  const lines = [
    [
      "quote_number",
      "title",
      "customer_name",
      "status",
      "validity_days",
      "issued_at_utc",
      "valid_until_utc",
      "client_response",
      "case_reference",
      "archived",
      "subtotal_usd",
      "active_revision",
      "created_at_utc",
    ].join(","),
  ];
  for (const row of rows) {
    lines.push(
      [
        row.quote_number,
        row.title,
        row.customer_name,
        row.status,
        row.validity_days,
        row.issued_at,
        row.valid_until,
        row.client_response,
        row.case_reference,
        row.archived_at ? "true" : "false",
        row.subtotal_minor,
        row.active_revision,
        row.created_at,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `\uFEFF${lines.join("\n")}\n`;
}

export async function generateQuotationPdf(
  db: D1Database,
  actor: Actor,
  id: string,
  revisionQuery?: string,
): Promise<{ bytes: Uint8Array; contentType: string; filename: string; draft: boolean }> {
  await assertQuotationSchemaReady(db);
  requirePermission(actor, "quotations.export");
  const quote = await loadQuote(db, id);
  await assertQuoteReadAccess(db, actor, quote);
  if (revisionQuery?.trim()) {
    const revision = Number(revisionQuery);
    if (!Number.isInteger(revision) || revision < 1) {
      throw errors.badRequest("revision must be a positive integer");
    }
    const row = await one<{ snapshot_json: string }>(
      db,
      "SELECT snapshot_json FROM quotation_revisions WHERE quotation_id = ? AND revision = ?",
      id,
      revision,
    );
    if (!row) throw notFound();
    return buildPdf(quote, JSON.parse(row.snapshot_json) as QuotationPdfSnapshot, false);
  }
  if (quote.active_revision >= 1) {
    const row = await one<{ snapshot_json: string }>(
      db,
      "SELECT snapshot_json FROM quotation_revisions WHERE quotation_id = ? AND revision = ?",
      id,
      quote.active_revision,
    );
    if (row) {
      return buildPdf(quote, JSON.parse(row.snapshot_json) as QuotationPdfSnapshot, false);
    }
  }
  // Draft preview: current working items with a clear DRAFT mark. It is not a
  // document valid for sending, so the DRAFT mark stays on.
  const items = await loadActiveItems(db, quote);
  const buyer = await buyerIdentity(db, quote.customer_id);
  const snapshot = snapshotFromQuote(quote, 0, await companyDisplayName(db), buyer, await caseReferenceOf(db, quote.case_id), items);
  return buildPdf(quote, snapshot, true);
}

function buildPdf(quote: QuoteRow, snapshot: QuotationPdfSnapshot, draft: boolean) {
  const bytes = renderQuotationPdf(snapshot, { draft });
  return {
    bytes,
    contentType: "application/pdf",
    filename: `${quote.quote_number}${draft ? "-DRAFT" : ""}.pdf`,
    draft,
  };
}

/** Replay-policy helper: resolve the case a quotation is linked to (null if unlinked). */
export async function quoteCaseIdOf(db: D1Database, id: string): Promise<string | null> {
  const row = await one<{ case_id: string | null }>(db, "SELECT case_id FROM quotations WHERE id = ?", id);
  if (!row) throw errors.notFound("Quotation not found");
  return row.case_id ?? null;
}
