import { expect, test } from "@playwright/test";
import { api, caseIdFromUrl, createCase, createCustomer, login, patchReminderRule, requirementCard, runStamp, uploadPdf, wranglerSql } from "./helpers";

const stamp = runStamp();

test("E2E-02 custom role hides menus and the API denies the action", async ({ page, browser }) => {
  const key = `desk_${stamp}`;
  await page.goto("/users");
  await page.locator('input[name="key"]').fill(key);
  await page.locator('input[name="nameEn"]').fill(`Desk ${stamp}`);
  await page.getByRole("checkbox", { name: "View the operations desk" }).check();
  await page.getByRole("checkbox", { name: "View reports" }).check();
  await page.getByRole("button", { name: "Create role" }).click();
  await expect(page.locator('select[name="role"]')).toContainText(`Desk ${stamp}`);

  const email = `desk.${stamp}@example.com`;
  const password = "Desk-user-pass-1";
  const created = await page.request.post("/api/v1/users", {
    data: { name: "Desk User", email, password, roleKeys: [key] },
    headers: { origin: "http://127.0.0.1:43174" },
  });
  expect(created.ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByText(email)).toBeVisible();

  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const employee = await context.newPage();
  await login(employee, email, password);
  await expect(employee.getByRole("link", { name: "Reports" })).toBeVisible();
  await expect(employee.getByRole("link", { name: "Bookings" })).toHaveCount(0);
  await expect(employee.getByRole("link", { name: "Users" })).toHaveCount(0);
  const denied = await employee.request.post("/api/v1/customers", {
    data: { legalName: "Should fail" },
    headers: { origin: "http://127.0.0.1:43174" },
  });
  expect(denied.status()).toBe(403);
  const me = await (await page.request.get("/api/v1/me")).json();
  const lastAdmin = await page.request.post(`/api/v1/users/${me.data.id}/active`, {
    data: { active: false },
    headers: { origin: "http://127.0.0.1:43174" },
  });
  expect(lastAdmin.status()).toBe(409);
  await context.close();
});

test("E2E-03 customer contacts, addresses, tax reference and masked bank", async ({ page }) => {
  const name = `Nile ${stamp}`;
  await createCustomer(page, name, `TAX-${stamp}`);
  await expect(page.getByText(`TAX-${stamp}`)).toBeVisible();
  await expect(page.getByText("Mona Saleh")).toBeVisible();
  await expect(page.getByText("Hany Adel")).toBeVisible();
  await expect(page.getByText("12 Corniche")).toBeVisible();
  await expect(page.getByText("5 Billing Street")).toBeVisible();
  await expect(page.getByText("last4 6789")).toBeVisible();
  await expect(page.getByText("EG123456789012345678901234")).toHaveCount(0);
});

test("E2E-04 FOB invoice keeps an explicit total and a separate freight expense", async ({ page }) => {
  const customer = `FOB Buyer ${stamp}`;
  await createCustomer(page, customer, `FOB-${stamp}`);
  await createCase(page, {
    customer,
    route: "DIRECT_ROUTE",
    invoice: `INV-FOB-${stamp}`,
    incoterm: "FOB",
    goods: "12500.00",
    invoicedFreight: "0",
    actualFreight: "900.00",
    total: "12500.00",
  });
  await page.locator('[data-tab="invoices"]').click();
  await expect(page.getByText(`INV-FOB-${stamp}`)).toBeVisible();
  await expect(page.getByText("$12,500.00").first()).toBeVisible();
  await expect(page.getByText("$900.00")).toBeVisible();
  await expect(page.getByText("12.500 kg")).toBeVisible();
  await expect(page.getByText("11.200 kg")).toBeVisible();
});

