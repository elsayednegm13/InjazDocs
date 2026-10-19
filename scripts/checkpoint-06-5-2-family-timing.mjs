import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const accounts = JSON.parse(readFileSync(".wrangler-perf/accounts.json", "utf8"));
const base = accounts.base;
if (base !== "http://127.0.0.1:43176") throw new Error("Unexpected perf base");

const ruleIds = [
  "rr-doc-due",
  "rr-review",
  "rr-bank",
  "rr-courier",
  "rr-load",
  "rr-cutoff",
  "rr-etd",
  "rr-ctr",
  "rr-eta",
  "rr-arr",
  "rr-goods",
];

const sign = await fetch(`${base}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ email: accounts.email, password: accounts.password }),
});
if (!sign.ok) {
  console.log(JSON.stringify({ step: "sign-in", status: sign.status }));
  process.exit(1);
}
const cookie = (typeof sign.headers.getSetCookie === "function" ? sign.headers.getSetCookie() : [])
  .map((value) => value.split(";")[0])
  .join("; ");
const headers = { cookie, origin: base, "content-type": "application/json" };
const rulesResponse = await fetch(`${base}/api/v1/reminder-rules`, { headers });
const rulesBody = await rulesResponse.json();
const rows = rulesBody.data ?? rulesBody;
const results = [];
for (const id of ruleIds) {
  const rule = rows.find((item) => item.id === id);
  const offset = rule?.offsetAmount ?? rule?.offset_amount;
  if (!Number.isInteger(offset)) {
    results.push({ id, step: "missing-rule", status: rulesResponse.status });
    continue;
  }
  const started = performance.now();
  let status = 0;
  let fetchFailed = false;
  let html = false;
  let error = null;
  try {
    const patch = await fetch(`${base}/api/v1/reminder-rules/${id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ offsetAmount: offset }),
    });
    status = patch.status;
    const text = await patch.text();
    fetchFailed = text.includes("fetch failed");
    html = text.trimStart().startsWith("<");
  } catch (cause) {
    error = cause?.cause?.code || cause?.name || "fetch-error";
  }
  const duration = Math.round(performance.now() - started);
  const row = { id, family: rule.family, status, duration_ms: duration, fetch_failed: fetchFailed, html, error };
  results.push(row);
  console.log(JSON.stringify(row));
}
mkdirSync("docs/performance/checkpoint-06-5-2", { recursive: true });
writeFileSync(
  "docs/performance/checkpoint-06-5-2/family-patch-after.json",
  JSON.stringify({ capturedAt: new Date().toISOString(), base, results }, null, 2),
);
