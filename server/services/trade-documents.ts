import { netAboveGross, packingPieces, reconcileTradeTotals, sumNumbers, type ReconciliationSummary, type TradeTotals } from "../../shared/trade-documents";
import { all, newId, nowIso, one } from "../db/sql";
import { errors } from "../http/errors";
import type { Actor } from "./actor";
import { assertCaseAccess, requireAny, requirePermission } from "./actor";
import { assertSchemaReady } from "./schema";
import { ensureTradeDefaults } from "./trade-defaults";
import { storeIssuedProformaPdf, storeIssuedTradePdfs } from "./trade-document-files";

const TERMS = new Set(["TT", "LC", "DP", "DA", "OTHER"]);

type InvoiceHead = {
  id: string;
  case_id: string;
  customer_id: string;
  invoiced_freight_minor: number;
  packages_count: number;
  gross_weight_grams: number;
  net_weight_grams: number;
  trade_status: string;
  trade_revision: number;
  payment_term_code: string;
  payment_term_label: string | null;
  shipping_method_label: string | null;
  origin_of_goods: string | null;
  exporter_bank_account_id: string | null;
  goods_value_minor: number;
  print_reference: string | null;
  incoterm: string;
};

type CommercialLineInput = {
  description: string;
  hsCode?: string | null;
  barcode?: string | null;
  unit?: string | null;
  quantity: number;
  unitPriceMinor: number;
};

type PackingLineInput = {
  description: string;
  hsCode?: string | null;
  barcode?: string | null;
  containerId?: string | null;
  packagesCount: number;
  packingPerPackage: number;
  grossWeightGrams: number;
  netWeightGrams: number;
};

type ProformaLineInput = {
  description: string;
  unit?: string | null;
  quantity: number;
  unitPriceMinor: number;
};

async function ready(db: D1Database) {
  await assertSchemaReady(db, "trade");
  await ensureTradeDefaults(db);
}

function text(value: unknown, field: string, max: number, required = false) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (required && !raw) throw errors.validation(`Enter ${field}.`, { [field]: "Required." }, "TRADE_FIELD_REQUIRED");
  if (raw.length > max) throw errors.validation(`${field} is too long.`, { [field]: "Too long." }, "TRADE_FIELD_REQUIRED");
  return raw || null;
}

function whole(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw errors.validation(`${field} must be a non-negative integer.`, { [field]: "Use a non-negative integer." }, "TRADE_NUMBER_INVALID");
  }
  return value;
}

function term(value: unknown) {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!TERMS.has(code)) throw errors.validation("Choose a payment term.", { paymentTermCode: "TT, LC, DP, DA, or OTHER." }, "TRADE_FIELD_REQUIRED");
  return code;
}

function incoterm(value: unknown) {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (code !== "FOB" && code !== "CFR") throw errors.validation("Choose FOB or CFR.", { incoterm: "FOB or CFR." }, "TRADE_FIELD_REQUIRED");
  return code;
}

function lineTotal(quantity: number, unitPriceMinor: number) {
  return quantity * unitPriceMinor;
}

async function invoiceHead(db: D1Database, actor: Actor, invoiceId: string) {
  const row = await one<InvoiceHead>(
    db,
    `SELECT id, case_id, customer_id, invoiced_freight_minor, packages_count, gross_weight_grams, net_weight_grams,
            trade_status, trade_revision, payment_term_code, payment_term_label, shipping_method_label, origin_of_goods,
            exporter_bank_account_id, goods_value_minor, print_reference, incoterm
     FROM export_invoices WHERE id = ?`,
    invoiceId,
  );
  if (!row) throw errors.notFound("Invoice not found");
  await assertCaseAccess(db, actor, row.case_id);
  return row;
}

function assertDraft(status: string) {
  if (status === "ISSUED") throw errors.conflict("This document is already issued.", "TRADE_ISSUED");
}

export async function getExporterIdentity(db: D1Database, actor: Actor) {
  await ready(db);
  requirePermission(actor, "settings.manage");
  return (await one(db, "SELECT * FROM exporter_identity WHERE id = 'default'")) ?? null;
}

