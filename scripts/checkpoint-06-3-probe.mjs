import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { performance } from "node:perf_hooks";
import { chromium, request as playwrightRequest } from "@playwright/test";

const base = process.env.EXPORTFLOW_PROBE_BASE ?? "http://127.0.0.1:43174";
const outDir = "docs/performance/checkpoint-06-3";
const tag = process.env.EXPORTFLOW_PROBE_TAG ?? "baseline";
mkdirSync(outDir, { recursive: true });

function summarize(samples) {
  const values = samples.map((row) => row.ms).sort((a, b) => a - b);
  const pick = (q) => values[Math.min(values.length - 1, Math.max(0, Math.ceil(q * values.length) - 1))];
  return {
    n: values.length,
    min: values[0] ?? null,
    median: pick(0.5),
    p95: pick(0.95),
    max: values[values.length - 1] ?? null,
    failures: samples.filter((row) => !row.ok).length,
    resets: samples.filter((row) => row.reset).length,
  };
}

async function once(path, init) {
  const started = performance.now();
  try {
    const response = await fetch(`${base}${path}`, init);
    const text = await response.text();
    const reset = text.includes("fetch failed") || text.trimStart().startsWith("<!");
    return {
      path,
      status: response.status,
      ms: Math.round(performance.now() - started),
      ok: response.ok && !reset,
      reset,
      contentType: response.headers.get("content-type") ?? "",
    };
  } catch (error) {
    return {
      path,
      status: 0,
      ms: Math.round(performance.now() - started),
      ok: false,
      reset: String(error?.cause?.code ?? error?.code ?? "").includes("RESET") || /fetch failed|ECONNRESET/i.test(String(error)),
      contentType: "",
      error: error instanceof Error ? error.name : "error",
    };
  }
}

async function series(label, count, path) {
  const samples = [];
  for (let i = 0; i < count; i += 1) samples.push(await once(path));
  return { label, ...summarize(samples), samples };
}

async function parallel(label, count, path) {
  const samples = await Promise.all(Array.from({ length: count }, () => once(path)));
  return { label, ...summarize(samples), samples };
}

function httpOnce(agent, path) {
  return new Promise((resolve) => {
    const started = performance.now();
    const req = http.request(
      { hostname: "127.0.0.1", port: Number(new URL(base).port), path, method: "GET", agent },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const reset = text.includes("fetch failed") || text.trimStart().startsWith("<!");
          resolve({
            path,
            status: res.statusCode ?? 0,
            ms: Math.round(performance.now() - started),
            ok: (res.statusCode ?? 500) < 400 && !reset,
            reset,
          });
        });
      },
    );
    req.on("error", (error) => {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "error";
      resolve({
        path,
        status: 0,
        ms: Math.round(performance.now() - started),
        ok: false,
        reset: code === "ECONNRESET" || /ECONNRESET/i.test(String(error)),
        error: code,
      });
    });
    req.end();
  });
}

async function httpSeries(label, count, agent) {
  const samples = [];
  for (let i = 0; i < count; i += 1) samples.push(await httpOnce(agent, "/api/v1/health"));
  return { label, ...summarize(samples), samples };
}

const healthReady = await once("/api/v1/health");
const api = {
  capturedAt: new Date().toISOString(),
  base,
  note: "Isolated E2E Vite+Miniflare on 43174. Bodies, cookies, and credentials are not stored.",
  healthReady,
  sequential8: await series("health-sequential", 8, "/api/v1/health"),
  parallel2: await parallel("health-parallel-2", 2, "/api/v1/health"),
  parallel4: await parallel("health-parallel-4", 4, "/api/v1/health"),
  parallel8: await parallel("health-parallel-8", 8, "/api/v1/health"),
  keepAlive8: await httpSeries("health-keepalive-8", 8, new http.Agent({ keepAlive: true, maxSockets: 1 })),
  freshAgent8: await httpSeries("health-fresh-agent-8", 8, new http.Agent({ keepAlive: false })),
};

