import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { assertPerfPath, perfRoot } from "./checkpoint-06-4-guard.mjs";

const launches = Number(process.env.EXPORTFLOW_COLD_N ?? 10);
const port = process.env.EXPORTFLOW_PORT ?? "43178";
const label = process.env.EXPORTFLOW_COLD_LABEL ?? "baseline";
const base = `http://127.0.0.1:${port}`;
const root = process.cwd();
const persist = assertPerfPath(path.join(perfRoot, "state"));
const accounts = JSON.parse(readFileSync(path.join(perfRoot, "accounts.json"), "utf8"));
const outDir = process.env.EXPORTFLOW_COLD_OUT ?? "docs/performance/checkpoint-06-5";
const logDir = path.join(outDir, `cold-logs-${label}`);
mkdirSync(logDir, { recursive: true });

function killTree(pid) {
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore" });
    killer.on("exit", () => resolve());
  });
}

async function waitHealth() {
  const started = Date.now();
  while (Date.now() - started < 90_000) {
    try {
      const response = await fetch(`${base}/api/v1/health`);
      if (response.ok) return Date.now() - started;
    } catch {
      // server still booting
    }
    await delay(400);
  }
  return null;
}

const rows = [];
for (let i = 0; i < launches; i += 1) {
  const logPath = path.join(logDir, `launch-${i}.log`);
  writeFileSync(logPath, "");
  const child = spawn(
    process.execPath,
    [path.join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", port, "--strictPort"],
    {
      cwd: root,
      env: {
        ...process.env,
        EXPORTFLOW_PORT: port,
        EXPORTFLOW_PERSIST: persist,
        CLOUDFLARE_ENV: "perf",
        EXPORTFLOW_TRACE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const chunks = [];
  const capture = (buf) => {
    chunks.push(buf);
    appendFileSync(logPath, buf);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  const healthMs = await waitHealth();
  const started = Date.now();
  let sign = { status: 0, ms: null, ok: false, reset: false, error: healthMs == null ? "no-health" : null };
  if (healthMs != null) {
    try {
      const response = await fetch(`${base}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: JSON.stringify({ email: accounts.email, password: accounts.password }),
      });
      const text = await response.text();
      const reset = text.includes("fetch failed") || text.trimStart().startsWith("<!");
      sign = {
        status: response.status,
        ms: Date.now() - started,
        ok: response.ok && !reset,
        reset,
        error: reset ? "transport-html" : null,
      };
    } catch (error) {
      sign = {
        status: 0,
        ms: Date.now() - started,
        ok: false,
        reset: true,
        error: error?.cause?.code ?? error?.code ?? error?.name ?? "fetch-threw",
      };
    }
  }
  await delay(250);
  const log = Buffer.concat(chunks).toString("utf8");
  const traceLine = log.match(/\[exportflow-trace\][^\n]*sign-in[^\n]*/)?.[0] ?? null;
  const handlerLine = log.match(/\[exportflow-handler\][^\n]*sign-in[^\n]*/)?.[0] ?? null;
  rows.push({
    i,
    healthMs,
    status: sign.status,
    ms: sign.ms,
    ok: sign.ok,
    reset: sign.reset,
    error: sign.error,
    handler: handlerLine ? "reached" : "not-in-log",
    traceLine,
    handlerLine,
  });
  await killTree(child.pid);
  await delay(600);
  console.log(JSON.stringify({ i, healthMs, status: sign.status, reset: sign.reset, ok: sign.ok, handler: rows.at(-1).handler }));
}

const summary = {
  label,
  port,
  n: rows.length,
  ok: rows.filter((row) => row.ok).length,
  reset: rows.filter((row) => row.reset).length,
  reachedHono: rows.filter((row) => row.handler === "reached").length,
  capturedAt: new Date().toISOString(),
  rows,
};
writeFileSync(path.join(outDir, `cold-signin-${label}.json`), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ label, ok: summary.ok, reset: summary.reset, n: summary.n, reachedHono: summary.reachedHono }));
