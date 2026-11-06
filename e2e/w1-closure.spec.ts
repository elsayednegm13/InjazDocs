import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { e2eRunRoot, wranglerRows } from "./helpers";

/**
 * W1-CLOSE targeted runtime checks that were not covered by the historical
 * Playwright suite:
 *   W1C-01 booking without an active UCR cannot be confirmed (BR-U1 / UAT-06)
 *   W1C-02 a new document version after APPROVED resets the requirement to
 *          UPLOADED and preserves the previous version's review state.
 *
 * API-only on purpose: the goal is the server contract, not a new UI flow.
 */
const origin = "http://127.0.0.1:43174";
const headers = { origin };
const runRoot = e2eRunRoot();
const persist = path.join(runRoot, "state");
const stamp = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;

async function createCustomerAndCase(request: import("@playwright/test").APIRequestContext, label: string) {
  const customer = await request.post("/api/v1/customers", {
    data: { legalName: `${label} ${stamp}`, countryCode: "EG" },
    headers,
  });
  expect(customer.ok(), await customer.text()).toBeTruthy();
  const customerId = (await customer.json()).data.id as string;
  const created = await request.post("/api/v1/export-cases", {
    data: { customerId, documentRoute: "DIRECT_ROUTE" },
    headers,
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  return { customerId, caseId: (await created.json()).data.id as string };
}

async function requirement(page: import("@playwright/test").Page, caseId: string, name: string) {
  const overview = await page.request.get(`/api/v1/export-cases/${caseId}`);
  expect(overview.ok(), await overview.text()).toBeTruthy();
  const row = (await overview.json()).data.requirements.find((item: { name_en: string }) => item.name_en === name);
  expect(row, `requirement ${name}`).toBeTruthy();
  return row as { id: string; status: string };
}

async function uploadAndAttach(
  page: import("@playwright/test").Page,
  requirementId: string,
  file: string,
) {
  const pdf = readFileSync(file);
  const session = await page.request.post("/api/v1/files/uploads", {
    data: {
      parentType: "document_requirement",
      parentId: requirementId,
      filename: path.basename(file),
      mime: "application/pdf",
      expectedBytes: pdf.length,
    },
    headers,
  });
  expect(session.ok(), await session.text()).toBeTruthy();
  const sessionId = (await session.json()).data.id as string;
  const signed = await page.request.post(`/api/v1/files/uploads/${sessionId}/sign`, { data: { partNumber: 1 }, headers });
  expect(signed.ok(), await signed.text()).toBeTruthy();
  const put = await page.request.put((await signed.json()).data.url, { data: pdf, headers });
  expect(put.ok(), await put.text()).toBeTruthy();
  const etag = (await put.json()).data.etag as string;
  const done = await page.request.post(`/api/v1/files/uploads/${sessionId}/complete`, {
    data: { parts: [{ partNumber: 1, etag }] },
    headers,
  });
  expect(done.ok(), await done.text()).toBeTruthy();
  const objectKey = (await done.json()).data.objectKey as string;
  const attached = await page.request.post(`/api/v1/document-requirements/${requirementId}/versions`, {
    data: { r2Key: objectKey, originalName: path.basename(file), contentType: "application/pdf", byteSize: pdf.length },
    headers,
  });
  expect(attached.ok(), await attached.text()).toBeTruthy();
  return (await attached.json()).data as { id: string; version: number };
}

test("W1C-01 booking cannot be confirmed without an active UCR", async ({ page }) => {
  const { caseId } = await createCustomerAndCase(page.request, "W1C UCR");
  const bookingNumber = `W1C-BK-${stamp}`;
  const created = await page.request.post("/api/v1/bookings", {
    data: {
      caseId,
      bookingNumber,
      expectedContainers: 2,
      plannedEtd: "2026-12-01",
      plannedEta: "2026-12-20",
    },
    headers,
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const bookingId = (await created.json()).data.id as string;

  const fetched = await page.request.get(`/api/v1/bookings/${bookingId}`);
  expect(fetched.ok(), await fetched.text()).toBeTruthy();
  const booking = (await fetched.json()).data.booking;
  expect(booking.status).toBe("DRAFT");

  const baseUpdate = {
    bookingNumber,
    expectedContainers: 2,
    plannedEtd: "2026-12-01",
    plannedEta: "2026-12-20",
    version: booking.version,
    status: "CONFIRMED",
  };

  const missing = await page.request.put(`/api/v1/bookings/${bookingId}`, { data: baseUpdate, headers });
  expect(missing.status()).toBe(422);
  const missingBody = await missing.json();
  expect(missingBody.error.code).toBe("BOOKING_UCR_REQUIRED");

  const whitespace = await page.request.put(`/api/v1/bookings/${bookingId}`, {
    data: { ...baseUpdate, ucr: "   " },
    headers,
  });
  expect(whitespace.status()).toBe(422);
  expect((await whitespace.json()).error.code).toBe("BOOKING_UCR_REQUIRED");

  const confirmed = await page.request.put(`/api/v1/bookings/${bookingId}`, {
    data: { ...baseUpdate, ucr: `UCR-W1C-${stamp}` },
    headers,
  });
  expect(confirmed.ok(), await confirmed.text()).toBeTruthy();

  const after = await page.request.get(`/api/v1/bookings/${bookingId}`);
  const afterBody = (await after.json()).data.booking;
  expect(afterBody.status).toBe("CONFIRMED");
  expect(afterBody.ucr).toBe(`UCR-W1C-${stamp}`);
});

test("W1C-02 a new document version after approval resets the requirement to UPLOADED", async ({ page }) => {
  const { caseId } = await createCustomerAndCase(page.request, "W1C Doc");
  const invoice = await requirement(page, caseId, "Commercial Invoice");
  expect(invoice.status).toBe("MISSING");

  const first = await uploadAndAttach(page, invoice.id, "e2e/fixtures/sample.pdf");
  expect(first.version).toBe(1);

  const underReview = await page.request.post(`/api/v1/document-requirements/${invoice.id}/review`, {
    data: { decision: "UNDER_REVIEW" },
    headers,
  });
  expect(underReview.ok(), await underReview.text()).toBeTruthy();
  const approved = await page.request.post(`/api/v1/document-requirements/${invoice.id}/review`, {
    data: { decision: "APPROVED" },
    headers,
  });
  expect(approved.ok(), await approved.text()).toBeTruthy();
  expect((await requirement(page, caseId, "Commercial Invoice")).status).toBe("APPROVED");

  const second = await uploadAndAttach(page, invoice.id, "e2e/fixtures/sample-2.pdf");
  expect(second.version).toBe(2);
  expect((await requirement(page, caseId, "Commercial Invoice")).status).toBe("UPLOADED");

  const versions = wranglerRows<{ version: number; review_state: string; original_name: string }>(
    persist,
    `SELECT version, review_state, original_name FROM document_versions WHERE requirement_id = '${invoice.id}' ORDER BY version`,
  );
  expect(versions.map((row) => ({ version: row.version, review_state: row.review_state }))).toEqual([
    { version: 1, review_state: "APPROVED" },
    { version: 2, review_state: "UPLOADED" },
  ]);
  expect(versions[0].original_name).toBe("sample.pdf");
  expect(versions[1].original_name).toBe("sample-2.pdf");
});
