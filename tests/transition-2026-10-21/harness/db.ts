import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createAuditD1, type AuditD1 } from "./d1";

const MIGRATIONS = [
  "0001_init.sql",
  "0002_seed.sql",
  "0003_checkpoint.sql",
  "0004_invoice_revisions.sql",
  "0005_idempotency.sql",
  "0006_customer_imports.sql",
  "0007_performance_indexes.sql",
  "0008_replay_safety_and_import_identity.sql",
];

export type AuditDatabase = {
  db: AuditD1;
  sqlite: DatabaseSync;
  dir: string;
  file: string;
  close: () => void;
};

export function createAuditDatabase(options: { upTo?: string; seed?: boolean } = {}): AuditDatabase {
  const upTo = options.upTo ?? "0008";
  const dir = mkdtempSync(path.join(os.tmpdir(), "et-20261021-"));
  const temporaryRoot = path.resolve(os.tmpdir()).toLowerCase();
  if (!path.resolve(dir).toLowerCase().startsWith(`${temporaryRoot}${path.sep}`)) {
    throw new Error("AUDIT_DB_OUTSIDE_TEMP");
  }
  const file = path.join(dir, "audit.sqlite");
  const sqlite = new DatabaseSync(file);
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const migration of MIGRATIONS) {
    if (Number(migration.slice(0, 4)) > Number(upTo.slice(0, 4))) break;
    sqlite.exec(readFileSync(path.join(process.cwd(), "drizzle", "migrations", migration), "utf8"));
  }
  const db = createAuditD1(sqlite);
  if (options.seed !== false) seedBase(sqlite);
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

export function seedBase(sqlite: DatabaseSync) {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const insertUser = sqlite.prepare(
    `INSERT INTO user (id, name, email, email_verified, created_at, updated_at, must_change_password, is_active)
     VALUES (?, ?, ?, 1, ?, ?, 0, 1)`,
  );
  insertUser.run("user-admin", "Admin", "admin@example.invalid", now, now);
  insertUser.run("user-officer", "Officer", "officer@example.invalid", now, now);
  insertUser.run("user-viewer", "Viewer", "viewer@example.invalid", now, now);
  insertUser.run("user-outsider", "Outsider", "outsider@example.invalid", now, now);

  sqlite.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)").run("user-admin", "role-admin");
  sqlite.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)").run("user-officer", "role-officer");
  sqlite.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)").run("user-viewer", "role-viewer");

  sqlite
    .prepare(
      `INSERT INTO customers (id, legal_name, country_code, version, created_at, updated_at, created_by)
       VALUES (?, ?, ?, 1, ?, ?, ?)`,
    )
    .run("customer-1", "Existing Customer", "EG", nowIso, nowIso, "user-admin");

  sqlite
    .prepare(
      `INSERT INTO export_cases
         (id, case_reference, customer_id, status, document_route, bank_path_status, direct_path_status,
          assigned_to, destination_country, version, created_at, updated_at, created_by)
       VALUES (?, ?, ?, 'ACTIVE', 'BANK_ROUTE', 'PREPARING', NULL, ?, ?, 1, ?, ?, ?)`,
    )
    .run("case-1", "EF-TEST-001", "customer-1", "user-officer", "NL", nowIso, nowIso, "user-officer");

  sqlite
    .prepare(
      `INSERT INTO export_case_customer_snapshots
         (case_id, legal_name, country_code, captured_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run("case-1", "Existing Customer", "EG", nowIso);

  sqlite
    .prepare(
      `INSERT INTO operation_document_requirements
         (id, case_id, document_type_id, required, status, created_at, updated_at)
       VALUES (?, ?, ?, 1, 'MISSING', ?, ?)`,
    )
    .run("requirement-1", "case-1", "dt-ci", nowIso, nowIso);

  // Other suites must not accidentally depend on the bootstrap flag.
  sqlite.prepare("UPDATE company_settings SET bootstrap_consumed = 1 WHERE id = 'default'").run();
}

export function setBootstrapAvailable(sqlite: DatabaseSync) {
  sqlite.prepare("UPDATE company_settings SET bootstrap_consumed = 0 WHERE id = 'default'").run();
}

export function count(sqlite: DatabaseSync, table: string, where = "1=1", ...params: unknown[]): number {
  const row = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...(params as never[])) as { n: number };
  return Number(row.n);
}
