import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = "http://127.0.0.1:43173";
const email = process.env.VERIFY_EMAIL;
const password = process.env.VERIFY_PASSWORD;
const outDir = process.env.CAPTURE_DIR || ".wrangler-verify";
mkdirSync(outDir, { recursive: true });
if (!email || !password) {
  console.error("VERIFY_EMAIL / VERIFY_PASSWORD are required");
  process.exit(2);
}

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "en-US" });
const page = await context.newPage();
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

async function shoot(path, name, ready) {
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
  if (ready) await page.waitForSelector(ready, { timeout: 40000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
  console.log(`saved ${name}`);
}

try {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/dashboard/, { timeout: 30000 });
  await page.waitForSelector("[data-dashboard='ready']", { timeout: 30000 });

  await shoot("/dashboard", "dashboard-admin-en-1366", "[data-dashboard='ready']");
  await page.setViewportSize({ width: 390, height: 844 });
  await shoot("/dashboard", "dashboard-admin-en-390", "[data-dashboard='ready']");
  await page.setViewportSize({ width: 1366, height: 900 });

  await page.evaluate(() => localStorage.setItem("exportflow.lang", "ar"));
  await shoot("/dashboard", "dashboard-admin-ar-1366", "[data-dashboard='ready']");
  await shoot("/export-cases", "cases-admin-ar-1366", "[data-cases='ready']");
  await shoot(`/export-cases/${process.env.VERIFY_CASE_ID || "a4c74a3b-1368-447c-a1ea-4a86fb088e1a"}`, "dossier-admin-ar-1366", "[data-dossier='loaded']");

  await page.setViewportSize({ width: 390, height: 844 });
  await shoot("/dashboard", "dashboard-admin-ar-390", "[data-dashboard='ready']");
  await shoot("/export-cases", "cases-admin-ar-390", "[data-cases='ready']");
} catch (error) {
  console.error("capture failed:", error instanceof Error ? error.message : error);
  await page.screenshot({ path: `${outDir}/design-failure.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  console.log("console errors:", errors.length ? errors.slice(0, 5) : "none");
  await browser.close();
}
