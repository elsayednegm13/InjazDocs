import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { e2eRunRoot, runStamp, wranglerRows } from "./helpers";

const stamp = runStamp();
const origin = "http://127.0.0.1:43174";
const runRoot = e2eRunRoot();
const storageState = path.join(runRoot, "admin-state.json");
const persist = path.join(runRoot, "state");

type Json = Record<string, any>;

type CreateResponse = {
  status: number;
  body: Json;
  replayed: boolean;
};

function payload(name: string) {
  return {
    legalName: name,
    countryCode: "EG",
    taxId: `DUP-${stamp}`,
    contacts: [{ fullName: "Duplicate Tester", isPrimary: true }],
    addresses: [{ kind: "SHIPPING", line1: "1 Test Road", city: "Cairo", countryCode: "EG", isPrimary: true }],
    banks: [],
    customFields: {},
  };
}

function sqlString(value: string) {
  return value.replaceAll("'", "''");
}

function countCustomers(name: string) {
  const rows = wranglerRows<{ n: number }>(
    persist,
    `SELECT COUNT(*) AS n FROM customers WHERE legal_name = '${sqlString(name)}'`,
  );
  return Number(rows[0]?.n ?? 0);
}

function customerId(name: string) {
  const rows = wranglerRows<{ id: string }>(
    persist,
    `SELECT id FROM customers WHERE legal_name = '${sqlString(name)}'`,
  );
  return rows[0]?.id ?? null;
}

function idempotencyRows(key: string) {
  return wranglerRows<{ state: string }>(
    persist,
    `SELECT state FROM idempotency_keys WHERE idempotency_key = '${sqlString(key)}'`,
  );
}

async function expectCount(name: string, expected: number) {
  await expect
    .poll(() => countCustomers(name), { timeout: 15_000, intervals: [200, 400, 800, 1200] })
    .toBe(expected);
}

async function createCustomerRequest(
  request: APIRequestContext,
  name: string,
  key: string,
  extraHeaders: Record<string, string> = {},
  timeout?: number,
): Promise<CreateResponse> {
  return postJson(request, "/api/v1/customers", payload(name), key, extraHeaders, timeout);
}

async function postJson(
  request: APIRequestContext,
  path: string,
  data: unknown,
  key: string,
  extraHeaders: Record<string, string> = {},
  timeout?: number,
): Promise<CreateResponse> {
  const response = await request.fetch(path, {
    method: "POST",
    headers: {
      origin,
      "idempotency-key": key,
      ...extraHeaders,
    },
    data,
    ...(timeout ? { timeout } : {}),
  });
  const text = await response.text();
  let body: Json = {};
  try {
    body = JSON.parse(text) as Json;
  } catch {
    body = { raw: text };
  }
  return {
    status: response.status(),
    body,
    replayed: response.headers()["idempotent-replayed"] === "true",
  };
}

async function settleJson(
  request: APIRequestContext,
  path: string,
  data: unknown,
  key: string,
) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await postJson(request, path, data, key);
    if (response.status >= 200 && response.status < 300) return response;
    if (response.status === 409 && response.body?.error?.code === "IDEMPOTENCY_IN_PROGRESS") {
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    throw new Error(`Unexpected create response ${response.status}: ${JSON.stringify(response.body)}`);
  }
  throw new Error("Create stayed in progress for too long");
}

async function settleCreate(request: APIRequestContext, name: string, key: string) {
  return settleJson(request, "/api/v1/customers", payload(name), key);
}

async function fillCustomerForm(page: import("@playwright/test").Page, name: string) {
  await page.goto("/customers/new");
  await page.locator('input[name="legalName"]').waitFor();
  await page.locator('input[name="legalName"]').fill(name);
  await page.locator('input[name="countryCode"]').fill("EG");
  await page.locator('input[name="contactName"]').fill("Double Click");
  await page.locator('input[name="line1"]').fill("1 Click Street");
  await page.locator('input[name="city"]').fill("Cairo");
}

