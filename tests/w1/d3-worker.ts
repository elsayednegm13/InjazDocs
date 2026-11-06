/**
 * W1-CLOSE / A1 — D-3 real-path harness worker (test-only).
 *
 * This entry is NEVER the production Worker entry. `wrangler.jsonc` and the
 * generated E2E config both point at `worker/index.ts`, which calls
 * `createApp()` with no dependencies and therefore cannot enable any fault.
 * This file is bundled only by `scripts/d3/run-d3.mjs`, into a disposable,
 * run-owned workerd process whose config lives inside the run root.
 *
 * Fault selection comes from Worker vars in that generated config
 * (`D3_MODE`, `D3_FAIL_EMAIL`), never from a header, query string, cookie or
 * request body. A normal HTTP client of this harness cannot choose a mode:
 * the mode is fixed before the process starts.
 *
 * Modes:
 *   CONTROL            plain createApp(), no fault
 *   LINK_FAIL          real Better Auth; linkAccount fails once for D3_FAIL_EMAIL
 *   COMPENSATION_FAIL  LINK_FAIL + createApp({ failUserCompensation: true })
 *   INCIDENT_FAIL      COMPENSATION_FAIL + D1 binding rejects incident inserts
 */
import { createApp, handleScheduled, type AppDependencies } from "../../server/http/app";
import { createAuth as realCreateAuth } from "../../server/auth";

const INCIDENT_INSERT = /insert\s+into\s+auth_compensation_incidents/i;
const D3_ERROR = "D3_INDUCED_LINK_ACCOUNT_FAILURE";
const INCIDENT_ERROR = "D3_INDUCED_INCIDENT_STORE_FAILURE";

type AnyRecord = Record<string, unknown>;

function failIncidentStore(db: D1Database): D1Database {
  const failingStatement = () => {
    const failing = {
      bind: () => failing,
      run: async () => {
        throw new Error(INCIDENT_ERROR);
      },
      first: async () => {
        throw new Error(INCIDENT_ERROR);
      },
      all: async () => {
        throw new Error(INCIDENT_ERROR);
      },
      raw: async () => {
        throw new Error(INCIDENT_ERROR);
      },
    };
    return failing;
  };
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql: string) => {
          if (INCIDENT_INSERT.test(sql)) return failingStatement() as unknown as D1PreparedStatement;
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  }) as unknown as D1Database;
}

/**
 * Wraps the real Better Auth instance (not a fake auth, not a fake D1).
 * Only `internalAdapter.createUser` / `linkAccount` are observed so that the
 * credential step fails for exactly one reserved synthetic email. The rest of
 * the auth instance is returned untouched and bound to the real object.
 */
function createAuthWithLinkFault(env: Env, failEmail: string): ReturnType<typeof realCreateAuth> {
  const auth = realCreateAuth(env);
  const target = String(failEmail ?? "").trim().toLowerCase();
  let cachedContext: Promise<unknown> | null = null;
  return new Proxy(auth, {
    get(instance, prop) {
      if (prop !== "$context") {
        const value = Reflect.get(instance, prop, instance);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(instance) : value;
      }
      if (!cachedContext) {
        cachedContext = (async () => {
          const context = (await instance.$context) as unknown as {
            internalAdapter: {
              createUser: (data: AnyRecord, ...rest: unknown[]) => Promise<{ id: string }>;
              linkAccount: (data: AnyRecord) => Promise<unknown>;
            };
          };
          if (!target) return context;
          const adapter = context.internalAdapter;
          const originalCreateUser = adapter.createUser.bind(adapter);
          const originalLinkAccount = adapter.linkAccount.bind(adapter);
          let failUserId: string | null = null;
          adapter.createUser = async (data: AnyRecord, ...rest: unknown[]) => {
            const created = await originalCreateUser(data, ...rest);
            if (String(data?.email ?? "").trim().toLowerCase() === target) failUserId = created.id;
            return created;
          };
          adapter.linkAccount = async (data: AnyRecord) => {
            if (failUserId && data?.userId === failUserId) {
              failUserId = null;
              throw new Error(D3_ERROR);
            }
            return originalLinkAccount(data);
          };
          return context;
        })();
      }
      return cachedContext;
    },
  }) as unknown as ReturnType<typeof realCreateAuth>;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const mode = String((env as unknown as AnyRecord).D3_MODE ?? "CONTROL");
    const failEmail = String((env as unknown as AnyRecord).D3_FAIL_EMAIL ?? "");
    const deps: AppDependencies = {};
    let requestEnv: Env = env;
    if (mode === "LINK_FAIL" || mode === "COMPENSATION_FAIL" || mode === "INCIDENT_FAIL") {
      deps.createAuth = ((authEnv: Env) => createAuthWithLinkFault(authEnv, failEmail)) as typeof realCreateAuth;
    }
    if (mode === "COMPENSATION_FAIL" || mode === "INCIDENT_FAIL") deps.failUserCompensation = true;
    if (mode === "INCIDENT_FAIL") {
      requestEnv = { ...(env as unknown as AnyRecord), DB: failIncidentStore(env.DB) } as unknown as Env;
    }
    const app = createApp(deps);
    return app.fetch(request, requestEnv, ctx);
  },
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleScheduled(env));
  },
};
