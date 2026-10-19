import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { perfRoot } from "./checkpoint-06-4-guard.mjs";

const base = process.env.EXPORTFLOW_PROBE_BASE ?? "http://127.0.0.1:43176";
const tag = process.env.EXPORTFLOW_PROBE_TAG ?? "dev-medium";
const dataset = process.env.EXPORTFLOW_PROBE_DATASET ?? "medium";
const samples = Number(process.env.EXPORTFLOW_PROBE_SAMPLES ?? 20);
const outDir = "docs/performance/checkpoint-06-4";
mkdirSync(outDir, { recursive: true });
const accounts = JSON.parse(readFileSync(path.join(perfRoot, "accounts.json"), "utf8"));

function summary(rows) {
  const values = rows.map((row) => row.ms).sort((a, b) => a - b);
  const pick = (q) => values[Math.min(values.length - 1, Math.max(0, Math.ceil(q * values.length) - 1))];
  return {
    n: values.length,
    min: values[0] ?? null,
    p50: pick(0.5),
    p95: values.length >= 20 ? pick(0.95) : null,
    p95Label: values.length >= 20 ? "sample" : "weak-not-reported",
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
      json: (response.headers.get("content-type") ?? "").includes("json"),
    };
  } catch (error) {
    const code = error?.cause?.code ?? error?.code ?? "";
    return {
      status: 0,
      ms: Math.round(performance.now() - started),
      ok: false,
      reset: String(code).includes("RESET") || /fetch failed|ECONNRESET/i.test(String(error)),
      json: false,
      error: String(code || error?.name || "error"),
    };
  }
}

async function series(urlPath, init) {
  for (let i = 0; i < 2; i += 1) await once(urlPath, init);
  const rows = [];
  for (let i = 0; i < samples; i += 1) rows.push(await once(urlPath, init));
  return { path: urlPath.split("?")[0], ...summary(rows), samples: rows.map(({ status, ms, ok, reset }) => ({ status, ms, ok, reset })) };
}

const signInAttempts = [];
let signed = null;
for (let attempt = 0; attempt < 3; attempt += 1) {
  signed = await once("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email: accounts.email, password: accounts.password }),
  });
  signInAttempts.push({ status: signed.status, ms: signed.ms, ok: signed.ok, reset: signed.reset, error: signed.error ?? null });
  if (signed.ok) break;
}
if (!signed?.ok) {
  writeFileSync(`${outDir}/${tag}.json`, JSON.stringify({ tag, dataset, base, signInAttempts }, null, 2));
  console.log(JSON.stringify({ tag, signInAttempts }));
  process.exit(1);
}
let cookie = "";
for (let attempt = 0; attempt < 3 && !cookie; attempt += 1) {
  const cookieResponse = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email: accounts.email, password: accounts.password }),
  });
  const text = await cookieResponse.text();
  const reset = text.includes("fetch failed") || text.trimStart().startsWith("<!");
  signInAttempts.push({ status: cookieResponse.status, ok: cookieResponse.ok && !reset, reset, error: reset ? "transport" : null });
  if (!reset && cookieResponse.ok) cookie = cookieResponse.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}
if (!cookie) {
  writeFileSync(`${outDir}/${tag}.json`, JSON.stringify({ tag, dataset, base, signInAttempts }, null, 2));
  process.exit(1);
}
const auth = { headers: { cookie, origin: base } };
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
const result = { tag, dataset, base, capturedAt: new Date().toISOString(), samples, signInAttempts, routes: {} };
for (const urlPath of paths) {
  const init = urlPath.startsWith("/api/v1/health") ? undefined : auth;
  result.routes[urlPath.split("?")[0]] = await series(urlPath, init);
}
const parallel = {};
if (process.env.EXPORTFLOW_PROBE_SKIP_PARALLEL !== "1") {
for (const count of [1, 2, 4, 8, 16]) {
  const rounds = count === 16 ? 4 : 8;
  const rows = [];
  for (let round = 0; round < rounds; round += 1) {
    const batch = await Promise.all(Array.from({ length: count }, () => once("/api/v1/dashboard", auth)));
    rows.push(...batch);
  }
  parallel[count] = { ...summary(rows), samples: rows.map(({ status, ms, ok, reset }) => ({ status, ms, ok, reset })) };
}
}
result.dashboardParallel = parallel;
writeFileSync(`${outDir}/${tag}.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({
  tag,
  dashboard: { p50: result.routes["/api/v1/dashboard"].p50, failures: result.routes["/api/v1/dashboard"].failures, resets: result.routes["/api/v1/dashboard"].resets },
  cases: { p50: result.routes["/api/v1/export-cases"].p50, failures: result.routes["/api/v1/export-cases"].failures },
  detail: { p50: result.routes["/api/v1/export-cases/pcase-0"].p50, failures: result.routes["/api/v1/export-cases/pcase-0"].failures, resets: result.routes["/api/v1/export-cases/pcase-0"].resets },
  parallel8: parallel[8] ? { p50: parallel[8].p50, failures: parallel[8].failures, resets: parallel[8].resets, n: parallel[8].n } : null,
}, null, 2));
