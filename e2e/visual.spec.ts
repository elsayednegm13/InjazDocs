import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

const dir = "docs/qa-screenshots/checkpoint-02-2/after";
const next = "docs/qa-screenshots/checkpoint-03/after";
const dossier = "docs/qa-screenshots/checkpoint-06-6/after";

test("capture after screenshots for Arabic and English", async ({ page, browser }) => {
  mkdirSync(dir, { recursive: true });
  mkdirSync(next, { recursive: true });
  mkdirSync(dossier, { recursive: true });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Operations desk" })).toBeVisible();
  await page.screenshot({ path: `${dir}/en-dashboard-1366.png`, fullPage: true });
  await page.screenshot({ path: `${next}/en-dashboard-1366.png`, fullPage: true });
  await page.getByRole("button", { name: "ع" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.screenshot({ path: `${dir}/ar-dashboard-1366.png`, fullPage: true });
  await page.screenshot({ path: `${next}/ar-dashboard-1366.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${dir}/ar-dashboard-390.png`, fullPage: true });
  await page.screenshot({ path: `${next}/ar-dashboard-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/export-cases");
  const caseLink = page.getByRole("link", { name: /EF-/ }).first();
  await expect(caseLink).toBeVisible();
  {
    await caseLink.click();
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("[data-dossier='loaded']")).toBeVisible();
    await page.screenshot({ path: `${dir}/ar-case-1366.png`, fullPage: true });
    await page.screenshot({ path: `${dossier}/ar-case-1366.png`, fullPage: true });
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.screenshot({ path: `${dossier}/ar-case-768.png`, fullPage: true });
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.screenshot({ path: `${next}/ar-case-1366.png`, fullPage: true });
    await page.locator('[data-tab="documents"]').click();
    await page.screenshot({ path: `${dir}/ar-documents-1366.png`, fullPage: true });
    await page.screenshot({ path: `${next}/ar-documents-1366.png`, fullPage: true });
    await page.locator('[data-tab="bookings"]').click();
    await page.screenshot({ path: `${dir}/ar-bookings-1366.png`, fullPage: true });
    await page.screenshot({ path: `${next}/ar-bookings-1366.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${dir}/ar-case-390.png`, fullPage: true });
    await page.screenshot({ path: `${dossier}/ar-case-390.png`, fullPage: true });
    await page.screenshot({ path: `${next}/ar-case-390.png`, fullPage: true });
    await page.locator('[data-tab="bookings"]').click();
    await page.screenshot({ path: `${next}/ar-bookings-390.png`, fullPage: true });
    await page.locator('[data-tab="documents"]').click();
    await page.screenshot({ path: `${next}/ar-documents-390.png`, fullPage: true });
    await page.getByRole("button", { name: "إضافة إلى هذه العملية" }).click();
    await expect(page.getByText("اختر نوع المستند قبل إضافته.")).toBeVisible();
    await page.screenshot({ path: `${dir}/ar-document-validation-390.png`, fullPage: true });
    await page.screenshot({ path: `${next}/ar-error-document-390.png`, fullPage: true });
    const caseId = page.url().match(/export-cases\/([0-9a-f-]+)/)?.[1];
    if (caseId) {
      const created = await page.request.post(`/api/v1/export-cases/${caseId}/tracking-links`, {
        data: {},
        headers: { origin: "http://127.0.0.1:43174" },
      });
      if (created.ok()) {
        const token = (await created.json()).data.token as string;
        const visitor = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const track = await visitor.newPage();
        await track.goto(`/track/${token}`);
        await expect(track.locator("h1")).toBeVisible();
        await track.screenshot({ path: `${next}/ar-public-tracking-390.png`, fullPage: true });
        await visitor.close();
      }
    }
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/reminders");
  await page.screenshot({ path: `${dir}/ar-reminders-1366.png`, fullPage: true });
  await page.screenshot({ path: `${next}/ar-reminders-1366.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${next}/ar-reminders-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/users");
  await page.screenshot({ path: `${next}/ar-users-1366.png`, fullPage: true });
  await page.goto("/reports");
  await page.locator('[data-testid="import-preview"] input[type="file"]').setInputFiles({
    name: "customers.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("legal_name,country_code,phone\nPreview Buyer,EG,+20100000000\n,EG,\n"),
  });
  await expect(page.getByText("Preview Buyer")).toBeVisible();
  await expect(page.getByText("الاسم القانوني مطلوب في هذا الصف.")).toBeVisible();
  await expect(page.locator("pre")).toHaveCount(0);
  await page.screenshot({ path: `${next}/ar-import-preview-1366.png`, fullPage: true });
  await page.goto("/schedule");
  await page.screenshot({ path: `${dir}/ar-bookings-schedule-1366.png`, fullPage: true });
  const login = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1366, height: 900 }, locale: "en-US" });
  const loginPage = await login.newPage();
  await loginPage.goto("/login");
  await loginPage.locator('input[name="email"]').fill("nobody@example.com");
  await loginPage.locator('input[name="password"]').fill("wrong-password-value");
  await loginPage.getByRole("button", { name: "Sign in" }).click();
  await expect(loginPage.getByText("Sign-in failed")).toBeVisible();
  await loginPage.screenshot({ path: `${next}/en-error-auth-1366.png`, fullPage: true });
  await loginPage.screenshot({ path: `${dir}/en-login-1366.png`, fullPage: true });
  await login.close();
});
