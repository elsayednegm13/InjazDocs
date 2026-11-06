import { expect, test, type Page } from "@playwright/test";

const widths = [320, 360, 375, 390, 430, 768, 1024, 1440];
const origin = { origin: "http://127.0.0.1:43174" };

async function overflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
}

async function seed(page: Page) {
  const stamp = Date.now().toString().slice(-6);
  const customer = await page.request.post("/api/v1/customers", {
    data: {
      legalName: `Responsive ${stamp}`,
      tradeName: "Responsive Trading Company",
      countryCode: "EG",
      notes: "A long note that can stretch a card on narrow screens.",
      contacts: [{ fullName: "Mona Saleh", phone: "+20100000001", isPrimary: true }],
      addresses: [{ kind: "SHIPPING", line1: "12 Corniche Street", city: "Alexandria", countryCode: "EG", isPrimary: true }],
    },
    headers: origin,
  });
  expect(customer.ok(), await customer.text()).toBeTruthy();
  const customerId = (await customer.json()).data.id as string;
  const exportCase = await page.request.post("/api/v1/export-cases", {
    data: {
      customerId,
      documentRoute: "DIRECT_ROUTE",
      destinationCountry: "NL",
      invoice: {
        invoiceNumber: `INV-RESP-${stamp}`,
        invoiceDate: "2026-10-20",
        paymentTermCode: "TT",
        incoterm: "FOB",
        namedPlace: "Alexandria",
        currency: "USD",
        goodsValue: "1000.00",
        invoicedFreight: "0",
        actualFreightExpense: "0",
        invoiceTotal: "1000.00",
        portOfLoading: "Alexandria",
        portOfDischarge: "Rotterdam",
        grossWeight: 12.5,
        netWeight: 11.2,
        weightUnit: "KG",
      },
    },
    headers: origin,
  });
  expect(exportCase.ok(), await exportCase.text()).toBeTruthy();
  const caseId = (await exportCase.json()).data.id as string;
  const booking = await page.request.post("/api/v1/bookings", {
    data: { caseId, bookingNumber: `BK-RESP-${stamp}`, shippingLine: "MSC", expectedContainers: 3, plannedEtd: "2026-11-02" },
    headers: origin,
  });
  expect(booking.ok(), await booking.text()).toBeTruthy();
  return { customerId, caseId, bookingId: (await booking.json()).data.id as string };
}

test("RESP-01 no page scrolls sideways at any supported width", async ({ page }) => {
  // 13 pages x 8 widths: the walk needs more than the default budget.
  test.setTimeout(420_000);
  const seeded = await seed(page);
  const pages = [
    { path: "/dashboard", ready: "[data-dashboard='ready']" },
    { path: "/export-cases", ready: "[data-cases='ready']" },
    { path: `/export-cases/${seeded.caseId}`, ready: "[data-dossier='loaded']" },
    { path: "/customers", ready: "[data-customers='ready']" },
    { path: `/customers/${seeded.customerId}`, ready: "[data-customer='ready']" },
    { path: "/bookings", ready: "[data-bookings='ready']" },
    { path: `/bookings/${seeded.bookingId}`, ready: "[data-booking='loaded']" },
    { path: "/schedule", ready: "[data-schedule='ready']" },
    { path: "/containers", ready: "[data-containers='ready']" },
    { path: "/reminders", ready: "[data-reminders='ready']" },
    { path: "/reports", ready: "[data-reports='ready']" },
    { path: "/users", ready: "[data-users='ready']" },
    { path: "/settings", ready: "[data-settings='ready']" },
  ];
  for (const entry of pages) {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(entry.path, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(entry.ready, { timeout: 20000 });
      await page.waitForTimeout(200);
      const value = await overflow(page);
      expect(value, `${entry.path} at ${width}px overflows by ${value}px`).toBeLessThanOrEqual(1);
    }
  }
});

test("RESP-02 the mobile menu opens, navigates and closes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await page.waitForSelector("[data-dashboard='ready']");
  const menu = page.getByRole("button", { name: /open menu/i });
  await expect(menu).toBeVisible();
  await menu.click();
  const drawer = page.getByRole("navigation", { name: /export operations/i }).last();
  await expect(drawer).toBeVisible();
  await drawer.getByRole("link", { name: /customers/i }).first().click();
  await page.waitForURL("**/customers");
  // The drawer must not cover the page after navigating.
  await expect(page.getByRole("navigation", { name: /export operations/i }).last()).toBeHidden();
  expect(await overflow(page)).toBeLessThanOrEqual(1);
});

test("RESP-03 the customer form stays usable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/customers/new");
  await page.locator('input[name="legalName"]').waitFor();
  await page.locator('input[name="legalName"]').fill("Narrow Form");
  await page.locator('input[name="contactName"]').fill("Mona");
  await page.locator('input[name="line1"]').fill("1 Street");
  const save = page.getByRole("button", { name: /save customer/i });
  await expect(save).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(1);
});

test("RESP-04 a slow API shows a placeholder that is replaced by the content", async ({ page }) => {
  await page.route("**/api/v1/dashboard", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.continue();
  });
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[aria-busy="true"]').first()).toBeVisible();
  await page.waitForSelector("[data-dashboard='ready']", { timeout: 30000 });
  await page.waitForTimeout(300);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator(".animate-pulse")).toHaveCount(0);
  await page.unroute("**/api/v1/dashboard");
});

test("RESP-05 the Arabic layout does not overflow on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await page.waitForSelector("[data-dashboard='ready']");
  await page.getByRole("button", { name: /ع|switch to arabic/i }).first().click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.waitForTimeout(400);
  expect(await overflow(page)).toBeLessThanOrEqual(1);
});
