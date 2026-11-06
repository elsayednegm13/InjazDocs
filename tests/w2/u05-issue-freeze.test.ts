import { afterEach, describe, expect, it } from "vitest";
import { createTestHarness } from "../transition-2026-10-21/harness/app";
import { createW2Database, count, type W2Database } from "./harness/db";

/**
 * U05 — D-02 issue + D-07 item freeze: issuing requires items, freezes the
 * lifecycle into revision 1 with a fresh UTC validity, and refuses every item
 * maintenance and quotation edit on the issued document.
 */
let audit: W2Database | null = null;

afterEach(() => {
  audit?.close();
  audit = null;
});

async function createDraft(audit: W2Database, quoteNumber: string, items: unknown[] = [], validityDays?: number) {
  const harness = createTestHarness(audit);
  const response = await harness.request({
    method: "POST",
    path: "/api/v1/quotations",
    actor: "user-admin",
    body: {
      quoteNumber,
      customerId: "customer-1",
      validityDays,
      items,
    },
  });
  if (response.status !== 201) throw new Error(`fixture create failed: ${response.status} ${response.text}`);
  return {
    harness,
    quoteId: (response.json as { data: { id: string } }).data.id,
  };
}

describe("U05 issue and freeze", () => {
  it("refuses to issue an empty draft with QUOTE_ITEMS_EMPTY", async () => {
    audit = createW2Database();
    const { harness, quoteId } = await createDraft(audit, "QU-U05-001");

    const refused = await harness.request({
      method: "POST",
      path: `/api/v1/quotations/${quoteId}/issue`,
      actor: "user-admin",
      body: {},
    });
    expect(refused.status).toBe(422);
    expect((refused.json as { error: { code: string } }).error.code).toBe("QUOTE_ITEMS_EMPTY");
  });

  it("refuses a zero-quantity or zero-price line with QUOTE_LINE_QUANTITY_ZERO / QUOTE_LINE_PRICE_ZERO", async () => {
    audit = createW2Database();

    const zeroQty = await createDraft(audit, "QU-U05-002", [{ description: "Zero qty", quantity: "0", unitPrice: "5" }]);
    const refusedQty = await zeroQty.harness.request({
      method: "POST",
      path: `/api/v1/quotations/${zeroQty.quoteId}/issue`,
      actor: "user-admin",
      body: {},
    });
    expect(refusedQty.status).toBe(422);
    expect((refusedQty.json as { error: { code: string } }).error.code).toBe("QUOTE_LINE_QUANTITY_ZERO");

    const zeroPrice = await createDraft(audit, "QU-U05-003", [{ description: "Zero price", quantity: "1", unitPrice: "0" }]);
    const refusedPrice = await zeroPrice.harness.request({
      method: "POST",
      path: `/api/v1/quotations/${zeroPrice.quoteId}/issue`,
      actor: "user-admin",
      body: {},
    });
    expect(refusedPrice.status).toBe(422);
    expect((refusedPrice.json as { error: { code: string } }).error.code).toBe("QUOTE_LINE_PRICE_ZERO");
  });

  it("issues into ISSUED revision 1 with the exact UTC end-of-validity", async () => {
    audit = createW2Database();
    const { harness, quoteId } = await createDraft(
      audit,
      "QU-U05-004",
      [{ description: "Issueable item", quantity: "1", unitPrice: "100" }],
      7,
    );

    const issued = await harness.request({
      method: "POST",
      path: `/api/v1/quotations/${quoteId}/issue`,
      actor: "user-admin",
      body: { reason: "First send to the client" },
    });
    expect(issued.status).toBe(200);
    const data = (issued.json as { data: { revision: number; validUntil: string } }).data;
    expect(data.revision).toBe(1);

    const expectedDay = new Date().toISOString().slice(0, 10);
    const expectedEnd = new Date(`${expectedDay}T00:00:00.000Z`);
    expectedEnd.setUTCDate(expectedEnd.getUTCDate() + 7);
    expect(data.validUntil).toBe(`${expectedEnd.toISOString().slice(0, 10)}T23:59:59.000Z`);

    const row = audit.sqlite.prepare("SELECT status, issued_at, valid_until, active_revision, subtotal_minor, version FROM quotations WHERE id = ?").get(quoteId) as {
      status: string;
      issued_at: string;
      valid_until: string;
      active_revision: number;
      subtotal_minor: number;
      version: number;
    };
    expect(row.status).toBe("ISSUED");
    expect(row.valid_until).toBe(data.validUntil);
    expect(Number(row.active_revision)).toBe(1);
    expect(Number(row.subtotal_minor)).toBe(10000);
    expect(row.version).toBe(2);

    const revision = audit.sqlite.prepare("SELECT revision, company_name, subtotal_minor, snapshot_json FROM quotation_revisions WHERE quotation_id = ?").get(quoteId) as {
      revision: number;
      company_name: string;
      subtotal_minor: number;
      snapshot_json: string;
    };
    expect(Number(revision.revision)).toBe(1);
    expect(revision.company_name).toBe("Export Operations");
    expect(Number(revision.subtotal_minor)).toBe(10000);

    const snapshot = JSON.parse(revision.snapshot_json) as { items: { description: string; lineTotalMinor: number }[] };
    expect(snapshot.items.length).toBe(1);
    expect(snapshot.items[0]!.lineTotalMinor).toBe(10000);

    expect(count(audit.sqlite, "audit_log", "entity_type = 'quotation' AND action = 'quotation.issue' AND entity_id = ?", quoteId)).toBe(1);
  });

  it("refuses item maintenance and quotation edits on the issued document", async () => {
    audit = createW2Database();
    const { harness, quoteId } = await createDraft(
      audit,
      "QU-U05-005",
      [
        { description: "Frozen item one", quantity: "1", unitPrice: "5" },
        { description: "Frozen item two", quantity: "2", unitPrice: "5" },
      ],
    );
    const item = audit.sqlite.prepare("SELECT id FROM quotation_items WHERE quotation_id = ? ORDER BY position LIMIT 1").get(quoteId) as { id: string };
    await harness.request({ method: "POST", path: `/api/v1/quotations/${quoteId}/issue`, actor: "user-admin", body: {} });

    const addItem = await harness.request({
      method: "POST",
      path: `/api/v1/quotations/${quoteId}/items`,
      actor: "user-admin",
      body: { description: "Refused add", quantity: "1", unitPrice: "1" },
    });
    expect(addItem.status).toBe(409);
    expect((addItem.json as { error: { code: string } }).error.code).toBe("QUOTE_NOT_EDITABLE");

    const updateItem = await harness.request({
      method: "PUT",
      path: `/api/v1/quotations/${quoteId}/items/${item.id}`,
      actor: "user-admin",
      body: { description: "Refused update", quantity: "1", unitPrice: "1" },
    });
    expect(updateItem.status).toBe(409);
    expect((updateItem.json as { error: { code: string } }).error.code).toBe("QUOTE_NOT_EDITABLE");

    const deleteItem = await harness.request({
      method: "DELETE",
      path: `/api/v1/quotations/${quoteId}/items/${item.id}`,
      actor: "user-admin",
    });
    expect(deleteItem.status).toBe(409);
    expect((deleteItem.json as { error: { code: string } }).error.code).toBe("QUOTE_NOT_EDITABLE");

    const editQuotation = await harness.request({
      method: "PUT",
      path: `/api/v1/quotations/${quoteId}`,
      actor: "user-admin",
      body: { version: 2, quoteNumber: "QU-U05-005B", quoteNumberInvalid: undefined },
    });
    expect(editQuotation.status).toBe(409);
    expect((editQuotation.json as { error: { code: string } }).error.code).toBe("QUOTE_NOT_EDITABLE");
  });

  it("refuses an out-of-range validity override with QUOTE_VALIDITY_INVALID", async () => {
    audit = createW2Database();
    const { harness, quoteId } = await createDraft(
      audit,
      "QU-U05-006",
      [{ description: "Validity item", quantity: "1", unitPrice: "1" }],
      30,
    );

    const refused = await harness.request({
      method: "POST",
      path: `/api/v1/quotations/${quoteId}/issue`,
      actor: "user-admin",
      body: { validityDays: 0 },
    });
    expect(refused.status).toBe(422);
    expect((refused.json as { error: { code: string } }).error.code).toBe("QUOTE_VALIDITY_INVALID");
  });
});
