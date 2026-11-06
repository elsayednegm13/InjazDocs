import { afterEach, describe, expect, it } from "vitest";
import { createTestHarness } from "../transition-2026-10-21/harness/app";
import { createW2Database, type W2Database } from "./harness/db";
import { lineTotalMinorOf } from "../../server/services/quotations";

/**
 * U04 — D-05 money math: exact bigint cents, ROUND_HALF_UP at line level,
 * quantity scale 3, unit price scale 4, and a subtotal that is the sum of the
 * stored line cents (never recomputed through binary floats).
 */
let audit: W2Database | null = null;

afterEach(() => {
  audit?.close();
  audit = null;
});

describe("U04 money math", () => {
  it("computes line totals exactly with ROUND_HALF_UP in bigint", () => {
    // 2.345 × 3.456 = 8.10392 → 810.392 cents → 810
    expect(lineTotalMinorOf(2345n, 34560n)).toBe(810n);
    // exact half cent rounds up: 0.001 × 5 = 0.005 → 0.5 cent → 1
    expect(lineTotalMinorOf(1n, 50000n)).toBe(1n);
    // 0.005 × 5 = 0.025 → 2.5 cents → 3
    expect(lineTotalMinorOf(5n, 50000n)).toBe(3n);
    // whole amounts stay exact: 2 × 12.75 = 25.5 → 2550 cents
    expect(lineTotalMinorOf(2000n, 127500n)).toBe(2550n);
    // decimals far beyond float precision stay exact:
    // 123.456 × 12345.6789 = 1,524,148.1342784 → 152,414,813.42784 cents → 152414813
    expect(lineTotalMinorOf(123456n, 123456789n)).toBe(152414813n);
  });

  it("scales quantities by 10^3 and prices by 10^4 exactly", async () => {
    audit = createW2Database();
    const harness = createTestHarness(audit);

    const created = await harness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: {
        quoteNumber: "QU-U04-001",
        customerId: "customer-1",
        items: [{ description: "Scale fixture", quantity: "0.123", unitPrice: "4.5678" }],
      },
    });
    expect(created.status).toBe(201);
    const quoteId = (created.json as { data: { id: string } }).data.id;

    const row = audit.sqlite.prepare("SELECT quantity_minor, unit_price_minor_4, line_total_minor FROM quotation_items WHERE quotation_id = ?").get(quoteId) as {
      quantity_minor: number;
      unit_price_minor_4: number;
      line_total_minor: number;
    };
    expect(Number(row.quantity_minor)).toBe(123); // 0.123 × 1000
    expect(Number(row.unit_price_minor_4)).toBe(45678); // 4.5678 × 10000
    // 0.123 × 4.5678 = 0.5618394 → 56.18394 cents → 56
    expect(Number(row.line_total_minor)).toBe(56);
  });

  it("keeps the subtotal as the exact sum of stored line cents", async () => {
    audit = createW2Database();
    const harness = createTestHarness(audit);

    const created = await harness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: {
        quoteNumber: "QU-U04-002",
        customerId: "customer-1",
        items: [
          { description: "Line one", quantity: "0.1", unitPrice: "3" }, // 30 cents
          { description: "Line two", quantity: "0.2", unitPrice: "0.001" }, // 0.02 → 0 (round down)
        ],
      },
    });
    expect(created.status).toBe(201);
    const quoteId = (created.json as { data: { id: string } }).data.id;

    const subtotal = audit.sqlite.prepare("SELECT subtotal_minor FROM quotations WHERE id = ?").get(quoteId) as {
      subtotal_minor: number;
    };
    expect(Number(subtotal.subtotal_minor)).toBe(30);
  });
});
