import { readFileSync } from "node:fs";

const accounts = JSON.parse(readFileSync(".wrangler-perf/accounts.json", "utf8"));
const base = accounts.base;
if (base !== "http://127.0.0.1:43176") throw new Error("Unexpected perf base");

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
const rules = await rulesResponse.json();
const rows = rules.data ?? rules;
const rule = rows.find((item) => item.id === "rr-doc-due");
const offset = rule?.offset_amount ?? rule?.offsetAmount;
if (!Number.isInteger(offset)) {
  console.log(JSON.stringify({ step: "rule", status: rulesResponse.status, keys: rule ? Object.keys(rule) : [] }));
  process.exit(1);
}
const started = performance.now();
const patch = await fetch(`${base}/api/v1/reminder-rules/rr-doc-due`, {
  method: "PATCH",
  headers,
  body: JSON.stringify({ offsetAmount: offset }),
});
const duration = Math.round(performance.now() - started);
const text = await patch.text();
console.log(JSON.stringify({
  step: "patch-same-offset",
  status: patch.status,
  duration_ms: duration,
  fetch_failed: text.includes("fetch failed"),
  html: text.trimStart().startsWith("<"),
}));
