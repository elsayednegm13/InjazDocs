import { afterEach, describe, expect, it } from "vitest";
import { createTestHarness } from "../transition-2026-10-21/harness/app";
import { createW2Database, count, type W2Database } from "./harness/db";

/**
 * U06 — D-08 effective expiry (no cron): the stored status stays ISSUED after
 * validity ends; reads report the effective status and mutating guards refuse
 * it, while revise treats EXPIRED as revisable.
 */
let audit: W2Database | null = null;

afterEach(() => {
  audit?.close();
  audit = null;
});

describe("U06 effective expiry", () => {
  it("keeps the stored status ISSUED while reads report EXPIRED", async () => {
    audit = createW2Database();
    const harness = createTestHarness(audit);

    const created = await harness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: {
        quoteNumber: "QU-U06-001",
        customerId: "customer-1",
        validityDays: 30,
        items: [{ description: "Expiring item", quantity: "1", unitPrice: "1" }],
      },
    });
    const quoteId = (created.json as { data: { id: string } }).data.id;
    await harness.request({ method: "POST", path: `/api/v1/quotations/${quoteId}/issue`, actor: "user-admin", body: {} });

    // The validity has ended: rewind issued_at into the past (test-owned store).
    audit.sqlite
      .prepare("UPDATE quotations SET issued_at = ?, valid_until = ? WHERE id = ?")
      .run("2026-01-01T10:00:00.000Z", "2026-01-02T23:59:59.000Z", quoteId);

    const read = await harness.request({ path: `/api/v1/quotations/${quoteId}`, actor: "user-admin" });
    expect(read.status).toBe(200);
    const data = (read.json as { data: { quote: { status: string; valid_until: string }; effectiveStatus: string } }).data;
    expect(data.quote.status).toBe("ISSUED"); // stored value untouched
    expect(data.effectiveStatus).toBe("EXPIRED");

    expect(count(audit.sqlite, "quotations", "id = ? AND status = 'ISSUED'", quoteId)).toBe(1);
  });

  it("refuses a client response after validity with QUOTE_EXPIRED", async () => {
    audit = createW2Database();
    const harness = createTestHarness(audit);

    const created = await harness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: {
        quoteNumber: "QU-U06-002",
        customerId: "customer-1",
        validityDays: 30,
        items: [{ description: "Expired response item", quantity: "1", unitPrice: "1" }],
      },
    });
    const quoteId = (created.json as { data: { id: string } }).data.id;
    await harness.request({ method: "POST", path: `/api/v1/quotations/${quoteId}/issue`, actor: "user-admin", body: {} });
    audit.sqlite
      .prepare("UPDATE quotations SET valid_until = ? WHERE id = ?")
      .run("2026-01-02T23:59:59.000Z", quoteId);

    const refused = await harness.request({
      method: "POST",
      path: `/api/v1/quotations/${quoteId}/response`,
      actor: "user-admin",
      body: { response: "ACCEPTED" },
    });
    expect(refused.status).toBe(409);
    expect((refused.json as { error: { code: string } }).error.code).toBe("QUOTE_EXPIRED");
  });

  it("treats EXPIRED as revisable and resets the lifecycle", async () => {
    audit = createW2Database();
    const harness = createTestHarness(audit);

    const created = await harness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: {
        quoteNumber: "QU-U06-003",
        customerId: "customer-1",
        validityDays: 30,
        items: [{ description: "Revise-on-expiry item", quantity: "1", unitPrice: "2" }],
      },
    });
    const quoteId = (created.json as { data: { id: string } }).data.id;
    await harness.request({ method: "POST", path: `/api/v1/quotations/${quoteId}/issue`, actor: "user-admin", body: {} });
    audit.sqlite
      .prepare("UPDATE quotations SET valid_until = ? WHERE id = ?")
      .run("2026-01-02T23:59:59.000Z", quoteId);

    const revised = await harness.request({
      method: "POST",
      path: `/api/v1/quotations/${quoteId}/revise`,
      actor: "user-admin",
      body: { version: 2, reason: "Re-sending after the validity ended" },
    });
    expect(revised.status).toBe(200);
    const data = (revised.json as { data: { revision: number } }).data;
    expect(data.revision).toBe(2);

    const row = audit.sqlite.prepare("SELECT status, active_revision, version FROM quotations WHERE id = ?").get(quoteId) as {
      status: string;
      active_revision: number;
      version: number;
    };
    expect(row.status).toBe("ISSUED");
    expect(Number(row.active_revision)).toBe(2);
    expect(row.version).toBe(3);
  });
});
