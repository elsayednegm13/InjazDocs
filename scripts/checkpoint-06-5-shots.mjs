import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { perfRoot } from "./checkpoint-06-4-guard.mjs";

const base = "http://127.0.0.1:43176";
const accounts = JSON.parse(readFileSync(path.join(perfRoot, "accounts.json"), "utf8"));
const tracks = JSON.parse(readFileSync(path.join(perfRoot, "tracks.json"), "utf8")).tracks;
const out = "docs/qa-screenshots/checkpoint-06-5";
mkdirSync(out, { recursive: true });
const consoleNotes = [];
const viewports = [
  [1366, 768],
  [768, 1024],
  [390, 844],
];
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
  ["activity", "/activity"],
  ["notifications", "/notifications"],
  ["new-case", "/export-cases/new"],
];

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage();
page.on("console", (msg) => {
  if (msg.type() === "error") consoleNotes.push({ url: page.url().split("?")[0].replace(/\/track\/[^/]+/, "/track/:token"), text: msg.text().slice(0, 180) });
});
page.on("pageerror", (error) => consoleNotes.push({ kind: "pageerror", text: String(error).slice(0, 180) }));

async function shot(name) {
  await page.screenshot({ path: path.join(out, `${name}.png`) });
}

for (const [width, height] of viewports) {
  await page.setViewportSize({ width, height });
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading").first().waitFor({ timeout: 20000 });
  const arabic = page.getByRole("button", { name: "العربية" });
  if (await arabic.count()) await arabic.click();
  await page.getByRole("button", { name: "English" }).waitFor({ timeout: 10000 });
  await shot(`login-ar-${width}`);
  await page.getByRole("button", { name: "English" }).click();
  await shot(`login-en-${width}`);
}

await page.setViewportSize({ width: 1366, height: 768 });
await page.locator("input[type=email], input[name=email]").first().fill(accounts.email);
await page.locator("input[type=password]").first().fill(accounts.password);
await page.locator("form").first().locator("button[type=submit]").click();
await page.waitForURL("**/dashboard", { timeout: 20000 });
await page.getByRole("heading").first().waitFor({ timeout: 20000 });

for (const lang of ["en", "ar"]) {
  const toggle = page.getByRole("button", { name: lang === "ar" ? "ع" : "EN" });
  if (await toggle.count()) await toggle.click();
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    for (const [name, route] of routes) {
      await page.goto(`${base}${route}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(700);
      await shot(`${name}-${lang}-${width}`);
    }
    await page.goto(`${base}/customers`, { waitUntil: "domcontentloaded" });
    const customer = page.locator("a[href^='/customers/']").first();
    if (await customer.count()) {
      await customer.click();
      await page.waitForTimeout(700);
      await shot(`customer-${lang}-${width}`);
    }
    await page.goto(`${base}/bookings`, { waitUntil: "domcontentloaded" });
    const booking = page.locator("a[href^='/bookings/']").first();
    if (await booking.count()) {
      await booking.click();
      await page.waitForTimeout(700);
      await shot(`booking-${lang}-${width}`);
    }
  }
}

const active = tracks.find((row) => !row.revoked);
const revoked = tracks.find((row) => row.revoked);
for (const [width, height] of viewports) {
  await page.setViewportSize({ width, height });
  await page.goto(`${base}/track/${active.token}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading").first().waitFor({ timeout: 20000 });
  await shot(`track-active-en-${width}`);
  const ar = page.getByRole("button", { name: "ع" });
  if (await ar.count()) {
    await ar.click();
    await page.waitForTimeout(300);
    await shot(`track-active-ar-${width}`);
  }
  await page.goto(`${base}/track/${revoked.token}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading").first().waitFor({ timeout: 20000 });
  await shot(`track-revoked-en-${width}`);
}

await browser.close();
writeFileSync("docs/performance/checkpoint-06-5/browser-console.json", JSON.stringify({ capturedAt: new Date().toISOString(), notes: consoleNotes.slice(0, 80), noteCount: consoleNotes.length }, null, 2));
console.log(JSON.stringify({ shots: "written", consoleNotes: consoleNotes.length }));