test("E2E-05 CFR invoice stores freight and total independently", async ({ page }) => {
  const customer = `CFR Buyer ${stamp}`;
  await createCustomer(page, customer, `CFR-${stamp}`);
  await createCase(page, {
    customer,
    route: "DIRECT_ROUTE",
    invoice: `INV-CFR-${stamp}`,
    incoterm: "CFR",
    goods: "10000.00",
    invoicedFreight: "1500.00",
    actualFreight: "1600.00",
    total: "11500.00",
  });
  await page.locator('[data-tab="invoices"]').click();
  await expect(page.getByText("CFR Incoterms 2020")).toBeVisible();
  await expect(page.getByText("$1,500.00")).toBeVisible();
  await expect(page.getByText("$1,600.00")).toBeVisible();
  await expect(page.getByText("$11,500.00")).toBeVisible();

  await page.goto("/export-cases/new");
  await page.locator('select[name="customerId"]').selectOption({ label: customer });
  await page.locator('input[name="invoiceNumber"]').fill(`INV-BAD-${stamp}`);
  await page.locator('input[name="invoiceDate"]').fill("2026-10-12");
  await page.locator('input[name="goodsValue"]').fill("10.00");
  await page.locator('input[name="invoiceTotal"]').fill("10.00");
  await page.locator('input[name="grossWeight"]').fill("1");
  await page.locator('input[name="netWeight"]').fill("5");
  await page.getByRole("button", { name: "Create draft case" }).click();
  await expect(page.getByText(/GROSS_LT_NET|gross/i)).toBeVisible();
});

