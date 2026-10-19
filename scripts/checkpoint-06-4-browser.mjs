import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { chromium } from "@playwright/test";
import { perfRoot } from "./checkpoint-06-4-guard.mjs";

const base = process.env.EXPORTFLOW_PROBE_BASE ?? "http://127.0.0.1:43176";
const tag = process.env.EXPORTFLOW_PROBE_TAG ?? "browser-large";
const dataset = process.env.EXPORTFLOW_PROBE_DATASET ?? "large";
const accounts = JSON.parse(readFileSync(path.join(perfRoot, "accounts.json"), "utf8"));
const tracks = JSON.parse(readFileSync(path.join(perfRoot, "tracks.json"), "utf8"));
const active = tracks.tracks.find((row) => !row.revoked);
const revoked = tracks.tracks.find((row) => row.revoked);
const outDir = "docs/performance/checkpoint-06-4";
mkdirSync(outDir, { recursive: true });

function redact(url) {
  return String(url)
    .replace(/\/public\/track\/[^/?#]+/g, "/public/track/:token")
    .replace(/\/track\/[^/?#]+/g, "/track/:token")
    .replace(/([?&])(token|password|secret)=[^&]*/gi, "$1$2=redacted");
}

function watch(page, bag) {
  page.on("pageerror", (error) => bag.pageErrors.push(String(error.message).slice(0, 180)));
  page.on("console", (message) => {
    if (message.type() === "error") bag.consoleErrors.push(redact(message.text()).slice(0, 180));
  });
  page.on("requestfailed", (request) => {
    bag.requestFailed.push({ url: redact(request.url()), error: request.failure()?.errorText ?? "" });
  });
}

async function signIn(page) {
  await page.goto(`${base}/login`, { waitUntil: "commit" });
  await page.locator("form").first().locator("input[name=email]").fill(accounts.email);
  await page.locator("form").first().locator("input[name=password]").fill(accounts.password);
  const started = performance.now();
  await page.locator("form").first().locator("button[type=submit]").click();
  await page.locator("h1").filter({ hasText: /Operations desk|مكتب/ }).waitFor({ timeout: 30000 });
  return Math.round(performance.now() - started);
}

async function dashboardReload(page) {
  const started = performance.now();
  await page.goto(`${base}/dashboard`, { waitUntil: "commit" });
  await page.locator("h1").filter({ hasText: /Operations desk|مكتب/ }).waitFor({ timeout: 30000 });
  return Math.round(performance.now() - started);
}

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const bag = { pageErrors: [], consoleErrors: [], requestFailed: [] };
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await context.newPage();
watch(page, bag);
const loginMs = await signIn(page);
const warm = [];
for (let i = 0; i < 10; i += 1) warm.push(await dashboardReload(page));
const casesStarted = performance.now();
await page.getByRole("link", { name: "Export operations", exact: true }).click();
await page.locator("[data-cases=ready]").waitFor({ timeout: 30000 });
await page.locator("a[href*='/export-cases/pcase-']").first().waitFor({ timeout: 30000 });
const casesMs = Math.round(performance.now() - casesStarted);
const openStarted = performance.now();
await page.locator("a[href*='/export-cases/pcase-']").first().click();
await page.locator("h1").filter({ hasText: /PF-2026-/ }).waitFor({ timeout: 30000 });
const openMs = Math.round(performance.now() - openStarted);
const caseHeading = await page.locator("h1").first().innerText();
const nav = [];
for (let i = 0; i < 3; i += 1) {
  const away = performance.now();
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await page.locator("h1").filter({ hasText: /Operations desk|مكتب/ }).waitFor({ timeout: 30000 });
  nav.push({ to: "dashboard", ms: Math.round(performance.now() - away) });
  const back = performance.now();
  await page.getByRole("link", { name: "Export operations", exact: true }).click();
  await page.locator("[data-cases=ready]").waitFor({ timeout: 30000 });
  nav.push({ to: "cases", ms: Math.round(performance.now() - back) });
}

async function routeReady(label, urlPath, ready) {
  const started = performance.now();
  await page.goto(`${base}${urlPath}`, { waitUntil: "commit" });
  await ready();
  return { label, ms: Math.round(performance.now() - started) };
}

const routes = [
  await routeReady("bookings", "/bookings", () => page.locator("h1").first().waitFor()),
  await routeReady("schedule", "/schedule", () => page.locator("h1").first().waitFor()),
  await routeReady("reminders", "/reminders", () => page.locator("h1").first().waitFor()),
];
const cold = [];
for (let i = 0; i < 3; i += 1) {
  const coldContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const coldPage = await coldContext.newPage();
  watch(coldPage, bag);
  await coldPage.goto(`${base}/login`, { waitUntil: "commit" });
  await coldPage.locator("form").first().locator("input[name=email]").fill(accounts.email);
  await coldPage.locator("form").first().locator("input[name=password]").fill(accounts.password);
  const started = performance.now();
  await coldPage.locator("form").first().locator("button[type=submit]").click();
  await coldPage.locator("h1").filter({ hasText: /Operations desk|مكتب/ }).waitFor({ timeout: 30000 });
  cold.push(Math.round(performance.now() - started));
  await coldContext.close();
}

const viewports = [];
for (const viewport of [{ width: 768, height: 1024 }, { width: 390, height: 844 }]) {
  const next = await browser.newContext({ viewport });
  await next.addCookies(await context.cookies());
  const sized = await next.newPage();
  watch(sized, bag);
  const started = performance.now();
  await sized.goto(`${base}/dashboard`, { waitUntil: "commit" });
  await sized.locator("h1").filter({ hasText: /Operations desk|مكتب/ }).waitFor({ timeout: 30000 });
  viewports.push({ viewport: viewport.width, ms: Math.round(performance.now() - started) });
  await next.close();
}

const trackPage = await context.newPage();
watch(trackPage, bag);
const trackSamples = [];
for (const kind of ["active", "revoked"]) {
  const token = kind === "active" ? active?.token : revoked?.token;
  const started = performance.now();
  await trackPage.goto(`${base}/track/${token}`, { waitUntil: "commit" });
  const heading = trackPage.locator("h1");
  await heading.waitFor({ timeout: 30000 });
  const text = await heading.innerText();
  const dir = await trackPage.locator("html").getAttribute("dir");
  const toggle = trackPage.getByRole("button", { name: "ع", exact: true });
  let dirAfter = dir;
  if (await toggle.count()) {
    await toggle.click();
    await trackPage.locator("html[dir=rtl]").waitFor({ timeout: 10000 });
    dirAfter = "rtl";
    await trackPage.getByRole("button", { name: "EN" }).click();
  }
  trackSamples.push({
    kind,
    ms: Math.round(performance.now() - started),
    heading: text.replace(/PF-2026-\d+/, "PF-2026-xxxx"),
    unavailable: /unavailable|غير متاح/i.test(text),
    dirBefore: dir,
    dirAfter,
    leakedAmount: /invoice_total|goods_value|bank name/i.test(text),
  });
}

const sorted = [...warm].sort((a, b) => a - b);
const result = {
  tag,
  dataset,
  base,
  capturedAt: new Date().toISOString(),
  environment: "LOCAL DEV watcher on, isolated perf database",
  loginMs,
  dashboardWarm: { n: warm.length, min: sorted[0], p50: sorted[4], max: sorted[sorted.length - 1], samples: warm },
  dashboardColdLogin: { n: cold.length, samples: cold },
  casesListMs: casesMs,
  openCaseMs: openMs,
  caseHeadingHasReference: /PF-2026-/.test(caseHeading),
  spaNav: nav,
  routes,
  viewports,
  track: trackSamples,
  consoleErrors: bag.consoleErrors.slice(0, 40),
  pageErrors: bag.pageErrors.slice(0, 20),
  requestFailed: bag.requestFailed.slice(0, 20),
};
writeFileSync(path.join(outDir, `${tag}.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify({
  loginMs,
  dashboardWarmP50: result.dashboardWarm.p50,
  casesListMs: result.casesListMs,
  openCaseMs: result.openCaseMs,
  cold: cold,
  viewports,
  track: trackSamples.map(({ kind, ms, dirAfter }) => ({ kind, ms, dirAfter })),
  consoleErrors: bag.consoleErrors.length,
  requestFailed: bag.requestFailed.length,
}, null, 2));
await browser.close();
