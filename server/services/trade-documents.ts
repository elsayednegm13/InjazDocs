import {
  calculatePackingLineWeights,
  groupPackingByContainer,
  netAboveGross,
  parseExtraAccessories,
  reconcileTradeTotals,
  shouldIncludePiecesInReconciliation,
  sumNumbers,
  type ExtraAccessory,
  type PackingLineType,
  type ReconciliationSummary,
  type TradeTotals,
} from "../../shared/trade-documents";
import { normalizePrintFields } from "../../shared/trade-print-fields";
import { TRADE_PAGE_H, TRADE_PAGE_W } from "../../shared/trade-sheet";
import { all, newId, nowIso, one } from "../db/sql";
import { errors } from "../http/errors";
import { edgeCache } from "../lib/cache";
import type { Actor } from "./actor";
import { assertCaseAccess, requireAny, requirePermission } from "./actor";
import { assertSchemaReady } from "./schema";
import { ensureTradeDefaults, listShippingMethodRows, shippingIncludesFreight } from "./trade-defaults";
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
  port_of_loading: string | null;
  port_of_discharge: string | null;
  exporter_bank_account_id: string | null;
  goods_value_minor: number;
  print_reference: string | null;
  incoterm: string;
  is_stamped: number;
  stamp_x: number | null;
  stamp_y: number | null;
  stamp_rotation: number | null;
  stamp_x_ratio: number | null;
  stamp_y_ratio: number | null;
  stamp_scale: number | null;
  packing_is_stamped: number;
  packing_stamp_x_ratio: number | null;
  packing_stamp_y_ratio: number | null;
  packing_stamp_scale: number | null;
  packing_stamp_rotation: number | null;
  print_fields_json: string | null;
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
  lineType: PackingLineType;
  packagesCount: number;
  packingPerPackage: number;
  piecesCount: number;
  unitNetWeightGrams: number;
  bagWeightGrams: number;
  posterWeightGrams: number;
  otherAccessoryWeightGrams: number;
  extraAccessoriesJson: string | null;
  manualWeightOverride: number;
  includePiecesInReconciliation: number;
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

function lineTotal(quantity: number, unitPriceMinor: number) {
  return quantity * unitPriceMinor;
}

async function invoiceHead(db: D1Database, actor: Actor, invoiceId: string) {
  const row = await one<InvoiceHead>(
    db,
    `SELECT id, case_id, customer_id, invoiced_freight_minor, packages_count, gross_weight_grams, net_weight_grams,
            trade_status, trade_revision, payment_term_code, payment_term_label, shipping_method_label, origin_of_goods,
            port_of_loading, port_of_discharge,
            exporter_bank_account_id, goods_value_minor, print_reference, incoterm, is_stamped, stamp_x, stamp_y, stamp_rotation,
            stamp_x_ratio, stamp_y_ratio, stamp_scale, packing_is_stamped, packing_stamp_x_ratio, packing_stamp_y_ratio,
            packing_stamp_scale, packing_stamp_rotation, print_fields_json
     FROM export_invoices WHERE id = ?`,
    invoiceId,
  );
  if (!row) throw errors.notFound("Invoice not found");
  await assertCaseAccess(db, actor, row.case_id);
  return row;
}

function storedIncoterm(value: unknown, includeFreight: boolean) {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (code === "FOB" || code === "CFR") return code;
  return includeFreight ? "CFR" : "FOB";
}

function stampFields(input: Record<string, unknown>) {
  const stamped = input.isStamped === true || input.isStamped === 1 ? 1 : 0;
  if (!stamped) return { stamped: 0, x: null, y: null, rotation: null, xRatio: null, yRatio: null, scale: null };
  const xRatio = ratioOf(input.stampXRatio, input.stampX, TRADE_PAGE_W);
  const yRatio = ratioOf(input.stampYRatio, input.stampY, TRADE_PAGE_H);
  const scale = clampNumber(input.stampScale ?? 1, 0.35, 2.5);
  return {
    stamped,
    x: xRatio * TRADE_PAGE_W,
    y: yRatio * TRADE_PAGE_H,
    rotation: clampNumber(input.stampRotation, -40, 40),
    xRatio,
    yRatio,
    scale,
  };
}

function ratioOf(ratio: unknown, absolute: unknown, page: number) {
  const direct = Number(ratio);
  if (Number.isFinite(direct)) return Math.min(1, Math.max(0, direct));
  const point = Number(absolute);
  if (Number.isFinite(point)) return Math.min(1, Math.max(0, point / page));
  return 0.5;
}

function storedPrintFields(input: Record<string, unknown>) {
  if (!Array.isArray(input.printFields)) return null;
  return JSON.stringify(normalizePrintFields(input.printFields));
}

function clampNumber(value: unknown, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return (min + max) / 2;
  return Math.min(max, Math.max(min, number));
}

function assertDraft(status: string) {
  if (status === "ISSUED") throw errors.conflict("This document is already issued.", "TRADE_ISSUED");
}

