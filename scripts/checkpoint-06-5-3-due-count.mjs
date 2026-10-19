import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(
  ".wrangler-perf/state/v3/d1/miniflare-D1DatabaseObject/e086a16c2df761e404ed26001d3f081a26268e90033ffbf14d8419a939ea8dbc.sqlite",
  { readOnly: true },
);
const due = db.prepare(
  "SELECT COUNT(*) AS n FROM reminder_instances WHERE status IN ('PENDING','ACTIVE','SNOOZED','ACKNOWLEDGED') AND due_at <= ?",
).get(new Date().toISOString());
const cases = db.prepare(
  "SELECT COUNT(DISTINCT case_id) AS n FROM reminder_instances WHERE status IN ('PENDING','ACTIVE','SNOOZED','ACKNOWLEDGED') AND due_at <= ?",
).get(new Date().toISOString());
const byRule = db.prepare(
  "SELECT rule_id, COUNT(*) AS n FROM reminder_instances WHERE status IN ('PENDING','ACTIVE','ACKNOWLEDGED') AND due_at <= ? GROUP BY rule_id",
).all(new Date().toISOString());
const dates = db.prepare(
  "SELECT COUNT(*) AS loading FROM bookings WHERE planned_loading_date IS NOT NULL AND status != 'CANCELLED'",
).get();
const cutoff = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE cutoff_date IS NOT NULL AND status != 'CANCELLED'").get();
const goods = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE actual_eta IS NOT NULL AND status != 'CANCELLED'").get();
const containers = db.prepare("SELECT status, COUNT(*) AS n FROM containers GROUP BY status").all();
console.log(JSON.stringify({ due, cases, byRule, dates, cutoff, goods, containers }, null, 2));