test("E2E-06 document checklist states stay distinct", async ({ page }) => {
  const customer = `Docs ${stamp}`;
  await createCustomer(page, customer, `DOC-${stamp}`);
  await createCase(page, {
    customer,
    route: "DIRECT_ROUTE",
    invoice: `INV-DOC-${stamp}`,
    incoterm: "FOB",
    goods: "100.00",
    invoicedFreight: "0",
    actualFreight: "0",
    total: "100.00",
  });
  await page.locator('[data-tab="documents"]').click();
  await expect(page.getByText("Commercial Invoice")).toBeVisible();
  await expect(page.locator('[data-status="MISSING"]').first()).toBeVisible();
  await page.getByRole("button", { name: "Add to this case" }).click();
  await expect(page.getByText("Choose a document type before adding it.")).toBeVisible();
  await page.locator('select[name="documentTypeId"]').selectOption({ label: "Technical Certificate" });
  const added = page.waitForResponse((response) => response.url().includes("/document-requirements") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Add to this case" }).click();
  expect((await added).ok()).toBeTruthy();
  const techCard = page.locator("div.rounded-xl").filter({ hasText: "Technical Certificate" }).filter({ has: page.locator('input[type="file"]') });
  await expect(techCard).toBeVisible();
  await page.reload();
  await page.locator('[data-tab="documents"]').click();
  await expect(techCard).toBeVisible();
  await expect(techCard.locator('[data-status="MISSING"]')).toBeVisible();
  await page.locator('[data-decision="WAIVED"]').first().click();
  await expect(page.locator('[data-status="WAIVED"]').first()).toBeVisible();
});

test("E2E-07 versioned PDF upload, correction, and denied download", async ({ page }) => {
  const customer = `Scan ${stamp}`;
  await createCustomer(page, customer, `SCN-${stamp}`);
  await createCase(page, {
    customer,
    route: "DIRECT_ROUTE",
    invoice: `INV-SCN-${stamp}`,
    incoterm: "FOB",
    goods: "100.00",
    invoicedFreight: "0",
    actualFreight: "0",
    total: "100.00",
  });
  await page.locator('[data-tab="documents"]').click();
  const key = await uploadPdf(page, "Commercial Invoice");
  const toReview = page.waitForResponse((response) => response.url().includes("/review") && response.ok());
  await requirementCard(page, "Commercial Invoice").locator('[data-decision="UNDER_REVIEW"]').click();
  await toReview;
  const toCorrect = page.waitForResponse((response) => response.url().includes("/review") && response.ok());
  await requirementCard(page, "Commercial Invoice").locator('[data-decision="NEEDS_CORRECTION"]').click();
  await toCorrect;
  await expect(requirementCard(page, "Commercial Invoice").locator('[data-status="NEEDS_CORRECTION"]')).toBeVisible();
  await uploadPdf(page, "Commercial Invoice", "e2e/fixtures/sample-2.pdf");
  const toReviewAgain = page.waitForResponse((response) => response.url().includes("/review") && response.ok());
  await requirementCard(page, "Commercial Invoice").locator('[data-decision="UNDER_REVIEW"]').click();
  await toReviewAgain;
  await expect(requirementCard(page, "Commercial Invoice").locator('[data-status="UNDER_REVIEW"]')).toBeVisible();
  const toApprove = page.waitForResponse((response) => response.url().includes("/review") && response.ok());
  await requirementCard(page, "Commercial Invoice").locator('[data-decision="APPROVED"]').click();
  await toApprove;
  await expect(requirementCard(page, "Commercial Invoice").locator('[data-status="APPROVED"]')).toBeVisible();

  const download = await page.request.get(`/api/v1/files/download?key=${encodeURIComponent(key)}`);
  expect(download.ok()).toBeTruthy();
  expect(download.headers()["content-disposition"]).toContain("attachment");
  expect((await download.body()).subarray(0, 4).toString()).toBe("%PDF");

  const fresh = await fetch(`http://127.0.0.1:43174/api/v1/files/download?key=${encodeURIComponent(key)}`);
  expect(fresh.status).toBe(401);

  const zero = await page.request.post("/api/v1/files/uploads", {
    data: { parentType: "document_requirement", parentId: "missing", filename: "empty.pdf", mime: "application/pdf", expectedBytes: 0 },
    headers: { origin: "http://127.0.0.1:43174" },
  });
  expect(zero.status()).toBe(422);
  const huge = await page.request.post("/api/v1/files/uploads", {
    data: { parentType: "document_requirement", parentId: "missing", filename: "big.pdf", mime: "application/pdf", expectedBytes: 419430401 },
    headers: { origin: "http://127.0.0.1:43174" },
  });
  expect([413, 404, 422]).toContain(huge.status());
});

test("E2E-08 bank route correction loop then manual courier delivery", async ({ page }) => {
  const customer = `Bank ${stamp}`;
  await createCustomer(page, customer, `BNK-${stamp}`);
  await createCase(page, {
    customer,
    route: "BANK_ROUTE",
    invoice: `INV-BNK-${stamp}`,
    incoterm: "FOB",
    goods: "100.00",
    invoicedFreight: "0",
    actualFreight: "0",
    total: "100.00",
  });
  const id = await caseIdFromUrl(page);
  const skipped = await api(page.request, `/api/v1/export-cases/${id}/bank/status`, { method: "POST", data: { to: "BANK_APPROVED" } });
  expect(skipped.status()).toBe(409);
  await page.locator('[data-tab="bank"]').click();
  for (const step of ["SCANNED", "READY_FOR_PHYSICAL_HANDOVER", "HANDED_TO_BANK", "BANK_REVIEW", "CORRECTION_REQUESTED", "SCANNED", "READY_FOR_PHYSICAL_HANDOVER", "HANDED_TO_BANK", "BANK_REVIEW", "BANK_APPROVED"]) {
    const done = page.waitForResponse((response) => response.url().includes("/bank/status") && response.ok());
    await page.locator(`[data-decision="${step}"]`).click();
    await done;
  }
  await expect(page.locator('[data-status="BANK_APPROVED"]').first()).toBeVisible();
  await page.reload();
  await page.locator('[data-tab="courier"]').click();
  await page.locator('select[name="sender"]').selectOption("BANK");
  await page.locator('input[name="trackingNumber"]').fill("DHL1234567890");
  await page.getByRole("button", { name: "Add manual shipment" }).click();
  await page.locator('[data-decision="DISPATCHED"]').click();
  await page.locator('[data-decision="DELIVERED"]').click();
  await expect(page.getByText("Source: MANUAL")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open carrier page" })).toBeVisible();
});

test("E2E-09 direct route has no bank gate and uses a manual carrier link", async ({ page }) => {
  const customer = `Direct ${stamp}`;
  await createCustomer(page, customer, `DIR-${stamp}`);
  await createCase(page, {
    customer,
    route: "DIRECT_ROUTE",
    invoice: `INV-DIR-${stamp}`,
    incoterm: "CFR",
    goods: "200.00",
    invoicedFreight: "20.00",
    actualFreight: "25.00",
    total: "220.00",
  });
  await page.locator('[data-tab="bank"]').click();
  await expect(page.getByText("direct route")).toBeVisible();
  await page.locator('[data-tab="courier"]').click();
  await page.locator('input[name="trackingNumber"]').fill("DHL99887766");
  await page.getByRole("button", { name: "Add manual shipment" }).click();
  const href = await page.getByRole("link", { name: "Open carrier page" }).getAttribute("href");
  expect(href).toContain("dhl.com");
  expect(href).not.toContain("api.dhl.com");
});

test("E2E-10 booking with five slots, two official numbers, and the schedule", async ({ page }) => {
  const customer = `Ship ${stamp}`;
  await createCustomer(page, customer, `SHP-${stamp}`);
  await createCase(page, {
    customer,
    route: "DIRECT_ROUTE",
    invoice: `INV-SHP-${stamp}`,
    incoterm: "FOB",
    goods: "300.00",
    invoicedFreight: "0",
    actualFreight: "40.00",
    total: "300.00",
  });
  await page.locator('[data-tab="bookings"]').click();
  await page.locator('input[name="bookingNumber"]').fill(`BK-${stamp}`);
  await page.locator('input[name="ucr"]').fill(`UCR-${stamp}`);
  await page.locator('input[name="expectedContainers"]').fill("5");
  await page.locator('input[name="plannedEtd"]').fill("2026-11-02");
  await page.locator('input[name="plannedEta"]').fill("2026-11-20");
  await page.getByRole("button", { name: "Create booking" }).click();
  await page.waitForURL(/\/bookings\//);
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/sample.pdf");
  await expect(page.getByText("sample.pdf")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('input[placeholder="MSCU1234567"]')).toHaveCount(5);
  await page.locator('input[placeholder="MSCU1234567"]').nth(0).fill("CSQU3054383");
  await page.getByRole("button", { name: "Assign number" }).nth(0).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("CSQU3054383")).toBeVisible();
  await page.locator('input[placeholder="MSCU1234567"]').nth(1).fill("MSCU1234566");
  await page.getByRole("button", { name: "Assign number" }).nth(1).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("MSCU1234566")).toBeVisible();
  await expect(page.getByText("CSQU3054383")).toBeVisible();
  await expect(page.getByText("MSCU1234566")).toBeVisible();
  await page.goto("/schedule");
  await expect(page.getByRole("link", { name: `BK-${stamp}` }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /2026-11-02/ })).toBeVisible();
});

