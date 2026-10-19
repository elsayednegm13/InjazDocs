import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";

const label = process.argv[2] || "snapshot";
const db = new DatabaseSync(
  ".wrangler-perf/state/v3/d1/miniflare-D1DatabaseObject/e086a16c2df761e404ed26001d3f081a26268e90033ffbf14d8419a939ea8dbc.sqlite",
  { readOnly: true },
);
const rows = db.prepare(
  "SELECT rule_id, status, COUNT(*) AS n FROM reminder_instances GROUP BY rule_id, status ORDER BY rule_id, status",
).all();
mkdirSync("docs/performance/checkpoint-06-5-2", { recursive: true });
const file = `docs/performance/checkpoint-06-5-2/instances-${label}.json`;
writeFileSync(file, JSON.stringify({ capturedAt: new Date().toISOString(), rows }, null, 2));
console.log(JSON.stringify({ file, groups: rows.length }));
