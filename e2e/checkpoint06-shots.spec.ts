import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { clearViteOverlay } from "./helpers";

const root = process.env.CHECKPOINT06_SHOTS ?? "docs/qa-screenshots/checkpoint-06-1/after";

test("checkpoint 06 visual capture", async ({ page, browser }) => {
  mkdirSync(root, { recursive: true });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/dashboard");
  await clearViteOverlay(page);
  await expect(page.getByRole("heading", { name: /Operations desk|برج/ })).toBeVisible();
  await page.screenshot({ path: `${root}/en-dashboard-1366.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${root}/en-dashboard-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1366, height: 900 });
  for (const [path, name] of [
    ["/export-cases", "en-cases-1366"],
    ["/bookings", "en-bookings-1366"],
    ["/customers", "en-customers-1366"],
    ["/schedule", "en-schedule-1366"],
    ["/users", "en-users-1366"],
    ["/reports", "en-reports-1366"],
  ] as const) {
    await page.goto(path);
    await clearViteOverlay(page);
    await expect(page.locator("h1")).toBeVisible();
    if (path === "/settings") await expect(page.locator("[data-rules='ready']")).toBeVisible();
    if (path === "/export-cases") await expect(page.locator("[data-cases='ready']")).toBeVisible();
    await page.screenshot({ path: `${root}/${name}.png`, fullPage: true });
  }
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "ع" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.screenshot({ path: `${root}/ar-dashboard-1366.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${root}/ar-dashboard-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1366, height: 900 });
  for (const [path, name] of [
    ["/export-cases", "ar-cases-1366"],
    ["/bookings", "ar-bookings-1366"],
    ["/customers", "ar-customers-1366"],
    ["/reminders", "ar-reminders-1366"],
    ["/settings", "ar-settings-1366"],
    ["/users", "ar-users-1366"],
  ] as const) {
    await page.goto(path);
    await clearViteOverlay(page);
    await expect(page.locator("h1")).toBeVisible();
    if (path === "/settings") await expect(page.locator("[data-rules='ready']")).toBeVisible();
    if (path === "/export-cases") await expect(page.locator("[data-cases='ready']")).toBeVisible();
    await page.screenshot({ path: `${root}/${name}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/export-cases");
  await page.screenshot({ path: `${root}/ar-cases-390.png`, fullPage: true });
  await page.goto("/bookings");
  await page.screenshot({ path: `${root}/ar-bookings-390.png`, fullPage: true });
  await page.goto("/reminders");
  await page.screenshot({ path: `${root}/ar-reminders-390.png`, fullPage: true });

  const login = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1366, height: 900 }, locale: "en-US" });
  const loginPage = await login.newPage();
  await loginPage.goto("/login");
  await clearViteOverlay(loginPage);
  await expect(loginPage.getByRole("button", { name: "Sign in" })).toBeVisible();
  await loginPage.screenshot({ path: `${root}/en-login-1366.png`, fullPage: true });
  await loginPage.setViewportSize({ width: 390, height: 844 });
  await loginPage.screenshot({ path: `${root}/en-login-390.png`, fullPage: true });
  await loginPage.getByRole("button", { name: "العربية" }).click();
  await expect(loginPage.locator("html")).toHaveAttribute("dir", "rtl");
  await loginPage.screenshot({ path: `${root}/ar-login-390.png`, fullPage: true });
  await loginPage.setViewportSize({ width: 1366, height: 900 });
  await loginPage.screenshot({ path: `${root}/ar-login-1366.png`, fullPage: true });
  await login.close();
});
