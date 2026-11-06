import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createAuditD1, type AuditD1 } from "../../transition-2026-10-21/harness/d1";
import { seedBase } from "../../transition-2026-10-21/harness/db";

/**
 * W2 harness database: synthetic isolated SQLite store applying the additive
 * migrations 0001..0010 (0010 = quotations). The store is owned by the test
 * run, lives only inside a temp directory and is destroyed on close. It is
 * never the developer store, never a remote store and holds no real secrets.
 */
const MIGRATIONS = [
  "0001_init.sql",
  "0002_seed.sql",
  "0003_checkpoint.sql",
  "0004_invoice_revisions.sql",
  "0005_idempotency.sql",
  "0006_customer_imports.sql",
  "0007_performance_indexes.sql",
  "0008_replay_safety_and_import_identity.sql",
  "0009_reports_view_all.sql",
  "0010_quotations.sql",
];

export type W2Database = {
  db: AuditD1;
  sqlite: DatabaseSync;
  dir: string;
  file: string;
  close: () => void;
};

export function createW2Database(options: { upTo?: string } = {}): W2Database {
  const upTo = options.upTo ?? "0010";
  const dir = mkdtempSync(path.join(os.tmpdir(), "et-w2-20261029-"));
  const temporaryRoot = path.resolve(os.tmpdir()).toLowerCase();
  if (!path.resolve(dir).toLowerCase().startsWith(`${temporaryRoot}${path.sep}`)) {
    throw new Error("W2_DB_OUTSIDE_TEMP");
  }
  const file = path.join(dir, "w2.sqlite");
  const sqlite = new DatabaseSync(file);
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const migration of MIGRATIONS) {
    if (Number(migration.slice(0, 4)) > Number(upTo.slice(0, 4))) break;
    sqlite.exec(readFileSync(path.join(process.cwd(), "drizzle", "migrations", migration), "utf8"));
  }
  const db = createAuditD1(sqlite);
  seedBase(sqlite);
  seedQuotationFixtures(sqlite);
  return {
    db,
    sqlite,
    dir,
    file,
    close() {
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Quotation fixtures beyond the base suite:
 *   - customer-quote: has a trade name (PDF buyer display precedence) and a
 *     BILLING + SHIPPING address pair (commercial address precedence), plus a
 *     bank account row that must never surface in quotation outputs (D-06).
 *   - customer-nofallback: no trade name, no addresses (null-address path).
 *   - case-2: a second case assigned to the officer for relink tests.
 */
export function seedQuotationFixtures(sqlite: DatabaseSync) {
  const nowIso = new Date().toISOString();

  sqlite
    .prepare(
      `INSERT INTO customers (id, legal_name, trade_name, country_code, version, created_at, updated_at, created_by)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .run("customer-quote", "Nile Trading LLC", "Nile Trading", "EG", nowIso, nowIso, "user-admin");

  sqlite
    .prepare(
      `INSERT INTO customer_addresses (id, customer_id, kind, line1, city, region, postal_code, country_code, is_primary)
       VALUES (?, ?, 'BILLING', '12 Nile Street', 'Cairo', 'Cairo', '11511', 'EG', 1)`,
    )
    .run("addr-billing", "customer-quote");

  sqlite
    .prepare(
      `INSERT INTO customer_addresses (id, customer_id, kind, line1, city, country_code, is_primary)
       VALUES (?, ?, 'SHIPPING', 'Port Said Warehouse', 'Port Said', 'EG', 0)`,
    )
    .run("addr-shipping", "customer-quote");

  sqlite
    .prepare(
      `INSERT INTO customer_bank_accounts (id, customer_id, bank_name, account_name, created_at)
       VALUES (?, ?, 'Test Bank of Egypt', 'Nile Trading LLC', ?)`,
    )
    .run("bank-1", "customer-quote", nowIso);

  sqlite
    .prepare(
      `INSERT INTO customers (id, legal_name, version, created_at, updated_at, created_by)
       VALUES (?, ?, 1, ?, ?, ?)`,
    )
    .run("customer-nofallback", "Bare Customer", nowIso, nowIso, "user-admin");

  sqlite
    .prepare(
      `INSERT INTO export_cases
         (id, case_reference, customer_id, status, document_route, bank_path_status, direct_path_status,
          assigned_to, destination_country, version, created_at, updated_at, created_by)
       VALUES (?, ?, ?, 'ACTIVE', 'BANK_ROUTE', 'PREPARING', NULL, ?, ?, 1, ?, ?, ?)`,
    )
    .run("case-2", "EF-TEST-002", "customer-1", "user-officer", "NL", nowIso, nowIso, "user-officer");
}

export function count(sqlite: DatabaseSync, table: string, where = "1=1", ...params: unknown[]): number {
  const row = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...(params as never[])) as { n: number };
  return Number(row.n);
}