export async function saveExporterIdentity(db: D1Database, actor: Actor, input: Record<string, unknown>) {
  await ready(db);
  requirePermission(actor, "settings.manage");
  const now = nowIso();
  const row = {
    nameEn: text(input.nameEn, "nameEn", 200) ?? "",
    nameAr: text(input.nameAr, "nameAr", 200) ?? "",
    address: text(input.address, "address", 500) ?? "",
    taxCard: text(input.taxCard, "taxCard", 80),
    taxFile: text(input.taxFile, "taxFile", 80),
    commercialRegistry: text(input.commercialRegistry, "commercialRegistry", 80),
    phone: text(input.phone, "phone", 40),
    email: text(input.email, "email", 120),
  };
  await db
    .prepare(
      `INSERT INTO exporter_identity (id, name_en, name_ar, address, tax_card, tax_file, commercial_registry, phone, email, updated_at)
       VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name_en = excluded.name_en, name_ar = excluded.name_ar, address = excluded.address,
         tax_card = excluded.tax_card, tax_file = excluded.tax_file, commercial_registry = excluded.commercial_registry,
         phone = excluded.phone, email = excluded.email, updated_at = excluded.updated_at`,
    )
    .bind(row.nameEn, row.nameAr, row.address, row.taxCard, row.taxFile, row.commercialRegistry, row.phone, row.email, now)
    .run();
  return getExporterIdentity(db, actor);
}

export async function listExporterBanks(db: D1Database, actor: Actor) {
  await ready(db);
  requireAny(actor, ["settings.manage", "invoices.view"]);
  return all(db, "SELECT * FROM exporter_bank_accounts ORDER BY is_default DESC, created_at");
}

export async function saveExporterBank(db: D1Database, actor: Actor, input: Record<string, unknown>, bankId?: string) {
  await ready(db);
  requirePermission(actor, "settings.manage");
  const now = nowIso();
  const id = bankId ?? newId();
  const accountName = text(input.accountName, "accountName", 200, true);
  const iban = (text(input.iban, "iban", 64, true) ?? "").replace(/\s+/g, "").toUpperCase();
  const bankName = text(input.bankName, "bankName", 200, true);
  const bankAddress = text(input.bankAddress, "bankAddress", 300);
  const swift = text(input.swiftCode, "swiftCode", 20);
  const currency = (text(input.currency, "currency", 3) ?? "USD").toUpperCase();
  const isDefault = input.isDefault === true ? 1 : 0;
  if (bankId) {
    const existing = await one(db, "SELECT id FROM exporter_bank_accounts WHERE id = ?", bankId);
    if (!existing) throw errors.notFound("Bank account not found");
    await db
      .prepare(
        `UPDATE exporter_bank_accounts
         SET account_name = ?, iban = ?, bank_name = ?, bank_address = ?, swift_code = ?, currency = ?, is_default = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(accountName, iban, bankName, bankAddress, swift, currency, isDefault, now, id)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO exporter_bank_accounts
           (id, account_name, iban, bank_name, bank_address, swift_code, currency, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, accountName, iban, bankName, bankAddress, swift, currency, isDefault, now, now)
      .run();
  }
  if (isDefault) {
    await db.prepare("UPDATE exporter_bank_accounts SET is_default = 0, updated_at = ? WHERE id != ? AND is_default != 0").bind(now, id).run();
  }
  return one(db, "SELECT * FROM exporter_bank_accounts WHERE id = ?", id);
}

export async function uploadExporterMark(db: D1Database, bucket: R2Bucket, actor: Actor, kind: "logo" | "stamp", dataUrl: string) {
  await ready(db);
  requirePermission(actor, "settings.manage");
  const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim());
  if (!match) throw errors.validation("Choose a JPEG or PNG image.", { image: "JPEG or PNG." }, "TRADE_IMAGE_INVALID");
  const bytes = decodeBase64(match[2].replace(/\s/g, ""));
  if (bytes.length === 0 || bytes.length > 1_500_000) throw errors.payload("The image must be under 1.5 MB.");
  const ext = match[1] === "image/png" ? "png" : "jpg";
  const key = `exporter/marks/${kind}.${ext}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: match[1] } });
  const now = nowIso();
  const column = kind === "logo" ? "logo_r2_key" : "stamp_r2_key";
  await db
    .prepare(
      `INSERT INTO exporter_marks (id, ${column}, updated_at) VALUES ('default', ?, ?)
       ON CONFLICT(id) DO UPDATE SET ${column} = excluded.${column}, updated_at = excluded.updated_at`,
    )
    .bind(key, now)
    .run();
  return { key };
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function getExporterMarks(db: D1Database, actor: Actor) {
  await ready(db);
  requirePermission(actor, "settings.manage");
  return (await one(db, "SELECT * FROM exporter_marks WHERE id = 'default'")) ?? null;
}