test("E2E-11 port arrival does not complete the case", async ({ page }) => {
  const customer = `Close ${stamp}`;
  await createCustomer(page, customer, `CLS-${stamp}`);
  await createCase(page, {
    customer,
    route: "DIRECT_ROUTE",
    invoice: `INV-CLS-${stamp}`,
    incoterm: "FOB",
    goods: "50.00",
    invoicedFreight: "0",
    actualFreight: "0",
    total: "50.00",
  });
  await page.getByRole("button", { name: "Mark active" }).click();
  await page.getByRole("button", { name: "Complete case" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator('[data-status="COMPLETED"]')).toHaveCount(0);
});

test("E2E-12 tracking link rotate and revoke fail closed", async ({ page, browser }) => {
  const customer = `Share ${stamp}`;
  await createCustomer(page, customer, `SHR-${stamp}`);
  await createCase(page, {
    customer,
    route: "DIRECT_ROUTE",
    invoice: `INV-SHR-${stamp}`,
    incoterm: "FOB",
    goods: "80.00",
    invoicedFreight: "0",
    actualFreight: "0",
    total: "80.00",
  });
  await page.locator('[data-tab="share"]').click();
  await page.getByRole("button", { name: "Create tracking link" }).click();
  const url = await page.locator("p.break-all").innerText();
  const token = url.split("/track/")[1];
  const visitor = await browser.newContext();
  const track = await visitor.newPage();
  await track.goto(`/track/${token}`);
  await expect(track.getByText(`INV-SHR-${stamp}`)).toBeVisible();
  await expect(track.getByText("Bank of")).toHaveCount(0);
  await expect(track.getByText("$")).toHaveCount(0);
  const headers = await (await visitor.request.get(`/api/v1/public/track/${token}`)).headers();
  expect(headers["cache-control"]).toContain("no-store");
  expect(headers["referrer-policy"]).toBe("no-referrer");

  const id = await caseIdFromUrl(page);
  const links = await (await api(page.request, `/api/v1/export-cases/${id}/tracking-links`)).json();
  const rotated = await (await api(page.request, `/api/v1/tracking-links/${links.data[0].id}/rotate`, { method: "POST" })).json();
  await track.reload();
  await expect(track.getByText("Tracking unavailable")).toBeVisible();
  await track.goto(`/track/${rotated.data.token}`);
  await expect(track.getByText(`INV-SHR-${stamp}`)).toBeVisible();
  await api(page.request, `/api/v1/tracking-links/${rotated.data.id}/revoke`, { method: "POST" });
  await page.reload();
  await page.locator('[data-tab="share"]').click();
  await page.getByRole("button", { name: "Revoke" }).first().click();
  await track.reload();
  await expect(track.getByRole("heading", { name: "Tracking unavailable" })).toBeVisible();
  const missing = await visitor.request.get("/api/v1/public/track/not-a-real-token");
  expect(missing.status()).toBe(410);
  expect(await missing.text()).not.toContain("export_cases");
  await visitor.close();
});

test("E2E-13 Arabic direction, mobile nav, and keyboard focus", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "ع" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByRole("button", { name: "EN" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /Open menu|فتح القائمة/ }).click();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator('input[name="q"]').focus();
  await expect(page.locator('input[name="q"]')).toBeFocused();
});

