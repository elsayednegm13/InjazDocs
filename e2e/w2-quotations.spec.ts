import { expect, test } from "@playwright/test";

/**
 * W2 quotations e2e contract (owner-approved, D-10). Authoritative negative
 * checks (403 without quotations.view, 409 on a duplicate number) are covered
 * by the isolated Vitest suites in tests/w2 — this spec verifies the UI wiring
 * end to end against the served worker. It intentionally does NOT start any
 * infrastructure itself: running Playwright in this round is prohibited, so
 * this file ships as the executable contract for a round that owns isolation.
 */
const PERM_STAMP = { testid: "quotations-list" };

test("quotation lifecycle: create, issue, record response, download PDF", async ({ page }) => {
  // The list screen is reachable from the navigation item for holders of
  // quotations.view and shows the contracted columns.
  await page.goto("/quotations");
  const list = page.getByTestId(PERM_STAMP.testid);
  await expect(list).toBeVisible();

  // New quotation form guards its required fields client-side and normalizes
  // Arabic-Indic digits and case server-side.
  await page.getByRole("link", { name: /new quotation|عرض جديد/ }).click();
  await expect(page.getByTestId("quotation-form")).toBeVisible();
  await page.getByLabel(/quote number|رقم العرض/).fill("12/٠٠٨");
  await page.getByLabel(/customer|العميل/).selectOption({ index: 1 });
  await page.getByLabel(/description|الوصف/).first().fill("E2E fixture line");
  await page.getByLabel(/quantity|الكمية/).first().fill("2");
  await page.getByLabel(/unit price|سعر الوحدة/).first().fill("10.5");
  await page.getByRole("button", { name: /create quotation|إنشاء العرض/ }).click();

  const detail = page.getByTestId("quotation-detail");
  await expect(detail).toBeVisible();
  await expect(page.getByTestId("quotation-detail").first()).toContainText("12/008");
  await expect(page.getByText(/draft|مسودة/).first()).toBeVisible();

  // Issue the draft; the status flips and the revision ledger gains revision 1.
  await page.getByRole("button", { name: /issue|إصدار/ }).first().click();
  await page.getByRole("button", { name: /issue|إصدار/ }).last().click();
  await expect(detail).toContainText(/issued|مُصدر/);

  // Record the client response from the recorded panel.
  await page.getByRole("button", { name: /record client response|تسجيل رد العميل/ }).click();
  await page.getByRole("button", { name: /accepted|مقبول/ }).last().click();
  await expect(detail).toContainText(/accepted|مقبول/);

  // The PDF download is served as an application/pdf attachment.
  const pdf = await page.request.get(page.locator('a[href*="/pdf"]').first().getAttribute("href") ?? "/api/v1/quotations/x/pdf");
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
});
