import { expect, test } from "@playwright/test";
import { patchReminderRule, wranglerSql } from "./helpers";

const origin = "http://127.0.0.1:43174";
const headers = { origin };

test("completed operation locks ordinary invoice edits and records a privileged correction", async ({ page, browser }) => {
  const stamp = Date.now().toString().slice(-6);
  const customer = await page.request.post("/api/v1/customers", {
    data: { legalName: `Lock ${stamp}`, countryCode: "EG", contacts: [{ fullName: "Nada", phone: "+201111111111" }] },
    headers,
  });
  expect(customer.ok()).toBeTruthy();
  const customerId = (await customer.json()).data.id as string;
  const created = await page.request.post("/api/v1/export-cases", {
    data: {
      customerId,
      documentRoute: "DIRECT_ROUTE",
      invoice: {
        invoiceNumber: `INV-LOCK-${stamp}`,
        invoiceDate: "2026-10-12",
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
      },
    },
    headers,
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const caseId = (await created.json()).data.id as string;
  const overview = await (await page.request.get(`/api/v1/export-cases/${caseId}`)).json();
  const invoice = overview.data.invoices[0] as { id: string; version: number };
  const body = {
    version: invoice.version,
    invoiceNumber: `INV-LOCK-${stamp}`,
    invoiceDate: "2026-10-12",
    paymentTermCode: "TT",
    incoterm: "FOB",
    currency: "USD",
    goodsValue: "100.00",
    invoicedFreight: "0",
    actualFreightExpense: "0",
    invoiceTotal: "120.00",
    grossWeight: 2,
    netWeight: 1,
    weightUnit: "KG",
  };
  const openEdit = await page.request.put(`/api/v1/invoices/${invoice.id}`, { data: { ...body, invoiceTotal: "100.00" }, headers });
  expect(openEdit.ok(), await openEdit.text()).toBeTruthy();

  wranglerSql(".wrangler-e2e/state", `UPDATE export_cases SET status = 'COMPLETED' WHERE id = '${caseId}'`);
  const email = `ops.${stamp}@example.com`;
  const password = "Manager-pass-12";
  const user = await page.request.post("/api/v1/users", {
    data: { name: "Ops", email, password, roleKeys: ["operations_manager"] },
    headers,
  });
  expect(user.ok(), await user.text()).toBeTruthy();
  const context = await browser.newContext();
  const signedIn = await context.request.post("/api/auth/sign-in/email", { data: { email, password }, headers });
  expect(signedIn.ok(), await signedIn.text()).toBeTruthy();
  const denied = await context.request.put(`/api/v1/invoices/${invoice.id}`, { data: { ...body, version: 2 }, headers });
  expect(denied.status()).toBe(409);
  const deniedBody = await denied.json();
  expect(deniedBody.error.code).toBe("INVOICE_LOCKED");
  expect(JSON.stringify(deniedBody)).not.toContain("SQLITE");

  const blank = await page.request.post(`/api/v1/invoices/${invoice.id}/corrections`, { data: { ...body, version: 2, reason: "  " }, headers });
  expect(blank.status()).toBe(422);
  expect(await blank.text()).toContain("INVOICE_CORRECTION_REASON");
  const none = await (await page.request.get(`/api/v1/invoices/${invoice.id}/revisions`)).json();
  expect(none.data).toEqual([]);

  const managerFix = await context.request.post(`/api/v1/invoices/${invoice.id}/corrections`, {
    data: { ...body, version: 2, reason: "Manager must not correct." },
    headers,
  });
  expect(managerFix.status()).toBe(403);
  expect(await managerFix.text()).toContain("USER_NOT_AUTHORIZED");

  const fieldKey = `note_${stamp}`;
  const field = await page.request.post("/api/v1/custom-fields", {
    data: { targetEntity: "INVOICE", fieldKey, labelEn: "Desk note", labelAr: "ملاحظة المكتب", dataType: "TEXT" },
    headers,
  });
  expect(field.ok(), await field.text()).toBeTruthy();
  const lockedFields = await page.request.put(`/api/v1/invoices/${invoice.id}/custom-fields`, {
    data: { [fieldKey]: "ordinary" },
    headers,
  });
  expect(lockedFields.status()).toBe(409);
  expect(await lockedFields.text()).toContain("INVOICE_LOCKED");

  // A reused Vite proxy socket can reset with HTML "fetch failed" (ECONNRESET) after the
  // bootstrap race. A new context opens a fresh connection. The failed attempt does not commit.
  const fresh = await browser.newContext({ storageState: ".wrangler-e2e/admin-state.json" });
  const corrected = await fresh.request.post(`/api/v1/invoices/${invoice.id}/corrections`, {
    data: { ...body, version: 2, reason: "Commercial total was recorded short.", customFields: { [fieldKey]: "corrected note" } },
    headers,
  });
  expect(corrected.ok(), await corrected.text()).toBeTruthy();
  const history = await (await page.request.get(`/api/v1/invoices/${invoice.id}/revisions`)).json();
  expect(history.data).toHaveLength(1);
  expect(history.data[0].reason).toBe("Commercial total was recorded short.");
  expect(history.data[0].after_json).toContain("corrected note");
  const storedFields = await (await page.request.get(`/api/v1/invoices/${invoice.id}/custom-fields`)).json();
  expect((storedFields.data as Array<{ key: string; value: string | null }>).find((row) => row.key === fieldKey)?.value).toBe("corrected note");

  const raced = await Promise.all([
    page.request.post(`/api/v1/invoices/${invoice.id}/corrections`, {
      data: { ...body, version: 3, invoiceTotal: "130.00", reason: "First concurrent correction." },
      headers,
    }),
    page.request.post(`/api/v1/invoices/${invoice.id}/corrections`, {
      data: { ...body, version: 3, invoiceTotal: "140.00", reason: "Second concurrent correction." },
      headers,
    }),
  ]);
  expect(raced.filter((response) => response.ok()).length).toBe(1);
  expect(raced.filter((response) => response.status() === 409).length).toBe(1);
  const afterRace = await (await page.request.get(`/api/v1/invoices/${invoice.id}/revisions`)).json();
  expect(afterRace.data).toHaveLength(2);

  const beforeFault = await (await page.request.get(`/api/v1/export-cases/${caseId}`)).json();
  const totalBeforeFault = beforeFault.data.invoices[0].invoice_total_minor;
  const versionBeforeFault = beforeFault.data.invoices[0].version;
  const fault = await page.request.post(`/api/v1/invoices/${invoice.id}/corrections`, {
    data: {
      ...body,
      version: versionBeforeFault,
      invoiceTotal: "150.00",
      reason: "This correction must roll back.",
      customFields: { [fieldKey]: "should not stick" },
      testFault: "constraint",
    },
    headers,
  });
  expect(fault.ok()).toBeFalsy();
  const afterFault = await (await page.request.get(`/api/v1/export-cases/${caseId}`)).json();
  expect(afterFault.data.invoices[0].invoice_total_minor).toBe(totalBeforeFault);
  expect(afterFault.data.invoices[0].version).toBe(versionBeforeFault);
  const fieldsAfterFault = await (await page.request.get(`/api/v1/invoices/${invoice.id}/custom-fields`)).json();
  expect((fieldsAfterFault.data as Array<{ key: string; value: string | null }>).find((row) => row.key === fieldKey)?.value).toBe("corrected note");
  const historyAfterFault = await (await page.request.get(`/api/v1/invoices/${invoice.id}/revisions`)).json();
  expect(historyAfterFault.data).toHaveLength(2);
  await fresh.close();
  await context.close();
});

test("reminder repeat interval persists and a manager without the permission cannot edit it", async ({ page, browser }) => {
  const saved = await patchReminderRule(page.request, "rr-courier", { repeatEveryDays: 4, repeatCap: 2 }, headers);
  expect(saved.ok(), await saved.text()).toBeTruthy();
  const rules = await (await page.request.get("/api/v1/reminder-rules")).json();
  const rule = (rules.data as Array<{ id: string; repeat_every_days: number }>).find((row) => row.id === "rr-courier");
  expect(rule?.repeat_every_days).toBe(4);
  const email = `norule.${Date.now().toString().slice(-6)}@example.com`;
  const password = "Manager-pass-12";
  expect((await page.request.post("/api/v1/users", { data: { name: "Ops", email, password, roleKeys: ["operations_manager"] }, headers })).ok()).toBeTruthy();
  const context = await browser.newContext();
  expect((await context.request.post("/api/auth/sign-in/email", { data: { email, password }, headers })).ok()).toBeTruthy();
  const denied = await context.request.patch("/api/v1/reminder-rules/rr-courier", { data: { repeatEveryDays: 9 }, headers });
  expect(denied.status()).toBe(403);
  await patchReminderRule(page.request, "rr-courier", { repeatEveryDays: null, repeatCap: null }, headers);
  await context.close();
});
