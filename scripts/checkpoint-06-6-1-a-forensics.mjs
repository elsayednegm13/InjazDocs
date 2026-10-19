import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(
  ".wrangler-forensics-061a/e086a16c2df761e404ed26001d3f081a26268e90033ffbf14d8419a939ea8dbc.sqlite",
  { readOnly: true },
);
const integrity = db.prepare("PRAGMA integrity_check").all();
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
const counts = {};
for (const table of ["export_cases", "export_invoices", "invoice_revisions", "customers", "bookings", "containers", "reminder_instances", "reminder_rule_definitions"]) {
  counts[table] = tables.includes(table) ? db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n : "MISSING";
}
const migrations = tables.filter((name) => /migrat/i.test(name));
let migrationRows = [];
for (const name of migrations) {
  migrationRows = db.prepare(`SELECT * FROM ${name}`).all().map((row) => row.name ?? row.id ?? Object.keys(row).length);
}
console.log(JSON.stringify({ integrity, tableCount: tables.length, counts, migrations, migrationRows }, null, 2));
db.close();