export async function saveExporterMarks(db: D1Database, actor: Actor, input: Record<string, unknown>) {
  await ready(db);
  requirePermission(actor, "settings.manage");
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO exporter_marks (id, logo_r2_key, stamp_r2_key, stamp_label_en, stamp_label_ar, updated_at)
       VALUES ('default', ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         logo_r2_key = excluded.logo_r2_key, stamp_r2_key = excluded.stamp_r2_key,
         stamp_label_en = excluded.stamp_label_en, stamp_label_ar = excluded.stamp_label_ar, updated_at = excluded.updated_at`,
    )
    .bind(text(input.logoR2Key, "logoR2Key", 300), text(input.stampR2Key, "stampR2Key", 300), text(input.stampLabelEn, "stampLabelEn", 200), text(input.stampLabelAr, "stampLabelAr", 200), now)
    .run();
  return getExporterMarks(db, actor);
}

export async function listProductPresets(db: D1Database, actor: Actor) {
  await ready(db);
  requirePermission(actor, "invoices.view");
  return all(db, "SELECT * FROM product_presets WHERE active = 1 ORDER BY name");
}

export async function saveProductPreset(db: D1Database, actor: Actor, input: Record<string, unknown>, presetId?: string) {
  await ready(db);
  requirePermission(actor, "invoices.edit");
  const now = nowIso();
  const id = presetId ?? newId();
  const name = text(input.name, "name", 200, true);
  const description = text(input.descriptionTemplate, "descriptionTemplate", 4000) ?? "";
  const packing = input.defaultPackingPerPackage == null ? null : whole(input.defaultPackingPerPackage, "defaultPackingPerPackage");
  const pieceWeight = input.pieceWeightGrams == null ? null : whole(input.pieceWeightGrams, "pieceWeightGrams");
  const price = input.defaultPriceMinor == null ? 0 : whole(input.defaultPriceMinor, "defaultPriceMinor");
  if (presetId) {
    const existing = await one(db, "SELECT id FROM product_presets WHERE id = ?", presetId);
    if (!existing) throw errors.notFound("Preset not found");
    await db
      .prepare(
        `UPDATE product_presets SET name=?, description_template=?, ply=?, material=?, size_label=?, barcode=?, hs_code=?,
           unit_label=?, default_price_minor=?, default_packing_per_package=?, piece_weight_grams=?, updated_at=? WHERE id=?`,
      )
      .bind(name, description, text(input.ply, "ply", 20), text(input.material, "material", 80), text(input.sizeLabel, "sizeLabel", 40), text(input.barcode, "barcode", 40), text(input.hsCode, "hsCode", 32), text(input.unit, "unit", 20), price, packing, pieceWeight, now, id)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO product_presets
           (id, name, description_template, ply, material, size_label, barcode, hs_code, unit_label, default_price_minor,
            default_packing_per_package, piece_weight_grams, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .bind(id, name, description, text(input.ply, "ply", 20), text(input.material, "material", 80), text(input.sizeLabel, "sizeLabel", 40), text(input.barcode, "barcode", 40), text(input.hsCode, "hsCode", 32), text(input.unit, "unit", 20), price, packing, pieceWeight, now, now)
      .run();
  }
  return one(db, "SELECT * FROM product_presets WHERE id = ?", id);
}

function commercialLines(raw: unknown): CommercialLineInput[] {
  if (!Array.isArray(raw) || raw.length === 0) throw errors.validation("Add at least one line.", { lines: "Required." }, "TRADE_FIELD_REQUIRED");
  return raw.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      description: text(row.description, "description", 4000, true) ?? "",
      hsCode: text(row.hsCode, "hsCode", 32),
      barcode: text(row.barcode, "barcode", 40),
      unit: text(row.unit, "unit", 20),
      quantity: whole(row.quantity, "quantity"),
      unitPriceMinor: whole(row.unitPriceMinor, "unitPriceMinor"),
    };
  });
}

function packingLines(raw: unknown): PackingLineInput[] {
  if (!Array.isArray(raw)) throw errors.validation("Packing lines are missing.", { lines: "Required." }, "TRADE_FIELD_REQUIRED");
  return raw.map((item) => {
    const row = item as Record<string, unknown>;
    const gross = whole(row.grossWeightGrams, "grossWeightGrams");
    const net = whole(row.netWeightGrams, "netWeightGrams");
    if (netAboveGross(net, gross)) {
      throw errors.validation("Net weight cannot exceed gross weight.", { netWeightGrams: "Net weight is above gross weight." }, "NET_ABOVE_GROSS");
    }
    return {
      description: text(row.description, "description", 4000, true) ?? "",
      hsCode: text(row.hsCode, "hsCode", 32),
      barcode: text(row.barcode, "barcode", 40),
      containerId: text(row.containerId, "containerId", 80),
      packagesCount: whole(row.packagesCount, "packagesCount"),
      packingPerPackage: whole(row.packingPerPackage, "packingPerPackage"),
      grossWeightGrams: gross,
      netWeightGrams: net,
    };
  });
}

export async function reconciliationFor(db: D1Database, actor: Actor, invoiceId: string): Promise<ReconciliationSummary> {
  await ready(db);
  requirePermission(actor, "invoices.view");
  const head = await invoiceHead(db, actor, invoiceId);
  return loadReconciliation(db, head);
}

async function loadReconciliation(db: D1Database, head: InvoiceHead) {
  const commercial = await all<{ quantity: number }>(db, "SELECT quantity FROM invoice_lines WHERE invoice_id = ?", head.id);
  const packing = await all<{ pieces_count: number; packages_count: number; gross_weight_grams: number; net_weight_grams: number }>(
    db,
    "SELECT pieces_count, packages_count, gross_weight_grams, net_weight_grams FROM packing_lines WHERE invoice_id = ?",
    head.id,
  );
  const invoice: TradeTotals = {
    pieces: sumNumbers(commercial.map((row) => Number(row.quantity))),
    packages: Number(head.packages_count),
    grossGrams: Number(head.gross_weight_grams),
    netGrams: Number(head.net_weight_grams),
  };
  const packed: TradeTotals = {
    pieces: sumNumbers(packing.map((row) => Number(row.pieces_count))),
    packages: sumNumbers(packing.map((row) => Number(row.packages_count))),
    grossGrams: sumNumbers(packing.map((row) => Number(row.gross_weight_grams))),
    netGrams: sumNumbers(packing.map((row) => Number(row.net_weight_grams))),
  };
  return reconcileTradeTotals(invoice, packed);
}

export async function replaceInvoiceLines(db: D1Database, actor: Actor, invoiceId: string, rawLines: unknown) {
  await ready(db);
  requirePermission(actor, "invoices.edit");
  const head = await invoiceHead(db, actor, invoiceId);
  assertDraft(head.trade_status);
  const lines = commercialLines(rawLines);
  const now = nowIso();
  const goods = sumNumbers(lines.map((line) => lineTotal(line.quantity, line.unitPriceMinor)));
  const statements = [
    db.prepare("DELETE FROM invoice_lines WHERE invoice_id = ?").bind(invoiceId),
    ...lines.map((line, index) =>
      db
        .prepare(
          `INSERT INTO invoice_lines (id, invoice_id, line_no, description, hs_code, barcode, unit_label, quantity, unit_price_minor, line_total_minor)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(newId(), invoiceId, index + 1, line.description, line.hsCode, line.barcode, line.unit, line.quantity, line.unitPriceMinor, lineTotal(line.quantity, line.unitPriceMinor)),
    ),
    db
      .prepare(
        `UPDATE export_invoices
         SET goods_value_minor = ?, invoice_total_minor = ? + invoiced_freight_minor, version = version + 1, updated_at = ?
         WHERE id = ?`,
      )
      .bind(goods, goods, now, invoiceId),
  ];
  await db.batch(statements);
  return { reconciliation: await loadReconciliation(db, { ...head, packages_count: head.packages_count, gross_weight_grams: head.gross_weight_grams, net_weight_grams: head.net_weight_grams }) };
}