export async function customerPrintProfile(db: D1Database, actor: Actor, customerId: string) {
  await ready(db);
  requirePermission(actor, "invoices.view");
  const [customerRes, addressRes, contactRes, bankRes] = await db.batch([
    db.prepare("SELECT legal_name, tax_id, customer_code, country_code FROM customers WHERE id = ?").bind(customerId),
    db
      .prepare("SELECT line1, line2, city, region, postal_code, country_code FROM customer_addresses WHERE customer_id = ? ORDER BY is_primary DESC LIMIT 1")
      .bind(customerId),
    db
      .prepare("SELECT phone, email FROM customer_contacts WHERE customer_id = ? ORDER BY is_primary DESC LIMIT 1")
      .bind(customerId),
    db
      .prepare(
        "SELECT bank_name, account_name, account_number, account_number_last4, iban, iban_last4, swift FROM customer_bank_accounts WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .bind(customerId),
  ]);
  const customer = customerRes.results?.[0] as
    | { legal_name: string; tax_id: string | null; customer_code: string | null; country_code: string | null }
    | undefined;
  if (!customer) throw errors.notFound("Customer not found");
  const address = addressRes.results?.[0] as
    | { line1: string; line2: string | null; city: string | null; region: string | null; postal_code: string | null; country_code: string | null }
    | undefined;
  const contact = contactRes.results?.[0] as { phone: string | null; email: string | null } | undefined;
  const bank = bankRes.results?.[0] as
    | { bank_name: string; account_name: string | null; account_number: string | null; account_number_last4: string | null; iban: string | null; iban_last4: string | null; swift: string | null }
    | undefined;
  return {
    name: customer.legal_name,
    address: [address?.line1, address?.line2, address?.city, address?.region, address?.postal_code, address?.country_code].filter(Boolean).join(", "),
    taxId: customer.tax_id ?? "",
    phone: contact?.phone ?? "",
    email: contact?.email ?? "",
    bankName: bank?.bank_name ?? "",
    accountName: bank?.account_name ?? "",
    accountLast4: bank?.account_number || bank?.account_number_last4 || "",
    ibanLast4: bank?.iban || bank?.iban_last4 || "",
    swift: bank?.swift ?? "",
    code: customer.customer_code ?? "",
    country: customer.country_code ?? address?.country_code ?? "",
  };
}

export async function getExporterIdentity(db: D1Database, actor: Actor) {
  await ready(db);
  requireAny(actor, ["settings.manage", "invoices.view"]);
  return edgeCache.getOrLoad(
    db,
    "exporter:identity",
    async () => (await one(db, "SELECT * FROM exporter_identity WHERE id = 'default'")) ?? null,
    5 * 60_000,
  );
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
  edgeCache.del(db, "exporter:identity");
  return getExporterIdentity(db, actor);
}

export async function listExporterBanks(db: D1Database, actor: Actor) {
  await ready(db);
  requireAny(actor, ["settings.manage", "exporter.bank_accounts.manage", "invoices.view", "proformas.view"]);
  return edgeCache.getOrLoad(
    db,
    "exporter:banks",
    () => all(db, "SELECT * FROM exporter_bank_accounts ORDER BY is_default DESC, created_at"),
    5 * 60_000,
  );
}

export async function saveExporterBank(db: D1Database, actor: Actor, input: Record<string, unknown>, bankId?: string) {
  await ready(db);
  requirePermission(actor, "exporter.bank_accounts.manage");
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
  edgeCache.del(db, "exporter:banks");
  return one(db, "SELECT * FROM exporter_bank_accounts WHERE id = ?", id);
}

export async function uploadExporterMark(db: D1Database, bucket: R2Bucket, actor: Actor, kind: "logo" | "stamp", dataUrl: string) {
  await ready(db);
  if (kind === "stamp") {
    requirePermission(actor, "trade.stamp.manage");
  } else {
    requirePermission(actor, "settings.manage");
  }
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
  edgeCache.del(db, "exporter:marks");
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
  return edgeCache.getOrLoad(
    db,
    "exporter:marks",
    async () => (await one(db, "SELECT * FROM exporter_marks WHERE id = 'default'")) ?? null,
    5 * 60_000,
  );
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
  edgeCache.del(db, "exporter:marks");
  return getExporterMarks(db, actor);
}

export async function listProductPresets(db: D1Database, actor: Actor) {
  await ready(db);
  requireAny(actor, ["invoices.view", "proformas.view", "catalog.products.manage"]);
  return edgeCache.getOrLoad(
    db,
    "catalog:product_presets",
    () => all(db, "SELECT * FROM product_presets WHERE active = 1 ORDER BY name"),
    5 * 60_000,
  );
}

export async function saveProductPreset(db: D1Database, actor: Actor, input: Record<string, unknown>, presetId?: string) {
  await ready(db);
  requirePermission(actor, "catalog.products.manage");
  const now = nowIso();
  const id = presetId ?? newId();
  const name = text(input.name, "name", 200, true);
  const description = text(input.descriptionTemplate, "descriptionTemplate", 4000) ?? "";
  const packing = input.defaultPackingPerPackage == null ? null : whole(input.defaultPackingPerPackage, "defaultPackingPerPackage");
  const rawPieceWeight = input.pieceWeightGrams == null ? null : whole(input.pieceWeightGrams, "pieceWeightGrams");
  const unitNetWeight = input.unitNetWeightGrams != null
    ? whole(input.unitNetWeightGrams, "unitNetWeightGrams")
    : (rawPieceWeight ?? 0);
  const pieceWeight = rawPieceWeight ?? (unitNetWeight > 0 ? unitNetWeight : null);
  const bagWeight = input.bagWeightGrams == null ? 0 : whole(input.bagWeightGrams, "bagWeightGrams");
  const posterWeight = input.posterWeightGrams == null ? 0 : whole(input.posterWeightGrams, "posterWeightGrams");
  const extraAccessories: ExtraAccessory[] = parseExtraAccessories(input.extraAccessories ?? input.extraAccessoriesJson);
  const extraSum = sumNumbers(extraAccessories.map((item) => item.weightGrams));
  const otherAccessoryWeight = input.otherAccessoryWeightGrams == null
    ? extraSum
    : whole(input.otherAccessoryWeightGrams, "otherAccessoryWeightGrams");
  const extraJson = extraAccessories.length > 0 ? JSON.stringify(extraAccessories) : null;
  const price = input.defaultPriceMinor == null ? 0 : whole(input.defaultPriceMinor, "defaultPriceMinor");
  if (presetId) {
    const existing = await one(db, "SELECT id FROM product_presets WHERE id = ?", presetId);
    if (!existing) throw errors.notFound("Preset not found");
    await db
      .prepare(
        `UPDATE product_presets SET name=?, description_template=?, ply=?, material=?, size_label=?, barcode=?, hs_code=?,
           unit_label=?, default_price_minor=?, default_packing_per_package=?, piece_weight_grams=?,
           unit_net_weight_grams=?, bag_weight_grams=?, poster_weight_grams=?, other_accessory_weight_grams=?, extra_accessories_json=?,
           updated_at=? WHERE id=?`,
      )
      .bind(
        name,
        description,
        text(input.ply, "ply", 20),
        text(input.material, "material", 80),
        text(input.sizeLabel, "sizeLabel", 40),
        text(input.barcode, "barcode", 40),
        text(input.hsCode, "hsCode", 32),
        text(input.unit, "unit", 20),
        price,
        packing,
        pieceWeight,
        unitNetWeight,
        bagWeight,
        posterWeight,
        otherAccessoryWeight,
        extraJson,
        now,
        id,
      )
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO product_presets
           (id, name, description_template, ply, material, size_label, barcode, hs_code, unit_label, default_price_minor,
            default_packing_per_package, piece_weight_grams, unit_net_weight_grams, bag_weight_grams, poster_weight_grams,
            other_accessory_weight_grams, extra_accessories_json, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .bind(
        id,
        name,
        description,
        text(input.ply, "ply", 20),
        text(input.material, "material", 80),
        text(input.sizeLabel, "sizeLabel", 40),
        text(input.barcode, "barcode", 40),
        text(input.hsCode, "hsCode", 32),
        text(input.unit, "unit", 20),
        price,
        packing,
        pieceWeight,
        unitNetWeight,
        bagWeight,
        posterWeight,
        otherAccessoryWeight,
        extraJson,
        now,
        now,
      )
      .run();
  }
  edgeCache.del(db, "catalog:product_presets");
  return one(db, "SELECT * FROM product_presets WHERE id = ?", id);
}

export async function deleteProductPreset(db: D1Database, actor: Actor, presetId: string) {
  await ready(db);
  requirePermission(actor, "catalog.products.manage");
  const existing = await one(db, "SELECT id FROM product_presets WHERE id = ?", presetId);
  if (!existing) throw errors.notFound("Preset not found");
  await db.prepare("DELETE FROM product_presets WHERE id = ?").bind(presetId).run();
  edgeCache.del(db, "catalog:product_presets");
  return { deleted: true };
}

export async function listShippingMethods(db: D1Database, actor: Actor) {
  await ready(db);
  requireAny(actor, ["settings.manage", "catalog.shipping.manage", "invoices.view", "proformas.view"]);
  return listShippingMethodRows(db);
}

export async function saveShippingMethod(db: D1Database, actor: Actor, input: Record<string, unknown>, methodId?: string) {
  await ready(db);
  requirePermission(actor, "catalog.shipping.manage");
  const now = nowIso();
  const code = (text(input.code, "code", 20, true) ?? "").toUpperCase();
  const label = text(input.label, "label", 40, true) ?? code;
  const includes = input.includesFreight === true || input.includesFreight === 1 ? 1 : 0;
  const sort = input.sortOrder == null ? 0 : whole(input.sortOrder, "sortOrder");
  const duplicate = await one<{ id: string }>(db, "SELECT id FROM shipping_methods WHERE code = ? AND id != ?", code, methodId ?? "");
  if (duplicate) throw errors.validation("This shipping method already exists.", { code: "Already used." }, "TRADE_FIELD_REQUIRED");
  if (methodId) {
    const existing = await one(db, "SELECT id FROM shipping_methods WHERE id = ?", methodId);
    if (!existing) throw errors.notFound("Shipping method not found");
    await db
      .prepare("UPDATE shipping_methods SET code = ?, label = ?, includes_freight = ?, sort_order = ?, updated_at = ? WHERE id = ?")
      .bind(code, label, includes, sort, now, methodId)
      .run();
    edgeCache.del(db, "catalog:shipping_methods");
    return one(db, "SELECT * FROM shipping_methods WHERE id = ?", methodId);
  }
  const id = newId();
  await db
    .prepare(
      `INSERT INTO shipping_methods (id, code, label, includes_freight, sort_order, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(id, code, label, includes, sort, now, now)
    .run();
  edgeCache.del(db, "catalog:shipping_methods");
  return one(db, "SELECT * FROM shipping_methods WHERE id = ?", id);
}

export async function deleteShippingMethod(db: D1Database, actor: Actor, methodId: string) {
  await ready(db);
  requirePermission(actor, "catalog.shipping.manage");
  const existing = await one(db, "SELECT id FROM shipping_methods WHERE id = ?", methodId);
  if (!existing) throw errors.notFound("Shipping method not found");
  await db.prepare("DELETE FROM shipping_methods WHERE id = ?").bind(methodId).run();
  edgeCache.del(db, "catalog:shipping_methods");
  return { deleted: true };
}

export async function readExporterMarkFile(db: D1Database, bucket: R2Bucket, actor: Actor, kind: "logo" | "stamp") {
  await ready(db);
  requireAny(actor, ["settings.manage", "trade.stamp.manage", "trade.stamp.apply", "invoices.view", "proformas.view"]);
  const row = await one<{ logo_r2_key: string | null; stamp_r2_key: string | null }>(
    db,
    "SELECT logo_r2_key, stamp_r2_key FROM exporter_marks WHERE id = 'default'",
  );
  const key = kind === "logo" ? row?.logo_r2_key : row?.stamp_r2_key;
  if (!key) throw errors.notFound("Image not found");
  const object = await bucket.get(key);
  if (!object) throw errors.notFound("Image not found");
  return new Response(await object.arrayBuffer(), {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || (key.endsWith(".png") ? "image/png" : "image/jpeg"),
      "Cache-Control": "private, max-age=60",
    },
  });
}

function commercialLines(raw: unknown): CommercialLineInput[] {
  if (!Array.isArray(raw)) throw errors.validation("Add at least one line.", { lines: "Required." }, "TRADE_FIELD_REQUIRED");
  const lines: CommercialLineInput[] = [];
  for (const item of raw) {
    const row = item as Record<string, unknown>;
    const description = text(row.description, "description", 4000);
    if (!description) continue;
    lines.push({
      description,
      hsCode: text(row.hsCode, "hsCode", 32),
      barcode: text(row.barcode, "barcode", 40),
      unit: text(row.unit, "unit", 20),
      quantity: whole(row.quantity, "quantity"),
      unitPriceMinor: whole(row.unitPriceMinor, "unitPriceMinor"),
    });
  }
  return lines;
}

function packingLines(raw: unknown): PackingLineInput[] {
  if (!Array.isArray(raw)) throw errors.validation("Packing lines are missing.", { lines: "Required." }, "TRADE_FIELD_REQUIRED");
  const lines: PackingLineInput[] = [];
  for (const item of raw) {
    const row = item as Record<string, unknown>;
    const description = text(row.description, "description", 4000);
    if (!description) continue;
    const rawType = typeof row.lineType === "string" ? row.lineType.trim().toUpperCase() : "PRODUCT";
    const lineType: PackingLineType = rawType === "ACCESSORY" ? "ACCESSORY" : "PRODUCT";
    const packagesCount = whole(row.packagesCount, "packagesCount");
    const packingPerPackage = row.packingPerPackage == null && lineType === "ACCESSORY"
      ? 1
      : whole(row.packingPerPackage, "packingPerPackage");
    const unitNetWeightGrams = row.unitNetWeightGrams == null ? 0 : whole(row.unitNetWeightGrams, "unitNetWeightGrams");
    const bagWeightGrams = row.bagWeightGrams == null ? 0 : whole(row.bagWeightGrams, "bagWeightGrams");
    const posterWeightGrams = row.posterWeightGrams == null ? 0 : whole(row.posterWeightGrams, "posterWeightGrams");
    const extraAccessories = parseExtraAccessories(row.extraAccessories ?? row.extraAccessoriesJson);
    const directOther = row.otherAccessoryWeightGrams == null ? 0 : whole(row.otherAccessoryWeightGrams, "otherAccessoryWeightGrams");
    const manualOverride = row.manualWeightOverride === true || row.manualWeightOverride === 1;
    const hasComponentWeights =
      unitNetWeightGrams > 0 ||
      bagWeightGrams > 0 ||
      posterWeightGrams > 0 ||
      directOther > 0 ||
      extraAccessories.length > 0;
    const explicitGross = row.grossWeightGrams == null ? (hasComponentWeights && !manualOverride ? 0 : whole(row.grossWeightGrams, "grossWeightGrams")) : whole(row.grossWeightGrams, "grossWeightGrams");
    const explicitNet = row.netWeightGrams == null ? (hasComponentWeights && !manualOverride ? 0 : whole(row.netWeightGrams, "netWeightGrams")) : whole(row.netWeightGrams, "netWeightGrams");
    const calculated = calculatePackingLineWeights({
      packagesCount,
      packingPerPackage,
      unitNetWeightGrams,
      bagWeightGrams,
      posterWeightGrams,
      otherAccessoryWeightGrams: directOther,
      extraAccessories,
      manualWeightOverride: manualOverride,
      grossWeightGrams: explicitGross,
      netWeightGrams: explicitNet,
    });
    if (netAboveGross(calculated.netWeightGrams, calculated.grossWeightGrams)) {
      throw errors.validation("Net weight cannot exceed gross weight.", { netWeightGrams: "Net weight is above gross weight." }, "NET_ABOVE_GROSS");
    }
    const includePieces = shouldIncludePiecesInReconciliation(
      lineType,
      row.includePiecesInReconciliation as boolean | number | null | undefined,
    ) ? 1 : 0;
    lines.push({
      description,
      hsCode: text(row.hsCode, "hsCode", 32),
      barcode: text(row.barcode, "barcode", 40),
      containerId: text(row.containerId, "containerId", 80),
      lineType,
      packagesCount,
      packingPerPackage,
      piecesCount: calculated.piecesCount,
      unitNetWeightGrams: calculated.unitNetWeightGrams,
      bagWeightGrams: calculated.bagWeightGrams,
      posterWeightGrams: calculated.posterWeightGrams,
      otherAccessoryWeightGrams: calculated.otherAccessoryWeightGrams,
      extraAccessoriesJson: extraAccessories.length > 0 ? JSON.stringify(extraAccessories) : null,
      manualWeightOverride: calculated.manualWeightOverride ? 1 : 0,
      includePiecesInReconciliation: includePieces,
      grossWeightGrams: calculated.grossWeightGrams,
      netWeightGrams: calculated.netWeightGrams,
    });
  }
  return lines;
}

export async function reconciliationFor(db: D1Database, actor: Actor, invoiceId: string): Promise<ReconciliationSummary> {
  await ready(db);
  requirePermission(actor, "invoices.view");
  const head = await invoiceHead(db, actor, invoiceId);
  return loadReconciliation(db, head);
}

function computeReconciliationFromRows(
  head: Pick<InvoiceHead, "packages_count" | "gross_weight_grams" | "net_weight_grams">,
  commercial: Array<{ quantity?: unknown }>,
  packing: Array<{
    pieces_count?: unknown;
    packages_count?: unknown;
    gross_weight_grams?: unknown;
    net_weight_grams?: unknown;
    line_type?: string | null;
    include_pieces_in_reconciliation?: number | null;
  }>,
) {
  const invoice: TradeTotals = {
    pieces: sumNumbers(commercial.map((row) => Number(row.quantity ?? 0))),
    packages: Number(head.packages_count),
    grossGrams: Number(head.gross_weight_grams),
    netGrams: Number(head.net_weight_grams),
  };
  const packed: TradeTotals = {
    pieces: sumNumbers(
      packing
        .filter((row) => shouldIncludePiecesInReconciliation(row.line_type, row.include_pieces_in_reconciliation))
        .map((row) => Number(row.pieces_count ?? 0)),
    ),
    packages: sumNumbers(packing.map((row) => Number(row.packages_count ?? 0))),
    grossGrams: sumNumbers(packing.map((row) => Number(row.gross_weight_grams ?? 0))),
    netGrams: sumNumbers(packing.map((row) => Number(row.net_weight_grams ?? 0))),
  };
  return reconcileTradeTotals(invoice, packed);
}

async function loadReconciliation(db: D1Database, head: InvoiceHead) {
  const [commRes, packRes] = await db.batch([
    db.prepare("SELECT quantity FROM invoice_lines WHERE invoice_id = ?").bind(head.id),
    db
      .prepare(
        "SELECT pieces_count, packages_count, gross_weight_grams, net_weight_grams, line_type, include_pieces_in_reconciliation FROM packing_lines WHERE invoice_id = ?",
      )
      .bind(head.id),
  ]);
  const commercial = (commRes.results ?? []) as Array<{ quantity: number }>;
  const packing = (packRes.results ?? []) as Array<{
    pieces_count: number;
    packages_count: number;
    gross_weight_grams: number;
    net_weight_grams: number;
    line_type: string | null;
    include_pieces_in_reconciliation: number | null;
  }>;
  return computeReconciliationFromRows(head, commercial, packing);
}

export async function replaceInvoiceLines(db: D1Database, actor: Actor, invoiceId: string, rawLines: unknown) {
  await ready(db);
  requirePermission(actor, "invoices.edit");
  const head = await invoiceHead(db, actor, invoiceId);
  assertDraft(head.trade_status);
  const lines = commercialLines(rawLines);
  const now = nowIso();
  const goods = sumNumbers(lines.map((line) => lineTotal(line.quantity, line.unitPriceMinor)));
  const includeFreight = await shippingIncludesFreight(db, head.shipping_method_label ?? head.incoterm);
  const freightPart = includeFreight ? Number(head.invoiced_freight_minor) : 0;
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
         SET goods_value_minor = ?, invoice_total_minor = ?, version = version + 1, updated_at = ?
         WHERE id = ?`,
      )
      .bind(goods, goods + freightPart, now, invoiceId),
  ];
  await db.batch(statements);
  return { reconciliation: await loadReconciliation(db, { ...head, packages_count: head.packages_count, gross_weight_grams: head.gross_weight_grams, net_weight_grams: head.net_weight_grams }) };
}

export async function replacePackingLines(db: D1Database, actor: Actor, invoiceId: string, rawLines: unknown) {
  await ready(db);
  requirePermission(actor, "packing.edit");
  const head = await invoiceHead(db, actor, invoiceId);
  assertDraft(head.trade_status);
  const lines = packingLines(rawLines);
  if (lines.some((line) => line.lineType === "PRODUCT" && line.manualWeightOverride === 1)) {
    requirePermission(actor, "packing.weights_override");
  }
  await db.batch([
    db.prepare("DELETE FROM packing_lines WHERE invoice_id = ?").bind(invoiceId),
    ...lines.map((line, index) =>
      db
        .prepare(
          `INSERT INTO packing_lines
             (id, invoice_id, case_id, container_id, line_no, line_type, description, hs_code, barcode,
              packages_count, packing_per_package, pieces_count,
              unit_net_weight_grams, bag_weight_grams, poster_weight_grams, other_accessory_weight_grams, extra_accessories_json,
              manual_weight_override, include_pieces_in_reconciliation,
              gross_weight_grams, net_weight_grams)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          newId(),
          invoiceId,
          head.case_id,
          line.containerId,
          index + 1,
          line.lineType,
          line.description,
          line.hsCode,
          line.barcode,
          line.packagesCount,
          line.packingPerPackage,
          line.piecesCount,
          line.unitNetWeightGrams,
          line.bagWeightGrams,
          line.posterWeightGrams,
          line.otherAccessoryWeightGrams,
          line.extraAccessoriesJson,
          line.manualWeightOverride,
          line.includePiecesInReconciliation,
          line.grossWeightGrams,
          line.netWeightGrams,
        ),
    ),
  ]);
  return { saved: true, reconciliation: await loadReconciliation(db, head) };
}

export async function syncPackingTotals(db: D1Database, actor: Actor, invoiceId: string) {
  await ready(db);
  requirePermission(actor, "packing.edit");
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
  requirePermission(actor, "invoices.issue");
  const head = await invoiceHead(db, actor, invoiceId);
  assertDraft(head.trade_status);
  const [commRes, packRes, contRes] = await db.batch([
    db.prepare("SELECT hs_code, quantity FROM invoice_lines WHERE invoice_id = ? ORDER BY line_no").bind(invoiceId),
    db
      .prepare(
        "SELECT container_id, pieces_count, packages_count, gross_weight_grams, net_weight_grams, line_type, include_pieces_in_reconciliation FROM packing_lines WHERE invoice_id = ?",
      )
      .bind(invoiceId),
    db.prepare("SELECT id, case_id, status FROM containers WHERE case_id = ?").bind(head.case_id),
  ]);
  const commercial = (commRes.results ?? []) as Array<{ hs_code: string | null; quantity: number }>;
  if (commercial.length === 0) throw errors.conflict("Add the commercial lines before issuing.", "TRADE_LINES_REQUIRED");
  if (commercial.some((line) => !line.hs_code?.trim())) throw errors.conflict("Every commercial line needs an HS code before issue.", "HS_CODE_REQUIRED");
  const packed = (packRes.results ?? []) as Array<{
    container_id: string | null;
    pieces_count: number;
    packages_count: number;
    gross_weight_grams: number;
    net_weight_grams: number;
    line_type: string | null;
    include_pieces_in_reconciliation: number | null;
  }>;
  if (packed.length === 0) throw errors.conflict("Add the packing lines before issuing.", "TRADE_LINES_REQUIRED");
  const validContainers = new Map<string, { case_id: string; status: string }>();
  for (const c of (contRes.results ?? []) as Array<{ id: string; case_id: string; status: string }>) {
    validContainers.set(c.id, c);
  }
  for (const line of packed) {
    if (!line.container_id) throw errors.conflict("Every packing line must name a container before issue.", "PACKING_CONTAINER_REQUIRED");
    const container = validContainers.get(line.container_id);
    if (!container || container.case_id !== head.case_id || container.status === "CANCELLED") {
      throw errors.conflict("Every packing line must use a live container on this operation.", "PACKING_CONTAINER_REQUIRED");
    }
  }
  const summary = computeReconciliationFromRows(head, commercial, packed);
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
  requirePermission(actor, "proformas.edit");
  const customerId = text(input.customerId, "customerId", 80, true);
  const customer = await one(db, "SELECT id FROM customers WHERE id = ?", customerId);
  if (!customer) throw errors.notFound("Customer not found");
  const caseId = text(input.caseId, "caseId", 80);
  if (caseId) await assertCaseAccess(db, actor, caseId);
  const lines = proformaLines(input.lines);
  const seaFreight = input.seaFreightMinor == null ? 0 : whole(input.seaFreightMinor, "seaFreightMinor");
  const fob = sumNumbers(lines.map((line) => lineTotal(line.quantity, line.unitPriceMinor)));
  const shippingLabel = text(input.shippingMethodLabel, "shippingMethodLabel", 40);
  const includeFreight = await shippingIncludesFreight(db, shippingLabel ?? "");
  const stamp = stampFields(input);
  if (stamp.stamped === 1) {
    requirePermission(actor, "trade.stamp.apply");
  }
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
            fob_total_minor, sea_freight_minor, total_minor, is_stamped, stamp_x, stamp_y, stamp_rotation,
            stamp_x_ratio, stamp_y_ratio, stamp_scale, status, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', 1, ?, ?)`,
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
        storedIncoterm(input.incoterm, includeFreight),
        shippingLabel,
        text(input.exporterBankAccountId, "exporterBankAccountId", 80),
        (text(input.currency, "currency", 3) ?? "USD").toUpperCase(),
        fob,
        seaFreight,
        includeFreight ? fob + seaFreight : fob,
        stamp.stamped,
        stamp.x,
        stamp.y,
        stamp.rotation,
        stamp.xRatio,
        stamp.yRatio,
        stamp.scale,
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
  const fields = storedPrintFields(input);
  if (fields) await db.prepare("UPDATE proforma_invoices SET print_fields_json = ? WHERE id = ?").bind(fields, id).run();
  return getProforma(db, actor, id);
}

export async function getProforma(db: D1Database, actor: Actor, id: string) {
  await ready(db);
  requirePermission(actor, "proformas.view");
  const header = await one<Record<string, unknown> & { status: string; case_id: string | null }>(db, "SELECT * FROM proforma_invoices WHERE id = ?", id);
  if (!header) throw errors.notFound("Proforma not found");
  if (header.case_id) await assertCaseAccess(db, actor, header.case_id);
  const lines = await all(db, "SELECT * FROM proforma_lines WHERE proforma_id = ? ORDER BY line_no", id);
  return { ...header, lines };
}

export async function updateProforma(db: D1Database, actor: Actor, id: string, input: Record<string, unknown>) {
  await ready(db);
  requirePermission(actor, "proformas.edit");
  const current = await one<{ status: string; case_id: string | null; version: number }>(db, "SELECT status, case_id, version FROM proforma_invoices WHERE id = ?", id);
  if (!current) throw errors.notFound("Proforma not found");
  assertDraft(current.status);
  if (current.case_id) await assertCaseAccess(db, actor, current.case_id);
  const caseId = input.caseId === undefined ? current.case_id : text(input.caseId, "caseId", 80);
  if (caseId) await assertCaseAccess(db, actor, caseId);
  const lines = proformaLines(input.lines);
  const seaFreight = input.seaFreightMinor == null ? 0 : whole(input.seaFreightMinor, "seaFreightMinor");
  const fob = sumNumbers(lines.map((line) => lineTotal(line.quantity, line.unitPriceMinor)));
  const shippingLabel = text(input.shippingMethodLabel, "shippingMethodLabel", 40);
  const includeFreight = await shippingIncludesFreight(db, shippingLabel ?? "");
  const stamp = stampFields(input);
  if (stamp.stamped === 1) {
    requirePermission(actor, "trade.stamp.apply");
  }
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        `UPDATE proforma_invoices SET case_id=?, invoice_number=?, print_reference=?, invoice_date=?, origin_of_goods=?,
           port_of_loading=?, port_of_discharge=?, payment_term_code=?, payment_term_label=?, incoterm=?, shipping_method_label=?,
           exporter_bank_account_id=?, currency=?, fob_total_minor=?, sea_freight_minor=?, total_minor=?,
           is_stamped=?, stamp_x=?, stamp_y=?, stamp_rotation=?, stamp_x_ratio=?, stamp_y_ratio=?, stamp_scale=?, version=version+1, updated_at=?
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
        storedIncoterm(input.incoterm, includeFreight),
        shippingLabel,
        text(input.exporterBankAccountId, "exporterBankAccountId", 80),
        (text(input.currency, "currency", 3) ?? "USD").toUpperCase(),
        fob,
        seaFreight,
        includeFreight ? fob + seaFreight : fob,
        stamp.stamped,
        stamp.x,
        stamp.y,
        stamp.rotation,
        stamp.xRatio,
        stamp.yRatio,
        stamp.scale,
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
  const fields = storedPrintFields(input);
  if (fields) await db.prepare("UPDATE proforma_invoices SET print_fields_json = ? WHERE id = ?").bind(fields, id).run();
  return getProforma(db, actor, id);
}

export async function issueProforma(db: D1Database, bucket: R2Bucket, actor: Actor, id: string) {
  await ready(db);
  requirePermission(actor, "proformas.issue");
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
  requirePermission(actor, "proformas.edit");
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
    print_fields_json: string | null;
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
  await db.prepare("UPDATE export_invoices SET print_fields_json = ? WHERE id = ?").bind(proforma.print_fields_json, invoice.id).run();
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
  requirePermission(actor, "proformas.view");
  if (caseId) await assertCaseAccess(db, actor, caseId);
  return all(
    db,
    `SELECT p.*, c.legal_name AS customer_name, c.customer_code, c.country_code AS customer_country
     FROM proforma_invoices p
     JOIN customers c ON c.id = p.customer_id
     ${caseId ? "WHERE p.case_id = ?" : ""}
     ORDER BY p.created_at DESC
     ${caseId ? "" : "LIMIT 100"}`,
    ...(caseId ? [caseId] : []),
  );
}

export async function deleteProforma(db: D1Database, actor: Actor, id: string) {
  await ready(db);
  requirePermission(actor, "proformas.delete");
  const current = await one<{ status: string; case_id: string | null }>(db, "SELECT status, case_id FROM proforma_invoices WHERE id = ?", id);
  if (!current) throw errors.notFound("Proforma not found");
  if (current.case_id) await assertCaseAccess(db, actor, current.case_id);
  if (current.status !== "DRAFT") throw errors.conflict("Only a draft proforma can be deleted.", "TRADE_ISSUED");
  await db.prepare("DELETE FROM proforma_invoices WHERE id = ? AND status = 'DRAFT'").bind(id).run();
  return { deleted: true };
}

export async function tradeSheet(db: D1Database, actor: Actor, invoiceId: string) {
  await ready(db);
  requirePermission(actor, "invoices.view");
  const head = await invoiceHead(db, actor, invoiceId);
  const [linesRes, packingRes, containersRes, bookingsRes, proformasRes] = await db.batch([
    db.prepare("SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_no").bind(invoiceId),
    db.prepare("SELECT * FROM packing_lines WHERE invoice_id = ? ORDER BY line_no").bind(invoiceId),
    db
      .prepare("SELECT id, booking_id, slot_index, official_number, status, version FROM containers WHERE case_id = ? AND status != 'CANCELLED' ORDER BY slot_index")
      .bind(head.case_id),
    db
      .prepare("SELECT id, booking_number, expected_containers, status, version FROM bookings WHERE case_id = ? AND status != 'CANCELLED' ORDER BY created_at DESC")
      .bind(head.case_id),
    db.prepare("SELECT * FROM proforma_invoices WHERE case_id = ? ORDER BY created_at DESC").bind(head.case_id),
  ]);
  const lines = (linesRes.results ?? []) as Array<Record<string, unknown>>;
  const packing = (packingRes.results ?? []) as Array<{
    id: string;
    container_id: string | null;
    line_no: number;
    line_type: PackingLineType | null;
    description: string;
    hs_code: string | null;
    barcode: string | null;
    packages_count: number;
    packing_per_package: number;
    pieces_count: number;
    unit_net_weight_grams: number;
    bag_weight_grams: number;
    poster_weight_grams: number;
    other_accessory_weight_grams: number;
    extra_accessories_json: string | null;
    manual_weight_override: number;
    include_pieces_in_reconciliation: number;
    gross_weight_grams: number;
    net_weight_grams: number;
  }>;
  const containers = (containersRes.results ?? []) as Array<{
    id: string;
    booking_id: string;
    slot_index: number;
    official_number: string | null;
    status: string;
    version: number;
  }>;
  const bookings = (bookingsRes.results ?? []) as Array<{
    id: string;
    booking_number: string;
    expected_containers: number;
    status: string;
    version: number;
  }>;
  const proformas = (proformasRes.results ?? []) as Array<Record<string, unknown>>;
  const containerGroups = groupPackingByContainer(
    containers.map((c) => ({
      id: c.id,
      slotIndex: Number(c.slot_index),
      officialNumber: c.official_number,
      status: c.status,
    })),
    packing.map((row) => ({
      ...row,
      containerId: row.container_id,
      lineType: (row.line_type === "ACCESSORY" ? "ACCESSORY" : "PRODUCT") as PackingLineType,
      packagesCount: Number(row.packages_count),
      packingPerPackage: Number(row.packing_per_package),
      piecesCount: Number(row.pieces_count),
      grossWeightGrams: Number(row.gross_weight_grams),
      netWeightGrams: Number(row.net_weight_grams),
      includePiecesInReconciliation: Number(row.include_pieces_in_reconciliation ?? 1),
    })),
  );
  return {
    header: head,
    lines,
    packing,
    containers,
    bookings,
    proformas,
    containerGroups,
    reconciliation: computeReconciliationFromRows(head, lines, packing),
  };
}

export async function saveTradeHeader(db: D1Database, actor: Actor, invoiceId: string, input: Record<string, unknown>) {
  await ready(db);
  requirePermission(actor, "invoices.edit");
  const head = await invoiceHead(db, actor, invoiceId);
  assertDraft(head.trade_status);
  const freight = input.seaFreightMinor == null ? Number(head.invoiced_freight_minor) : whole(input.seaFreightMinor, "seaFreightMinor");
  const shippingLabel = text(input.shippingMethodLabel, "shippingMethodLabel", 40);
  const includeFreight = await shippingIncludesFreight(db, shippingLabel ?? head.incoterm);
  const stamp = stampFields(input);
  const packingStamp = stampFields({
    isStamped: input.packingIsStamped,
    stampXRatio: input.packingStampXRatio,
    stampYRatio: input.packingStampYRatio,
    stampScale: input.packingStampScale,
    stampRotation: input.packingStampRotation,
  });
  if (stamp.stamped === 1 || packingStamp.stamped === 1) {
    requirePermission(actor, "trade.stamp.apply");
  }
  const goods = await one<{ goods_value_minor: number }>(db, "SELECT goods_value_minor FROM export_invoices WHERE id = ?", invoiceId);
  await db
    .prepare(
      `UPDATE export_invoices
       SET payment_term_label = ?, shipping_method_label = ?, origin_of_goods = ?, port_of_loading = ?, port_of_discharge = ?, exporter_bank_account_id = ?,
           print_reference = ?, invoiced_freight_minor = ?, invoice_total_minor = ?,
           is_stamped = ?, stamp_x = ?, stamp_y = ?, stamp_rotation = ?, stamp_x_ratio = ?, stamp_y_ratio = ?, stamp_scale = ?,
           packing_is_stamped = ?, packing_stamp_x_ratio = ?, packing_stamp_y_ratio = ?, packing_stamp_scale = ?, packing_stamp_rotation = ?,
           print_fields_json = ?, version = version + 1, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      text(input.paymentTermLabel, "paymentTermLabel", 200),
      shippingLabel,
      text(input.originOfGoods, "originOfGoods", 80),
      text(input.portOfLoading, "portOfLoading", 80),
      text(input.portOfDischarge, "portOfDischarge", 80),
      text(input.exporterBankAccountId, "exporterBankAccountId", 80),
      text(input.printReference, "printReference", 40),
      freight,
      Number(goods?.goods_value_minor ?? 0) + (includeFreight ? freight : 0),
      stamp.stamped,
      stamp.x,
      stamp.y,
      stamp.rotation,
      stamp.xRatio,
      stamp.yRatio,
      stamp.scale,
      packingStamp.stamped,
      packingStamp.xRatio,
      packingStamp.yRatio,
      packingStamp.scale,
      packingStamp.rotation,
      storedPrintFields(input),
      nowIso(),
      invoiceId,
    )
    .run();
  return tradeSheet(db, actor, invoiceId);
}
