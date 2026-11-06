import { afterEach, describe, expect, it } from "vitest";
import { createTestHarness } from "../transition-2026-10-21/harness/app";
import { createW2Database, count, type W2Database } from "./harness/db";

/**
 * U08 — D-02 revise: a revision is a new review (N+1) with ISSUED state, a new
 * valid_until, a reset client_response and an exact item copy (with
 * provenance) when no list is sent; old revisions stay immutable.
 */
let audit: W2Database | null = null;

afterEach(() => {
  audit?.close();
  audit = null;
});

async function issuedQuote(audit: W2Database, quoteNumber: string) {
  const harness = createTestHarness(audit);
  const created = await harness.request({
    method: "POST",
    path: "/api/v1/quotations",
    actor: "user-admin",
    body: {
      quoteNumber,
      customerId: "customer-1",
      items: [
        { description: "Revision item one", quantity: "1", unitPrice: "3" },
        { description: "Revision item two", quantity: "2", unitPrice: "4" },
      ],
    },
  });
  const quoteId = (created.json as { data: { id: string } }).data.id;
  await harness.request({ method: "POST", path: `/api/v1/quotations/${quoteId}/issue`, actor: "user-admin", body: {} });
  return { harness, quoteId };
}

function revisionRow(audit: W2Database, quoteId: string, revision: number) {
  return audit.sqlite
    .prepare("SELECT revision, reason, company_name, subtotal_minor, snapshot_json FROM quotation_revisions WHERE quotation_id = ? AND revision = ?")
    .get(quoteId, revision) as { revision: number; reason: string; company_name: string; subtotal_minor: number; snapshot_json: string } | undefined;
}

