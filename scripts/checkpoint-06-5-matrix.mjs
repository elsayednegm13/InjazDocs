import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { perfRoot } from "./checkpoint-06-4-guard.mjs";

const base = process.env.EXPORTFLOW_PROBE_BASE ?? "http://127.0.0.1:43176";
const samples = Number(process.env.EXPORTFLOW_PROBE_SAMPLES ?? 20);
const outDir = "docs/performance/checkpoint-06-5";
mkdirSync(outDir, { recursive: true });
const accounts = JSON.parse(readFileSync(path.join(perfRoot, "accounts.json"), "utf8"));
const tracks = JSON.parse(readFileSync(path.join(perfRoot, "tracks.json"), "utf8")).tracks;

function summary(rows) {
  const values = rows.map((row) => row.ms).sort((a, b) => a - b);
  const pick = (q) => values[Math.min(values.length - 1, Math.max(0, Math.ceil(q * values.length) - 1))];
  return {
    n: values.length,
    min: values[0] ?? null,
    p50: pick(0.5),
    p95: values.length >= 20 ? pick(0.95) : null,
    max: values[values.length - 1] ?? null,
    failures: rows.filter((row) => !row.ok).length,
    resets: rows.filter((row) => row.reset).length,
  };
}

async function once(urlPath, init) {
  const started = performance.now();
  try {
    const response = await fetch(`${base}${urlPath}`, init);
    const text = await response.text();
    const reset = text.includes("fetch failed") || text.trimStart().startsWith("<!");
    return {
      status: response.status,
      ms: Math.round(performance.now() - started),
      ok: response.ok && !reset,
      reset,
      text,
    };
  } catch (error) {
    const code = error?.cause?.code ?? error?.code ?? "";
    return {
      status: 0,
      ms: Math.round(performance.now() - started),
      ok: false,
      reset: String(code).includes("RESET") || /fetch failed|ECONNRESET/i.test(String(error)),
      text: "",
      error: String(code || error?.name || "error"),
    };
  }
}

async function cookieFor(email, password) {
  const attempts = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${base}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ email, password }),
    });
    const text = await response.text();
    const reset = text.includes("fetch failed") || text.trimStart().startsWith("<!");
    attempts.push({ status: response.status, ok: response.ok && !reset, reset });
    if (!reset && response.ok) {
      return { cookie: response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; "), attempts };
    }
  }
  return { cookie: "", attempts };
}

const admin = await cookieFor(accounts.email, accounts.password);
if (!admin.cookie) {
  writeFileSync(`${outDir}/dev-large-baseline.json`, JSON.stringify({ signIn: admin.attempts }, null, 2));
  console.log(JSON.stringify({ signIn: admin.attempts }));
  process.exit(1);
}
const auth = { headers: { cookie: admin.cookie, origin: base } };
const paths = [
  "/api/v1/health",
  "/api/v1/me",
  "/api/v1/dashboard",
  "/api/v1/export-cases?page=1&pageSize=20",
  "/api/v1/export-cases/pcase-0",
  "/api/v1/bookings",
  "/api/v1/reminders",
  "/api/v1/schedule",
];
const routes = {};
for (const urlPath of paths) {
  const init = urlPath.startsWith("/api/v1/health") ? undefined : auth;
  for (let i = 0; i < 2; i += 1) await once(urlPath, init);
  const rows = [];
  for (let i = 0; i < samples; i += 1) rows.push(await once(urlPath, init));
  routes[urlPath.split("?")[0]] = {
    path: urlPath.split("?")[0],
    ...summary(rows),
    samples: rows.map(({ status, ms, ok, reset }) => ({ status, ms, ok, reset })),
  };
}

const parallel = {};
for (const count of [1, 2, 4, 8, 16]) {
  const rounds = count === 16 ? 4 : 8;
  const rows = [];
  for (let round = 0; round < rounds; round += 1) {
    rows.push(...(await Promise.all(Array.from({ length: count }, () => once("/api/v1/dashboard", auth)))));
  }
  parallel[count] = { ...summary(rows), samples: rows.map(({ status, ms, ok, reset }) => ({ status, ms, ok, reset })) };
}

