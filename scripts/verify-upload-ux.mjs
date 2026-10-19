import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = "http://127.0.0.1:43173";
const email = process.env.VERIFY_EMAIL;
const password = process.env.VERIFY_PASSWORD;
const caseId = process.env.VERIFY_CASE_ID || "a4c74a3b-1368-447c-a1ea-4a86fb088e1a";
const outDir = ".wrangler-verify";
mkdirSync(outDir, { recursive: true });

if (!email || !password) {
  console.error("VERIFY_EMAIL / VERIFY_PASSWORD are required");
  process.exit(2);
}

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "en-US" });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

const result = { steps: [] };
const step = (name, ok, extra = "") => {
  result.steps.push({ name, ok, extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
};

try {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/dashboard/, { timeout: 30000 });
  step("sign-in", true);

  await page.goto(`${base}/export-cases/${caseId}`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-tab="documents"]').click();
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.waitFor({ state: "attached", timeout: 20000 });
  await page.screenshot({ path: `${outDir}/documents-before.png`, fullPage: true });
  step("documents tab opens", true);

  await fileInput.setInputFiles("e2e/fixtures/sample.pdf");
  await page.locator("[data-sonner-toast]", { hasText: "File uploaded" }).first().waitFor({ timeout: 60000 });
  step("success toast appears", true);

  await page.getByRole("link", { name: /open file/i }).first().waitFor({ timeout: 30000 });
  await page.locator("li", { hasText: "sample.pdf" }).first().waitFor({ timeout: 30000 });
  step("uploaded file name visible in versions list", true);

  await page.screenshot({ path: `${outDir}/documents-after.png`, fullPage: true });

  const openLink = page.getByRole("link", { name: /open file/i }).first();
  const href = await openLink.getAttribute("href");
  const download = await context.request.get(href ? new URL(href, base).toString() : `${base}/api/v1/files/download`);
  const disposition = download.headers()["content-disposition"] || "";
  step("download endpoint", download.status() === 200, `status=${download.status()}`);
  step("inline PDF + original name", /inline/i.test(disposition) && /sample\.pdf/i.test(disposition), disposition);

  await page.goto(`${base}/export-cases/00000000-0000-0000-0000-000000000000`, { waitUntil: "domcontentloaded" });
  const errorToast = page.locator("[data-sonner-toast]").first();
  await errorToast.waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${outDir}/error-toast.png`, fullPage: false });
  step("global error toast", true, (await errorToast.innerText()).replaceAll("\n", " ").slice(0, 90));

  const bad = consoleErrors.filter((line) => /Uncaught \(in promise\)/.test(line));
  step("no uncaught promise errors", bad.length === 0, bad.slice(0, 2).join(" | "));
} catch (error) {
  step("unexpected failure", false, error instanceof Error ? error.message : String(error));
  await page.screenshot({ path: `${outDir}/failure.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}

console.log(JSON.stringify(result, null, 2));
