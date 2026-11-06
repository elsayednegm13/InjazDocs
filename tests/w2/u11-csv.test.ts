import { afterEach, describe, expect, it } from "vitest";
import { createTestHarness } from "../transition-2026-10-21/harness/app";
import { count, createW2Database, type W2Database } from "./harness/db";

/**
 * U11 — CSV export contract: BOM-prefixed UTF-8, the exact header row, exact
 * cell escaping for commas, and the archived flag. Requires quotations.export.
 */
let audit: W2Database | null = null;

afterEach(() => {
  audit?.close();
  audit = null;
});

describe("U11 quotations CSV", () => {
  it("serves a BOM-prefixed CSV with the contracted header and escaped cells", async () => {
    audit = createW2Database();
    const harness = createTestHarness(audit);

    const created = await harness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: {
        quoteNumber: "QU-U11-001",
        customerId: "customer-quote",
        title: 'Fixture, title "with" comma',
        items: [{ description: "CSV fixture item", quantity: "3", unitPrice: "5" }],
      },
    });
    expect(created.status).toBe(201);

    const response = await harness.request({ path: "/api/v1/quotations.csv", actor: "user-admin" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.text.startsWith("\uFEFF")).toBe(true);

    const lines = response.text.replace(/^\uFEFF/, "").split("\n");
    expect(lines[0]).toBe(
      "quote_number,title,customer_name,status,validity_days,issued_at_utc,valid_until_utc,client_response,case_reference,archived,subtotal_usd,active_revision,created_at_utc",
    );
    expect(lines[1]).toContain("QU-U11-001");
    expect(lines[1]).toContain('"Fixture, title ""with"" comma"'); // csvCell quotes only cells that need it
    expect(lines[1]).toContain("Nile Trading LLC");
    expect(lines[1]).toContain("DRAFT");
    expect(lines[1]).toContain("false");
    expect(lines).toHaveLength(3); // header + one data row + trailing newline
  });

  it("marks archived rows and proves the empty company case", async () => {
    audit = createW2Database();
    const harness = createTestHarness(audit);

    const empty = await harness.request({ path: "/api/v1/quotations.csv", actor: "user-admin" });
    const emptyLines = empty.text.replace(/^\uFEFF/, "").split("\n");
    expect(emptyLines).toHaveLength(2); // header only + trailing newline
    expect(count(audit.sqlite, "quotations")).toBe(0);

    const created = await harness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: {
        quoteNumber: "QU-U11-002",
        customerId: "customer-1",
        items: [{ description: "Archive CSV item", quantity: "1", unitPrice: "1" }],
      },
    });
    const quoteId = (created.json as { data: { id: string } }).data.id;
    await harness.request({
      method: "POST",
      path: `/api/v1/quotations/${quoteId}/archive`,
      actor: "user-admin",
      body: { reason: "CSV archived fixture" },
    });

    const response = await harness.request({ path: "/api/v1/quotations.csv", actor: "user-admin" });
    const dataRow = response.text.replace(/^\uFEFF/, "").split("\n")[1] ?? "";
    expect(dataRow).toContain(",true,");
    expect(dataRow).toContain("Existing Customer");
  });
});
