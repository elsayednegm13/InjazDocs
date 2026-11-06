/**
 * W1-FINAL — test-only Worker entry for the run-owned harness.
 *
 * It is never the production entry: `wrangler.jsonc` and the E2E launcher point
 * at `worker/index.ts`, which calls `createApp()` with no injected dependency.
 * This file is bundled only by `scripts/w1final/run-w1-final.mjs` into a
 * disposable workerd process whose config lives in the run root.
 *
 * Faults are delays only. They are read from Worker vars in that generated
 * config (`W1_*_DELAY_MS`), never from a header, cookie, query string or request
 * body. A normal HTTP client of this harness cannot choose a delay, and no
 * endpoint, permission or business rule is bypassed: every request still runs
 * the real Hono app, real Better Auth and the real local D1 binding.
 *
 * The `/__w1/*` probe is also test-only. It is gated by a random
 * `W1_PROBE_TOKEN` that exists only in the run-owned config and is used only to
 * read the production `effectiveRootCondition`/`countRootAdmins` definitions
 * back out of the real Worker. It cannot mutate data and is not part of the
 * production entry.
 */
import { createApp, handleScheduled } from "../../server/http/app";
import { countRootAdmins, effectiveRootCondition } from "../../server/services/users";

type AnyRecord = Record<string, unknown>;

