import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assertPerfPath, perfRoot } from "./checkpoint-06-4-guard.mjs";

const sizes = { small: 10, medium: 100, large: 500 };
const dataset = process.argv.includes("--dataset") ? process.argv[process.argv.indexOf("--dataset") + 1] : "medium";
const verifyOnly = process.argv.includes("--verify-only");
const caseCount = sizes[dataset];
if (!caseCount) {
  console.error("Use --dataset small|medium|large");
  process.exit(1);
}

const dbFile = assertPerfPath(path.join(perfRoot, "state/v3/d1/miniflare-D1DatabaseObject/e086a16c2df761e404ed26001d3f081a26268e90033ffbf14d8419a939ea8dbc.sqlite"));
const actors = JSON.parse(readFileSync(path.join(perfRoot, "actors.json"), "utf8"));
const adminId = actors.adminId;
const officerId = actors.officerId;
if (!adminId || !officerId) throw new Error("actors.json is missing ids");

const db = new DatabaseSync(verifyOnly ? dbFile : dbFile);
if (verifyOnly) {
  const counts = countRows(db);
  console.log(JSON.stringify({ dataset, verifyOnly: true, counts, bytes: statSync(dbFile).size }));
  process.exit(counts.export_cases === caseCount ? 0 : 2);
}

const started = Date.now();
db.exec("PRAGMA foreign_keys = ON");
const clear = [
  "courier_tracking_events", "courier_shipments", "customer_tracking_links", "notification_deliveries",
  "reminder_instances", "container_events", "containers", "booking_attachments", "bookings",
  "document_reviews", "document_versions", "operation_document_requirements", "export_invoices",
  "export_case_customer_snapshots", "case_events", "export_cases", "customer_bank_accounts",
  "customer_addresses", "customer_contacts", "customers",
];
db.exec("BEGIN");
for (const table of clear) db.exec(`DELETE FROM ${table}`);

const customerCount = Math.min(20, Math.max(4, Math.ceil(caseCount / 5)));
const insertCustomer = db.prepare(`INSERT INTO customers (id, legal_name, trade_name, country_code, notes, version, created_at, updated_at, created_by) VALUES (?, ?, ?, 'EG', NULL, 1, ?, ?, ?)`);
const insertContact = db.prepare(`INSERT INTO customer_contacts (id, customer_id, full_name, title, email, phone, is_primary) VALUES (?, ?, ?, 'Buyer', ?, '+20100000000', 1)`);
const insertAddress = db.prepare(`INSERT INTO customer_addresses (id, customer_id, kind, line1, city, country_code, is_primary) VALUES (?, ?, 'SHIPPING', '1 Synthetic Street', 'Alexandria', 'EG', 1)`);
const insertBank = db.prepare(`INSERT INTO customer_bank_accounts (id, customer_id, bank_name, account_name, account_number_last4, iban_last4, swift, created_at) VALUES (?, ?, 'Synthetic Bank', 'Perf Account', '1234', '5678', 'SYNTHXXX', ?)`);
const stamp = "2026-06-01T00:00:00.000Z";
for (let i = 0; i < customerCount; i += 1) {
  const id = `pcust-${i}`;
  insertCustomer.run(id, `Perf Customer ${String(i).padStart(2, "0")}`, `Perf Trade ${i}`, stamp, stamp, adminId);
  insertContact.run(`pcon-${i}`, id, `Contact ${i}`, `contact${i}@perf.example`);
  insertAddress.run(`paddr-${i}`, id);
  insertBank.run(`pbank-${i}`, id, stamp);
}