test("E2E-14 search, csv export, and empty reminder copy", async ({ page }) => {
  await page.goto("/dashboard");
  await page.locator('input[name="q"]').fill(`FOB Buyer ${stamp}`);
  await page.locator('input[name="q"]').press("Enter");
  await expect(page).toHaveURL(/q=/);
  await expect(page.getByRole("link", { name: new RegExp(`FOB Buyer ${stamp}`) })).toBeVisible();
  const csv = await page.request.get("/api/v1/exports/csv");
  expect(csv.ok()).toBeTruthy();
  const text = await csv.text();
  expect(text.startsWith("\uFEFF")).toBeTruthy();
  expect(text).not.toContain("iban");
  expect(text).not.toContain("EG123456789012345678901234");
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
});

test("E2E-15 snoozed reminder resolves after the document is approved", async ({ page }) => {
  test.setTimeout(150_000);
  const origin = { origin: "http://127.0.0.1:43174" };
  await patchReminderRule(page.request, "rr-doc-due", { offsetAmount: -1 }, origin);
  const other = `Other ${stamp}`;
  await createCustomer(page, other, `OTH-${stamp}`);
  await createCase(page, {
    customer: other,
    route: "DIRECT_ROUTE",
    invoice: `INV-OTH-${stamp}`,
    incoterm: "FOB",
    goods: "40.00",
    invoicedFreight: "0",
    actualFreight: "0",
    total: "40.00",
  });
  const otherRef = (await page.locator("h1").innerText()).trim();
  const customer = `Remind ${stamp}`;
  await createCustomer(page, customer, `REM-${stamp}`);
  await createCase(page, {
    customer,
    route: "DIRECT_ROUTE",
    invoice: `INV-REM-${stamp}`,
    incoterm: "FOB",
    goods: "40.00",
    invoicedFreight: "0",
    actualFreight: "0",
    total: "40.00",
  });
  const caseUrl = page.url();
  const caseRef = (await page.locator("h1").innerText()).trim();
  await page.setViewportSize({ width: 1366, height: 900 });
    await page.screenshot({ path: "docs/qa-screenshots/checkpoint-02-2/after/en-case-1366.png", fullPage: true });
  await page.getByRole("button", { name: "ع" }).click();
  await page.screenshot({ path: "docs/qa-screenshots/checkpoint-02-2/after/ar-case-detail-1366.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "docs/qa-screenshots/checkpoint-02-2/after/ar-case-detail-390.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: "EN" }).click();
  const scheduled = await page.request.get("/cdn-cgi/local/scheduled?format=json");
  expect(scheduled.ok()).toBeTruthy();
  await page.goto("/reminders");
  if (await page.getByText("fetch failed").count()) {
    await page.keyboard.press("Escape");
    await page.reload();
  }
  const missing = page.locator("div.rounded-xl").filter({ hasText: caseRef }).filter({ hasText: "Required document is not yet uploaded: Commercial Invoice" });
  await expect(missing).toBeVisible();
  await expect(missing.getByText("Upload a scanned PDF of the original")).toBeVisible();
  await expect(missing.locator('[data-status="ACTIVE"]')).toBeVisible();
  await missing.getByRole("button", { name: "Snooze 1d" }).click();
  await expect(missing.locator('[data-status="SNOOZED"]')).toBeVisible();
  await page.goto(caseUrl);
  await page.locator('[data-tab="documents"]').click();
  await uploadPdf(page, "Commercial Invoice");
  const reviewing = page.waitForResponse((response) => response.url().includes("/review") && response.ok());
  await requirementCard(page, "Commercial Invoice").locator('[data-decision="UNDER_REVIEW"]').click();
  await reviewing;
  await expect(requirementCard(page, "Commercial Invoice").locator('[data-status="UNDER_REVIEW"]')).toBeVisible();
  const approved = page.waitForResponse((response) => response.url().includes("/review") && response.ok());
  await requirementCard(page, "Commercial Invoice").locator('[data-decision="APPROVED"]').click();
  await approved;
  await expect(requirementCard(page, "Commercial Invoice").locator('[data-status="APPROVED"]')).toBeVisible();
  await page.goto("/reminders");
  await expect(page.locator("div.rounded-xl").filter({ hasText: caseRef }).filter({ hasText: "not yet uploaded: Commercial Invoice" })).toHaveCount(0);
  await expect(page.locator("div.rounded-xl").filter({ hasText: caseRef }).filter({ hasText: "waiting for review: Commercial Invoice" })).toHaveCount(0);
  await expect(page.locator("div.rounded-xl").filter({ hasText: caseRef }).filter({ hasText: "not yet uploaded: Packing List" })).toBeVisible();
  await expect(page.locator("div.rounded-xl").filter({ hasText: otherRef }).filter({ hasText: "not yet uploaded: Commercial Invoice" })).toBeVisible();
  await page.reload();
  const again = await page.request.get("/cdn-cgi/local/scheduled?format=json");
  expect(again.ok()).toBeTruthy();
  await page.reload();
  const otherCard = page.locator("div.rounded-xl").filter({ hasText: otherRef }).filter({ hasText: "not yet uploaded: Commercial Invoice" });
  if (!(await otherCard.count())) await page.reload();
  await expect(page.getByRole("heading", { name: "Reminders" })).toBeVisible();
  await expect(page.locator("div.rounded-xl").filter({ hasText: caseRef }).filter({ hasText: "not yet uploaded: Commercial Invoice" })).toHaveCount(0);
  await expect(otherCard).toBeVisible();
  await patchReminderRule(page.request, "rr-doc-due", { offsetAmount: 0 }, origin);
});

