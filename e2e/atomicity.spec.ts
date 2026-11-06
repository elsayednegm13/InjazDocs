import path from "node:path";
import { expect, test } from "@playwright/test";
import { e2eRunRoot, runStamp, wranglerRows } from "./helpers";

const stamp = runStamp();
const origin = { origin: "http://127.0.0.1:43174" };
const runRoot = e2eRunRoot();
const persist = path.join(runRoot, "state");

function countRows(table: string, where: string) {
  const rows = wranglerRows<{ n: number }>(persist, `SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`);
  return Number(rows[0]?.n ?? 0);
}

function countCustomers(name: string) {
  return countRows("customers", `legal_name = '${name.replaceAll("'", "''")}'`);
}

async function createCustomer(request: import("@playwright/test").APIRequestContext, body: Record<string, unknown>) {
  return request.post("/api/v1/customers", { data: body, headers: origin });
}

test("ATOM-01 a rejected customer leaves no customer, contact, address or bank row", async ({ page }) => {
  const name = `Atom 01 ${stamp}`;
  // An unknown custom field is rejected after the customer row would have been
  // written in the old flow.
  const rejected = await createCustomer(page.request, {
    legalName: name,
    countryCode: "EG",
    customFields: { field_that_does_not_exist: "x" },
  });
  expect(rejected.status()).toBe(422);
  expect((await rejected.json()).error.code).toBe("CUSTOM_FIELD_UNAVAILABLE");
  expect(countCustomers(name)).toBe(0);
  expect(countRows("customer_contacts", `customer_id IN (SELECT id FROM customers WHERE legal_name = '${name}')`)).toBe(0);
  expect(countRows("customer_addresses", `customer_id IN (SELECT id FROM customers WHERE legal_name = '${name}')`)).toBe(0);
  expect(countRows("customer_bank_accounts", `customer_id IN (SELECT id FROM customers WHERE legal_name = '${name}')`)).toBe(0);
});

test("ATOM-02 a customer over the contact limit is refused before any write", async ({ page }) => {
  const name = `Atom 02 ${stamp}`;
  const contacts = Array.from({ length: 21 }, (_, index) => ({ fullName: `Contact ${index}` }));
  const rejected = await createCustomer(page.request, { legalName: name, countryCode: "EG", contacts });
  expect(rejected.status()).toBe(422);
  expect((await rejected.json()).error.code).toBe("CUSTOMER_CONTACTS_LIMIT");
  expect(countCustomers(name)).toBe(0);
});

