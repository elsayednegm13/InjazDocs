import type { CommercialPdf, PackingPdf, ProformaPdf, TradeBank, TradeBuyer, TradeIdentity, TradeItem, TradePackingRow } from "./trade-document-pdf";
import { renderCustomsBundle, renderTradePdf } from "./trade-document-pdf";
import { assertDocumentTransition } from "../domain/transitions";
import type { DocumentRequirementStatus } from "../../shared/enums";
import { all, newId, nowIso, one } from "../db/sql";
import { errors } from "../http/errors";
import type { Actor } from "./actor";
import { assertCaseAccess, requirePermission } from "./actor";
import { ensureTradeDefaults } from "./trade-defaults";

const EMPTY_IDENTITY: TradeIdentity = {
  nameEn: "",
  nameAr: "",
  address: "",
  phone: "",
  email: "",
  taxCard: "",
  taxFile: "",
  commercialRegistry: "",
  stampLabelEn: "",
  stampLabelAr: "",
};

export async function proformaPdfBytes(db: D1Database, bucket: R2Bucket, actor: Actor, id: string) {
  requirePermission(actor, "invoices.view");
  const row = await one<{ case_id: string | null; status: string; issued_snapshot_json: string | null }>(
    db,
    "SELECT case_id, status, issued_snapshot_json FROM proforma_invoices WHERE id = ?",
    id,
  );
  if (!row) throw errors.notFound("Proforma not found");
  if (row.case_id) await assertCaseAccess(db, actor, row.case_id);
  if (row.status === "ISSUED" && row.issued_snapshot_json) {
    const snapshot = JSON.parse(row.issued_snapshot_json) as { pdfR2Key?: string };
    if (snapshot.pdfR2Key) {
      const stored = await readObject(bucket, snapshot.pdfR2Key);
      if (stored) return stored;
    }
  }
  return renderTradePdf(await proformaModel(db, bucket, id, row.status !== "ISSUED"));
}

export async function invoicePdfBytes(db: D1Database, bucket: R2Bucket, actor: Actor, invoiceId: string, kind: "commercial" | "packing" | "customs") {
  requirePermission(actor, "invoices.view");
  const head = await one<{ case_id: string; trade_status: string }>(db, "SELECT case_id, trade_status FROM export_invoices WHERE id = ?", invoiceId);
  if (!head) throw errors.notFound("Invoice not found");
  await assertCaseAccess(db, actor, head.case_id);
  const draft = head.trade_status !== "ISSUED";
  if (kind === "packing") return renderTradePdf(await packingModel(db, bucket, invoiceId, draft));
  if (kind === "customs") {
    const commercial = await commercialModel(db, bucket, invoiceId, draft);
    const packing = await packingModel(db, bucket, invoiceId, draft);
    return renderCustomsBundle(commercial, packing);
  }
  return renderTradePdf(await commercialModel(db, bucket, invoiceId, draft));
}

export async function storeIssuedTradePdfs(db: D1Database, bucket: R2Bucket, actor: Actor, invoiceId: string, revision: number) {
  const head = await one<{ id: string; case_id: string }>(db, "SELECT id, case_id FROM export_invoices WHERE id = ?", invoiceId);
  if (!head) throw errors.notFound("Invoice not found");
  const commercial = await renderTradePdf(await commercialModel(db, bucket, invoiceId, false));
  const packing = await renderTradePdf(await packingModel(db, bucket, invoiceId, false));
  const commercialKey = `trade/${head.case_id}/${invoiceId}/commercial-r${revision}.pdf`;
  const packingKey = `trade/${head.case_id}/${invoiceId}/packing-r${revision}.pdf`;
  await bucket.put(commercialKey, commercial, { httpMetadata: { contentType: "application/pdf" } });
  await bucket.put(packingKey, packing, { httpMetadata: { contentType: "application/pdf" } });
  await stackGeneratedVersion(db, actor, head.case_id, "commercial_invoice", commercialKey, "commercial-invoice.pdf", commercial.byteLength);
  await stackGeneratedVersion(db, actor, head.case_id, "packing_list", packingKey, "packing-list.pdf", packing.byteLength);
}

export async function storeIssuedProformaPdf(db: D1Database, bucket: R2Bucket, actor: Actor, proformaId: string) {
  const row = await one<{ case_id: string | null; issued_snapshot_json: string | null }>(
    db,
    "SELECT case_id, issued_snapshot_json FROM proforma_invoices WHERE id = ?",
    proformaId,
  );
  if (!row?.issued_snapshot_json) return;
  const bytes = await renderTradePdf(await proformaModel(db, bucket, proformaId, false));
  const key = `trade/proforma/${proformaId}.pdf`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: "application/pdf" } });
  const snapshot = JSON.parse(row.issued_snapshot_json) as Record<string, unknown>;
  snapshot.pdfR2Key = key;
  await db.prepare("UPDATE proforma_invoices SET issued_snapshot_json = ? WHERE id = ?").bind(JSON.stringify(snapshot), proformaId).run();
  if (row.case_id) {
    await stackGeneratedVersion(db, actor, row.case_id, "proforma_invoice", key, "proforma.pdf", bytes.byteLength);
  }
}