const admin = JSON.parse(readFileSync(".wrangler-e2e/admin.json", "utf8"));
const bootstrapBody = JSON.stringify({ email: admin.email, password: admin.password, name: "E2E Admin" });
const bootstrapHeaders = { "content-type": "application/json", "x-bootstrap-secret": admin.bootstrapSecret, origin: base };
const raced = await Promise.all([
  once("/api/v1/auth/bootstrap", { method: "POST", headers: bootstrapHeaders, body: bootstrapBody }),
  once("/api/v1/auth/bootstrap", { method: "POST", headers: bootstrapHeaders, body: bootstrapBody }),
]);
api.bootstrapRace = { label: "bootstrap-parallel-2", ...summarize(raced), samples: raced.map(({ path, status, ms, ok, reset }) => ({ path, status, ms, ok, reset })) };
if (!raced.some((row) => row.status === 201)) {
  api.bootstrapRetry = await once("/api/v1/auth/bootstrap", { method: "POST", headers: bootstrapHeaders, body: bootstrapBody });
}

const signIn = await fetch(`${base}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ email: admin.email, password: admin.password }),
});
const signInText = await signIn.text();
const setCookies = typeof signIn.headers.getSetCookie === "function" ? signIn.headers.getSetCookie() : [];
const cookie = setCookies.map((value) => value.split(";")[0]).join("; ");
api.signIn = {
  status: signIn.status,
  ms: null,
  ok: signIn.ok && !signInText.includes("fetch failed"),
  reset: signInText.includes("fetch failed") || signInText.trimStart().startsWith("<!"),
  cookieCount: setCookies.length,
};
if (cookie) {
  const changed = await once("/api/v1/me/password", {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, cookie },
    body: JSON.stringify({ currentPassword: admin.password, newPassword: admin.password }),
  });
  api.passwordChange = { status: changed.status, ms: changed.ms, ok: changed.ok, reset: changed.reset };
  const authed = {};
  for (const path of ["/api/v1/me", "/api/v1/dashboard", "/api/v1/export-cases", "/api/v1/bookings", "/api/v1/reminders"]) {
    const samples = [];
    for (let i = 0; i < 5; i += 1) samples.push(await once(path, { headers: { cookie } }));
    authed[path] = { ...summarize(samples), samples: samples.map(({ status, ms, ok, reset }) => ({ status, ms, ok, reset })) };
  }
  api.authenticated = authed;
}
if (cookie) {
  const reused = await playwrightRequest.newContext({ baseURL: base, extraHTTPHeaders: { cookie, origin: base } });
  const hit = async () => {
    const started = performance.now();
    const response = await reused.get("/api/v1/dashboard");
    const text = await response.text();
    const reset = text.includes("fetch failed") || text.trimStart().startsWith("<!");
    return { status: response.status(), ms: Math.round(performance.now() - started), ok: response.ok() && !reset, reset };
  };
  const sequential = [];
  for (let i = 0; i < 12; i += 1) sequential.push(await hit());
  const parallel = await Promise.all(Array.from({ length: 8 }, () => hit()));
  api.playwrightReuse = {
    sequential: { ...summarize(sequential), samples: sequential },
    parallel8: { ...summarize(parallel), samples: parallel },
  };
  await reused.dispose();
}
writeFileSync(`${outDir}/${tag}-api.json`, JSON.stringify(api, null, 2));
if (!api.signIn?.ok) {
  writeFileSync(`${outDir}/${tag}-browser.json`, JSON.stringify({
    capturedAt: new Date().toISOString(),
    skipped: "sign-in did not return a session; browser journeys were not run against an unknown account",
    journeys: [],
    consoleEvents: [],
  }, null, 2));
  console.log(JSON.stringify({ signIn: api.signIn, bootstrap: api.bootstrapRace, retry: api.bootstrapRetry ?? null }, null, 2));
  process.exit(0);
}

const browser = await chromium.launch({ channel: "chrome", args: ["--disable-dev-shm-usage"] });
try {
const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "en-US" });
const page = await context.newPage();
const consoleEvents = [];
const requests = [];
page.on("console", (message) => {
  const type = message.type();
  if (type !== "error" && type !== "warning") return;
  consoleEvents.push({ type, text: message.text().slice(0, 240) });
});
page.on("pageerror", (error) => {
  consoleEvents.push({ type: "pageerror", text: String(error.message).slice(0, 240) });
});
page.on("response", (response) => {
  const url = new URL(response.url());
  if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/src/")) return;
  requests.push({ method: response.request().method(), path: url.pathname, status: response.status() });
});
page.on("requestfailed", (request) => {
  const url = new URL(request.url());
  requests.push({
    method: request.method(),
    path: url.pathname,
    status: 0,
    failed: request.failure()?.errorText?.slice(0, 120) ?? "failed",
  });
});

async function journey(name, action) {
  const started = performance.now();
  const before = requests.length;
  const beforeConsole = consoleEvents.length;
  await action();
  return {
    name,
    ms: Math.round(performance.now() - started),
    apiCalls: requests.slice(before).filter((row) => row.path.startsWith("/api/")),
    srcRequests: requests.slice(before).filter((row) => row.path.startsWith("/src/")).length,
    consoleAdded: consoleEvents.slice(beforeConsole),
  };
}

const journeys = [];
try {
journeys.push(await journey("login", async () => {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  const signInForm = page.locator("form").first();
  await signInForm.locator('input[name="email"]').fill(admin.email);
  await signInForm.locator('input[name="password"]').fill(admin.password);
  await signInForm.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(dashboard|change-password)/, { timeout: 30_000, waitUntil: "commit" });
  if (page.url().includes("change-password")) {
    await page.locator('input[name="currentPassword"]').fill(admin.password);
    await page.locator('input[name="newPassword"]').fill(admin.password);
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL("**/dashboard", { timeout: 30_000 });
  }
  await page.getByRole("heading", { name: /Operations desk|برج/ }).waitFor({ timeout: 30_000 });
}));
for (const [name, path, heading] of [
  ["dashboard-reload", "/dashboard", "Operations desk"],
  ["cases", "/export-cases", "Export operations"],
  ["bookings", "/bookings", "Bookings"],
  ["schedule", "/schedule", "Shipping schedule"],
  ["reminders", "/reminders", "Reminders"],
  ["settings", "/settings", "Settings"],
]) {
  journeys.push(await journey(name, async () => {
    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: heading, level: 1 }).waitFor({ timeout: 20_000 });
  }));
}
for (let i = 1; i <= 5; i += 1) {
  journeys.push(await journey(`dashboard-warm-${i}`, async () => {
    await page.goto(`${base}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: /Operations desk|برج/ }).waitFor({ timeout: 20_000 });
  }));
}
journeys.push(await journey("spa-cases", async () => {
  await page.getByRole("link", { name: "Export operations", exact: true }).click();
  await page.getByRole("heading", { name: "Export operations", level: 1 }).waitFor({ timeout: 20_000 });
}));
journeys.push(await journey("spa-dashboard", async () => {
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await page.getByRole("heading", { name: /Operations desk|برج/ }).waitFor({ timeout: 20_000 });
}));
await page.setViewportSize({ width: 390, height: 844 });
journeys.push(await journey("dashboard-390", async () => {
  await page.goto(`${base}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.locator("h1").first().waitFor({ timeout: 20_000 });
}));

} finally {
const apiPaths = requests.filter((row) => row.path.startsWith("/api/")).map((row) => row.path);
const counts = {};
for (const path of apiPaths) counts[path] = (counts[path] ?? 0) + 1;

writeFileSync(`${outDir}/${tag}-api.json`, JSON.stringify(api, null, 2));
writeFileSync(`${outDir}/${tag}-browser.json`, JSON.stringify({
  capturedAt: new Date().toISOString(),
  journeys,
  apiPathCounts: counts,
  consoleEvents,
  requestCount: requests.length,
}, null, 2));
}
console.log(JSON.stringify({
  sequential: api.sequential8,
  parallel2: { failures: api.parallel2.failures, resets: api.parallel2.resets, median: api.parallel2.median },
  parallel8: { failures: api.parallel8.failures, resets: api.parallel8.resets, median: api.parallel8.median },
  journeys: journeys.map((row) => ({ name: row.name, ms: row.ms, api: row.apiCalls.length, console: row.consoleAdded.length })),
  console: consoleEvents.length,
}, null, 2));
} finally {
  await browser.close();
}
