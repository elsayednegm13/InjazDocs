import { afterEach, describe, expect, it } from "vitest";
import { netAboveGross, reconcileTradeTotals } from "../shared/trade-documents";
import { hashToken } from "../server/services/tracking";
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
});
