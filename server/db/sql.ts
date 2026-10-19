export async function one<T>(
  db: D1Database,
  sql: string,
  ...binds: unknown[]
): Promise<T | null> {
  const row = await db.prepare(sql).bind(...binds).first<T>();
  return row ?? null;
}

export async function all<T>(
  db: D1Database,
  sql: string,
  ...binds: unknown[]
): Promise<T[]> {
  const result = await db.prepare(sql).bind(...binds).all<T>();
  return result.results ?? [];
}

export async function run(db: D1Database, sql: string, ...binds: unknown[]): Promise<D1Result> {
  return db.prepare(sql).bind(...binds).run();
}

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(date = new Date()): string {
  return date.toISOString();
}
