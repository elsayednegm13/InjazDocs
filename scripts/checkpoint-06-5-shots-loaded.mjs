import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { perfRoot } from "./checkpoint-06-4-guard.mjs";

const base = "http://127.0.0.1:43176";
const accounts = JSON.parse(readFileSync(path.join(perfRoot, "accounts.json"), "utf8"));
const tracks = JSON.parse(readFileSync(path.join(perfRoot, "tracks.json"), "utf8")).tracks;
const out = "docs/qa-screenshots/checkpoint-06-5";
mkdirSync(out, { recursive: true });
const viewports = [[1366, 768], [768, 1024], [390, 844]];
const routes = [
  ["dashboard", "/dashboard"],
  ["cases", "/export-cases"],
  ["case", "/export-cases/pcase-0"],
  ["customers", "/customers"],
  ["bookings", "/bookings"],
  ["schedule", "/schedule"],
  ["containers", "/containers"],
  ["reminders", "/reminders"],
  ["reports", "/reports"],
  ["users", "/users"],
  ["settings", "/settings"],
  ["notifications", "/notifications"],
  ["activity", "/activity"],
  ["new-case", "/export-cases/new"],
];
const browser = await chromium.launch({ headless: true, channel: "chrome" });
let page = await browser.newPage();

async function ready() {
  await page.waitForFunction(() => {
    const text = document.body?.innerText ?? "";
    return text.length > 40 && !text.includes("Loading workspace") && !text.includes("fetch failed");
  }, null, { timeout: 20000 });
}

for (const lang of ["en", "ar"]) {
  const context = await browser.newContext();
  page = await context.newPage();
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((value) => localStorage.setItem("exportflow.lang", value), lang);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading").first().waitFor({ timeout: 20000 });
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: path.join(out, `login-${lang}-${width}.png`) });
  }
  await page.locator("input[type=email], input[name=email]").first().fill(accounts.email);
  await page.locator("input[type=password]").first().fill(accounts.password);
  await page.locator("form").first().locator("button[type=submit]").click();
  await page.waitForURL("**/dashboard", { timeout: 20000 });
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    for (const [name, route] of routes) {
      await page.goto(`${base}${route}`, { waitUntil: "domcontentloaded" });
      await ready();
      await page.screenshot({ path: path.join(out, `${name}-${lang}-${width}.png`) });
    }
    await page.goto(`${base}/customers`, { waitUntil: "domcontentloaded" });
    await ready();
    const customer = page.locator("a[href^='/customers/']").nth(1);
    if (await customer.count()) {
      await customer.click();
      await ready();
      await page.screenshot({ path: path.join(out, `customer-${lang}-${width}.png`) });
    }
  }
  await context.close();
}
const active = tracks.find((row) => !row.revoked);
const revoked = tracks.find((row) => row.revoked);
const trackContext = await browser.newContext();
page = await trackContext.newPage();
for (const lang of ["en", "ar"]) {
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    await page.goto(`${base}/track/${active.token}`, { waitUntil: "domcontentloaded" });
    await page.evaluate((value) => localStorage.setItem("exportflow.lang", value), lang);
    await page.reload({ waitUntil: "domcontentloaded" });
    await ready();
    await page.screenshot({ path: path.join(out, `track-active-${lang}-${width}.png`) });
    await page.goto(`${base}/track/${revoked.token}`, { waitUntil: "domcontentloaded" });
    await ready();
    await page.screenshot({ path: path.join(out, `track-revoked-${lang}-${width}.png`) });
  }
}
await browser.close();
console.log("loaded-shots");