const insertCase = db.prepare(`INSERT INTO export_cases (id, case_reference, customer_id, status, document_route, bank_path_status, direct_path_status, assigned_to, destination_country, next_action, closed_at, version, created_at, updated_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'NL', ?, ?, 1, ?, ?, ?)`);
const insertSnap = db.prepare(`INSERT INTO export_case_customer_snapshots (case_id, legal_name, contact_name, contact_phone, contact_email, address_line1, city, country_code, captured_at) VALUES (?, ?, ?, '+20100000000', ?, '1 Synthetic Street', 'Alexandria', 'EG', ?)`);
const insertInvoice = db.prepare(`INSERT INTO export_invoices (id, case_id, invoice_number, invoice_date, customer_id, port_of_loading, port_of_discharge, destination_country, payment_term_code, incoterm, incoterms_edition, named_place, currency, currency_decimals, goods_value_minor, invoiced_freight_minor, actual_freight_expense_minor, invoice_total_minor, gross_weight_grams, net_weight_grams, units, version, created_at, updated_at) VALUES (?, ?, ?, '2026-06-01', ?, 'egaly', 'nlrtm', 'NL', 'TT', ?, 'Incoterms 2020', 'Alexandria', 'USD', 2, ?, ?, ?, ?, ?, ?, 10, 1, ?, ?)`);
const insertReq = db.prepare(`INSERT INTO operation_document_requirements (id, case_id, document_type_id, required, status, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
const insertVersion = db.prepare(`INSERT INTO document_versions (id, requirement_id, version, r2_key, original_name, content_type, byte_size, uploaded_by, review_state, created_at) VALUES (?, ?, 1, ?, 'synthetic.pdf', 'application/pdf', 128, ?, ?, ?)`);
const insertBooking = db.prepare(`INSERT INTO bookings (id, case_id, booking_number, ucr, shipping_line, vessel, voyage, port_of_loading, port_of_discharge, expected_containers, status, planned_etd, actual_etd, planned_eta, actual_eta, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'Synthetic Line', 'Perf Vessel', '1', 'egaly', 'nlrtm', 5, ?, ?, NULL, ?, NULL, 1, ?, ?)`);
const insertSlot = db.prepare(`INSERT INTO containers (id, booking_id, case_id, slot_index, official_number, official_number_override, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, 1, ?, ?)`);
const insertReminder = db.prepare(`INSERT INTO reminder_instances (id, rule_id, case_id, target_type, target_id, condition_key, generation, due_at, status, snoozed_until, resolved_at, dedup_key, owner_user_id, reason, next_action, created_at, updated_at) VALUES (?, 'rr-doc-due', ?, 'EXPORT_CASE', ?, 'DOCUMENT_NOT_READY', 1, ?, ?, ?, ?, ?, ?, 'Synthetic follow-up', 'Review documents', ?, ?)`);
const insertEvent = db.prepare(`INSERT INTO case_events (id, case_id, event_type, summary, actor_id, created_at) VALUES (?, ?, 'NOTE', ?, ?, ?)`);
const insertCourier = db.prepare(`INSERT INTO courier_shipments (id, case_id, route, sender, carrier, tracking_number, recipient_summary, status, version, created_at, updated_at) VALUES (?, ?, 'DIRECT', 'COMPANY', 'DHL', ?, 'Synthetic consignee', 'IN_TRANSIT', 1, ?, ?)`);
const insertTrack = db.prepare(`INSERT INTO customer_tracking_links (id, case_id, token_hash, created_by, revoked_at, display_scope_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);

const docTypes = ["dt-ci", "dt-pl", "dt-coo"];
const docStatuses = ["MISSING", "UPLOADED", "UNDER_REVIEW", "APPROVED", "NEEDS_CORRECTION"];
const tracks = [];
for (let i = 0; i < caseCount; i += 1) {
  const customerId = `pcust-${i % customerCount}`;
  const caseId = `pcase-${i}`;
  const when = `2026-06-${String((i % 27) + 1).padStart(2, "0")}T08:00:00.000Z`;
  const assignee = i % 2 === 0 ? officerId : adminId;
  const pattern = i % 5;
  const bank = pattern === 2 || pattern === 4;
  const route = bank ? "BANK_ROUTE" : "DIRECT_ROUTE";
  const status = ["DRAFT", "ACTIVE", "ACTIVE", "COMPLETED", "ON_HOLD"][pattern];
  const bankPath = bank ? ["PREPARING", "BANK_REVIEW", "HANDED_TO_BANK", "DOCUMENTS_DELIVERED", "SCANNED"][pattern] : "NOT_REQUIRED";
  const directPath = bank ? null : ["PREPARING", "INTERNAL_REVIEW", "COURIER_DISPATCHED", "DOCUMENTS_DELIVERED", "READY_FOR_DISPATCH"][pattern];
  const closed = status === "COMPLETED" ? when : null;
  insertCase.run(caseId, `PF-2026-${String(i).padStart(4, "0")}`, customerId, status, route, bankPath, directPath, assignee, "Collect documents", closed, when, when, adminId);
  insertSnap.run(caseId, `Perf Customer ${String(i % customerCount).padStart(2, "0")}`, `Contact ${i % customerCount}`, `contact${i % customerCount}@perf.example`, when);
  const incoterm = i % 2 === 0 ? "FOB" : "CFR";
  const goods = 100_000 + i * 100;
  const invoicedFreight = incoterm === "CFR" ? 15_000 : 0;
  const actualFreight = 12_000;
  const total = goods + invoicedFreight;
  insertInvoice.run(`pinv-${i}`, caseId, `PF-INV-${String(i).padStart(5, "0")}`, customerId, incoterm, goods, invoicedFreight, actualFreight, total, 12_000 + i, 9_000 + i, when, when);
  docTypes.forEach((typeId, index) => {
    const reqId = `preq-${i}-${index}`;
    const docStatus = docStatuses[(i + index) % docStatuses.length];
    insertReq.run(reqId, caseId, typeId, index === 2 ? 0 : 1, docStatus, assignee, when, when);
    if (docStatus !== "MISSING" && docStatus !== "WAIVED") {
      insertVersion.run(`pver-${i}-${index}`, reqId, `perf/synthetic/${reqId}.pdf`, assignee, docStatus === "APPROVED" ? "APPROVED" : "PENDING", when);
    }
  });
  const bookingStatus = ["DRAFT", "CONFIRMED", "DEPARTED", "ARRIVED_PORT", "REQUESTED"][pattern];
  insertBooking.run(`pbk-${i}`, caseId, `PF-BK-${String(i).padStart(5, "0")}`, i % 3 === 0 ? `UCR-${i}` : null, bookingStatus, "2026-07-01", "2026-07-20", when, when);
  for (let slot = 0; slot < 5; slot += 1) {
    const numbered = slot < 2;
    insertSlot.run(
      `pctr-${i}-${slot}`,
      `pbk-${i}`,
      caseId,
      slot,
      numbered ? `PFXU${String(i).padStart(6, "0")}${slot}` : null,
      numbered ? "NUMBER_ASSIGNED" : "PLANNED",
      when,
      when,
    );
  }
  for (let reminder = 0; reminder < 2; reminder += 1) {
    const reminderStatus = ["PENDING", "ACTIVE", "SNOOZED", "RESOLVED"][(i + reminder) % 4];
    insertReminder.run(
      `prem-${i}-${reminder}`,
      caseId,
      caseId,
      when,
      reminderStatus,
      reminderStatus === "SNOOZED" ? "2026-07-15T00:00:00.000Z" : null,
      reminderStatus === "RESOLVED" ? when : null,
      `perf-${dataset}-${i}-${reminder}`,
      assignee,
      when,
      when,
    );
  }
  for (let event = 0; event < 3; event += 1) insertEvent.run(`pevt-${i}-${event}`, caseId, `Synthetic event ${event}`, adminId, when);
  if (!bank && (pattern === 2 || pattern === 3)) insertCourier.run(`pshp-${i}`, caseId, `DHL-${i}`, when, when);
  if (i < 3) {
    const token = randomBytes(16).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    insertTrack.run(`ptrk-${i}`, caseId, tokenHash, adminId, i === 1 ? when : null, JSON.stringify({ showInvoiceReference: false, showCourierTracking: true, showContainerNumbers: true, showEta: true, showRecipientName: false, showRemarks: false }), when);
    tracks.push({ caseIndex: i, revoked: i === 1, token });
  }
}
db.exec("COMMIT");
mkdirSync(perfRoot, { recursive: true });
writeFileSync(path.join(perfRoot, "tracks.json"), JSON.stringify({ dataset, tracks }, null, 2));
writeFileSync(path.join(perfRoot, "seed-manifest.json"), JSON.stringify({
  dataset,
  seed: "checkpoint-06-4-v1",
  caseCount,
  customerCount,
  elapsedMs: Date.now() - started,
  bytes: statSync(dbFile).size,
  counts: countRows(db),
}, null, 2));
console.log(JSON.stringify({ dataset, elapsedMs: Date.now() - started, bytes: statSync(dbFile).size, counts: countRows(db) }));

function countRows(database) {
  const tables = ["customers", "export_cases", "export_invoices", "operation_document_requirements", "document_versions", "bookings", "containers", "reminder_instances", "case_events", "courier_shipments", "customer_tracking_links"];
  const counts = {};
  for (const table of tables) counts[table] = database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  return counts;
}
