import { DatabaseSync } from "node:sqlite";

type Row = Record<string, unknown>;

export type AuditD1 = D1Database & { __sqlite: DatabaseSync };

function normalizeParam(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

function meta(sqlite: DatabaseSync, changes: number | bigint) {
  return {
    changes: Number(changes),
    last_row_id: Number(sqlite.prepare("SELECT last_insert_rowid() AS id").get()?.id ?? 0),
    duration: 0,
    rows_read: 0,
    rows_written: Number(changes),
  };
}

class AuditStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new AuditStatement(this.sqlite, this.sql, params.map(normalizeParam));
  }

  async first<T = Row>(): Promise<T | null> {
    const row = this.sqlite.prepare(this.sql).get(...(this.params as never[]));
    return (row as T | undefined) ?? null;
  }

  async all<T = Row>(): Promise<{ results: T[]; success: true; meta: ReturnType<typeof meta> }> {
    const results = this.sqlite.prepare(this.sql).all(...(this.params as never[])) as T[];
    return { results, success: true, meta: meta(this.sqlite, 0) };
  }

  async run(): Promise<{ results: Row[]; success: true; meta: ReturnType<typeof meta> }> {
    const result = this.sqlite.prepare(this.sql).run(...(this.params as never[]));
    return { results: [], success: true, meta: meta(this.sqlite, result.changes) };
  }

  get __auditSql() {
    return this.sql;
  }

  get __auditParams() {
    return this.params;
  }

  executeSync(): { results: Row[]; success: true; meta: ReturnType<typeof meta> } {
    if (/^\s*(SELECT|WITH|PRAGMA|EXPLAIN)\b/i.test(this.sql)) {
      const results = this.sqlite.prepare(this.sql).all(...(this.params as never[])) as Row[];
      return { results, success: true, meta: meta(this.sqlite, 0) };
    }
    const result = this.sqlite.prepare(this.sql).run(...(this.params as never[]));
    return { results: [], success: true, meta: meta(this.sqlite, result.changes) };
  }
}

export function createAuditD1(sqlite: DatabaseSync): AuditD1 {
  const db = {
    prepare(sql: string) {
      return new AuditStatement(sqlite, sql);
    },
    async batch(statements: AuditStatement[]) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement) => statement.executeSync());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    async exec(sql: string) {
      sqlite.exec(sql);
      return { count: 0, duration: 0 };
    },
    __sqlite: sqlite,
  };
  return db as unknown as AuditD1;
}
