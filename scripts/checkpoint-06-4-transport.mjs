import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { perfRoot } from "./checkpoint-06-4-guard.mjs";

const base = process.env.EXPORTFLOW_PROBE_BASE ?? "http://127.0.0.1:43176";
const accounts = JSON.parse(readFileSync(path.join(perfRoot, "accounts.json"), "utf8"));
const outDir = "docs/performance/checkpoint-06-4";
mkdirSync(outDir, { recursive: true });

async function once(urlPath, init) {
  const started = performance.now();
  try {
    const response = await fetch(`${base}${urlPath}`, init);
    const text = await response.text();
    const reset = text.includes("fetch failed") || text.trimStart().startsWith("<!");
    return { status: response.status, ms: Math.round(performance.now() - started), ok: response.ok && !reset, reset, cause: null };
  } catch (error) {
    const cause = error?.cause;
    return {
      status: 0,
      ms: Math.round(performance.now() - started),
      ok: false,
      reset: true,
      cause: [error?.name, error?.code, cause?.name, cause?.code].filter(Boolean).join(">"),
    };
  }
}

const signed = await once("/api/auth/sign-in/email", {
  method: "POST",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ email: accounts.email, password: accounts.password }),
});
const cookieResponse = await fetch(`${base}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ email: accounts.email, password: accounts.password }),
});
const cookie = cookieResponse.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
const auth = { headers: { cookie, origin: base } };

function freshOnce(urlPath) {
  const started = performance.now();
  const url = new URL(`${base}${urlPath}`);
  return new Promise((resolve) => {
    const req = httpRequest({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "GET",
      headers: { cookie, origin: base, connection: "close" },
      agent: false,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const reset = text.includes("fetch failed");
        resolve({ status: response.statusCode ?? 0, ms: Math.round(performance.now() - started), ok: response.statusCode === 200 && !reset, reset, cause: null });
      });
    });
    req.on("error", (error) => {
      resolve({ status: 0, ms: Math.round(performance.now() - started), ok: false, reset: true, cause: [error.name, error.code].filter(Boolean).join(">") });
    });
    req.end();
  });
}

async function series(label, gapMs, init) {
  const rows = [];
  for (let i = 0; i < 8; i += 1) {
    if (gapMs) await new Promise((resolve) => setTimeout(resolve, gapMs));
    rows.push(init === "fresh" ? await freshOnce("/api/v1/dashboard") : await once("/api/v1/dashboard", init));
  }
  return { label, gapMs, resets: rows.filter((row) => row.reset).length, failures: rows.filter((row) => !row.ok).length, samples: rows };
}

const result = {
  capturedAt: new Date().toISOString(),
  route: "/api/v1/dashboard",
  dataset: "large",
  signIn: { status: signed.status, reset: signed.reset, cause: signed.cause, ms: signed.ms },
  immediateKeepAlive: await series("immediate-keepalive", 0, auth),
  idle6s: await series("idle-6s", 6000, auth),
  freshConnection: await series("fresh-connection", 0, "fresh"),
};
writeFileSync(path.join(outDir, "transport-large.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({
  signIn: result.signIn,
  immediate: { resets: result.immediateKeepAlive.resets, failures: result.immediateKeepAlive.failures },
  idle6s: { resets: result.idle6s.resets, failures: result.idle6s.failures, causes: result.idle6s.samples.filter((row) => row.cause).map((row) => row.cause) },
  fresh: { resets: result.freshConnection.resets, failures: result.freshConnection.failures },
}, null, 2));
