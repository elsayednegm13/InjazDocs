import { expect, test } from "@playwright/test";

const headers = { origin: "http://127.0.0.1:43174" };

function invoice(number: string) {
  return {
    invoiceNumber: number,
    invoiceDate: "2026-10-20",
    paymentTermCode: "TT",
    incoterm: "FOB",
    currency: "USD",
    goodsValue: "100.00",
    invoicedFreight: "0",
    actualFreightExpense: "0",
    invoiceTotal: "100.00",
    grossWeight: 2,
    netWeight: 1,
    weightUnit: "KG",
  };
}

test("an invalid or duplicate invoice never leaves an orphan export case", async ({ page }) => {
  const stamp = Date.now().toString().slice(-6);
  const first = await page.request.post("/api/v1/customers", {
    data: { legalName: `Integrity A ${stamp}`, countryCode: "EG" },
    headers,
  });
  expect(first.ok(), await first.text()).toBeTruthy();
  const firstCustomerId = (await first.json()).data.id as string;

  const invalid = await page.request.post("/api/v1/export-cases", {
    data: {
      customerId: firstCustomerId,
      documentRoute: "DIRECT_ROUTE",
      invoice: { ...invoice(`INV-BAD-${stamp}`), goodsValue: "not-a-number" },
    },
    headers,
  });
  expect(invalid.status()).toBe(422);
  expect((await invalid.json()).error.code).toBe("INVOICE_AMOUNT_INVALID");

  const afterInvalid = await (await page.request.get(`/api/v1/customers/${firstCustomerId}`)).json();
  expect(afterInvalid.data.cases).toHaveLength(0);

  const valid = await page.request.post("/api/v1/export-cases", {
    data: { customerId: firstCustomerId, documentRoute: "DIRECT_ROUTE", invoice: invoice(`INV-DUP-${stamp}`) },
    headers,
  });
  expect(valid.ok(), await valid.text()).toBeTruthy();

  const second = await page.request.post("/api/v1/customers", {
    data: { legalName: `Integrity B ${stamp}`, countryCode: "EG" },
    headers,
  });
  expect(second.ok(), await second.text()).toBeTruthy();
  const secondCustomerId = (await second.json()).data.id as string;

  const duplicate = await page.request.post("/api/v1/export-cases", {
    data: { customerId: secondCustomerId, documentRoute: "DIRECT_ROUTE", invoice: invoice(`INV-DUP-${stamp}`) },
    headers,
  });
  expect(duplicate.status()).toBe(409);
  expect((await duplicate.json()).error.code).toBe("INVOICE_NUMBER_TAKEN");

  const afterDuplicate = await (await page.request.get(`/api/v1/customers/${secondCustomerId}`)).json();
  expect(afterDuplicate.data.cases).toHaveLength(0);
});
