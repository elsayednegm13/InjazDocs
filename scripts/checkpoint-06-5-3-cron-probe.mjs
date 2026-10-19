import { DatabaseSync } from "node:sqlite";

const sqlitePath =
  ".wrangler-perf/state/v3/d1/miniflare-D1DatabaseObject/e086a16c2df761e404ed26001d3f081a26268e90033ffbf14d8419a939ea8dbc.sqlite";
const base = process.env.EXPORTFLOW_BASE || "http://127.0.0.1:43176";
const capMs = Number(process.env.CRON_CAP_MS || 180000);

function snapshot() {
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  const due = db.prepare(
    "SELECT COUNT(*) AS n FROM reminder_instances WHERE status IN ('PENDING','ACTIVE','SNOOZED','ACKNOWLEDGED') AND due_at <= ?",
  ).get(new Date().toISOString());
  const evaluated = db.prepare("SELECT COUNT(*) AS n FROM reminder_instances WHERE last_evaluated_at IS NOT NULL").get();
  const deliveries = db.prepare("SELECT COUNT(*) AS n FROM notification_deliveries").get();
  const newest = db.prepare("SELECT MAX(last_evaluated_at) AS at FROM reminder_instances").get();
  db.close();
  return { at: new Date().toISOString(), due: due.n, evaluated: evaluated.n, deliveries: deliveries.n, newest: newest.at };
}

const before = snapshot();
const started = Date.now();
let http = { status: 0, ms: 0, body: "" };
try {
  const response = await fetch(`${base}/cdn-cgi/local/scheduled`, { signal: AbortSignal.timeout(Number(process.env.CRON_HTTP_MS || 90000)) });
  http = { status: response.status, ms: Date.now() - started, body: (await response.text()).slice(0, 240) };
} catch (error) {
  const cause = error instanceof Error && "cause" in error ? error.cause : undefined;
  const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
  http = { status: 0, ms: Date.now() - started, body: error instanceof Error ? `${error.name}:${code}` : "error" };
}

const samples = [before];
const deadline = Date.now() + capMs;
const minWindow = Date.now() + 25000;
let stable = 0;
let previous = "";
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const next = snapshot();
  samples.push(next);
  const key = JSON.stringify({ due: next.due, evaluated: next.evaluated, deliveries: next.deliveries, newest: next.newest });
  stable = key === previous ? stable + 1 : 0;
  previous = key;
  if (Date.now() >= minWindow && stable >= 3) break;
}
const after = samples.at(-1);
console.log(JSON.stringify({
  http,
  before,
  after,
  samples: samples.length,
  elapsedMs: Date.now() - started,
  changed: before.evaluated !== after.evaluated || before.deliveries !== after.deliveries || before.due !== after.due,
  capMs,
}, null, 2));
