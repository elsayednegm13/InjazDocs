import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const accounts = JSON.parse(readFileSync(".wrangler-perf/accounts.json", "utf8"));
const base = "http://127.0.0.1:43177";
const sqlitePath =
  ".wrangler-0653/state/v3/d1/miniflare-D1DatabaseObject/e086a16c2df761e404ed26001d3f081a26268e90033ffbf14d8419a939ea8dbc.sqlite";
const ruleId = process.argv[2] || "rr-courier";

function offsetOf() {
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  const row = db.prepare("SELECT offset_amount, offset_direction FROM reminder_rule_definitions WHERE id = ?").get(ruleId);
  db.close();
  return row;
}

const before = offsetOf();
const sign = await fetch(`${base}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ email: accounts.email, password: accounts.password }),
  signal: AbortSignal.timeout(20000),
});
const cookie = (typeof sign.headers.getSetCookie === "function" ? sign.headers.getSetCookie() : [])
  .map((value) => value.split(";")[0])
  .join("; ");
if (!sign.ok || !cookie) {
  console.log(JSON.stringify({ step: "sign-in", status: sign.status, cookie: Boolean(cookie) }));
  process.exit(1);
}
const started = Date.now();
const patch = await fetch(`${base}/api/v1/reminder-rules/${ruleId}`, {
  method: "PATCH",
  headers: { cookie, origin: base, "content-type": "application/json" },
  body: JSON.stringify({ offsetAmount: before.offset_amount }),
  signal: AbortSignal.timeout(60000),
});
const text = await patch.text();
const after = offsetOf();
console.log(JSON.stringify({
  ruleId,
  signStatus: sign.status,
  patchStatus: patch.status,
  ms: Date.now() - started,
  fetchFailed: text.includes("fetch failed"),
  code: text.includes("REMINDER") ? text.slice(0, 220) : text.slice(0, 120),
  before,
  after,
  unchanged: before.offset_amount === after.offset_amount && before.offset_direction === after.offset_direction,
}, null, 2));