test("DUP-A rapid double click creates exactly one customer", async ({ page }) => {
  const name = `Dup A ${stamp}`;
  await fillCustomerForm(page, name);
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/v1/customers")) posts += 1;
  });

  await page
    .getByRole("button", { name: "Save customer" })
    .evaluate((element) => {
      (element as HTMLButtonElement).click();
      (element as HTMLButtonElement).click();
    });

  await page.waitForURL("**/customers");
  await expectCount(name, 1);
  expect(posts).toBe(1);
});

test("DUP-B repeated click during a slow response creates exactly one customer", async ({ page }) => {
  const name = `Dup B ${stamp}`;
  await fillCustomerForm(page, name);
  let posts = 0;
  await page.route("**/api/v1/customers", async (route) => {
    if (route.request().method() === "POST") {
      posts += 1;
      await new Promise((resolve) => setTimeout(resolve, 1_200));
    }
    await route.continue();
  });

  try {
    await page
      .getByRole("button", { name: "Save customer" })
      .evaluate((element) => {
        (element as HTMLButtonElement).click();
        (element as HTMLButtonElement).click();
      });
    await page.waitForURL("**/customers");
    await expectCount(name, 1);
    expect(posts).toBe(1);
  } finally {
    await page.unroute("**/api/v1/customers");
  }
});

test("DUP-C fifteen concurrent requests with one key create one row", async ({ page }) => {
  const name = `Dup C ${stamp}`;
  const key = randomUUID();
  const firstWave = await Promise.all(
    Array.from({ length: 15 }, () => createCustomerRequest(page.request, name, key)),
  );

  const ids = new Set<string>();
  const pending = [] as CreateResponse[];
  for (const response of firstWave) {
    if (response.status === 201) {
      ids.add(String(response.body.data.id));
    } else if (response.status === 409 && response.body?.error?.code === "IDEMPOTENCY_IN_PROGRESS") {
      pending.push(response);
    } else {
      throw new Error(`Unexpected concurrent response ${response.status}: ${JSON.stringify(response.body)}`);
    }
  }

  for (let index = 0; index < pending.length; index += 1) {
    const settled = await settleCreate(page.request, name, key);
    ids.add(String(settled.body.data.id));
  }

  expect(ids.size).toBe(1);
  await expectCount(name, 1);
  const rows = idempotencyRows(key);
  expect(rows).toHaveLength(1);
  expect(rows[0].state).toBe("COMPLETED");
});

test("DUP-D a response lost after commit replays the original record", async ({ page }) => {
  const name = `Dup D ${stamp}`;
  const key = randomUUID();
  let timedOut = false;
  try {
    await createCustomerRequest(
      page.request,
      name,
      key,
      { "x-test-delay-after-commit-ms": "4000" },
      1_000,
    );
  } catch {
    timedOut = true;
  }
  expect(timedOut).toBe(true);
  await expectCount(name, 1);

  const originalId = customerId(name);
  const retry = await settleCreate(page.request, name, key);
  expect(retry.status).toBe(201);
  expect(retry.replayed).toBe(true);
  expect(String(retry.body.data.id)).toBe(originalId);
  await expectCount(name, 1);
});

test("DUP-E two tabs: one key is one row, two keys are two intentional rows", async ({ browser }) => {
  const first = await browser.newContext({ storageState });
  const second = await browser.newContext({ storageState });
  try {
    const name = `Dup E ${stamp}`;
    const key = randomUUID();
    const [a, b] = await Promise.all([
      createCustomerRequest(first.request, name, key),
      createCustomerRequest(second.request, name, key),
    ]);
    const ids = new Set<string>();
    for (const response of [a, b]) {
      if (response.status === 201) ids.add(String(response.body.data.id));
    }
    if (!ids.size) {
      const settled = await settleCreate(first.request, name, key);
      ids.add(String(settled.body.data.id));
    }
    expect(ids.size).toBe(1);
    await expectCount(name, 1);

    const intentionalName = `Dup E2 ${stamp}`;
    const [one, two] = await Promise.all([
      settleCreate(first.request, intentionalName, randomUUID()),
      settleCreate(second.request, intentionalName, randomUUID()),
    ]);
    expect(String(one.body.data.id)).not.toBe(String(two.body.data.id));
    await expectCount(intentionalName, 2);
  } finally {
    await first.close();
    await second.close();
  }
});

