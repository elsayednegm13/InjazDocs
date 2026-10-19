import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const failed = [];
page.on("requestfailed", (request) => failed.push({ url: request.url().split("?")[0], error: request.failure()?.errorText ?? "" }));
page.on("console", (message) => {
  if (message.type() === "error") failed.push({ url: "console", error: message.text().slice(0, 240) });
});
const response = await page.goto("http://127.0.0.1:43181/login", { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(3000);
const html = await page.content();
writeFileSync("docs/performance/checkpoint-06-5-2/arm-b-login-shell.html", html);
const text = await page.locator("body").innerText();
console.log(JSON.stringify({
  status: response?.status() ?? 0,
  len: html.length,
  textLen: text.length,
  hasEmail: html.includes("name=\"email\""),
  textStart: text.slice(0, 160),
  failed,
}));
await page.screenshot({ path: "docs/performance/checkpoint-06-5-2/arm-b-login-probe.png", fullPage: true });
await browser.close();
