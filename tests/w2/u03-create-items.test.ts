import { afterEach, describe, expect, it } from "vitest";
import { createTestHarness } from "../transition-2026-10-21/harness/app";
import { createW2Database, count, type W2Database } from "./harness/db";

/**
 * U03 — D-02 create + item maintenance: a quotation is created without an
 * export case, stays DRAFT, and its items add/update/delete under optimistic
 * versioning with a subtotal that is exactly the sum of the line cents.
 */
let audit: W2Database | null = null;

afterEach(() => {
  audit?.close();
  audit = null;
});

const itemA = { description: "Fixture item A", quantity: "2.5", unitPrice: "12.75" };
const itemB = { description: "Fixture item B", quantity: "1", unitPrice: "40" };

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    quoteNumber: "QU-U03-001",
    customerId: "customer-1",
    title: "Fixture quotation",
    incoterm: "FOB",
    paymentTerms: "50% advance, 50% against documents",
    notes: "Fixture notes",
    items: [itemA, itemB],
    ...overrides,
  };
}

// itemA: 2.5 × 12.75 = 31.875 → 3187.5 cents → ROUND_HALF_UP → 3188
// itemB: 1 × 40 = 4000 cents
const EXPECTED_SUBTOTAL = 3188 + 4000;

describe("U03 quotation create and items", () => {
  it("creates a DRAFT quotation without an export case and sums line cents", async () => {
    audit = createW2Database();
    const harness = createTestHarness(audit);

    const created = await harness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: createBody(),
    });
    expect(created.status).toBe(201);
    const data = (created.json as { data: { id: string; quoteNumber: string; revision: number } }).data;
    expect(data.quoteNumber).toBe("QU-U03-001");
    expect(data.revision).toBe(0);

    const row = audit.sqlite.prepare("SELECT status, case_id, subtotal_minor, active_revision, version FROM quotations WHERE id = ?").get(data.id) as {
      status: string;
      case_id: string | null;
      subtotal_minor: number;
      active_revision: number;
      version: number;
    };
    expect(row.status).toBe("DRAFT");
    expect(row.case_id).toBeNull();
    expect(row.active_revision).toBe(0);
    expect(row.version).toBe(1);
    expect(Number(row.subtotal_minor)).toBe(EXPECTED_SUBTOTAL);

    const items = count(audit.sqlite, "quotation_items", "quotation_id = ? AND revision = 0", data.id);
    expect(items).toBe(2);

    // Audit: the create action wrote exactly one quotation audit row.
    expect(count(audit.sqlite, "audit_log", "entity_type = 'quotation' AND entity_id = ? AND action = 'quotation.create'", data.id)).toBe(1);
  });

  it("refuses a missing or unknown customer with 422", async () => {
    audit = createW2Database();
    const harness = createTestHarness(audit);

    const noCustomer = await harness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: createBody({ customerId: "   " }),
    });
    expect(noCustomer.status).toBe(422);

    const unknownCustomer = await harness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: createBody({ customerId: "customer-missing" }),
    });
    expect(unknownCustomer.status).toBe(422);
  });

  it("refuses unsupported item shapes with stable codes", async () => {
    audit = createW2Database();
    const harness = createTestHarness(audit);

    const blankDescription = await harness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: createBody({ items: [{ ...itemA, description: "   " }] }),
    });
    expect(blankDescription.status).toBe(422);
    expect((blankDescription.json as { error: { code: string } }).error.code).toBe("QUOTE_ITEMS_INVALID");

    const longDescription = await harness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: createBody({ items: [{ ...itemA, description: "x".repeat(501) }] }),
    });
    expect(longDescription.status).toBe(422);
    expect((longDescription.json as { error: { code: string } }).error.code).toBe("QUOTE_ITEMS_INVALID");

    const badQuantity = await harness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: createBody({ items: [{ ...itemA, quantity: "-2" }] }),
    });
    expect(badQuantity.status).toBe(422);
    expect((badQuantity.json as { error: { code: string } }).error.code).toBe("QUOTE_LINE_QUANTITY_INVALID");

    const badPrice = await harness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: createBody({ items: [{ ...itemA, unitPrice: "abc" }] }),
    });
    expect(badPrice.status).toBe(422);
    expect((badPrice.json as { error: { code: string } }).error.code).toBe("QUOTE_LINE_PRICE_INVALID");
  });

  it("adds, updates and deletes items with exact subtotal adjustments", async () => {
    audit = createW2Database();
    const harness = createTestHarness(audit);

    const created = await harness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: createBody(),
    });
    const quoteId = (created.json as { data: { id: string } }).data.id;

    const added = await harness.request({
      method: "POST",
      path: `/api/v1/quotations/${quoteId}/items`,
      actor: "user-admin",
      body: { description: "Fixture item C", quantity: "0.005", unitPrice: "5" },
    });
    // 0.005 × 5 = 0.025 USD = 2.5 cents → half-up 3 cents
    expect(added.status).toBe(201);
    const addedData = (added.json as { data: { itemId: string; position: number } }).data;
    expect(addedData.position).toBe(3);

    let row = audit.sqlite.prepare("SELECT subtotal_minor, version FROM quotations WHERE id = ?").get(quoteId) as {
      subtotal_minor: number;
      version: number;
    };
    expect(Number(row.subtotal_minor)).toBe(EXPECTED_SUBTOTAL + 3);
    expect(row.version).toBe(2);

    const itemRow = audit.sqlite.prepare("SELECT line_total_minor FROM quotation_items WHERE id = ?").get(addedData.itemId) as {
      line_total_minor: number;
    };
    expect(Number(itemRow.line_total_minor)).toBe(3);

    const updated = await harness.request({
      method: "PUT",
      path: `/api/v1/quotations/${quoteId}/items/${addedData.itemId}`,
      actor: "user-admin",
      body: { description: "Fixture item C revised", quantity: "1", unitPrice: "10" },
    });
    expect(updated.status).toBe(200);

    row = audit.sqlite.prepare("SELECT subtotal_minor, version FROM quotations WHERE id = ?").get(quoteId) as {
      subtotal_minor: number;
      version: number;
    };
    expect(Number(row.subtotal_minor)).toBe(EXPECTED_SUBTOTAL + 1000);
    expect(row.version).toBe(3);

    const deleted = await harness.request({
      method: "DELETE",
      path: `/api/v1/quotations/${quoteId}/items/${addedData.itemId}`,
      actor: "user-admin",
    });
    expect(deleted.status).toBe(200);

    row = audit.sqlite.prepare("SELECT subtotal_minor, version FROM quotations WHERE id = ?").get(quoteId) as {
      subtotal_minor: number;
      version: number;
    };
    expect(Number(row.subtotal_minor)).toBe(EXPECTED_SUBTOTAL);
    expect(row.version).toBe(4);
    expect(count(audit.sqlite, "quotation_items", "id = ?", addedData.itemId)).toBe(0);

    const unknownItem = await harness.request({
      method: "DELETE",
      path: `/api/v1/quotations/${quoteId}/items/missing-item`,
      actor: "user-admin",
    });
    expect(unknownItem.status).toBe(404);
  });
});
