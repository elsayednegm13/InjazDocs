import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_CATALOG,
  PERMISSION_GROUPS,
} from "../shared/permissions";
import {
  calculatePackingLineWeights,
  groupPackingByContainer,
  netAboveGross,
  reconcileTradeTotals,
} from "../shared/trade-documents";
import { hashToken } from "../server/services/tracking";
import { edgeCache } from "../server/lib/cache";
import {
  clearOfflineOutbox,
  enqueueOfflineMutation,
  flushOfflineOutbox,
  getOfflineSyncSnapshot,
  isQueueableOfflineMutation,
  setCustomReplayExecutor,
  type OutboxItem,
} from "../src/lib/offline-outbox";
import { clearLocalDraft, loadLocalDraft, saveLocalDraft } from "../src/lib/offline-drafts";
import { createTestHarness } from "./transition-2026-10-21/harness/app";
import { createAuditDatabase, type AuditDatabase } from "./transition-2026-10-21/harness/db";

const openDatabases: AuditDatabase[] = [];

function fresh() {
  const audit = createAuditDatabase();
  openDatabases.push(audit);
  return audit;
}

afterEach(() => {
  while (openDatabases.length) openDatabases.pop()?.close();
});

function codeOf(json: unknown) {
  return (json as { error?: { code?: string } } | null)?.error?.code;
}

function seedCaseInvoice(audit: AuditDatabase) {
  const now = "2026-11-09T00:00:00.000Z";
  audit.sqlite
    .prepare(
      `INSERT INTO export_invoices
         (id, case_id, invoice_number, invoice_date, customer_id, payment_term_code, incoterm, incoterms_edition,
          currency, currency_decimals, goods_value_minor, invoiced_freight_minor, actual_freight_expense_minor,
          invoice_total_minor, gross_weight_grams, net_weight_grams, version, created_at, updated_at)
       VALUES ('invoice-trade', 'case-1', 'INV-TRADE-1', '2026-11-09', 'customer-1', 'LC', 'CFR', 'Incoterms 2020',
          'USD', 2, 0, 0, 0, 0, 0, 0, 1, ?, ?)`,
    )
    .run(now, now);
  audit.sqlite
    .prepare(
      `INSERT INTO bookings (id, case_id, booking_number, status, version, created_at, updated_at)
       VALUES ('booking-trade', 'case-1', 'BKG-TRADE-1', 'CONFIRMED', 1, ?, ?)`,
    )
    .run(now, now);
  audit.sqlite
    .prepare(
      `INSERT INTO containers (id, booking_id, case_id, slot_index, official_number, status, version, created_at, updated_at)
       VALUES ('container-a', 'booking-trade', 'case-1', 1, 'TCLU0000001', 'LOADED', 1, ?, ?),
              ('container-b', 'booking-trade', 'case-1', 2, 'TCLU0000002', 'LOADED', 1, ?, ?)`,
    )
    .run(now, now, now, now);
}

