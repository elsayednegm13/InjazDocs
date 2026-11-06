import { afterEach, describe, expect, it } from "vitest";
import { createTestHarness } from "../transition-2026-10-21/harness/app";
import { createW2Database, type W2Database } from "./harness/db";

/**
 * U10 — D-06 PDF contract: a real PDF document (header, band label, letterhead,
 * footer with page numbers), the unmistakable DRAFT mark on previews and none
 * on issued snapshots, and the privacy rule: no bank data and no technical
 * identifiers in the printed output.
 */
let audit: W2Database | null = null;

afterEach(() => {
  audit?.close();
  audit = null;
});

async function issuedQuote(audit: W2Database) {
  const harness = createTestHarness(audit);
  const created = await harness.request({
    method: "POST",
    path: "/api/v1/quotations",
    actor: "user-admin",
    body: {
      quoteNumber: "QU-U10-001",
      customerId: "customer-quote", // has a trade name and bank rows
      paymentTerms: "Net 30 days",
      notes: "Delivery within three weeks of order confirmation",
      items: [{ description: "Cotton T-Shirts — model A-1", quantity: "1200", unitLabel: "PCS", unitPrice: "2.75" }],
    },
  });
  if (created.status !== 201) throw new Error(`fixture create failed: ${created.text}`);
  const quoteId = (created.json as { data: { id: string } }).data.id;
  const issue = await harness.request({ method: "POST", path: `/api/v1/quotations/${quoteId}/issue`, actor: "user-admin", body: {} });
  if (issue.status !== 200) throw new Error(`fixture issue failed: ${issue.text}`);
  return { harness, quoteId };
}

describe("U10 quotation PDF", () => {
  it("serves a valid PDF attachment for an issued quotation", async () => {
    audit = createW2Database();
    const { harness, quoteId } = await issuedQuote(audit);

    const response = await harness.request({ path: `/api/v1/quotations/${quoteId}/pdf`, actor: "user-admin" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="QU-U10-001.pdf"');
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.text.startsWith("%PDF-1.4")).toBe(true);
    expect(response.text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(response.text.includes("QUOTATION / PROFORMA")).toBe(true);
    expect(response.text.includes("Export")).toBe(true);
    expect(response.text.includes("Operations")).toBe(true);
    expect(response.text.includes("Page 1 of 1")).toBe(true);
  });

  it("keeps the issued snapshot free of the DRAFT mark while previews carry it", async () => {
    audit = createW2Database();
    const { harness, quoteId } = await issuedQuote(audit);

    const issued = await harness.request({ path: `/api/v1/quotations/${quoteId}/pdf`, actor: "user-admin" });
    expect(issued.text.includes("DRAFT")).toBe(false);

    // A fresh store proves the preview path: no revision exists yet.
    audit?.close();
    audit = createW2Database();
    const draftHarness = createTestHarness(audit);
    const draftQuote = await draftHarness.request({
      method: "POST",
      path: "/api/v1/quotations",
      actor: "user-admin",
      body: {
        quoteNumber: "QU-U10-002",
        customerId: "customer-quote",
        items: [{ description: "Draft preview item", quantity: "1", unitPrice: "1" }],
      },
    });
    const draftId = (draftQuote.json as { data: { id: string } }).data.id;
    const preview = await draftHarness.request({ path: `/api/v1/quotations/${draftId}/pdf`, actor: "user-admin" });
    expect(preview.status).toBe(200);
    expect(preview.text.includes("DRAFT")).toBe(true);
    expect(preview.headers.get("content-disposition")).toBe('attachment; filename="QU-U10-002-DRAFT.pdf"');
  });

  it("never prints bank data or technical identifiers", async () => {
    audit = createW2Database();
    const { harness, quoteId } = await issuedQuote(audit);

    const response = await harness.request({ path: `/api/v1/quotations/${quoteId}/pdf`, actor: "user-admin" });
    expect(response.text.includes("Test Bank of Egypt")).toBe(false); // D-06: no bank data
    expect(response.text.includes(quoteId)).toBe(false); // no UUIDs in the printout
    expect(response.text.includes("Nile")).toBe(true);
    expect(response.text.includes("Trading")).toBe(true);
  });
});
