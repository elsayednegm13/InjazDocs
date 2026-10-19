import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { assertPerfPath, perfRoot } from "./checkpoint-06-4-guard.mjs";

const dbFile = assertPerfPath(path.join(perfRoot, "state/v3/d1/miniflare-D1DatabaseObject/e086a16c2df761e404ed26001d3f081a26268e90033ffbf14d8419a939ea8dbc.sqlite"));
const db = new DatabaseSync(dbFile);
const queries = {
  dashboardCounts: `SELECT
      (SELECT COUNT(*) FROM export_cases WHERE status NOT IN ('CANCELLED','ARCHIVED')) AS total_cases,
      (SELECT COUNT(*) FROM export_cases WHERE status = 'COMPLETED') AS completed,
      (SELECT COUNT(*) FROM operation_document_requirements WHERE status IN ('MISSING','UPLOADED','UNDER_REVIEW','NEEDS_CORRECTION') AND required = 1) AS docs_pending,
      (SELECT COUNT(*) FROM export_cases WHERE bank_path_status IN ('HANDED_TO_BANK','BANK_REVIEW')) AS bank_pending,
      (SELECT COUNT(*) FROM courier_shipments WHERE status IN ('DISPATCHED','IN_TRANSIT')) AS courier_open,
      (SELECT COUNT(*) FROM reminder_instances WHERE status = 'ACTIVE' AND due_at < datetime('now')) AS overdue`,
  recentEvents: `SELECT id, event_type, summary, created_at, case_id FROM case_events ORDER BY created_at DESC LIMIT 12`,
  dueReminders: `SELECT r.id, r.due_at, r.status, c.case_reference, r.case_id
     FROM reminder_instances r
     JOIN export_cases c ON c.id = r.case_id
     LEFT JOIN user u ON u.id = r.owner_user_id
     WHERE r.status IN ('ACTIVE','PENDING') AND 1=1
     ORDER BY r.due_at ASC LIMIT 24`,
  caseListCount: `SELECT COUNT(DISTINCT c.id) AS n
     FROM export_cases c
     JOIN customers cu ON cu.id = c.customer_id
     LEFT JOIN export_invoices i ON i.case_id = c.id
     WHERE 1=1`,
  caseListPage: `SELECT c.id, c.case_reference, c.status, c.updated_at, cu.legal_name,
            GROUP_CONCAT(DISTINCT i.invoice_number) AS invoice_numbers
     FROM export_cases c
     JOIN customers cu ON cu.id = c.customer_id
     LEFT JOIN export_invoices i ON i.case_id = c.id
     WHERE 1=1
     GROUP BY c.id
     ORDER BY c.updated_at DESC
     LIMIT 20 OFFSET 0`,
  caseDetail: `SELECT * FROM export_cases WHERE id = 'pcase-0'`,
  caseInvoices: `SELECT id, invoice_number, incoterm FROM export_invoices WHERE case_id = 'pcase-0'`,
  caseDocs: `SELECT r.id, r.status FROM operation_document_requirements r WHERE r.case_id = 'pcase-0'`,
  caseBookings: `SELECT id, booking_number FROM bookings WHERE case_id = 'pcase-0'`,
  caseContainers: `SELECT id, slot_index, status FROM containers WHERE case_id = 'pcase-0'`,
  bookingsPage: `SELECT b.id, b.booking_number, c.case_reference
     FROM bookings b
     JOIN export_cases c ON c.id = b.case_id
     JOIN customers cu ON cu.id = c.customer_id
     WHERE 1=1
     ORDER BY COALESCE(b.planned_etd, b.created_at) DESC
     LIMIT 20 OFFSET 0`,
  reminders: `SELECT r.id, c.case_reference FROM reminder_instances r
     JOIN export_cases c ON c.id = r.case_id
     WHERE 1=1 AND r.status IN ('PENDING','ACTIVE','SNOOZED','ACKNOWLEDGED')
     ORDER BY r.due_at ASC LIMIT 200`,
  schedule: `SELECT b.id, b.booking_number, c.case_reference
     FROM bookings b
     JOIN export_cases c ON c.id = b.case_id
     JOIN customers cu ON cu.id = c.customer_id
     WHERE b.status != 'CANCELLED' AND 1=1
     ORDER BY COALESCE(b.planned_etd, b.planned_loading_date, b.planned_eta)`,
  containers: `SELECT ct.id, b.booking_number, c.case_reference
     FROM containers ct
     JOIN bookings b ON b.id = ct.booking_id
     JOIN export_cases c ON c.id = ct.case_id
     WHERE 1=1
     ORDER BY ct.updated_at DESC
     LIMIT 200`,
};

function timeQuery(sql) {
  const statement = db.prepare(sql);
  statement.all();
  const samples = [];
  for (let i = 0; i < 20; i += 1) {
    const started = performance.now();
    const rows = statement.all();
    samples.push({ ms: Number((performance.now() - started).toFixed(3)), rows: rows.length });
  }
  const values = samples.map((row) => row.ms).sort((a, b) => a - b);
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all();
  return {
    n: values.length,
    p50: values[9],
    p95: values[18],
    min: values[0],
    max: values[values.length - 1],
    rowCount: samples[0]?.rows ?? 0,
    plan: plan.map((step) => step.detail),
  };
}

const out = {
  capturedAt: new Date().toISOString(),
  dataset: "large",
  bytes: statSync(dbFile).size,
  engine: "node:sqlite local file, not the Worker D1 binding",
  queries: {},
};
for (const [name, sql] of Object.entries(queries)) out.queries[name] = timeQuery(sql);
mkdirSync("docs/performance/checkpoint-06-4", { recursive: true });
writeFileSync("docs/performance/checkpoint-06-4/explain-large.json", JSON.stringify(out, null, 2));
const brief = Object.fromEntries(Object.entries(out.queries).map(([name, row]) => [name, { p50: row.p50, p95: row.p95, rows: row.rowCount, plan: row.plan }]));
console.log(JSON.stringify(brief, null, 2));
db.close();
