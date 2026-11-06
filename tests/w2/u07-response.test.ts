import { afterEach, describe, expect, it } from "vitest";
import { createTestHarness } from "../transition-2026-10-21/harness/app";
import { createW2Database, count, type W2Database } from "./harness/db";

/**
 * U07 — D-02 client response: ACCEPTED/REJECTED transitions, refusal of a
 * second response, and the stable invalid-response code.
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
      items: [{ description: "Response fixture item", quantity: "1", unitPrice: "1" }],
    },
  });
  const quoteId = (created.json as { data: { id: string } }).data.id;
  const issued = await harness.request({
    method: "POST",
    path: `/api/v1/quotations/${quoteId}/issue`,
    actor: "user-admin",
    body: {},
  });
  if (issued.status !== 200) throw new Error(`fixture issue failed: ${issued.text}`);
  return { harness, quoteId };
}

describe("U07 client response", () => {
  it("transitions ACCEPTED and REJECTED", async () => {
    audit = createW2Database();

    const accepted = await issuedQuote(audit, "QU-U07-001");
    const acceptedResponse = await accepted.harness.request({
      method: "POST",
      path: `/api/v1/quotations/${accepted.quoteId}/response`,
      actor: "user-admin",
      body: { response: "accepted" },
    });
    expect(acceptedResponse.status).toBe(200);
    let row = acceptRow(audit, accepted.quoteId);    expect(row.status).toBe("ACCEPTED");
    expect(row.client_response).toBe("ACCEPTED");
    expect(row.client_response_by).toBe("user-admin");
    expect(row.client_response_at).toBeTruthy();

    const rejected = await issuedQuote(audit, "QU-U07-002");
    const reject = await rejected.harness.request({
      method: "POST",
      path: `/api/v1/quotations/${rejected.quoteId}/response`,
      actor: "user-admin",
      body: { response: "REJECTED" },
    });
    expect(reject.status).toBe(200);
    row = acceptRow(audit, rejected.quoteId);
    expect(row.status).toBe("REJECTED");
    expect(row.client_response).toBe("REJECTED");
  });

  it("refuses a second response and an invalid response", async () => {
    audit = createW2Database();
    const { harness, quoteId } = await issuedQuote(audit, "QU-U07-003");

    const first = await harness.request({
      method: "POST",
      path: `/api/v1/quotations/${quoteId}/response`,
      actor: "user-admin",
      body: { response: "ACCEPTED" },
    });
    expect(first.status).toBe(200);

    const second = await harness.request({
      method: "POST",
      path: `/api/v1/quotations/${quoteId}/response`,
      actor: "user-admin",
      body: { response: "REJECTED" },
    });
    expect(second.status).toBe(409);
    expect((second.json as { error: { code: string } }).error.code).toBe("QUOTE_RESPONSE_RECORDED");

    const invalid = await issuedQuote(audit, "QU-U07-004");
    const refusedInvalid = await invalid.harness.request({
      method: "POST",
      path: `/api/v1/quotations/${invalid.quoteId}/response`,
      actor: "user-admin",
      body: { response: "MAYBE" },
    });
    expect(refusedInvalid.status).toBe(422);
    expect((refusedInvalid.json as { error: { code: string } }).error.code).toBe("QUOTE_RESPONSE_INVALID");

    // record_response requires the permission — officer lacks it.
    const officerRefused = await harness.request({
      method: "POST",
      path: `/api/v1/quotations/${quoteId}/response`,
      actor: "user-officer",
      body: { response: "ACCEPTED" },
    });
    expect(officerRefused.status).toBe(403);
  });
});

function acceptRow(audit: W2Database, quoteId: string) {
  return audit.sqlite
    .prepare("SELECT status, client_response, client_response_by, client_response_at FROM quotations WHERE id = ?")
    .get(quoteId) as { status: string; client_response: string | null; client_response_by: string | null; client_response_at: string | null };
}
