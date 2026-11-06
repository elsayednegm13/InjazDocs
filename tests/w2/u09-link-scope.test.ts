import { afterEach, describe, expect, it } from "vitest";
import { createTestHarness } from "../transition-2026-10-21/harness/app";
import { createW2Database, count, type W2Database } from "./harness/db";

/**
 * U09 — D-09 link/scope rules: linked quotations follow the export-case scope,
 * unlinked quotations are creator-only, and link/relink/unlink carry the
 * documented operational conditions.
 */
let audit: W2Database | null = null;

afterEach(() => {
  audit?.close();
  audit = null;
});

async function quotedBy(audit: W2Database, owner: string, quoteNumber: string) {
  const harness = createTestHarness(audit);
  const created = await harness.request({
    method: "POST",
    path: "/api/v1/quotations",
    actor: owner,
    body: {
      quoteNumber,
      customerId: "customer-quote",
      items: [{ description: "Link fixture item", quantity: "1", unitPrice: "1" }],
    },
  });
  if (created.status !== 201) throw new Error(`fixture create failed: ${created.text}`);
  return { harness, quoteId: (created.json as { data: { id: string } }).data.id };
}

describe("U09 link and scope", () => {
  it("refuses an unlinked quotation to everyone except the creator", async () => {
    audit = createW2Database();
    const adminQuote = await quotedBy(audit, "user-admin", "QU-U09-001");

    const officerRead = await adminQuote.harness.request({ path: `/api/v1/quotations/${adminQuote.quoteId}`, actor: "user-officer" });
    expect(officerRead.status).toBe(403);

    const selfRead = await adminQuote.harness.request({ path: `/api/v1/quotations/${adminQuote.quoteId}`, actor: "user-admin" });
    expect(selfRead.status).toBe(200);
  });

  it("serves a linked quotation to the case scope", async () => {
    audit = createW2Database();
    const adminQuote = await quotedBy(audit, "user-admin", "QU-U09-002");

    const linked = await adminQuote.harness.request({
      method: "POST",
      path: `/api/v1/quotations/${adminQuote.quoteId}/link`,
      actor: "user-officer", // assigned to case-1 and case-2, holds quotations.edit + export_cases.edit
      body: { caseId: "case-1" },
    });
    expect(linked.status).toBe(200);

    const officerRead = await adminQuote.harness.request({ path: `/api/v1/quotations/${adminQuote.quoteId}`, actor: "user-officer" });
    expect(officerRead.status).toBe(200); // case scope now grants the read

    const outsiderRead = await adminQuote.harness.request({ path: `/api/v1/quotations/${adminQuote.quoteId}`, actor: "user-outsider" });
    expect(outsiderRead.status).toBe(403);
  });

  it("requires export_cases.edit on the target case for link", async () => {
    audit = createW2Database();
    const officerQuote = await quotedBy(audit, "user-officer", "QU-U09-003");

    // viewer has quotations.view but no quotations.edit — refused.
    const viewerLink = await officerQuote.harness.request({
      method: "POST",
      path: `/api/v1/quotations/${officerQuote.quoteId}/link`,
      actor: "user-viewer",
      body: { caseId: "case-1" },
    });
    expect(viewerLink.status).toBe(403);

    // unknown case → 404.
    const unknownCase = await officerQuote.harness.request({
      method: "POST",
      path: `/api/v1/quotations/${officerQuote.quoteId}/link`,
      actor: "user-officer",
      body: { caseId: "case-missing" },
    });
    expect(unknownCase.status).toBe(404);

    // officer is assigned to case-2 → link succeeds.
    const linked = await officerQuote.harness.request({
      method: "POST",
      path: `/api/v1/quotations/${officerQuote.quoteId}/link`,
      actor: "user-officer",
      body: { caseId: "case-2" },
    });
    expect(linked.status).toBe(200);
    const linkedCase = (linked.json as { data: { caseId: string } }).data.caseId;
    expect(linkedCase).toBe("case-2");
  });

  it("unlinks once and refuses the second unlink or a missing reason", async () => {
    audit = createW2Database();
    const adminQuote = await quotedBy(audit, "user-admin", "QU-U09-004");
    await adminQuote.harness.request({
      method: "POST",
      path: `/api/v1/quotations/${adminQuote.quoteId}/link`,
      actor: "user-officer",
      body: { caseId: "case-1" },
    });

    const noReason = await adminQuote.harness.request({
      method: "POST",
      path: `/api/v1/quotations/${adminQuote.quoteId}/unlink`,
      actor: "user-admin",
      body: { reason: "   " },
    });
    expect(noReason.status).toBe(422);
    expect((noReason.json as { error: { code: string } }).error.code).toBe("QUOTE_REASON");

    const unlinked = await adminQuote.harness.request({
      method: "POST",
      path: `/api/v1/quotations/${adminQuote.quoteId}/unlink`,
      actor: "user-admin",
      body: { reason: "Wrong case — moving provenance" },
    });
    expect(unlinked.status).toBe(200);

    const again = await adminQuote.harness.request({
      method: "POST",
      path: `/api/v1/quotations/${adminQuote.quoteId}/unlink`,
      actor: "user-admin",
      body: { reason: "Second unlink must be refused" },
    });
    expect(again.status).toBe(409);
    expect((again.json as { error: { code: string } }).error.code).toBe("QUOTE_NOT_LINKED");
  });
});
