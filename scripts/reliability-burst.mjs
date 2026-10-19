import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const base = process.argv[2];
const arm = process.argv[3] ?? "unknown";
if (!base || !base.startsWith("http://127.0.0.1:")) {
  throw new Error("Pass a loopback base URL");
}
const outDir = path.join(process.cwd(), "docs/reliability/checkpoint-06-5-1");
mkdirSync(outDir, { recursive: true });

async function hit(route) {
  const started = performance.now();
  try {
    const response = await fetch(base + route, { headers: { "x-request-id": `rel-${arm}` } });
    const text = await response.text();
    return {
      route,
      status: response.status,
      duration_ms: Math.round(performance.now() - started),
      fetch_failed: text.includes("fetch failed"),
      html: text.trimStart().startsWith("<"),
      error_cause_code: null,
    };
  } catch (error) {
    const cause = error && typeof error === "object" && "cause" in error ? error.cause : undefined;
    const code = cause && typeof cause === "object" && cause && "code" in cause ? String(cause.code) : null;
    return {
      route,
      status: 0,
      duration_ms: Math.round(performance.now() - started),
      fetch_failed: true,
      html: false,
      error_cause_code: code ?? (error instanceof Error ? error.name : "Error"),
    };
  }
}

async function wave(concurrency, count, route) {
  const rows = [];
  let pending = 0;
  let index = 0;
  await new Promise((resolve) => {
    const next = () => {
      if (index >= count && pending === 0) {
        resolve();
        return;
      }
      while (pending < concurrency && index < count) {
        pending += 1;
        index += 1;
        hit(route).then((row) => {
          rows.push({ ...row, concurrency });
          pending -= 1;
          next();
        });
      }
    };
    next();
  });
  return rows;
}

const routes = ["/api/v1/health", "/api/v1/auth/bootstrap-status", "/api/v1/me"];
const samples = [];
for (const route of routes) samples.push(...await wave(1, 20, route));
for (const concurrency of [4, 8, 16]) {
  for (const route of routes) samples.push(...await wave(concurrency, 16, route));
}
const scheduled = await hit("/cdn-cgi/local/scheduled?format=json");
const summary = {
  arm,
  base,
  time_utc: new Date().toISOString(),
  observations: samples.length,
  fetch_failed: samples.filter((row) => row.fetch_failed).length,
  statuses: samples.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {}),
  scheduled: { status: scheduled.status, fetch_failed: scheduled.fetch_failed, html: scheduled.html, duration_ms: scheduled.duration_ms },
};
const file = path.join(outDir, `burst-${arm}.json`);
writeFileSync(file, JSON.stringify({ summary, samples }, null, 2));
console.log(JSON.stringify(summary));
