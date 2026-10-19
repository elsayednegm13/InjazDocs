import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { perfRoot } from "./checkpoint-06-4-guard.mjs";

const base = process.env.EXPORTFLOW_PROBE_BASE ?? "http://127.0.0.1:43176";
const label = process.env.EXPORTFLOW_COLD_LABEL ?? "baseline";
const rounds = Number(process.env.EXPORTFLOW_BROWSER_ROUNDS ?? 12);
const accounts = JSON.parse(readFileSync(path.join(perfRoot, "accounts.json"), "utf8"));
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const rows = [];
await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
await page.locator("input[type=email], input[name=email]").first().fill(accounts.email);
await page.locator("input[type=password]").first().fill(accounts.password);
await page.locator("form").first().locator("button[type=submit]").click();
await page.waitForTimeout(1500);
for (let i = 0; i < rounds; i += 1) {
  const started = Date.now();
  await page.goto(`${base}/dashboard`, { waitUntil: "domcontentloaded" });
  const overlay = page.getByText("fetch failed");
  const heading = page.getByRole("heading", { name: /Operations desk|مكتب/ });
  const winner = await Promise.race([
    overlay.waitFor({ timeout: 8000 }).then(() => "overlay"),
    heading.waitFor({ timeout: 8000 }).then(() => "heading"),
  ]).catch(() => "timeout");
  rows.push({ i, winner, ms: Date.now() - started });
  if (winner === "overlay") await page.keyboard.press("Escape");
}
await browser.close();
mkdirSync("docs/performance/checkpoint-06-5", { recursive: true });
const summary = {
  label,
  base,
  n: rows.length,
  overlay: rows.filter((row) => row.winner === "overlay").length,
  heading: rows.filter((row) => row.winner === "heading").length,
  timeout: rows.filter((row) => row.winner === "timeout").length,
  rows,
};
const out = path.join("docs/performance/checkpoint-06-5", `browser-reload-${label}.json`);
writeFileSync(out, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ label, overlay: summary.overlay, heading: summary.heading, timeout: summary.timeout, n: summary.n }));