export async function replacePackingLines(db: D1Database, actor: Actor, invoiceId: string, rawLines: unknown) {
  await ready(db);
  requirePermission(actor, "invoices.edit");
  const head = await invoiceHead(db, actor, invoiceId);
  assertDraft(head.trade_status);
  const lines = packingLines(rawLines);
  await db.batch([
    db.prepare("DELETE FROM packing_lines WHERE invoice_id = ?").bind(invoiceId),
    ...lines.map((line, index) =>
      db
        .prepare(
          `INSERT INTO packing_lines
             (id, invoice_id, case_id, container_id, line_no, description, hs_code, barcode, packages_count, packing_per_package,
              pieces_count, gross_weight_grams, net_weight_grams)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          newId(),
          invoiceId,
          head.case_id,
          line.containerId,
          index + 1,
          line.description,
          line.hsCode,
          line.barcode,
          line.packagesCount,
          line.packingPerPackage,
          packingPieces(line.packagesCount, line.packingPerPackage),
          line.grossWeightGrams,
          line.netWeightGrams,
        ),
    ),
  ]);
  return { saved: true, reconciliation: await loadReconciliation(db, head) };
}

export async function syncPackingTotals(db: D1Database, actor: Actor, invoiceId: string) {
  await ready(db);
  requirePermission(actor, "invoices.edit");
  const head = await invoiceHead(db, actor, invoiceId);
  assertDraft(head.trade_status);
  const sums = await one<{ packages: number; gross: number; net: number }>(
    db,
    `SELECT COALESCE(SUM(packages_count), 0) AS packages, COALESCE(SUM(gross_weight_grams), 0) AS gross, COALESCE(SUM(net_weight_grams), 0) AS net
     FROM packing_lines WHERE invoice_id = ?`,
    invoiceId,
  );
  const packages = Number(sums?.packages ?? 0);
  const gross = Number(sums?.gross ?? 0);
  const net = Number(sums?.net ?? 0);
  if (netAboveGross(net, gross)) {
    throw errors.validation("Net weight cannot exceed gross weight.", { netWeightGrams: "Net weight is above gross weight." }, "NET_ABOVE_GROSS");
  }
  await db
    .prepare("UPDATE export_invoices SET packages_count = ?, gross_weight_grams = ?, net_weight_grams = ?, version = version + 1, updated_at = ? WHERE id = ?")
    .bind(packages, gross, net, nowIso(), invoiceId)
    .run();
  return reconciliationFor(db, actor, invoiceId);
}

export async function issueTradeDocuments(db: D1Database, bucket: R2Bucket, actor: Actor, invoiceId: string) {
  await ready(db);
  requirePermission(actor, "invoices.edit");
  const head = await invoiceHead(db, actor, invoiceId);
  assertDraft(head.trade_status);
  const commercial = await all<{ hs_code: string | null }>(db, "SELECT hs_code FROM invoice_lines WHERE invoice_id = ? ORDER BY line_no", invoiceId);
  if (commercial.length === 0) throw errors.conflict("Add the commercial lines before issuing.", "TRADE_LINES_REQUIRED");
  if (commercial.some((line) => !line.hs_code?.trim())) throw errors.conflict("Every commercial line needs an HS code before issue.", "HS_CODE_REQUIRED");
  const packed = await all<{ container_id: string | null }>(db, "SELECT container_id FROM packing_lines WHERE invoice_id = ?", invoiceId);
  if (packed.length === 0) throw errors.conflict("Add the packing lines before issuing.", "TRADE_LINES_REQUIRED");
  for (const line of packed) {
    if (!line.container_id) throw errors.conflict("Every packing line must name a container before issue.", "PACKING_CONTAINER_REQUIRED");
    const container = await one<{ case_id: string; status: string }>(db, "SELECT case_id, status FROM containers WHERE id = ?", line.container_id);
    if (!container || container.case_id !== head.case_id || container.status === "CANCELLED") {
      throw errors.conflict("Every packing line must use a live container on this operation.", "PACKING_CONTAINER_REQUIRED");
    }
  }
  const summary = await loadReconciliation(db, head);
  if (!summary.matched) throw errors.conflict("Invoice and packing totals do not match.", "TRADE_TOTALS_DIFFER");
  const revision = Number(head.trade_revision) + 1;
  await storeIssuedTradePdfs(db, bucket, actor, invoiceId, revision);
  await db
    .prepare("UPDATE export_invoices SET trade_status = 'ISSUED', trade_revision = ?, version = version + 1, updated_at = ? WHERE id = ?")
    .bind(revision, nowIso(), invoiceId)
    .run();
  return { tradeStatus: "ISSUED", tradeRevision: revision, reconciliation: summary };
}

function proformaLines(raw: unknown): ProformaLineInput[] {
  return commercialLines(raw).map((line) => ({
    description: line.description,
    unit: line.unit,
    quantity: line.quantity,
    unitPriceMinor: line.unitPriceMinor,
  }));
}

export async function createProforma(db: D1Database, actor: Actor, input: Record<string, unknown>) {
  await ready(db);
  requirePermission(actor, "invoices.edit");
  const customerId = text(input.customerId, "customerId", 80, true);
  const customer = await one(db, "SELECT id FROM customers WHERE id = ?", customerId);
  if (!customer) throw errors.notFound("Customer not found");
  const caseId = text(input.caseId, "caseId", 80);
  if (caseId) await assertCaseAccess(db, actor, caseId);
  const lines = proformaLines(input.lines);
  const seaFreight = input.seaFreightMinor == null ? 0 : whole(input.seaFreightMinor, "seaFreightMinor");
  const fob = sumNumbers(lines.map((line) => lineTotal(line.quantity, line.unitPriceMinor)));
  const now = nowIso();
  const id = newId();
  const number = text(input.invoiceNumber, "invoiceNumber", 40, true);
  let printReference = text(input.printReference, "printReference", 40);
  if (!printReference && customerId) {
    const coded = await one<{ customer_code: string | null }>(db, "SELECT customer_code FROM customers WHERE id = ?", customerId);
    printReference = coded?.customer_code ?? null;
  }
  await db.batch([
    db
      .prepare(
        `INSERT INTO proforma_invoices
           (id, customer_id, case_id, invoice_number, print_reference, invoice_date, origin_of_goods, port_of_loading, port_of_discharge,
            payment_term_code, payment_term_label, incoterm, shipping_method_label, exporter_bank_account_id, currency, currency_decimals,
            fob_total_minor, sea_freight_minor, total_minor, status, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2, ?, ?, ?, 'DRAFT', 1, ?, ?)`,
      )
      .bind(
        id,
        customerId,
        caseId,
        number,
        printReference,
        text(input.invoiceDate, "invoiceDate", 40, true),
        text(input.originOfGoods, "originOfGoods", 80) ?? "EGYPT",
        text(input.portOfLoading, "portOfLoading", 80),
        text(input.portOfDischarge, "portOfDischarge", 80),
        term(input.paymentTermCode),
        text(input.paymentTermLabel, "paymentTermLabel", 200),
        incoterm(input.incoterm),
        text(input.shippingMethodLabel, "shippingMethodLabel", 40),
        text(input.exporterBankAccountId, "exporterBankAccountId", 80),
        (text(input.currency, "currency", 3) ?? "USD").toUpperCase(),
        fob,
        seaFreight,
        fob + seaFreight,
        now,
        now,
      ),
    ...lines.map((line, index) =>
      db
        .prepare(
          `INSERT INTO proforma_lines (id, proforma_id, line_no, description, unit_label, quantity, unit_price_minor, line_total_minor)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(newId(), id, index + 1, line.description, line.unit, line.quantity, line.unitPriceMinor, lineTotal(line.quantity, line.unitPriceMinor)),
    ),
  ]);
  return getProforma(db, actor, id);
}

export async function getProforma(db: D1Database, actor: Actor, id: string) {
  await ready(db);
  requirePermission(actor, "invoices.view");
  const header = await one<Record<string, unknown> & { status: string; case_id: string | null }>(db, "SELECT * FROM proforma_invoices WHERE id = ?", id);
  if (!header) throw errors.notFound("Proforma not found");
  if (header.case_id) await assertCaseAccess(db, actor, header.case_id);
  const lines = await all(db, "SELECT * FROM proforma_lines WHERE proforma_id = ? ORDER BY line_no", id);
  return { ...header, lines };
}

export async function updateProforma(db: D1Database, actor: Actor, id: string, input: Record<string, unknown>) {
  await ready(db);
  requirePermission(actor, "invoices.edit");
  const current = await one<{ status: string; case_id: string | null; version: number }>(db, "SELECT status, case_id, version FROM proforma_invoices WHERE id = ?", id);
  if (!current) throw errors.notFound("Proforma not found");
  assertDraft(current.status);
  if (current.case_id) await assertCaseAccess(db, actor, current.case_id);
  const caseId = input.caseId === undefined ? current.case_id : text(input.caseId, "caseId", 80);
  if (caseId) await assertCaseAccess(db, actor, caseId);
  const lines = proformaLines(input.lines);
  const seaFreight = input.seaFreightMinor == null ? 0 : whole(input.seaFreightMinor, "seaFreightMinor");
  const fob = sumNumbers(lines.map((line) => lineTotal(line.quantity, line.unitPriceMinor)));
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        `UPDATE proforma_invoices SET case_id=?, invoice_number=?, print_reference=?, invoice_date=?, origin_of_goods=?,
           port_of_loading=?, port_of_discharge=?, payment_term_code=?, payment_term_label=?, incoterm=?, shipping_method_label=?,
           exporter_bank_account_id=?, currency=?, fob_total_minor=?, sea_freight_minor=?, total_minor=?, version=version+1, updated_at=?
         WHERE id=? AND status='DRAFT'`,
      )
      .bind(
        caseId,
        text(input.invoiceNumber, "invoiceNumber", 40, true),
        text(input.printReference, "printReference", 40),
        text(input.invoiceDate, "invoiceDate", 40, true),
        text(input.originOfGoods, "originOfGoods", 80) ?? "EGYPT",
        text(input.portOfLoading, "portOfLoading", 80),
        text(input.portOfDischarge, "portOfDischarge", 80),
        term(input.paymentTermCode),
        text(input.paymentTermLabel, "paymentTermLabel", 200),
        incoterm(input.incoterm),
        text(input.shippingMethodLabel, "shippingMethodLabel", 40),
        text(input.exporterBankAccountId, "exporterBankAccountId", 80),
        (text(input.currency, "currency", 3) ?? "USD").toUpperCase(),
        fob,
        seaFreight,
        fob + seaFreight,
        now,
        id,
      ),
    db.prepare("DELETE FROM proforma_lines WHERE proforma_id = ?").bind(id),
    ...lines.map((line, index) =>
      db
        .prepare(
          `INSERT INTO proforma_lines (id, proforma_id, line_no, description, unit_label, quantity, unit_price_minor, line_total_minor)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(newId(), id, index + 1, line.description, line.unit, line.quantity, line.unitPriceMinor, lineTotal(line.quantity, line.unitPriceMinor)),
    ),
  ]);
  return getProforma(db, actor, id);
}

export async function issueProforma(db: D1Database, bucket: R2Bucket, actor: Actor, id: string) {
  await ready(db);
  requirePermission(actor, "invoices.edit");
  const current = await getProforma(db, actor, id);
  assertDraft(String(current.status));
  const snapshot = JSON.stringify({ ...current, issuedAt: nowIso() });
  await db
    .prepare("UPDATE proforma_invoices SET status='ISSUED', issued_snapshot_json=?, version=version+1, updated_at=? WHERE id=? AND status='DRAFT'")
    .bind(snapshot, nowIso(), id)
    .run();
  await storeIssuedProformaPdf(db, bucket, actor, id);
  return getProforma(db, actor, id);
}

export async function convertProforma(db: D1Database, actor: Actor, id: string) {
  await ready(db);
  requirePermission(actor, "invoices.edit");
  const proforma = await one<{
    id: string;
    customer_id: string;
    case_id: string | null;
    invoice_number: string;
    print_reference: string | null;
    invoice_date: string;
    origin_of_goods: string;
    port_of_loading: string | null;
    port_of_discharge: string | null;
    payment_term_code: string;
    payment_term_label: string | null;
    incoterm: string;
    shipping_method_label: string | null;
    exporter_bank_account_id: string | null;
    currency: string;
    fob_total_minor: number;
    sea_freight_minor: number;
    total_minor: number;
    status: string;
  }>(db, "SELECT * FROM proforma_invoices WHERE id = ?", id);
  if (!proforma) throw errors.notFound("Proforma not found");
  if (!proforma.case_id) throw errors.conflict("Link the proforma to an operation before converting it.", "PROFORMA_CASE_REQUIRED");
  await assertCaseAccess(db, actor, proforma.case_id);
  const lines = await all<{ description: string; unit_label: string | null; quantity: number; unit_price_minor: number; line_total_minor: number }>(
    db,
    "SELECT description, unit_label, quantity, unit_price_minor, line_total_minor FROM proforma_lines WHERE proforma_id = ? ORDER BY line_no",
    id,
  );
  const now = nowIso();
  let invoice = await one<{ id: string; trade_status: string }>(db, "SELECT id, trade_status FROM export_invoices WHERE case_id = ?", proforma.case_id);
  if (invoice?.trade_status === "ISSUED") throw errors.conflict("The commercial invoice is already issued.", "TRADE_ISSUED");
  if (!invoice) {
    const invoiceId = newId();
    await db
      .prepare(
        `INSERT INTO export_invoices
           (id, case_id, invoice_number, invoice_date, customer_id, port_of_loading, port_of_discharge, payment_term_code, payment_term_label,
            incoterm, incoterms_edition, shipping_method_label, origin_of_goods, exporter_bank_account_id, currency, currency_decimals,
            goods_value_minor, invoiced_freight_minor, actual_freight_expense_minor, invoice_total_minor, gross_weight_grams, net_weight_grams,
            packages_count, trade_status, trade_revision, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Incoterms 2020', ?, ?, ?, ?, 2, ?, ?, 0, ?, 0, 0, 0, 'DRAFT', 0, 1, ?, ?)`,
      )
      .bind(
        invoiceId,
        proforma.case_id,
        proforma.invoice_number,
        proforma.invoice_date,
        proforma.customer_id,
        proforma.port_of_loading,
        proforma.port_of_discharge,
        proforma.payment_term_code,
        proforma.payment_term_label,
        proforma.incoterm,
        proforma.shipping_method_label,
        proforma.origin_of_goods,
        proforma.exporter_bank_account_id,
        proforma.currency,
        proforma.fob_total_minor,
        proforma.sea_freight_minor,
        proforma.total_minor,
        now,
        now,
      )
      .run();
    invoice = { id: invoiceId, trade_status: "DRAFT" };
  } else {
    await db
      .prepare(
        `UPDATE export_invoices SET invoice_date=?, port_of_loading=?, port_of_discharge=?, payment_term_code=?, payment_term_label=?,
           incoterm=?, shipping_method_label=?, origin_of_goods=?, exporter_bank_account_id=?, goods_value_minor=?, invoiced_freight_minor=?,
           invoice_total_minor=?, version=version+1, updated_at=? WHERE id=?`,
      )
      .bind(
        proforma.invoice_date,
        proforma.port_of_loading,
        proforma.port_of_discharge,
        proforma.payment_term_code,
        proforma.payment_term_label,
        proforma.incoterm,
        proforma.shipping_method_label,
        proforma.origin_of_goods,
        proforma.exporter_bank_account_id,
        proforma.fob_total_minor,
        proforma.sea_freight_minor,
        proforma.total_minor,
        now,
        invoice.id,
      )
      .run();
  }
  await db.batch([
    db.prepare("DELETE FROM invoice_lines WHERE invoice_id = ?").bind(invoice.id),
    ...lines.map((line, index) =>
      db
        .prepare(
          `INSERT INTO invoice_lines (id, invoice_id, line_no, description, hs_code, barcode, unit_label, quantity, unit_price_minor, line_total_minor)
           VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
        )
        .bind(newId(), invoice.id, index + 1, line.description, line.unit_label, line.quantity, line.unit_price_minor, line.line_total_minor),
    ),
    db.prepare("UPDATE proforma_invoices SET converted_invoice_id = ?, version = version + 1, updated_at = ? WHERE id = ?").bind(invoice.id, now, id),
  ]);
  const saved = await all(db, "SELECT line_no, description, quantity, line_total_minor FROM invoice_lines WHERE invoice_id = ? ORDER BY line_no", invoice.id);
  return { invoiceId: invoice.id, proformaId: id, lines: saved };
}

export async function listProformas(db: D1Database, actor: Actor, caseId?: string) {
  await ready(db);
  requirePermission(actor, "invoices.view");
  if (caseId) await assertCaseAccess(db, actor, caseId);
  return all(
    db,
    caseId
      ? "SELECT * FROM proforma_invoices WHERE case_id = ? ORDER BY created_at DESC"
      : "SELECT * FROM proforma_invoices ORDER BY created_at DESC LIMIT 100",
    ...(caseId ? [caseId] : []),
  );
}

export async function tradeSheet(db: D1Database, actor: Actor, invoiceId: string) {
  await ready(db);
  requirePermission(actor, "invoices.view");
  const head = await invoiceHead(db, actor, invoiceId);
  const lines = await all(db, "SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_no", invoiceId);
  const packing = await all(db, "SELECT * FROM packing_lines WHERE invoice_id = ? ORDER BY line_no", invoiceId);
  return { header: head, lines, packing, reconciliation: await loadReconciliation(db, head) };
}

export async function saveTradeHeader(db: D1Database, actor: Actor, invoiceId: string, input: Record<string, unknown>) {
  await ready(db);
  requirePermission(actor, "invoices.edit");
  const head = await invoiceHead(db, actor, invoiceId);
  assertDraft(head.trade_status);
  const freight = input.seaFreightMinor == null ? Number(head.invoiced_freight_minor) : whole(input.seaFreightMinor, "seaFreightMinor");
  const goods = await one<{ goods_value_minor: number }>(db, "SELECT goods_value_minor FROM export_invoices WHERE id = ?", invoiceId);
  await db
    .prepare(
      `UPDATE export_invoices
       SET payment_term_label = ?, shipping_method_label = ?, origin_of_goods = ?, exporter_bank_account_id = ?,
           print_reference = ?, invoiced_freight_minor = ?, invoice_total_minor = ?, version = version + 1, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      text(input.paymentTermLabel, "paymentTermLabel", 200),
      text(input.shippingMethodLabel, "shippingMethodLabel", 40),
      text(input.originOfGoods, "originOfGoods", 80),
      text(input.exporterBankAccountId, "exporterBankAccountId", 80),
      text(input.printReference, "printReference", 40),
      freight,
      Number(goods?.goods_value_minor ?? 0) + freight,
      nowIso(),
      invoiceId,
    )
    .run();
  return tradeSheet(db, actor, invoiceId);
}