async function stackGeneratedVersion(
  db: D1Database,
  actor: Actor,
  caseId: string,
  typeKey: string,
  r2Key: string,
  filename: string,
  byteSize: number,
) {
  const requirement = await one<{ id: string; status: DocumentRequirementStatus }>(
    db,
    `SELECT r.id, r.status FROM operation_document_requirements r
     JOIN document_type_definitions d ON d.id = r.document_type_id
     WHERE r.case_id = ? AND d.key = ?`,
    caseId,
    typeKey,
  );
  if (!requirement) return;
  const last = await one<{ version: number }>(db, "SELECT MAX(version) AS version FROM document_versions WHERE requirement_id = ?", requirement.id);
  const version = (last?.version ?? 0) + 1;
  await db
    .prepare(
      `INSERT INTO document_versions
         (id, requirement_id, version, r2_key, original_name, content_type, byte_size, uploaded_by, review_state, created_at)
       VALUES (?, ?, ?, ?, ?, 'application/pdf', ?, ?, 'UPLOADED', ?)`,
    )
    .bind(newId(), requirement.id, version, r2Key, filename, byteSize, actor.id, nowIso())
    .run();
  if (requirement.status !== "UPLOADED") {
    assertDocumentTransition(requirement.status, "UPLOADED");
    await db.prepare("UPDATE operation_document_requirements SET status = 'UPLOADED', updated_at = ? WHERE id = ?").bind(nowIso(), requirement.id).run();
  }
}

async function proformaModel(db: D1Database, bucket: R2Bucket, id: string, draft: boolean): Promise<ProformaPdf> {
  const row = await one<Record<string, unknown>>(db, "SELECT * FROM proforma_invoices WHERE id = ?", id);
  if (!row) throw errors.notFound("Proforma not found");
  const lines = await all<{ description: string; unit_label: string | null; quantity: number; unit_price_minor: number; line_total_minor: number }>(
    db,
    "SELECT description, unit_label, quantity, unit_price_minor, line_total_minor FROM proforma_lines WHERE proforma_id = ? ORDER BY line_no",
    id,
  );
  const chrome = await chromeFor(db, String(row.customer_id), row.exporter_bank_account_id ? String(row.exporter_bank_account_id) : null, bucket);
  return {
    kind: "proforma",
    draft,
    ...chrome,
    date: String(row.invoice_date ?? ""),
    invoiceNumber: String(row.invoice_number ?? ""),
    printReference: String(row.print_reference ?? ""),
    origin: String(row.origin_of_goods ?? "EGYPT"),
    portOfLoading: String(row.port_of_loading ?? ""),
    portOfDischarge: String(row.port_of_discharge ?? ""),
    shippingMethod: String(row.shipping_method_label ?? row.incoterm ?? ""),
    paymentTerm: String(row.payment_term_label ?? row.payment_term_code ?? ""),
    incoterm: String(row.incoterm ?? "FOB"),
    fobMinor: Number(row.fob_total_minor ?? 0),
    freightMinor: Number(row.sea_freight_minor ?? 0),
    lines: lines.map(itemFrom),
  };
}

async function commercialModel(db: D1Database, bucket: R2Bucket, invoiceId: string, draft: boolean): Promise<CommercialPdf> {
  const row = await one<Record<string, unknown>>(db, "SELECT * FROM export_invoices WHERE id = ?", invoiceId);
  if (!row) throw errors.notFound("Invoice not found");
  const lines = await all<{ description: string; unit_label: string | null; quantity: number; unit_price_minor: number; line_total_minor: number }>(
    db,
    "SELECT description, unit_label, quantity, unit_price_minor, line_total_minor FROM invoice_lines WHERE invoice_id = ? ORDER BY line_no",
    invoiceId,
  );
  const chrome = await chromeFor(db, String(row.customer_id), row.exporter_bank_account_id ? String(row.exporter_bank_account_id) : null, bucket);
  return {
    kind: "commercial",
    draft,
    ...chrome,
    date: String(row.invoice_date ?? ""),
    invoiceNumber: String(row.invoice_number ?? ""),
    printReference: String(row.print_reference ?? ""),
    origin: String(row.origin_of_goods ?? ""),
    portOfLoading: String(row.port_of_loading ?? ""),
    portOfDischarge: String(row.port_of_discharge ?? ""),
    shippingMethod: String(row.shipping_method_label ?? row.incoterm ?? ""),
    paymentTerm: String(row.payment_term_label ?? row.payment_term_code ?? ""),
    incoterm: String(row.incoterm ?? "FOB"),
    fobMinor: Number(row.goods_value_minor ?? 0),
    freightMinor: Number(row.invoiced_freight_minor ?? 0),
    packages: Number(row.packages_count ?? 0),
    grossGrams: Number(row.gross_weight_grams ?? 0),
    netGrams: Number(row.net_weight_grams ?? 0),
    lines: lines.map(itemFrom),
  };
}