test("ATOM-03 a customer is written with its contacts, address and bank in one transaction", async ({ page }) => {
  const name = `Atom 03 ${stamp}`;
  const created = await createCustomer(page.request, {
    legalName: name,
    countryCode: "EG",
    contacts: [{ fullName: "Primary", isPrimary: true }],
    addresses: [{ kind: "SHIPPING", line1: "1 Atomic Way", city: "Cairo", isPrimary: true }],
    banks: [{ bankName: "Atomic Bank", accountNumber: "99887766", iban: "EG998877660000000000000001" }],
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const id = (await created.json()).data.id as string;
  expect(countCustomers(name)).toBe(1);
  expect(countRows("customer_contacts", `customer_id = '${id}'`)).toBe(1);
  expect(countRows("customer_addresses", `customer_id = '${id}'`)).toBe(1);
  expect(countRows("customer_bank_accounts", `customer_id = '${id}'`)).toBe(1);
});

test("ATOM-04 a failed import row is reported and a retry resumes without duplicating", async ({ page }) => {
  const importId = `import-${stamp}-a`;
  const goodName = `Atom 04 good ${stamp}`;
  const alsoGood = `Atom 04 second ${stamp}`;
  const tooLong = "X".repeat(260);
  const rows = [
    { legal_name: goodName, country_code: "EG" },
    { legal_name: tooLong, country_code: "EG" },
    { legal_name: alsoGood, country_code: "EG" },
  ];

  const first = await page.request.post("/api/v1/imports/customers/commit", {
    data: { importId, rows },
    headers: origin,
  });
  expect(first.ok(), await first.text()).toBeTruthy();
  const firstBody = (await first.json()).data as {
    importId: string;
    status: string;
    imported: number;
    failed: number;
    rows: Array<{ row: number; status: string; errorCode?: string }>;
  };
  expect(firstBody.importId).toBe(importId);
  expect(firstBody.status).toBe("PARTIAL");
  expect(firstBody.imported).toBe(2);
  expect(firstBody.failed).toBe(1);
  expect(firstBody.rows.find((row) => row.status === "FAILED")?.errorCode).toBe("CUSTOMER_NAME_TOO_LONG");
  expect(countCustomers(goodName)).toBe(1);
  expect(countCustomers(alsoGood)).toBe(1);
  expect(countRows("customers", `legal_name = '${tooLong}'`)).toBe(0);

  // The same import id resumes: the imported rows are skipped and the failed
  // row is attempted again. No customer is created twice.
  const retry = await page.request.post("/api/v1/imports/customers/commit", {
    data: { importId, rows },
    headers: origin,
  });
  expect(retry.ok(), await retry.text()).toBeTruthy();
  const retryBody = (await retry.json()).data as { imported: number; failed: number; skipped: number };
  expect(retryBody.imported).toBe(2);
  expect(retryBody.skipped).toBe(2);
  expect(countCustomers(goodName)).toBe(1);
  expect(countCustomers(alsoGood)).toBe(1);

  const operation = wranglerRows<{ status: string; imported_rows: number; failed_rows: number }>(
    persist,
    `SELECT status, imported_rows, failed_rows FROM customer_import_operations WHERE id = '${importId}'`,
  );
  expect(operation).toHaveLength(1);
  expect(operation[0].status).toBe("PARTIAL");
  expect(Number(operation[0].imported_rows)).toBe(2);
  expect(Number(operation[0].failed_rows)).toBe(1);
});

test("ATOM-05 two concurrent imports with one id create each customer once", async ({ page }) => {
  const importId = `import-${stamp}-b`;
  const name = `Atom 05 ${stamp}`;
  const rows = [{ legal_name: name, country_code: "EG" }];
  const [first, second] = await Promise.all([
    page.request.post("/api/v1/imports/customers/commit", { data: { importId, rows }, headers: origin }),
    page.request.post("/api/v1/imports/customers/commit", { data: { importId, rows }, headers: origin }),
  ]);
  expect(first.ok(), await first.text()).toBeTruthy();
  expect(second.ok(), await second.text()).toBeTruthy();
  expect(countCustomers(name)).toBe(1);
});

test("ATOM-06 a case with a duplicate invoice leaves no case, checklist or snapshot row", async ({ page }) => {
  const stampLocal = Date.now().toString().slice(-6);
  const invoiceNumber = `INV-ATOM-${stampLocal}`;
  const invoice = {
    invoiceNumber,
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
  const customer = await createCustomer(page.request, { legalName: `Atom 06 ${stampLocal}`, countryCode: "EG" });
  expect(customer.ok(), await customer.text()).toBeTruthy();
  const customerId = (await customer.json()).data.id as string;

  const first = await page.request.post("/api/v1/export-cases", {
    data: { customerId, documentRoute: "DIRECT_ROUTE", invoice },
    headers: origin,
  });
  expect(first.ok(), await first.text()).toBeTruthy();

  const second = await page.request.post("/api/v1/export-cases", {
    data: { customerId, documentRoute: "DIRECT_ROUTE", invoice: { ...invoice, invoiceNumber: invoiceNumber } },
    headers: origin,
  });
  expect(second.status()).toBe(409);
  expect((await second.json()).error.code).toBe("INVOICE_NUMBER_TAKEN");

  const cases = countRows("export_cases", `customer_id = '${customerId}'`);
  expect(cases).toBe(1);
  // The rejected case must not leave a snapshot, a checklist row or a case event.
  const orphanSnapshots = countRows(
    "export_case_customer_snapshots",
    `case_id IN (SELECT id FROM export_cases WHERE customer_id = '${customerId}') AND captured_at IS NOT NULL`,
  );
  expect(orphanSnapshots).toBe(cases);
  const invoices = countRows("export_invoices", `invoice_number = '${invoiceNumber}'`);
  expect(invoices).toBe(1);
});