test("DUP-F reusing a key for a different payload is rejected", async ({ page }) => {
  const nameA = `Dup F A ${stamp}`;
  const nameB = `Dup F B ${stamp}`;
  const key = randomUUID();
  const first = await settleCreate(page.request, nameA, key);
  expect(first.status).toBe(201);

  const second = await createCustomerRequest(page.request, nameB, key);
  expect(second.status).toBe(422);
  expect(second.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  await expectCount(nameA, 1);
  await expectCount(nameB, 0);
});

test("DUP-G a transient pre-handler failure leaves no row and recovers on the same key", async ({ page }) => {
  const name = `Dup G ${stamp}`;
  const key = randomUUID();
  const failed = await createCustomerRequest(page.request, name, key, {
    "x-test-fail-before-handler": "1",
  });
  expect(failed.status).toBe(500);
  await expectCount(name, 0);
  expect(idempotencyRows(key)).toHaveLength(0);

  const retried = await settleCreate(page.request, name, key);
  expect(retried.status).toBe(201);
  await expectCount(name, 1);
  expect(idempotencyRows(key)[0]?.state).toBe("COMPLETED");
});

test("DUP-H two different keys with identical data create two intentional rows", async ({ page }) => {
  const name = `Dup H ${stamp}`;
  const [one, two] = await Promise.all([
    settleCreate(page.request, name, randomUUID()),
    settleCreate(page.request, name, randomUUID()),
  ]);
  expect(one.status).toBe(201);
  expect(two.status).toBe(201);
  expect(String(one.body.data.id)).not.toBe(String(two.body.data.id));
  await expectCount(name, 2);
});

test("DUP-I concurrent case creation writes one case and one invoice", async ({ page }) => {
  const customer = await settleCreate(page.request, `Dup I ${stamp}`, randomUUID());
  const customerId = String(customer.body.data.id);
  const invoiceNumber = `INV-DUP-${stamp}`;
  const key = randomUUID();
  const casePayload = {
    customerId,
    documentRoute: "DIRECT_ROUTE",
    destinationCountry: "NL",
    invoice: {
      invoiceNumber,
      invoiceDate: "2026-10-20",
      paymentTermCode: "TT",
      incoterm: "FOB",
      namedPlace: "Alexandria",
      currency: "USD",
      goodsValue: "100.00",
      invoicedFreight: "0.00",
      actualFreightExpense: "0.00",
      invoiceTotal: "100.00",
      portOfLoading: "Alexandria",
      portOfDischarge: "Rotterdam",
      grossWeight: 10,
      netWeight: 9,
      weightUnit: "KG",
    },
  };
  const wave = await Promise.all(
    Array.from({ length: 10 }, () => postJson(page.request, "/api/v1/export-cases", casePayload, key)),
  );
  const ids = new Set<string>();
  let pending = 0;
  for (const response of wave) {
    if (response.status === 201) ids.add(String(response.body.data.id));
    else if (response.status === 409 && response.body?.error?.code === "IDEMPOTENCY_IN_PROGRESS") pending += 1;
    else throw new Error(`Unexpected case response ${response.status}: ${JSON.stringify(response.body)}`);
  }
  for (let index = 0; index < pending; index += 1) {
    const settled = await settleJson(page.request, "/api/v1/export-cases", casePayload, key);
    ids.add(String(settled.body.data.id));
  }
  expect(ids.size).toBe(1);

  const cases = wranglerRows<{ n: number }>(persist, `SELECT COUNT(*) AS n FROM export_cases WHERE customer_id = '${sqlString(customerId)}'`);
  const invoices = wranglerRows<{ n: number }>(persist, `SELECT COUNT(*) AS n FROM export_invoices WHERE invoice_number = '${sqlString(invoiceNumber)}'`);
  expect(Number(cases[0]?.n ?? 0)).toBe(1);
  expect(Number(invoices[0]?.n ?? 0)).toBe(1);
});

test("DUP-J concurrent booking creation writes one booking and five slots", async ({ page }) => {
  const customer = await settleCreate(page.request, `Dup J ${stamp}`, randomUUID());
  const customerId = String(customer.body.data.id);
  const caseNumber = `INV-DUP-J-${stamp}`;
  const casePayload = {
    customerId,
    documentRoute: "BANK_ROUTE",
    destinationCountry: "NL",
    invoice: {
      invoiceNumber: caseNumber,
      invoiceDate: "2026-10-20",
      paymentTermCode: "TT",
      incoterm: "FOB",
      namedPlace: "Alexandria",
      currency: "USD",
      goodsValue: "200.00",
      invoicedFreight: "0.00",
      actualFreightExpense: "0.00",
      invoiceTotal: "200.00",
      portOfLoading: "Alexandria",
      portOfDischarge: "Rotterdam",
      grossWeight: 20,
      netWeight: 19,
      weightUnit: "KG",
    },
  };
  const createdCase = await settleJson(page.request, "/api/v1/export-cases", casePayload, randomUUID());
  const caseId = String(createdCase.body.data.id);
  const bookingNumber = `BK-DUP-${stamp}`;
  const key = randomUUID();
  const bookingPayload = {
    caseId,
    bookingNumber,
    shippingLine: "MSC",
    expectedContainers: 5,
    plannedEtd: "2026-11-02",
    plannedEta: "2026-11-20",
  };
  const wave = await Promise.all(
    Array.from({ length: 10 }, () => postJson(page.request, "/api/v1/bookings", bookingPayload, key)),
  );
  const ids = new Set<string>();
  let pending = 0;
  for (const response of wave) {
    if (response.status === 201) ids.add(String(response.body.data.id));
    else if (response.status === 409 && response.body?.error?.code === "IDEMPOTENCY_IN_PROGRESS") pending += 1;
    else throw new Error(`Unexpected booking response ${response.status}: ${JSON.stringify(response.body)}`);
  }
  for (let index = 0; index < pending; index += 1) {
    const settled = await settleJson(page.request, "/api/v1/bookings", bookingPayload, key);
    ids.add(String(settled.body.data.id));
  }
  expect(ids.size).toBe(1);
  const bookingId = [...ids][0];
  const bookings = wranglerRows<{ n: number }>(persist, `SELECT COUNT(*) AS n FROM bookings WHERE booking_number = '${sqlString(bookingNumber)}'`);
  const containers = wranglerRows<{ n: number }>(persist, `SELECT COUNT(*) AS n FROM containers WHERE booking_id = '${sqlString(bookingId)}'`);
  expect(Number(bookings[0]?.n ?? 0)).toBe(1);
  expect(Number(containers[0]?.n ?? 0)).toBe(5);
});

test("DUP-K concurrent customer import commit inserts each row once", async ({ page }) => {
  const name = `Dup K ${stamp}`;
  const key = randomUUID();
  const importPayload = {
    rows: [{ legal_name: name, country_code: "EG" }],
  };
  const wave = await Promise.all(
    Array.from({ length: 10 }, () =>
      postJson(page.request, "/api/v1/imports/customers/commit", importPayload, key),
    ),
  );
  let pending = 0;
  for (const response of wave) {
    if (response.status >= 200 && response.status < 300) continue;
    if (response.status === 409 && response.body?.error?.code === "IDEMPOTENCY_IN_PROGRESS") pending += 1;
    else throw new Error(`Unexpected import response ${response.status}: ${JSON.stringify(response.body)}`);
  }
  for (let index = 0; index < pending; index += 1) {
    await settleJson(page.request, "/api/v1/imports/customers/commit", importPayload, key);
  }
  await expectCount(name, 1);
});