describe("U08 revisions", () => {
  it("creates revision 2 with reset response and copied items", async () => {
    audit = createW2Database();
    const { harness, quoteId } = await issuedQuote(audit, "QU-U08-001");

    await harness.request({
      method: "POST",
      path: `/api/v1/quotations/${quoteId}/response`,
      actor: "user-admin",
      body: { response: "ACCEPTED" },
    });

    const revised = await harness.request({
      method: "POST",
      path: `/api/v1/quotations/${quoteId}/revise`,
      actor: "user-admin",
      body: { version: 3, reason: "Client asked for a different price" },
    });
    expect(revised.status).toBe(200);
    const data = (revised.json as { data: { revision: number; validUntil: string } }).data;
    expect(data.revision).toBe(2);

    const row = audit.sqlite.prepare("SELECT status, active_revision, client_response, client_response_at, client_response_by, version FROM quotations WHERE id = ?").get(quoteId) as {
      status: string;
      active_revision: number;
      client_response: string | null;
      client_response_at: string | null;
      client_response_by: string | null;
      version: number;
    };
    expect(row.status).toBe("ISSUED");
    expect(Number(row.active_revision)).toBe(2);
    expect(row.client_response).toBeNull();
    expect(row.client_response_at).toBeNull();
    expect(row.client_response_by).toBeNull();
    expect(row.version).toBe(4);

    // Active revision items exist and carry provenance back to the same quotation.
    const items = audit.sqlite.prepare("SELECT revision, position, source_quotation_id, source_item_id, source_line_total_minor, line_total_minor FROM quotation_items WHERE quotation_id = ? AND revision = 2 ORDER BY position").all(quoteId) as {
      revision: number;
      position: number;
      source_quotation_id: string | null;
      source_item_id: string | null;
      source_line_total_minor: number | null;
      line_total_minor: number;
    }[];
    expect(items.length).toBe(2);
    for (const item of items) {
      expect(item.source_quotation_id, "same-quote provenance").toBe(quoteId);
      expect(item.source_item_id).toBeTruthy();
      expect(Number(item.source_line_total_minor)).toBe(Number(item.line_total_minor));
    }

    // The old revision rows are untouched.
    expect(count(audit.sqlite, "quotation_items", "quotation_id = ? AND revision = 1", quoteId)).toBe(2);
    expect(revisionRow(audit, quoteId, 1)).toBeTruthy();

    // The revision ledger records the reason.
    expect(String(revisionRow(audit, quoteId, 2)?.reason)).toBe("Client asked for a different price");

    // Revision list endpoint exposes both revisions.
    const revisions = await harness.request({ path: `/api/v1/quotations/${quoteId}/revisions`, actor: "user-admin" });
    expect(revisions.status).toBe(200);
    const revisionRows = (revisions.json as { data: { rows: { revision: number }[] } }).data.rows;
    expect(revisionRows.map((r) => r.revision)).toEqual([1, 2]);
  });

  it("applies an explicit item list and refuses stale versions", async () => {
    audit = createW2Database();
    const { harness, quoteId } = await issuedQuote(audit, "QU-U08-002");

    const revised = await harness.request({
      method: "POST",
      path: `/api/v1/quotations/${quoteId}/revise`,
      actor: "user-admin",
      body: {
        version: 2,
        reason: "Explicit line list in the revision",
        items: [{ description: "Only line", quantity: "5", unitPrice: "10" }],
      },
    });
    expect(revised.status).toBe(200);
    const row = audit.sqlite.prepare("SELECT subtotal_minor FROM quotations WHERE id = ?").get(quoteId) as { subtotal_minor: number };
    expect(Number(row.subtotal_minor)).toBe(5000); // 5 × 10 USD = 5000 cents

    const items = count(audit.sqlite, "quotation_items", "quotation_id = ? AND revision = 2", quoteId);
    expect(items).toBe(1);

    const stale = await harness.request({
      method: "POST",
      path: `/api/v1/quotations/${quoteId}/revise`,
      actor: "user-admin",
      body: { version: 2, reason: "Stale version must be refused" },
    });
    expect(stale.status).toBe(409);
    expect((stale.json as { error: { code: string } }).error.code).toBe("QUOTE_VERSION");
  });

  it("refuses revise on a draft, a rejected document and a missing reason", async () => {
    audit = createW2Database();
    const harness = createTestHarness(audit);

    // Draft: never issued.
    const draft = await harness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: {
        quoteNumber: "QU-U08-003",
        customerId: "customer-1",
        items: [{ description: "Draft item", quantity: "1", unitPrice: "1" }],
      },
    });
    const draftId = (draft.json as { data: { id: string } }).data.id;
    const draftRevise = await harness.request({
      method: "POST",
      path: `/api/v1/quotations/${draftId}/revise`,
      actor: "user-admin",
      body: { version: 1, reason: "Draft cannot be revised" },
    });
    expect(draftRevise.status).toBe(409);
    expect((draftRevise.json as { error: { code: string } }).error.code).toBe("QUOTE_NOT_ISSUED");

    // REJECTED: revise is refused (D-02 revise covers ISSUED/ACCEPTED/EXPIRED only).
    const rejected = await issuedQuote(audit, "QU-U08-004");
    await rejected.harness.request({
      method: "POST",
      path: `/api/v1/quotations/${rejected.quoteId}/response`,
      actor: "user-admin",
      body: { response: "REJECTED" },
    });
    const rejectedRevise = await rejected.harness.request({
      method: "POST",
      path: `/api/v1/quotations/${rejected.quoteId}/revise`,
      actor: "user-admin",
      body: { version: 2, reason: "Rejected quotation cannot be revised" },
    });
    expect(rejectedRevise.status).toBe(409);
    expect((rejectedRevise.json as { error: { code: string } }).error.code).toBe("QUOTE_NOT_ISSUED");

    // Missing reason.
    const missingReason = await issuedQuote(audit, "QU-U08-005");
    const refused = await missingReason.harness.request({
      method: "POST",
      path: `/api/v1/quotations/${missingReason.quoteId}/revise`,
      actor: "user-admin",
      body: { version: 2, reason: "  " },
    });
    expect(refused.status).toBe(422);
    expect((refused.json as { error: { code: string } }).error.code).toBe("QUOTE_REASON");
  });
});