describe("trade document rules", () => {
  it("rejects a net weight above the gross weight", () => {
    expect(netAboveGross(11, 10)).toBe(true);
    expect(netAboveGross(10, 10)).toBe(false);
  });

  it("reports piece, package, and weight differences without requiring the same lines", () => {
    const summary = reconcileTradeTotals(
      { pieces: 430, packages: 40, grossGrams: 12000, netGrams: 11000 },
      { pieces: 430, packages: 40, grossGrams: 12000, netGrams: 11000 },
    );
    expect(summary.matched).toBe(true);
    expect(reconcileTradeTotals(
      { pieces: 430, packages: 40, grossGrams: 12000, netGrams: 11000 },
      { pieces: 400, packages: 40, grossGrams: 12000, netGrams: 11000 },
    ).matched).toBe(false);
  });

  it("saves a draft while totals differ, then issues only when the four totals match", async () => {
    const audit = fresh();
    seedCaseInvoice(audit);
    const harness = createTestHarness(audit);
    const heavy = await harness.request({
      method: "PUT",
      path: "/api/v1/invoices/invoice-trade/packing-lines",
      body: { lines: [{ description: "too heavy net", packagesCount: 1, packingPerPackage: 1, grossWeightGrams: 10, netWeightGrams: 11 }] },
    });
    expect(heavy.status).toBe(422);
    expect(codeOf(heavy.json)).toBe("NET_ABOVE_GROSS");

    const lines = await harness.request({
      method: "PUT",
      path: "/api/v1/invoices/invoice-trade/lines",
      body: {
        lines: [
          { description: "Mixed blankets", hsCode: "6301.40", unit: "PCS", quantity: 200, unitPriceMinor: 100 },
          { description: "Printed blankets", hsCode: "6301.40", unit: "PCS", quantity: 230, unitPriceMinor: 120 },
        ],
      },
    });
    expect(lines.status).toBe(200);

    const draft = await harness.request({
      method: "PUT",
      path: "/api/v1/invoices/invoice-trade/packing-lines",
      body: {
        lines: [
          { description: "Container split A", packagesCount: 10, packingPerPackage: 10, grossWeightGrams: 1000, netWeightGrams: 800 },
        ],
      },
    });
    expect(draft.status).toBe(200);
    expect((draft.json as { data: { reconciliation: { matched: boolean } } }).data.reconciliation.matched).toBe(false);

    const missingHs = await harness.request({
      method: "PUT",
      path: "/api/v1/invoices/invoice-trade/lines",
      body: { lines: [{ description: "No code", quantity: 100, unitPriceMinor: 1 }] },
    });
    expect(missingHs.status).toBe(200);
    const blockedHs = await harness.request({ method: "POST", path: "/api/v1/invoices/invoice-trade/issue-trade", body: {} });
    expect(blockedHs.status).toBe(409);
    expect(codeOf(blockedHs.json)).toBe("HS_CODE_REQUIRED");

    await harness.request({
      method: "PUT",
      path: "/api/v1/invoices/invoice-trade/lines",
      body: {
        lines: [
          { description: "Invoice style A", hsCode: "6301.40", quantity: 200, unitPriceMinor: 100 },
          { description: "Invoice style B", hsCode: "6301.40", quantity: 230, unitPriceMinor: 120 },
        ],
      },
    });
    const blockedContainer = await harness.request({ method: "POST", path: "/api/v1/invoices/invoice-trade/issue-trade", body: {} });
    expect(blockedContainer.status).toBe(409);
    expect(codeOf(blockedContainer.json)).toBe("PACKING_CONTAINER_REQUIRED");

    await harness.request({
      method: "PUT",
      path: "/api/v1/invoices/invoice-trade/packing-lines",
      body: {
        lines: [
          { description: "Bay 1 blankets", containerId: "container-a", packagesCount: 10, packingPerPackage: 20, grossWeightGrams: 4000, netWeightGrams: 3000 },
          { description: "Bay 1 printed", containerId: "container-a", packagesCount: 5, packingPerPackage: 26, grossWeightGrams: 2000, netWeightGrams: 1500 },
          { description: "Bay 2 balance", containerId: "container-b", packagesCount: 10, packingPerPackage: 10, grossWeightGrams: 3000, netWeightGrams: 2500 },
        ],
      },
    });
    const stillDifferent = await harness.request({ method: "POST", path: "/api/v1/invoices/invoice-trade/issue-trade", body: {} });
    expect(stillDifferent.status).toBe(409);
    expect(codeOf(stillDifferent.json)).toBe("TRADE_TOTALS_DIFFER");

    const synced = await harness.request({ method: "POST", path: "/api/v1/invoices/invoice-trade/sync-totals", body: {} });
    expect(synced.status).toBe(200);
    expect((synced.json as { data: { matched: boolean } }).data.matched).toBe(true);

    const issued = await harness.request({ method: "POST", path: "/api/v1/invoices/invoice-trade/issue-trade", body: {} });
    expect(issued.status).toBe(200);
    expect((issued.json as { data: { tradeStatus: string } }).data.tradeStatus).toBe("ISSUED");
    const row = audit.sqlite.prepare("SELECT trade_status, packages_count, gross_weight_grams, net_weight_grams FROM export_invoices WHERE id = 'invoice-trade'").get() as {
      trade_status: string;
      packages_count: number;
      gross_weight_grams: number;
      net_weight_grams: number;
    };
    expect(row.trade_status).toBe("ISSUED");
    expect(row.packages_count).toBe(25);
    expect(row.gross_weight_grams).toBe(9000);
    expect(row.net_weight_grams).toBe(7000);
  });

  it("converts a proforma into the operation invoice without a second invoice row", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const created = await harness.request({
      method: "POST",
      path: "/api/v1/proformas",
      body: {
        customerId: "customer-1",
        caseId: "case-1",
        invoiceNumber: "PF-116",
        printReference: "EX-116",
        invoiceDate: "2026-11-09",
        originOfGoods: "EGYPT",
        paymentTermCode: "TT",
        paymentTermLabel: "100% ADVANCE",
        incoterm: "CFR",
        shippingMethodLabel: "C&F",
        seaFreightMinor: 5000,
        lines: [
          { description: "Polyester blanket 180*230", unit: "PCS", quantity: 100, unitPriceMinor: 250 },
        ],
      },
    });
    expect(created.status).toBe(201);
    const proformaId = (created.json as { data: { id: string } }).data.id;
    const converted = await harness.request({ method: "POST", path: `/api/v1/proformas/${proformaId}/convert`, body: {} });
    expect(converted.status).toBe(200);
    const invoiceId = (converted.json as { data: { invoiceId: string; lines: Array<{ quantity: number }> } }).data.invoiceId;
    expect((converted.json as { data: { lines: unknown[] } }).data.lines).toHaveLength(1);
    expect(audit.sqlite.prepare("SELECT COUNT(*) AS n FROM export_invoices WHERE case_id = 'case-1'").get()).toEqual({ n: 1 });
    expect((audit.sqlite.prepare("SELECT converted_invoice_id, print_reference FROM proforma_invoices WHERE id = ?").get(proformaId) as { converted_invoice_id: string; print_reference: string }).converted_invoice_id).toBe(invoiceId);
    expect((audit.sqlite.prepare("SELECT shipping_method_label, goods_value_minor, invoiced_freight_minor FROM export_invoices WHERE id = ?").get(invoiceId) as { shipping_method_label: string; goods_value_minor: number; invoiced_freight_minor: number })).toEqual({
      shipping_method_label: "C&F",
      goods_value_minor: 25000,
      invoiced_freight_minor: 5000,
    });
  });

  it("does not place a full exporter IBAN on the public tracking payload", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const now = "2026-11-09T00:00:00.000Z";
    const token = "trade-public-token";
    audit.sqlite
      .prepare(
        `INSERT INTO exporter_bank_accounts (id, account_name, iban, bank_name, currency, is_default, created_at, updated_at)
         VALUES ('bank-secret', 'NANA SECRET', 'EG999SECRETIBAN', 'Test Bank', 'USD', 1, ?, ?)`,
      )
      .run(now, now);
    audit.sqlite
      .prepare(
        `INSERT INTO customer_tracking_links (id, case_id, token_hash, created_by, display_scope_json, created_at)
         VALUES ('link-trade', 'case-1', ?, 'user-admin', '{}', ?)`,
      )
      .run(await hashToken(token), now);
    const response = await harness.request({ path: `/api/v1/public/track/${token}` });
    expect(response.status).toBe(200);
    expect(response.text).not.toContain("EG999SECRETIBAN");
  });

  it("seeds the company profile and keeps a customer code with a custom payment label", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    audit.sqlite.prepare("UPDATE customers SET customer_code = 'EX-116' WHERE id = 'customer-1'").run();
    seedCaseInvoice(audit);
    const identity = await harness.request({ path: "/api/v1/settings/exporter-identity" });
    expect(identity.status).toBe(200);
    expect(identity.json?.data).toMatchObject({ name_en: "NANA SECRET COMPANY", tax_card: "535-629-524" });
    const banks = await harness.request({ path: "/api/v1/settings/exporter-bank-accounts" });
    expect(banks.json?.data?.[0]).toMatchObject({ iban: "EG310002017401740120000000966", swift_code: "BMISEGCXXXX" });
    const presets = await harness.request({ path: "/api/v1/product-presets" });
    expect(presets.json?.data).toHaveLength(7);
    const created = await harness.request({
      method: "POST",
      path: "/api/v1/proformas",
      body: {
        customerId: "customer-1",
        invoiceNumber: "PI-REF",
        invoiceDate: "2026-11-09",
        paymentTermCode: "TT",
        paymentTermLabel: "30% ADVANCE, 70% AGAINST DOCUMENTS",
        incoterm: "FOB",
        lines: [{ description: "بطانية", unit: "Piece", quantity: 1, unitPriceMinor: 100 }],
      },
    });
    expect(created.status).toBe(201);
    expect(created.json?.data).toMatchObject({ print_reference: "EX-116", payment_term_label: "30% ADVANCE, 70% AGAINST DOCUMENTS" });
    const header = await harness.request({
      method: "PUT",
      path: "/api/v1/invoices/invoice-trade/trade-header",
      body: { paymentTermLabel: "30% ADVANCE, 70% AGAINST DOCUMENTS", printReference: "EX-01", shippingMethodLabel: "CFR", originOfGoods: "EGYPT", seaFreightMinor: 0 },
    });
    expect(header.status).toBe(200);
    const sheet = await harness.request({ path: "/api/v1/invoices/invoice-trade/trade-sheet" });
    expect(sheet.json?.data?.header).toMatchObject({ print_reference: "EX-01", payment_term_label: "30% ADVANCE, 70% AGAINST DOCUMENTS" });
  });

  it("edits shipping methods, deletes a catalog item, and clears a draft invoice line", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    seedCaseInvoice(audit);
    const methods = await harness.request({ path: "/api/v1/shipping-methods" });
    expect(methods.status).toBe(200);
    expect((methods.json?.data as Array<{ code: string }>).map((row) => row.code)).toEqual(expect.arrayContaining(["FOB", "CFR", "C&F", "CIF", "EXW"]));
    const created = await harness.request({
      method: "POST",
      path: "/api/v1/shipping-methods",
      body: { code: "AIR", label: "AIR", includesFreight: false },
    });
    expect(created.status).toBe(201);
    const methodId = (created.json?.data as { id: string }).id;
    expect((await harness.request({
      method: "PATCH",
      path: `/api/v1/shipping-methods/${methodId}`,
      body: { code: "AIR", label: "AIR FREIGHT", includesFreight: true },
    })).status).toBe(200);
    expect((await harness.request({ method: "DELETE", path: `/api/v1/shipping-methods/${methodId}` })).status).toBe(200);
    const preset = await harness.request({
      method: "POST",
      path: "/api/v1/product-presets",
      body: { name: "Temp blanket", descriptionTemplate: "Temp", unit: "Piece" },
    });
    expect(preset.status).toBe(201);
    const presetId = (preset.json?.data as { id: string }).id;
    expect((await harness.request({ method: "PATCH", path: `/api/v1/product-presets/${presetId}`, body: { name: "Temp blanket edited", unit: "Piece" } })).status).toBe(200);
    expect((await harness.request({ method: "DELETE", path: `/api/v1/product-presets/${presetId}` })).status).toBe(200);
    expect((await harness.request({
      method: "PUT",
      path: "/api/v1/invoices/invoice-trade/lines",
      body: { lines: [{ description: "Keep", quantity: 2, unitPriceMinor: 100, unit: "PCS", hsCode: "1" }, { description: "Drop", quantity: 1, unitPriceMinor: 50, unit: "PCS", hsCode: "1" }] },
    })).status).toBe(200);
    expect((await harness.request({
      method: "PUT",
      path: "/api/v1/invoices/invoice-trade/lines",
      body: { lines: [{ description: "", quantity: 1, unitPriceMinor: 0 }] },
    })).status).toBe(200);
    const sheet = await harness.request({ path: "/api/v1/invoices/invoice-trade/trade-sheet" });
    expect(sheet.json?.data?.lines).toEqual([]);
    expect(sheet.json?.data?.header?.goods_value_minor).toBe(0);
    const proforma = await harness.request({
      method: "POST",
      path: "/api/v1/proformas",
      body: {
        customerId: "customer-1",
        invoiceNumber: "PI-DEL",
        invoiceDate: "2026-11-09",
        paymentTermCode: "TT",
        shippingMethodLabel: "FOB",
        lines: [{ description: "Draft line", quantity: 1, unitPriceMinor: 10, unit: "PCS" }],
      },
    });
    expect(proforma.status).toBe(201);
    const proformaId = (proforma.json?.data as { id: string }).id;
    expect((await harness.request({ method: "DELETE", path: `/api/v1/proformas/${proformaId}` })).status).toBe(200);
    const pdf = await harness.request({ path: "/api/v1/invoices/invoice-trade/commercial-pdf" });
    expect(pdf.status).toBe(200);
    expect(pdf.text).not.toContain("APPROVED");
    expect(pdf.text).not.toContain("/ImStamp");
  });

  it("prints the customer profile and only the visible custom fields", async () => {
    const audit = fresh();
    seedCaseInvoice(audit);
    const now = "2026-11-09T00:00:00.000Z";
    audit.sqlite.prepare("UPDATE customers SET tax_id = 'TAX-7788' WHERE id = 'customer-1'").run();
    audit.sqlite.prepare(
      `INSERT INTO customer_addresses (id, customer_id, kind, line1, city, country_code, is_primary)
       VALUES ('addr-print', 'customer-1', 'BILLING', 'Scheelegatan 9', 'Malmo', 'SE', 1)`,
    ).run();
    audit.sqlite.prepare(
      `INSERT INTO customer_bank_accounts (id, customer_id, bank_name, account_name, account_number, account_number_last4, iban, iban_last4, swift, created_at)
       VALUES ('bank-print', 'customer-1', 'CLIENTBANKX', 'Buyer Account', '123456789012', '9012', 'EG998877660000000000000001', '0001', 'CLIENTSW', ?)`,
    ).run(now);
    const harness = createTestHarness(audit);
    const profile = await harness.request({ path: "/api/v1/customer-print-profiles/customer-1" });
    expect(profile.status).toBe(200);
    expect(profile.json?.data?.address).toContain("Scheelegatan 9");
    expect(profile.json?.data?.taxId).toBe("TAX-7788");
    expect(profile.json?.data?.ibanLast4).toBe("EG998877660000000000000001");
    expect(profile.json?.data?.accountLast4).toBe("123456789012");
    const fields = [
      { id: "name", side: "buyer", source: "profile", key: "name", label: "BILL TO", visible: true },
      { id: "address", side: "buyer", source: "profile", key: "address", label: "ADDRESS", visible: true },
      { id: "taxId", side: "buyer", source: "profile", key: "taxId", label: "Registration number", visible: false },
      { id: "bankName", side: "buyer", source: "profile", key: "bankName", label: "BANK", visible: true },
      { id: "ibanLast4", side: "buyer", source: "profile", key: "ibanLast4", label: "IBAN", visible: true },
      { id: "accountLast4", side: "buyer", source: "profile", key: "accountLast4", label: "ACCOUNT NO", visible: true },
      { id: "date", side: "meta", source: "profile", key: "date", label: "DATE", visible: true },
      { id: "invoiceNumber", side: "meta", source: "profile", key: "invoiceNumber", label: "INVOICE NO#", visible: true },
      { id: "lc", side: "meta", source: "custom", key: "lc", label: "LC NO", value: "LC-9", visible: true },
    ];
    const saved = await harness.request({
      method: "PUT",
      path: "/api/v1/invoices/invoice-trade/trade-header",
      body: { shippingMethodLabel: "CFR", printFields: fields },
    });
    expect(saved.status).toBe(200);
    expect(String(saved.json?.data?.header?.print_fields_json)).toContain("LC-9");
    const pdf = await harness.request({ path: "/api/v1/invoices/invoice-trade/commercial-pdf" });
    expect(pdf.status).toBe(200);
    expect(pdf.text).toContain("Scheelegatan");
    expect(pdf.text).toContain("Malmo");
    expect(pdf.text).toContain("CLIENTBANKX");
    expect(pdf.text).toContain("EG998877660000000000000001");
    expect(pdf.text).toContain("123456789012");
    expect(pdf.text).toContain("LC-9");
    expect(pdf.text).not.toContain("TAX-7788");
  });

  it("calculates net and gross weights from blanket + bag + poster + accessories × pieces and supports manual bascule override", async () => {
    // 1. Pure formula check: 25 bales × 10 pcs/bale = 250 pcs
    // Unit net: 2400g, bag: 150g, poster: 50g, extra hanger: 30g => Unit gross = 2630g
    // Total net = 250 * 2400 = 600,000g (600.000 kg)
    // Total gross = 250 * 2630 = 657,500g (657.500 kg)
    const calc = calculatePackingLineWeights({
      packagesCount: 25,
      packingPerPackage: 10,
      unitNetWeightGrams: 2400,
      bagWeightGrams: 150,
      posterWeightGrams: 50,
      extraAccessories: [{ name: "Hanger", weightGrams: 30 }],
    });
    expect(calc.piecesCount).toBe(250);
    expect(calc.unitGrossWeightGrams).toBe(2630);
    expect(calc.netWeightGrams).toBe(600_000);
    expect(calc.grossWeightGrams).toBe(657_500);

    // 2. Manual weighbridge (bascule) override check
    const overridden = calculatePackingLineWeights({
      packagesCount: 25,
      packingPerPackage: 10,
      unitNetWeightGrams: 2400,
      bagWeightGrams: 150,
      posterWeightGrams: 50,
      manualWeightOverride: true,
      netWeightGrams: 601_200,
      grossWeightGrams: 659_000,
    });
    expect(overridden.manualWeightOverride).toBe(true);
    expect(overridden.netWeightGrams).toBe(601_200);
    expect(overridden.grossWeightGrams).toBe(659_000);

    // 3. End-to-end API & catalog preset persistence check
    const audit = fresh();
    seedCaseInvoice(audit);
    const harness = createTestHarness(audit);

    const savedPreset = await harness.request({
      method: "POST",
      path: "/api/v1/product-presets",
      body: {
        name: "Blanket 2.4KG Royal",
        descriptionTemplate: "Royal Blanket 2.4KG",
        hsCode: "6301400010",
        unit: "PCS",
        defaultPriceMinor: 1200,
        defaultPackingPerPackage: 10,
        unitNetWeightGrams: 2400,
        bagWeightGrams: 150,
        posterWeightGrams: 50,
        otherAccessoryWeightGrams: 30,
        extraAccessories: [{ name: "Ribbon", weightGrams: 30 }],
      },
    });
    expect(savedPreset.status).toBe(201);
    expect(savedPreset.json?.data).toMatchObject({
      unit_net_weight_grams: 2400,
      bag_weight_grams: 150,
      poster_weight_grams: 50,
      other_accessory_weight_grams: 30,
      default_packing_per_package: 10,
    });

    const packedRes = await harness.request({
      method: "PUT",
      path: "/api/v1/invoices/invoice-trade/packing-lines",
      body: {
        lines: [
          {
            description: "Royal Blanket 2.4KG",
            hsCode: "6301400010",
            containerId: "container-a",
            lineType: "PRODUCT",
            packagesCount: 25,
            packingPerPackage: 10,
            unitNetWeightGrams: 2400,
            bagWeightGrams: 150,
            posterWeightGrams: 50,
            extraAccessories: [{ name: "Ribbon", weightGrams: 30 }],
            manualWeightOverride: false,
          },
          {
            description: "Heavy Blanket 4KG (Bascule override)",
            hsCode: "6301400010",
            containerId: "container-b",
            lineType: "PRODUCT",
            packagesCount: 10,
            packingPerPackage: 8,
            unitNetWeightGrams: 4000,
            bagWeightGrams: 200,
            posterWeightGrams: 100,
            manualWeightOverride: true,
            netWeightGrams: 320_500,
            grossWeightGrams: 345_000,
          },
        ],
      },
    });
    expect(packedRes.status).toBe(200);
    const sheet = await harness.request({ path: "/api/v1/invoices/invoice-trade/trade-sheet" });
    expect(sheet.status).toBe(200);
    const savedPacking = sheet.json?.data?.packing as Array<Record<string, unknown>>;
    expect(savedPacking).toHaveLength(2);
    expect(savedPacking[0]).toMatchObject({
      pieces_count: 250,
      unit_net_weight_grams: 2400,
      bag_weight_grams: 150,
      poster_weight_grams: 50,
      other_accessory_weight_grams: 30,
      net_weight_grams: 600_000,
      gross_weight_grams: 657_500,
      manual_weight_override: 0,
    });
    expect(savedPacking[1]).toMatchObject({
      pieces_count: 80,
      net_weight_grams: 320_500,
      gross_weight_grams: 345_000,
      manual_weight_override: 1,
    });
  });

  it("groups packing lines by operation containers and supports standalone accessory lines without breaking blanket piece reconciliation", async () => {
    const audit = fresh();
    seedCaseInvoice(audit);
    const harness = createTestHarness(audit);

    // Commercial invoice has 400 blankets total (250 in container A + 150 in container B)
    const invLines = await harness.request({
      method: "PUT",
      path: "/api/v1/invoices/invoice-trade/lines",
      body: {
        lines: [
          { description: "Blanket 2.4KG", hsCode: "6301.40", unit: "PCS", quantity: 250, unitPriceMinor: 1000 },
          { description: "Blanket 3.0KG", hsCode: "6301.40", unit: "PCS", quantity: 150, unitPriceMinor: 1200 },
        ],
      },
    });
    expect(invLines.status).toBe(200);

    // Packing list has:
    // - Container A: 25 bales × 10 pcs = 250 blankets + 2 cartons of 100 spare PVC bags (ACCESSORY)
    // - Container B: 15 bales × 10 pcs = 150 blankets + 1 carton of 200 spare posters (ACCESSORY)
    const packLines = await harness.request({
      method: "PUT",
      path: "/api/v1/invoices/invoice-trade/packing-lines",
      body: {
        lines: [
          {
            description: "Blanket 2.4KG",
            hsCode: "6301.40",
            containerId: "container-a",
            lineType: "PRODUCT",
            packagesCount: 25,
            packingPerPackage: 10,
            unitNetWeightGrams: 2400,
            bagWeightGrams: 100,
            posterWeightGrams: 50,
          },
          {
            description: "Spare PVC Zipper Bags (Cartons)",
            hsCode: "3923.29",
            containerId: "container-a",
            lineType: "ACCESSORY",
            packagesCount: 2,
            packingPerPackage: 100,
            grossWeightGrams: 22_000,
            netWeightGrams: 20_000,
          },
          {
            description: "Blanket 3.0KG",
            hsCode: "6301.40",
            containerId: "container-b",
            lineType: "PRODUCT",
            packagesCount: 15,
            packingPerPackage: 10,
            unitNetWeightGrams: 3000,
            bagWeightGrams: 120,
            posterWeightGrams: 60,
          },
          {
            description: "Spare Printed Posters (Carton)",
            hsCode: "4911.10",
            containerId: "container-b",
            lineType: "ACCESSORY",
            packagesCount: 1,
            packingPerPackage: 200,
            grossWeightGrams: 11_000,
            netWeightGrams: 10_000,
          },
        ],
      },
    });
    expect(packLines.status).toBe(200);

    // Sync package & weight summary from packing list to commercial invoice header
    const synced = await harness.request({
      method: "POST",
      path: "/api/v1/invoices/invoice-trade/sync-totals",
      body: {},
    });
    expect(synced.status).toBe(200);
    // Reconciled pieces should be 250 + 150 = 400 (matching the commercial invoice!),
    // while total packages = 25 + 2 + 15 + 1 = 43
    expect(synced.json?.data).toMatchObject({
      matched: true,
      invoice: {
        pieces: 400,
        packages: 43,
        netGrams: 600_000 + 20_000 + 450_000 + 10_000,
        grossGrams: 637_500 + 22_000 + 477_000 + 11_000,
      },
      packing: {
        pieces: 400,
        packages: 43,
        netGrams: 1_080_000,
        grossGrams: 1_147_500,
      },
    });

    // Verify container-centric grouping on trade-sheet response
    const sheet = await harness.request({ path: "/api/v1/invoices/invoice-trade/trade-sheet" });
    expect(sheet.status).toBe(200);
    const groups = sheet.json?.data?.containerGroups as ReturnType<typeof groupPackingByContainer>;
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      containerId: "container-a",
      officialNumber: "TCLU0000001",
      totals: {
        packagesCount: 27,
        piecesCount: 450,
        reconciledPiecesCount: 250,
        productPiecesCount: 250,
        accessoryPiecesCount: 200,
        netWeightGrams: 620_000,
        grossWeightGrams: 659_500,
      },
    });
    expect(groups[1]).toMatchObject({
      containerId: "container-b",
      officialNumber: "TCLU0000002",
      totals: {
        packagesCount: 16,
        piecesCount: 350,
        reconciledPiecesCount: 150,
        productPiecesCount: 150,
        accessoryPiecesCount: 200,
        netWeightGrams: 460_000,
        grossWeightGrams: 488_000,
      },
    });

    // Issue the trade documents and verify it succeeds
    const issued = await harness.request({
      method: "POST",
      path: "/api/v1/invoices/invoice-trade/issue-trade",
      body: {},
    });
    expect(issued.status).toBe(200);
    expect(issued.json?.data?.tradeStatus).toBe("ISSUED");
  });

  it("enforces the 59 granular RBAC permissions and per-user GRANT/DENY overrides across trade and catalog routes", async () => {
    expect(PERMISSIONS).toHaveLength(59);
    expect(PERMISSION_GROUPS).toHaveLength(12);
    expect(Object.keys(PERMISSION_CATALOG)).toHaveLength(59);
    expect(DEFAULT_ROLE_PERMISSIONS.administrator).toHaveLength(59);
    expect(DEFAULT_ROLE_PERMISSIONS.operations_manager).toHaveLength(49);
    expect(DEFAULT_ROLE_PERMISSIONS.export_officer).toHaveLength(34);
    expect(DEFAULT_ROLE_PERMISSIONS.viewer).toHaveLength(12);

    const audit = fresh();
    seedCaseInvoice(audit);
    const harness = createTestHarness(audit);

    // 1. Verify GET /api/v1/users returns enriched rolePermissions, overrides, and effectivePermissionsCount
    const usersRes = await harness.request({ path: "/api/v1/users" });
    expect(usersRes.status).toBe(200);
    const usersList = usersRes.json?.data as Array<{
      id: string;
      roleKeys: string[];
      rolePermissions: string[];
      overrides: Array<{ permissionKey: string; effect: string }>;
      effectivePermissions: string[];
      effectivePermissionsCount: number;
    }>;
    const officerRow = usersList.find((u) => u.id === "user-officer");
    expect(officerRow).toBeDefined();
    expect(officerRow?.roleKeys).toEqual(["export_officer"]);
    expect(officerRow?.effectivePermissionsCount).toBe(34);

    // 2. Officer cannot add shipping methods or delete draft proformas by default
    const deniedShipAdd = await harness.request({
      actor: "user-officer",
      method: "POST",
      path: "/api/v1/shipping-methods",
      body: { code: "AIR", label: "AIR", includesFreight: false },
    });
    expect(deniedShipAdd.status).toBe(403);

    const createdPi = await harness.request({
      actor: "user-officer",
      method: "POST",
      path: "/api/v1/proformas",
      body: {
        caseId: "case-1",
        customerId: "customer-1",
        invoiceNumber: "PI-RBAC-001",
        invoiceDate: "2026-11-10",
        paymentTermCode: "TT",
        incoterm: "FOB",
        lines: [{ description: "Blanket", unit: "Piece", quantity: 1, unitPriceMinor: 100 }],
      },
    });
    expect(createdPi.status).toBe(201);
    const piId = createdPi.json?.data?.id as string;

    const deniedPiDelete = await harness.request({
      actor: "user-officer",
      method: "DELETE",
      path: `/api/v1/proformas/${piId}`,
    });
    expect(deniedPiDelete.status).toBe(403);

    // 3. Apply per-user overrides via PUT /api/v1/users/:id/overrides:
    //    +GRANT proformas.delete & catalog.shipping.manage
    //    -DENY packing.weights_override & invoices.issue
    const overrideRes = await harness.request({
      actor: "user-admin",
      method: "PUT",
      path: "/api/v1/users/user-officer/overrides",
      body: {
        overrides: [
          { permissionKey: "proformas.delete", effect: "GRANT" },
          { permissionKey: "catalog.shipping.manage", effect: "GRANT" },
          { permissionKey: "packing.weights_override", effect: "DENY" },
          { permissionKey: "invoices.issue", effect: "DENY" },
        ],
      },
    });
    expect(overrideRes.status).toBe(200);

    // Verify effective permissions count stayed 34 (34 + 2 grants - 2 denies = 34)
    const usersAfter = await harness.request({ path: "/api/v1/users" });
    const officerAfter = (usersAfter.json?.data as typeof usersList).find((u) => u.id === "user-officer");
    expect(officerAfter?.overrides).toHaveLength(4);
    expect(officerAfter?.effectivePermissionsCount).toBe(34);
    expect(officerAfter?.effectivePermissions).toContain("proformas.delete");
    expect(officerAfter?.effectivePermissions).toContain("catalog.shipping.manage");
    expect(officerAfter?.effectivePermissions).not.toContain("packing.weights_override");
    expect(officerAfter?.effectivePermissions).not.toContain("invoices.issue");

    // 4. Now officer CAN add a shipping method and delete the draft proforma
    const allowedShipAdd = await harness.request({
      actor: "user-officer",
      method: "POST",
      path: "/api/v1/shipping-methods",
      body: { code: "AIR", label: "AIR", includesFreight: false },
    });
    expect(allowedShipAdd.status).toBe(201);

    const allowedPiDelete = await harness.request({
      actor: "user-officer",
      method: "DELETE",
      path: `/api/v1/proformas/${piId}`,
    });
    expect(allowedPiDelete.status).toBe(200);

    // 5. And officer is BLOCKED from manual weight override (manualWeightOverride = true) and /issue-trade
    const blockedManualWeight = await harness.request({
      actor: "user-officer",
      method: "PUT",
      path: "/api/v1/invoices/invoice-trade/packing-lines",
      body: {
        lines: [
          {
            description: "Cloud Blanket",
            containerId: "container-a",
            lineType: "PRODUCT",
            packagesCount: 10,
            packingPerPackage: 10,
            unitNetWeightGrams: 2000,
            bagWeightGrams: 100,
            posterWeightGrams: 50,
            manualWeightOverride: true,
            netWeightGrams: 205_000,
            grossWeightGrams: 215_000,
          },
        ],
      },
    });
    expect(blockedManualWeight.status).toBe(403);

    const blockedIssue = await harness.request({
      actor: "user-officer",
      method: "POST",
      path: "/api/v1/invoices/invoice-trade/issue-trade",
      body: {},
    });
    expect(blockedIssue.status).toBe(403);

    // 6. Verify PATCH /api/v1/users/:id/status works
    const statusPatch = await harness.request({
      actor: "user-admin",
      method: "PATCH",
      path: "/api/v1/users/user-viewer/status",
      body: { isActive: false },
    });
    expect(statusPatch.status).toBe(200);
  });

  it("caches hot catalog and actor reads in edgeCache and purges immediately on write", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);

    // 1. First read populates catalog:shipping_methods and actor:user-admin in edgeCache
    const shipRead1 = await harness.request({ path: "/api/v1/shipping-methods" });
    expect(shipRead1.status).toBe(200);
    expect(edgeCache.get(audit.db, "catalog:shipping_methods")).toBeDefined();
    expect(edgeCache.get(audit.db, "actor:user-admin")).toBeDefined();

    // 2. Creating a new shipping method purges catalog:shipping_methods immediately
    const shipCreate = await harness.request({
      method: "POST",
      path: "/api/v1/shipping-methods",
      body: { code: "FAS", label: "FAS", includesFreight: false },
    });
    expect(shipCreate.status).toBe(201);
    expect(edgeCache.get(audit.db, "catalog:shipping_methods")).toBeUndefined();

    // Next read re-populates with the new FAS method included
    const shipRead2 = await harness.request({ path: "/api/v1/shipping-methods" });
    expect((shipRead2.json?.data as Array<{ code: string }>).some((m) => m.code === "FAS")).toBe(true);
    expect(edgeCache.get(audit.db, "catalog:shipping_methods")).toBeDefined();

    // 3. Product presets cache & instant purge on write
    const presets1 = await harness.request({ path: "/api/v1/product-presets" });
    expect(presets1.status).toBe(200);
    expect(edgeCache.get(audit.db, "catalog:product_presets")).toBeDefined();

    const presetAdd = await harness.request({
      method: "POST",
      path: "/api/v1/product-presets",
      body: {
        name: "Cached Blanket",
        descriptionTemplate: "100% Mink Blanket",
        unitLabel: "PCS",
        defaultPriceMinor: 1500,
      },
    });
    expect(presetAdd.status).toBe(201);
    expect(edgeCache.get(audit.db, "catalog:product_presets")).toBeUndefined();
  });

  it("coalesces repeated offline edits, replays FIFO in order, and isolates 409/422 conflicts", async () => {
    clearOfflineOutbox();
    setCustomReplayExecutor(null);

    expect(isQueueableOfflineMutation("PUT", "/api/v1/invoices/inv-1/lines")).toBe(true);
    expect(isQueueableOfflineMutation("PUT", "/api/v1/invoices/inv-1/packing-lines")).toBe(true);
    expect(isQueueableOfflineMutation("POST", "/api/v1/invoices/inv-1/issue-trade")).toBe(false);
    expect(isQueueableOfflineMutation("DELETE", "/api/v1/proformas/pi-1")).toBe(false);

    // 1. Enqueue header update, then two consecutive line updates (should coalesce into 1 line update!)
    const itemHeader = enqueueOfflineMutation({
      method: "PUT",
      path: "/api/v1/invoices/inv-1/trade-header",
      body: JSON.stringify({ paymentTermLabel: "100% ADVANCE" }),
      idempotencyKey: "idem-header-1",
    });
    enqueueOfflineMutation({
      method: "PUT",
      path: "/api/v1/invoices/inv-1/lines",
      body: JSON.stringify({ lines: [{ description: "Draft v1", quantity: 10 }] }),
      idempotencyKey: "idem-lines-v1",
    });
    const itemLinesV2 = enqueueOfflineMutation({
      method: "PUT",
      path: "/api/v1/invoices/inv-1/lines",
      body: JSON.stringify({ lines: [{ description: "Draft v2", quantity: 25 }] }),
      idempotencyKey: "idem-lines-v2",
    });
    const itemPacking = enqueueOfflineMutation({
      method: "PUT",
      path: "/api/v1/invoices/inv-1/packing-lines",
      body: JSON.stringify({ lines: [{ description: "Pack v1", packagesCount: 5 }] }),
      idempotencyKey: "idem-pack-1",
    });

    const snapBefore = getOfflineSyncSnapshot();
    // 3 items in queue (header, coalesced lines, packing), not 4
    expect(snapBefore.queuedCount).toBe(3);
    expect(snapBefore.items.map((i) => i.id)).toEqual([itemHeader.id, itemLinesV2.id, itemPacking.id]);
    expect(snapBefore.items[1]?.body).toContain("Draft v2");

    // 2. Replay FIFO: simulate 409 conflict on the middle item and verify the 3rd item still executes!
    const replayedOrder: string[] = [];
    setCustomReplayExecutor(async (item: OutboxItem) => {
      replayedOrder.push(`${item.method} ${item.path} (${item.idempotencyKey})`);
      if (item.path.endsWith("/lines")) {
        return { ok: false, status: 409, errorMessage: "Version conflict on invoice lines" };
      }
      return { ok: true, status: 200 };
    });

    const result = await flushOfflineOutbox();
    expect(replayedOrder).toEqual([
      "PUT /api/v1/invoices/inv-1/trade-header (idem-header-1)",
      "PUT /api/v1/invoices/inv-1/lines (idem-lines-v2)",
      "PUT /api/v1/invoices/inv-1/packing-lines (idem-pack-1)",
    ]);
    expect(result.syncedCount).toBe(2);
    expect(result.conflictCount).toBe(1);
    expect(result.remainingQueued).toBe(0);

    const snapAfter = getOfflineSyncSnapshot();
    expect(snapAfter.items).toHaveLength(1);
    expect(snapAfter.items[0]?.status).toBe("conflict");
    expect(snapAfter.items[0]?.conflictStatus).toBe(409);

    clearOfflineOutbox();
    setCustomReplayExecutor(null);
  });

  it("saves, loads, and clears local auto-drafts in browser/memory storage", () => {
    const scope = "trade:inv-test-99";
    clearLocalDraft(scope);
    expect(loadLocalDraft(scope)).toBeNull();

    saveLocalDraft(scope, "DRAFT", {
      paymentLabel: "50% ADVANCE",
      lines: [{ description: "Local Blanket", quantity: "40" }],
    });

    const loaded = loadLocalDraft<{ paymentLabel: string; lines: Array<{ description: string; quantity: string }> }>(
      scope,
    );
    expect(loaded).not.toBeNull();
    expect(loaded?.payload.paymentLabel).toBe("50% ADVANCE");
    expect(loaded?.payload.lines[0]?.description).toBe("Local Blanket");

    clearLocalDraft(scope);
    expect(loadLocalDraft(scope)).toBeNull();
  });
});
