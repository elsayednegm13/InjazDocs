import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { Actor } from "../server/services/actor";
import { overview } from "../server/services/reports";

type Bound = { sql: string; params: unknown[]; all: () => unknown[] };

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE export_cases (
      id TEXT PRIMARY KEY,
      case_reference TEXT NOT NULL,
      status TEXT NOT NULL,
      assigned_to TEXT,
      created_by TEXT,
      bank_path_status TEXT NOT NULL
    );
    CREATE TABLE operation_document_requirements (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      status TEXT NOT NULL,
      required INTEGER NOT NULL
    );
    CREATE TABLE courier_shipments (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE reminder_instances (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      status TEXT NOT NULL,
      due_at TEXT NOT NULL,
      reason TEXT,
      next_action TEXT,
      owner_user_id TEXT
    );
    CREATE TABLE case_events (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE user (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
  `);
  const addCase = sqlite.prepare(
    `INSERT INTO export_cases (id, case_reference, status, assigned_to, created_by, bank_path_status) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  addCase.run("in-1", "IN-1", "OPEN", "officer", "officer", "NOT_STARTED");
  addCase.run("in-2", "IN-2", "COMPLETED", "officer", "someone-else", "NOT_STARTED");
  addCase.run("out-1", "OUT-1", "OPEN", "other", "other", "BANK_REVIEW");
  addCase.run("out-2", "OUT-2", "OPEN", "other", "other", "NOT_STARTED");
  sqlite.prepare(`INSERT INTO operation_document_requirements (id, case_id, status, required) VALUES (?, ?, ?, 1)`).run("d-in", "in-1", "MISSING");
  sqlite.prepare(`INSERT INTO operation_document_requirements (id, case_id, status, required) VALUES (?, ?, ?, 1)`).run("d-out", "out-1", "MISSING");
  sqlite.prepare(`INSERT INTO courier_shipments (id, case_id, status) VALUES (?, ?, ?)`).run("c-in", "in-1", "IN_TRANSIT");
  sqlite.prepare(`INSERT INTO courier_shipments (id, case_id, status) VALUES (?, ?, ?)`).run("c-out", "out-1", "DISPATCHED");
  sqlite.prepare(`INSERT INTO reminder_instances (id, case_id, status, due_at, reason, next_action, owner_user_id) VALUES (?, ?, 'ACTIVE', '2000-01-01T00:00:00Z', 'in', 'review', 'officer')`).run("r-in", "in-1");
  sqlite.prepare(`INSERT INTO reminder_instances (id, case_id, status, due_at, reason, next_action, owner_user_id) VALUES (?, ?, 'ACTIVE', '2000-01-01T00:00:00Z', 'out', 'review', 'other')`).run("r-out", "out-1");
  sqlite.prepare(`INSERT INTO case_events (id, case_id, event_type, summary, created_at) VALUES (?, ?, 'NOTE', ?, ?)`).run("e-out", "out-1", "outside", "2026-01-02T00:00:00Z");
  sqlite.prepare(`INSERT INTO case_events (id, case_id, event_type, summary, created_at) VALUES (?, ?, 'NOTE', ?, ?)`).run("e-in", "in-1", "inside", "2026-01-01T00:00:00Z");
  sqlite.prepare(`INSERT INTO user (id, name) VALUES (?, ?)`).run("officer", "Officer");

  const db = {
    prepare(sql: string) {
      const statement: Bound = {
        sql,
        params: [],
        all() {
          return sqlite.prepare(statement.sql).all(...(statement.params as never[])) as unknown[];
        },
      };
      return {
        bind(...params: unknown[]) {
          statement.params = params;
          return statement;
        },
      };
    },
    async batch(statements: Bound[]) {
      return statements.map((statement) => ({ results: statement.all() }));
    },
  };
  return db as unknown as D1Database;
}

function actor(id: string, viewAll: boolean): Actor {
  return {
    id,
    email: `${id}@example.test`,
    name: id,
    mustChangePassword: false,
    isActive: true,
    permissions: new Set(viewAll ? ["dashboard.view", "export_cases.view_all"] : ["dashboard.view"]),
    roleKeys: [viewAll ? "tenant_admin" : "export_officer"],
  };
}

describe("dashboard scope", () => {
  it("limits a scoped officer to assigned or created cases and their events", async () => {
    const result = await overview(createDb(), actor("officer", false));
    expect(result.counts).toMatchObject({
      total_cases: 2,
      completed: 1,
      docs_pending: 1,
      bank_pending: 0,
      courier_open: 1,
      overdue: 1,
    });
    expect(result.recent.map((row) => (row as { case_id: string }).case_id)).toEqual(["in-1"]);
    expect(result.due.map((row) => (row as { case_id: string }).case_id)).toEqual(["in-1"]);
  });

  it("keeps the global totals for an actor who can view every case", async () => {
    const result = await overview(createDb(), actor("admin", true));
    expect(result.counts?.total_cases).toBe(4);
    expect(result.counts?.bank_pending).toBe(1);
    expect(result.counts?.docs_pending).toBe(2);
    expect(result.recent).toHaveLength(2);
  });
});
