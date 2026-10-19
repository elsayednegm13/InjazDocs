import { readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { perfRoot } from "./checkpoint-06-4-guard.mjs";

const base = "http://127.0.0.1:43176";
const accounts = JSON.parse(readFileSync(path.join(perfRoot, "accounts.json"), "utf8"));
const signed = await fetch(`${base}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ email: accounts.email, password: accounts.password }),
});
if (!signed.ok) {
  console.log(JSON.stringify({ signIn: signed.status }));
  process.exit(1);
}
const cookie = signed.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
const auth = { headers: { cookie, origin: base } };
async function sample(url) {
  const rows = [];
  for (let i = 0; i < 20; i += 1) {
    const started = performance.now();
    const response = await fetch(`${base}${url}`, auth);
    const text = await response.text();
    rows.push({ status: response.status, ms: Math.round(performance.now() - started), reset: text.includes("fetch failed") });
  }
  const values = rows.map((row) => row.ms).sort((a, b) => a - b);
  const pick = (q) => values[Math.ceil(q * values.length) - 1];
  return { p50: pick(0.5), p95: pick(0.95), resets: rows.filter((row) => row.reset).length, failures: rows.filter((row) => row.status !== 200).length };
}
console.log(JSON.stringify({
  dashboard: await sample("/api/v1/dashboard"),
  detail: await sample("/api/v1/export-cases/pcase-0"),
}));