async function packingModel(db: D1Database, bucket: R2Bucket, invoiceId: string, draft: boolean): Promise<PackingPdf> {
  const commercial = await commercialModel(db, bucket, invoiceId, draft);
  const rows = await all<{
    description: string;
    packages_count: number;
    packing_per_package: number;
    pieces_count: number;
    gross_weight_grams: number;
    net_weight_grams: number;
    slot_index: number | null;
    official_number: string | null;
  }>(
    db,
    `SELECT p.description, p.packages_count, p.packing_per_package, p.pieces_count, p.gross_weight_grams, p.net_weight_grams,
            c.slot_index, c.official_number
     FROM packing_lines p
     LEFT JOIN containers c ON c.id = p.container_id
     WHERE p.invoice_id = ?
     ORDER BY COALESCE(c.slot_index, 9999), p.line_no`,
    invoiceId,
  );
  const packingRows: TradePackingRow[] = rows.map((row) => ({
    slot: row.slot_index,
    containerNumber: row.official_number ?? "",
    description: row.description,
    packages: Number(row.packages_count),
    perPackage: Number(row.packing_per_package),
    pieces: Number(row.pieces_count),
    grossGrams: Number(row.gross_weight_grams),
    netGrams: Number(row.net_weight_grams),
  }));
  return { ...commercial, kind: "packing", rows: packingRows };
}

function itemFrom(row: { description: string; unit_label: string | null; quantity: number; unit_price_minor: number; line_total_minor: number }): TradeItem {
  return {
    description: row.description,
    unit: row.unit_label ?? "",
    quantity: Number(row.quantity),
    unitPriceMinor: Number(row.unit_price_minor),
    lineTotalMinor: Number(row.line_total_minor),
  };
}

async function chromeFor(db: D1Database, customerId: string, bankId: string | null, bucket?: R2Bucket) {
  await ensureTradeDefaults(db);
  const identity = await one<Record<string, unknown>>(db, "SELECT * FROM exporter_identity WHERE id = 'default'");
  const marks = await one<{ logo_r2_key: string | null; stamp_r2_key: string | null; stamp_label_en: string | null; stamp_label_ar: string | null }>(
    db,
    "SELECT logo_r2_key, stamp_r2_key, stamp_label_en, stamp_label_ar FROM exporter_marks WHERE id = 'default'",
  );
  const customer = await one<{ legal_name: string; tax_id: string | null }>(db, "SELECT legal_name, tax_id FROM customers WHERE id = ?", customerId);
  const address = await one<{ line1: string; city: string | null; country_code: string | null }>(
    db,
    "SELECT line1, city, country_code FROM customer_addresses WHERE customer_id = ? ORDER BY is_primary DESC LIMIT 1",
    customerId,
  );
  const contact = await one<{ phone: string | null; email: string | null }>(
    db,
    "SELECT phone, email FROM customer_contacts WHERE customer_id = ? ORDER BY is_primary DESC LIMIT 1",
    customerId,
  );
  const bankRow = bankId
    ? await one<Record<string, unknown>>(db, "SELECT * FROM exporter_bank_accounts WHERE id = ?", bankId)
    : await one<Record<string, unknown>>(db, "SELECT * FROM exporter_bank_accounts WHERE is_default = 1 ORDER BY created_at LIMIT 1");
  const buyer: TradeBuyer = {
    name: customer?.legal_name ?? "",
    address: [address?.line1, address?.city, address?.country_code].filter(Boolean).join(", "),
    vat: customer?.tax_id ?? "",
    phone: contact?.phone ?? "",
    email: contact?.email ?? "",
  };
  const bank: TradeBank | null = bankRow
    ? {
        accountName: String(bankRow.account_name ?? ""),
        iban: String(bankRow.iban ?? ""),
        bankName: String(bankRow.bank_name ?? ""),
        bankAddress: String(bankRow.bank_address ?? ""),
        swift: String(bankRow.swift_code ?? ""),
      }
    : null;
  return {
    identity: {
      ...EMPTY_IDENTITY,
      nameEn: String(identity?.name_en ?? ""),
      nameAr: String(identity?.name_ar ?? ""),
      address: String(identity?.address ?? ""),
      phone: String(identity?.phone ?? ""),
      email: String(identity?.email ?? ""),
      taxCard: String(identity?.tax_card ?? ""),
      taxFile: String(identity?.tax_file ?? ""),
      commercialRegistry: String(identity?.commercial_registry ?? ""),
      stampLabelEn: marks?.stamp_label_en ?? "",
      stampLabelAr: marks?.stamp_label_ar ?? "",
    },
    buyer,
    bank,
    logo: bucket && marks?.logo_r2_key ? await readObject(bucket, marks.logo_r2_key) : null,
    stamp: bucket && marks?.stamp_r2_key ? await readObject(bucket, marks.stamp_r2_key) : null,
  };
}

async function readObject(bucket: R2Bucket, key: string) {
  const object = await bucket.get(key);
  if (!object) return null;
  return new Uint8Array(await object.arrayBuffer());
}