const idle = [];
for (const seconds of [1, 3, 6, 15, 30]) {
  await delay(seconds * 1000);
  const row = await once("/api/v1/dashboard", auth);
  idle.push({ seconds, status: row.status, ms: row.ms, ok: row.ok, reset: row.reset, error: row.error ?? null });
}

const serial = [];
for (let i = 0; i < 100; i += 1) serial.push(await once("/api/v1/export-cases/pcase-0", auth));

const officer = await cookieFor(accounts.officerEmail, accounts.officerPassword);
let officerScope = { signIn: officer.attempts };
if (officer.cookie) {
  const officerAuth = { headers: { cookie: officer.cookie, origin: base } };
  const dash = await once("/api/v1/dashboard", officerAuth);
  const list = await once("/api/v1/export-cases?page=1&pageSize=20", officerAuth);
  const dashJson = dash.text ? JSON.parse(dash.text) : null;
  const listJson = list.text ? JSON.parse(list.text) : null;
  officerScope = {
    signIn: officer.attempts,
    dashboardStatus: dash.status,
    listStatus: list.status,
    dashboardTotal: dashJson?.data?.counts?.total_cases ?? null,
    listTotal: listJson?.meta?.total ?? null,
  };
}

const before = await once("/api/v1/customers?page=1&pageSize=1", auth);
const beforeTotal = before.text ? JSON.parse(before.text).meta?.total : null;
const created = await once("/api/v1/customers", {
  method: "POST",
  headers: { ...auth.headers, "content-type": "application/json" },
  body: JSON.stringify({ legalName: "CP065 Disposable Probe", countryCode: "NL" }),
});
const after = await once("/api/v1/customers?page=1&pageSize=1", auth);
const afterTotal = after.text ? JSON.parse(after.text).meta?.total : null;

const active = tracks.find((row) => !row.revoked);
const revoked = tracks.find((row) => row.revoked);
const activeTrack = await once(`/api/v1/public/track/${active.token}`);
const revokedTrack = await once(`/api/v1/public/track/${revoked.token}`);
const activeJson = activeTrack.text && activeTrack.text.startsWith("{") ? JSON.parse(activeTrack.text) : null;

const result = {
  capturedAt: new Date().toISOString(),
  base,
  dataset: "large",
  samples,
  signIn: admin.attempts,
  routes,
  dashboardParallel: parallel,
  idle,
  serialCaseReads: { ...summary(serial), n: serial.length },
  officerScope,
  mutation: {
    beforeTotal,
    createStatus: created.status,
    createReset: created.reset,
    afterTotal,
    committedOnce: afterTotal === beforeTotal + 1,
  },
  publicTrack: {
    activeStatus: activeTrack.status,
    revokedStatus: revokedTrack.status,
    activeHasInvoiceTotal: activeJson ? Object.prototype.hasOwnProperty.call(JSON.stringify(activeJson) ? activeJson : {}, "x") || JSON.stringify(activeJson).includes("invoice_total") : null,
    activeLeaksInvoice: activeTrack.text.includes("invoice_total") || activeTrack.text.includes("goods_value"),
  },
};
writeFileSync(`${outDir}/dev-large-baseline.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({
  dashboard: { p50: routes["/api/v1/dashboard"].p50, p95: routes["/api/v1/dashboard"].p95, failures: routes["/api/v1/dashboard"].failures, resets: routes["/api/v1/dashboard"].resets },
  detail: { p50: routes["/api/v1/export-cases/pcase-0"].p50, failures: routes["/api/v1/export-cases/pcase-0"].failures, resets: routes["/api/v1/export-cases/pcase-0"].resets },
  parallel8: { p50: parallel[8].p50, failures: parallel[8].failures, n: parallel[8].n },
  parallel16: { p50: parallel[16].p50, failures: parallel[16].failures, n: parallel[16].n },
  idleResets: idle.filter((row) => row.reset).length,
  serial: result.serialCaseReads,
  officerScope: { dashboardTotal: officerScope.dashboardTotal, listTotal: officerScope.listTotal },
  mutation: result.mutation,
  publicTrack: { active: activeTrack.status, revoked: revokedTrack.status, leak: result.publicTrack.activeLeaksInvoice },
}, null, 2));
