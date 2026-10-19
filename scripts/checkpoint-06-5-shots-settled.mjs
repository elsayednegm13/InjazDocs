import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { perfRoot } from "./checkpoint-06-4-guard.mjs";

const base = "http://127.0.0.1:43176";
const accounts = JSON.parse(readFileSync(path.join(perfRoot, "accounts.json"), "utf8"));
const tracks = JSON.parse(readFileSync(path.join(perfRoot, "tracks.json"), "utf8")).tracks;
const out = "docs/qa-screenshots/checkpoint-06-5";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const widths = [1366, 768, 390];

async function settle(page, marker) {
  await page.waitForFunction((value) => (document.body?.innerText ?? "").includes(value), marker, { timeout: 20000 });
  await page.waitForTimeout(200);
}

for (const lang of ["en", "ar"]) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((value) => localStorage.setItem("exportflow.lang", value), lang);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading").first().waitFor();
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    await page.screenshot({ path: path.join(out, `login-${lang}-${width}.png`) });
  }
  await page.locator("input[type=password]").first().fill(accounts.password);
  await page.locator("input[type=email], input[name=email]").first().fill(accounts.email);
  await page.locator("form").first().locator("button[type=submit]").click();
  await page.waitForURL("**/dashboard");
  const pages = [
    ["dashboard", "/dashboard", "PF-2026"],
    ["cases", "/export-cases", "PF-2026"],
    ["case", "/export-cases/pcase-0", "PF-2026"],
    ["customers", "/customers", "Perf Customer"],
    ["bookings", "/bookings", "PF-BK"],
    ["schedule", "/schedule", "2026-07"],
    ["containers", "/containers", "PFXU"],
    ["reminders", "/reminders", "PF-2026"],
    ["users", "/users", "Perf"],
    ["settings", "/settings", lang === "ar" ? "الإعدادات" : "Custom fields"],
  ];
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const [name, route, marker] of pages) {
      await page.goto(`${base}${route}`, { waitUntil: "domcontentloaded" });
      try {
        await settle(page, marker);
      } catch {
        const text = await page.locator("body").innerText();
        console.log(JSON.stringify({ missed: true, lang, width, route, marker, snippet: text.slice(0, 180).replace(/\s+/g, " ") }));
      }
      await page.screenshot({ path: path.join(out, `${name}-${lang}-${width}.png`) });
    }
  }
  await context.close();
}

const active = tracks.find((row) => !row.revoked);
const revoked = tracks.find((row) => row.revoked);
const trackContext = await browser.newContext();
const track = await trackContext.newPage();
for (const lang of ["en", "ar"]) {
  for (const width of widths) {
    await track.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    await track.goto(`${base}/track/${active.token}`, { waitUntil: "domcontentloaded" });
    await track.evaluate((value) => localStorage.setItem("exportflow.lang", value), lang);
    await track.reload({ waitUntil: "domcontentloaded" });
    await settle(track, "PF-2026");
    await track.screenshot({ path: path.join(out, `track-active-${lang}-${width}.png`) });
    await track.goto(`${base}/track/${revoked.token}`, { waitUntil: "domcontentloaded" });
    await settle(track, lang === "ar" ? "غير" : "unavailable");
    await track.screenshot({ path: path.join(out, `track-revoked-${lang}-${width}.png`) });
  }
}
await browser.close();
console.log("settled-shots");