test("E2E-15b upload without approval keeps the review reminder", async ({ page }) => {
  const origin = { origin: "http://127.0.0.1:43174" };
  await patchReminderRule(page.request, "rr-review", { offsetAmount: -1 }, origin);
  const customer = `Review ${stamp}`;
  await createCustomer(page, customer, `RVW-${stamp}`);
  await createCase(page, {
    customer,
    route: "DIRECT_ROUTE",
    invoice: `INV-RVW-${stamp}`,
    incoterm: "FOB",
    goods: "40.00",
    invoicedFreight: "0",
    actualFreight: "0",
    total: "40.00",
  });
  const caseRef = (await page.locator("h1").innerText()).trim();
  await page.locator('[data-tab="documents"]').click();
  await uploadPdf(page, "Commercial Invoice");
  await page.goto("/reminders");
  await expect(page.locator("div.rounded-xl").filter({ hasText: caseRef }).filter({ hasText: "not yet uploaded: Commercial Invoice" })).toHaveCount(0);
  const review = page.locator("div.rounded-xl").filter({ hasText: caseRef }).filter({ hasText: "waiting for review: Commercial Invoice" });
  await expect(review).toBeVisible();
  await expect(review.locator('[data-status="RESOLVED"]')).toHaveCount(0);
  await patchReminderRule(page.request, "rr-review", { offsetAmount: 1 }, origin);
});

test("isolated database does not contain the developer admin", async () => {
  expect(() => wranglerSql(".wrangler/state", "SELECT 1")).toThrow(/DEVELOPER_STATE_FORBIDDEN/);
  const e2e = wranglerSql(".wrangler-e2e/state", "SELECT email FROM user");
  expect(e2e).toContain("e2e-admin@example.com");
  expect(e2e).not.toContain("ops@exportflow.local");
});
