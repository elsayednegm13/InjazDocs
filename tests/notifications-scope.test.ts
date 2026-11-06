import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { Actor } from "../server/services/actor";
import { listNotifications } from "../server/services/reminders";

function createDb(includeDeliveries = true) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE export_cases (
      id TEXT PRIMARY KEY,
      case_reference TEXT NOT NULL,
      assigned_to TEXT,
      created_by TEXT
    );
    CREATE TABLE reminder_instances (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      next_action TEXT
    );
    CREATE TABLE notification_deliveries (
      id TEXT PRIMARY KEY,
      reminder_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE notification_reads (
      user_id TEXT NOT NULL,
      delivery_id TEXT NOT NULL,
      read_at TEXT NOT NULL,
      PRIMARY KEY (user_id, delivery_id)
    );
  `);
  sqlite.prepare(`INSERT INTO export_cases (id, case_reference, assigned_to, created_by) VALUES (?, ?, ?, ?)`).run("in-1", "EF-IN", "officer", "officer");
  sqlite.prepare(`INSERT INTO export_cases (id, case_reference, assigned_to, created_by) VALUES (?, ?, ?, ?)`).run("out-1", "EF-OUT", "other", "other");
  sqlite.prepare(`INSERT INTO reminder_instances (id, case_id, status, reason, next_action) VALUES (?, ?, ?, ?, ?)`).run("r-in", "in-1", "ACTIVE", "own", "review");
  sqlite.prepare(`INSERT INTO reminder_instances (id, case_id, status, reason, next_action) VALUES (?, ?, ?, ?, ?)`).run("r-out", "out-1", "ACTIVE", "foreign", "review");
  sqlite.prepare(`INSERT INTO reminder_instances (id, case_id, status, reason, next_action) VALUES (?, ?, ?, ?, ?)`).run("r-done", "in-1", "RESOLVED", "done", "none");
  if (includeDeliveries) {
    sqlite.prepare(`INSERT INTO notification_deliveries (id, reminder_id, created_at) VALUES (?, ?, ?)`).run("d-old", "r-in", "2026-01-01T00:00:00Z");
    sqlite.prepare(`INSERT INTO notification_deliveries (id, reminder_id, created_at) VALUES (?, ?, ?)`).run("d-new", "r-in", "2026-02-01T00:00:00Z");
    sqlite.prepare(`INSERT INTO notification_deliveries (id, reminder_id, created_at) VALUES (?, ?, ?)`).run("d-out", "r-out", "2026-03-01T00:00:00Z");
    sqlite.prepare(`INSERT INTO notification_deliveries (id, reminder_id, created_at) VALUES (?, ?, ?)`).run("d-done", "r-done", "2026-04-01T00:00:00Z");
    sqlite.prepare(`INSERT INTO notification_reads (user_id, delivery_id, read_at) VALUES (?, ?, ?)`).run("officer", "d-old", "2026-01-02T00:00:00Z");
  }
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            all() {
              return { results: sqlite.prepare(sql).all(...(params as never[])) };
            },
            first() {
              return sqlite.prepare(sql).get(...(params as never[])) ?? null;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

function actor(id: string, viewAll: boolean): Actor {
  const permissions = new Set<Actor["permissions"] extends Set<infer T> ? T : never>(["reminders.view"]);
  if (viewAll) permissions.add("export_cases.view_all" as never);
  return {
    id,
    email: `${id}@example.test`,
    name: id,
    mustChangePassword: false,
    isActive: true,
    permissions,
    roleKeys: [viewAll ? "tenant_admin" : "export_officer"],
  };
}

describe("notification scope", () => {
  it("shows an officer only open notifications on visible cases, newest first", async () => {
    const rows = await listNotifications(createDb(), actor("officer", false));
    expect(rows.map((row) => row.id)).toEqual(["d-new", "d-old"]);
    expect(rows.map((row) => row.is_read)).toEqual([0, 1]);
    expect(rows.map((row) => row.case_reference)).toEqual(["EF-IN", "EF-IN"]);
  });

  it("keeps other cases visible to an actor who can view every case, and still hides resolved reminders", async () => {
    const rows = await listNotifications(createDb(), actor("admin", true));
    expect(rows.map((row) => row.id)).toEqual(["d-out", "d-new", "d-old"]);
  });

  it("returns an empty inbox without listing rows that were never stored", async () => {
    const rows = await listNotifications(createDb(false), actor("admin", true));
    expect(rows).toEqual([]);
  });
});
