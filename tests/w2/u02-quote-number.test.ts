import { afterEach, describe, expect, it } from "vitest";
import { createTestHarness } from "../transition-2026-10-21/harness/app";
import { createW2Database, count, type W2Database } from "./harness/db";

/**
 * U02 — D-03 manual quote number: normalization (trim, Arabic-Indic/Persian
 * digits to Latin, ASCII uppercase), strict format, and company-wide uniqueness
 * including archived rows.
 */
let audit: W2Database | null = null;

afterEach(() => {
  audit?.close();
  audit = null;
});

function validBody(quoteNumber: string) {
  return {
    quoteNumber,
    customerId: "customer-1",
    items: [{ description: "Number fixture item", quantity: "1", unitPrice: "1" }],
  };
}

describe("U02 quote number normalization and uniqueness", () => {
  it("normalizes Arabic-Indic and Persian digits to the canonical Latin text", async () => {
    audit = createW2Database();
    const harness = createTestHarness(audit);

    const arabic = await harness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: validBody("١٢٣/٢٠"),
    });
    expect(arabic.status).toBe(201);
    expect((arabic.json as { data: { quoteNumber: string } }).data.quoteNumber).toBe("123/20");
    expect(count(audit.sqlite, "quotations", "quote_number = '123/20'")).toBe(1);
    expect(count(audit.sqlite, "quotations", "quote_number_display = '١٢٣/٢٠'")).toBe(1);

    const persian = await harness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: validBody("۱۲۴"),
    });
    expect(persian.status).toBe(201);
    expect((persian.json as { data: { quoteNumber: string } }).data.quoteNumber).toBe("124");

    const lowercase = await harness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: validBody("qu-125"),
    });
    expect(lowercase.status).toBe(201);
    expect((lowercase.json as { data: { quoteNumber: string } }).data.quoteNumber).toBe("QU-125");
  });

  it("refuses missing, spaced, oversized and unsupported formats with stable codes", async () => {
    audit = createW2Database();
    const harness = createTestHarness(audit);

    const missing = await harness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: { ...validBody("   "), quoteNumber: "  " },
    });
    expect(missing.status).toBe(422);
    expect((missing.json as { error: { code: string } }).error.code).toBe("QUOTE_NUMBER_REQUIRED");

    const spaced = await harness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: validBody("QU 200"),
    });
    expect(spaced.status).toBe(422);
    expect((spaced.json as { error: { code: string } }).error.code).toBe("QUOTE_NUMBER_INVALID_FORMAT");

    const oversized = await harness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: validBody("Q".repeat(41)),
    });
    expect(oversized.status).toBe(422);
    expect((oversized.json as { error: { code: string } }).error.code).toBe("QUOTE_NUMBER_INVALID_FORMAT");

    const unsupported = await harness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: validBody("QU@300"),
    });
    expect(unsupported.status).toBe(422);
    expect((unsupported.json as { error: { code: string } }).error.code).toBe("QUOTE_NUMBER_INVALID_FORMAT");
  });

  it("keeps the canonical number unique across the whole company, including archived rows", async () => {
    audit = createW2Database();
    const harness = createTestHarness(audit);

    const duplicate = await harness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: validBody("١٢٣/٢٠"), // same canonical as 123/20 from the first test — fresh store proves uniqueness only within this suite
    });
    expect(duplicate.status).toBe(201);

    const second = await harness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: validBody("123/20"), // different display, identical canonical
    });
    expect(second.status).toBe(409);
    expect((second.json as { error: { code: string } }).error.code).toBe("QUOTE_NUMBER_TAKEN");

    const quoteId = (duplicate.json as { data: { id: string } }).data.id;
    const archive = await harness.request({
      method: "POST",
      path: `/api/v1/quotations/${quoteId}/archive`,
      actor: "user-admin",
      body: { reason: "Fixture archive to prove the unique reach" },
    });
    expect(archive.status).toBe(200);

    const afterArchive = await harness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: validBody("123/20"),
    });
    expect(afterArchive.status).toBe(409);
    expect((afterArchive.json as { error: { code: string } }).error.code).toBe("QUOTE_NUMBER_TAKEN");
  });
});
