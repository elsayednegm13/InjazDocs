import { expect, test } from "@playwright/test";
import { createCase, createCustomer, runStamp } from "./helpers";

const stamp = runStamp();
const origin = { origin: "http://127.0.0.1:43174" };

test("T01 empty document type is a safe 422 and Arabic inline error", async ({ page }) => {
  const customer = `Err ${stamp}`;
  await createCustomer(page, customer, `ERR-${stamp}`);
  const created = await page.request.post("/api/v1/customers", {
    data: { legalName: `API ${stamp}`, countryCode: "EG", contacts: [{ fullName: "Nada", phone: "+201000000088" }] },
    headers: origin,
  });
  expect(created.ok()).toBeTruthy();
  const customerId = (await created.json()).data.id as string;
  const caseRes = await page.request.post("/api/v1/export-cases", {
    data: { customerId, documentRoute: "DIRECT_ROUTE" },
    headers: origin,
  });
  expect(caseRes.ok()).toBeTruthy();
  const caseId = (await caseRes.json()).data.id as string;
  const empty = await page.request.post(`/api/v1/export-cases/${caseId}/document-requirements`, {
    data: { documentTypeId: "", required: true },
    headers: origin,
  });
  expect(empty.status()).toBe(422);
  const body = await empty.json();
  expect(body.error.code).toBe("DOCUMENT_TYPE_REQUIRED");
  expect(JSON.stringify(body)).not.toMatch(/SQLITE|CONSTRAINT|D1_|document_type_id/i);

  await createCase(page, {
    customer,
    route: "DIRECT_ROUTE",
    invoice: `INV-ERR-${stamp}`,
    incoterm: "FOB",
    goods: "10.00",
    invoicedFreight: "0",
    actualFreight: "0",
    total: "10.00",
  });
  await page.locator('[data-tab="documents"]').click();
  await page.getByRole("button", { name: "ع" }).click();
  await page.getByRole("button", { name: "إضافة إلى هذه العملية" }).click();
  await expect(page.getByText("اختر نوع المستند قبل إضافته.")).toBeVisible();
  await expect(page.getByText(/SQLITE|CONSTRAINT|D1_/)).toHaveCount(0);
});

test("T05 public tracking revoked stays privacy-preserving", async ({ page }) => {
  const missing = await page.request.get("/api/v1/public/track/not-a-real-token");
  expect(missing.status()).toBe(410);
  const text = await missing.text();
  expect(text).not.toContain("export_cases");
  expect(text).toContain("CUSTOMER_TRACKING_UNAVAILABLE");
});