type DelayRule = {
  needle: string;
  ms: number;
  bindIncludes?: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function normalise(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function delayingStatement(statement: D1PreparedStatement, ms: number): D1PreparedStatement {
  const wrap = (current: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(current, {
      get(target, prop) {
        if (prop === "bind") {
          return (...args: unknown[]) =>
            wrap((target.bind as (...bound: unknown[]) => D1PreparedStatement).apply(target, args));
        }
        const value = Reflect.get(target, prop, target);
        if (typeof value !== "function") return value;
        return async (...args: unknown[]) => {
          const result = await (value as (...call: unknown[]) => Promise<unknown>).apply(target, args);
          // Delay AFTER the read resolves: this widens the exact read-to-write
          // window the service has to own, without changing the result.
          await sleep(ms);
          return result;
        };
      },
    }) as unknown as D1PreparedStatement;
  return wrap(statement);
}

function delayingBind(statement: D1PreparedStatement, ms: number, bindIncludes: string): D1PreparedStatement {
  return new Proxy(statement, {
    get(target, prop) {
      if (prop === "bind") {
        return (...args: unknown[]) => {
          const bound = (target.bind as (...bound: unknown[]) => D1PreparedStatement).apply(target, args);
          return args.some((arg) => String(arg) === bindIncludes) ? delayingStatement(bound, ms) : bound;
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  }) as unknown as D1PreparedStatement;
}

function delayReads(db: D1Database, rules: DelayRule[]): D1Database {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql: string) => {
          const statement = target.prepare(sql);
          const rule = rules.find((candidate) => candidate.ms > 0 && normalise(sql).includes(candidate.needle));
          if (!rule) return statement;
          return rule.bindIncludes
            ? delayingBind(statement, rule.ms, rule.bindIncludes)
            : delayingStatement(statement, rule.ms);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  }) as unknown as D1Database;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function probe(request: Request, env: Env, pathname: string): Promise<Response> {
  const expected = String((env as unknown as AnyRecord).W1_PROBE_TOKEN ?? "");
  if (!expected || request.headers.get("x-w1-probe") !== expected) {
    return new Response("Not found", { status: 404 });
  }

  if (pathname === "/__w1/root-sql") {
    return jsonResponse({ ok: true, sql: effectiveRootCondition("u") });
  }
  if (pathname === "/__w1/root-count") {
    return jsonResponse({ ok: true, count: await countRootAdmins(env.DB) });
  }
  if (pathname === "/__w1/root-ids") {
    const result = await env.DB.prepare(
      `SELECT u.id AS id FROM user u WHERE ${effectiveRootCondition("u")} ORDER BY u.id`,
    ).all<{ id: string }>();
    return jsonResponse({ ok: true, ids: (result.results ?? []).map((row) => row.id) });
  }
  if (pathname === "/__w1/root-flags") {
    const ids = (new URL(request.url).searchParams.get("ids") ?? "").split(",").filter(Boolean);
    if (ids.length === 0) return jsonResponse({ ok: true, flags: {} });
    const placeholders = ids.map(() => "?").join(",");
    const result = await env.DB.prepare(
      `SELECT u.id AS id, CASE WHEN ${effectiveRootCondition("u")} THEN 1 ELSE 0 END AS is_root
         FROM user u WHERE u.id IN (${placeholders})`,
    )
      .bind(...ids)
      .all<{ id: string; is_root: number }>();
    const flags: Record<string, number> = {};
    for (const row of result.results ?? []) flags[row.id] = Number(row.is_root);
    return jsonResponse({ ok: true, flags });
  }
  return new Response("Not found", { status: 404 });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const runtime = env as unknown as AnyRecord;
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith("/__w1/")) return probe(request, env, pathname);

    const delayBind = String(runtime.W1_DELAY_BIND ?? "");
    const rules: DelayRule[] = [];
    const reviewReadDelay = Number(runtime.W1_REVIEW_READ_DELAY_MS ?? 0);
    if (reviewReadDelay > 0) {
      rules.push({
        needle: "FROM document_versions WHERE requirement_id = ? ORDER BY version DESC LIMIT 1",
        ms: reviewReadDelay,
      });
    }
    const roleReadDelay = Number(runtime.W1_ROLE_READ_DELAY_MS ?? 0);
    if (roleReadDelay > 0) {
      rules.push({
        needle: "SELECT role_id FROM user_roles WHERE user_id = ?",
        ms: roleReadDelay,
        bindIncludes: delayBind || undefined,
      });
    }
    const overrideReadDelay = Number(runtime.W1_OVERRIDE_READ_DELAY_MS ?? 0);
    if (overrideReadDelay > 0) {
      rules.push({
        needle: "SELECT permission_key, effect FROM user_permission_overrides WHERE user_id = ?",
        ms: overrideReadDelay,
        bindIncludes: delayBind || undefined,
      });
    }
    const activeReadDelay = Number(runtime.W1_ACTIVE_READ_DELAY_MS ?? 0);
    if (activeReadDelay > 0) {
      rules.push({
        needle: "SELECT is_active FROM user WHERE id = ?",
        ms: activeReadDelay,
        bindIncludes: delayBind || undefined,
      });
    }
    const rolePermissionReadDelay = Number(runtime.W1_ROLEPERM_READ_DELAY_MS ?? 0);
    if (rolePermissionReadDelay > 0) {
      rules.push({
        needle: "SELECT permission_key FROM role_permissions WHERE role_id = ?",
        ms: rolePermissionReadDelay,
        bindIncludes: delayBind || undefined,
      });
    }
    const roleLookupDelay = Number(runtime.W1_ROLE_LOOKUP_DELAY_MS ?? 0);
    if (roleLookupDelay > 0) {
      rules.push({
        needle: "SELECT key FROM roles WHERE key IN",
        ms: roleLookupDelay,
        bindIncludes: delayBind || undefined,
      });
    }
    const roleInsertDelay = Number(runtime.W1_ROLE_INSERT_DELAY_MS ?? 0);
    if (roleInsertDelay > 0) {
      rules.push({
        needle: "INSERT INTO roles (id, key",
        ms: roleInsertDelay,
      });
    }

    let requestEnv: Env = env;
    if (rules.length > 0) {
      requestEnv = {
        ...(env as unknown as AnyRecord),
        DB: delayReads(env.DB, rules),
      } as unknown as Env;
    }

    const app = createApp();
    const activeDelay = Number(runtime.W1_ACTIVE_DELAY_MS ?? 0);
    if (activeDelay > 0) {
      if (request.method === "POST" && /^\/api\/v1\/users\/[^/]+\/active$/.test(pathname)) {
        return sleep(activeDelay).then(() => app.fetch(request, requestEnv, ctx));
      }
    }
    return app.fetch(request, requestEnv, ctx);
  },
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleScheduled(env));
  },
};
