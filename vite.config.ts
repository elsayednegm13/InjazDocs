import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { assertIsolatedPersist, isDeveloperStatePath } from "./shared/isolation";

// Historical test roots that must never be reused as a test persist target,
// even if explicitly passed via EXPORTFLOW_PERSIST in test mode.
const HISTORICAL_TEST_ROOTS = [
  ".wrangler-e2e",
  ".wrangler-perf",
  ".wrangler-reliability-b",
  ".wrangler-0653",
  ".wrangler-0654-drain",
  ".wrangler-0654-race",
  ".wrangler-verify",
  ".wrangler-transition-audit-20261020-c",
  ".wrangler-transition-audit-20261020-u",
  ".wrangler-transition-audit-20261020-p",
  ".wrangler-transition-audit-20261020-f",
  ".wrangler-transition-audit-20261020-h",
  ".wrangler-transition-audit-20261020-cwd",
];

function isHistoricalTestRoot(value: string): boolean {
  const normalized = value.replaceAll("\\", "/").toLowerCase();
  return HISTORICAL_TEST_ROOTS.some((root) => {
    const n = root.toLowerCase();
    return (
      normalized === n ||
      normalized.startsWith(`${n}/`) ||
      normalized.includes(`/${n}/`) ||
      normalized.endsWith(`/${n}`)
    );
  });
}

// Measured on this Windows host: serial POST bodies through the Vite plugin's
// Miniflare workerd pool fail with ECONNRESET before Hono. GET and empty POST
// do not. The pool keeps the socket for 1s and sets undici reset=false, so the
// next body request reuses a socket workerd has already reset. Closing that
// socket after one request still races the following POST unless dispatch is
// serialized until the socket is gone. This is local dispatch only. It does
// not retry a request and does not change the Worker.
//
// miniflare is a transitive dependency, so it is resolved through the plugin
// that depends on it instead of a hard coded pnpm path: a version bump changes
// the store hash and a fixed path would break the dev server.
const requireFromMiniflare = createRequire(fileURLToPath(import.meta.resolve("@cloudflare/vite-plugin")));
const undiciForRuntime = requireFromMiniflare("undici") as {
  Pool: new (url: URL, options?: Record<string, unknown>) => object;
  fetch: (input: unknown, init?: { dispatcher?: unknown; method?: string }) => Promise<unknown>;
};
const OriginalRuntimePool = undiciForRuntime.Pool;
undiciForRuntime.Pool = class ExportflowRuntimePool extends OriginalRuntimePool {
  constructor(url: URL, options: Record<string, unknown> = {}) {
    const isWorkerdPool = options.keepAliveTimeout === 1000 && options.headersTimeout === 0 && options.bodyTimeout === 0;
    super(url, isWorkerdPool ? { ...options, maxRequestsPerClient: 1, keepAliveTimeout: 1, keepAliveMaxTimeout: 1 } : options);
    if (isWorkerdPool && process.env.EXPORTFLOW_TRACE === "1") {
      console.error("[exportflow-trace] local workerd pool closes after one request");
    }
  }
};
const originalUndiciFetch = undiciForRuntime.fetch;
let workerdBodyGate: Promise<void> = Promise.resolve();
undiciForRuntime.fetch = (input, init) => {
  if (!init?.dispatcher) return originalUndiciFetch(input, init);
  const method = typeof input === "object" && input !== null && "method" in input
    ? String((input as { method?: string }).method ?? "GET")
    : String(init?.method ?? "GET");
  const writesBody = method !== "GET" && method !== "HEAD";
  const pending = workerdBodyGate.then(() => originalUndiciFetch(input, init));
  workerdBodyGate = pending.then(
    () => (writesBody ? new Promise<void>((resolve) => setTimeout(resolve, 320)) : undefined),
    () => (writesBody ? new Promise<void>((resolve) => setTimeout(resolve, 320)) : undefined),
  );
  return pending;
};

function traceDispatch(): Plugin {
  const attach = (register: (handler: (...args: never[]) => void) => void) => {
    if (process.env.EXPORTFLOW_TRACE !== "1") return;
    register(((error: { name?: string; code?: string; cause?: unknown }, req: { method?: string; url?: string }, _res: unknown, next: (error?: unknown) => void) => {
      const chain: string[] = [];
      let current: { name?: string; code?: string; cause?: unknown } | undefined = error;
      for (let depth = 0; current && depth < 4; depth += 1) {
        chain.push([current.name, current.code].filter(Boolean).join(":"));
        current = current.cause && typeof current.cause === "object" ? current.cause as { name?: string; code?: string; cause?: unknown } : undefined;
      }
      const pathname = (req.url ?? "").split("?")[0];
      console.error(`[exportflow-trace] ${req.method ?? "GET"} ${pathname} ${chain.join(" > ")}`);
      next(error);
    }) as never);
  };
  return {
    name: "exportflow-trace-dispatch",
    apply: "serve",
    enforce: "post",
    configureServer(server) {
      attach(server.middlewares.use.bind(server.middlewares) as never);
    },
    configurePreviewServer(server) {
      attach(server.middlewares.use.bind(server.middlewares) as never);
    },
  };
}

function omitCopiedDevVars(): Plugin {
  return {
    name: "exportflow-omit-dev-vars",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const key of Object.keys(bundle)) {
        const item = bundle[key];
        const name = item.type === "asset" || item.type === "chunk" ? item.fileName : key;
        if (name === ".dev.vars" || name.endsWith("/.dev.vars") || name.endsWith("\\.dev.vars")) {
          delete bundle[key];
        }
      }
    },
  };
}

const port = Number(process.env.EXPORTFLOW_PORT ?? 43173);
const explicitPersistPath = process.env.EXPORTFLOW_PERSIST;
const testMode = process.env.CI === "1" || process.env.EXPORTFLOW_TEST === "1";
// A CI/test run must name its own disposable store. Falling back to the
// developer store is exactly the failure this guard exists to prevent.
if (testMode && !explicitPersistPath) {
  throw new Error("EXPORTFLOW_PERSIST_REQUIRED: test runs may not use the developer D1 store");
}
const persistPath = explicitPersistPath ?? ".wrangler/state";
if (testMode && isDeveloperStatePath(persistPath)) {
  throw new Error("DEVELOPER_STATE_FORBIDDEN: test runs may not resolve .wrangler/state");
}
if (testMode && isHistoricalTestRoot(persistPath)) {
  throw new Error("HISTORICAL_TEST_ROOT_FORBIDDEN: test runs may not resolve historical test roots");
}

// M01-B.1: E2E runs are pinned to a generated, allowlisted Worker config that
// lives inside the owned run root. Wrangler resolves worker dev vars from the
// directory of the effective config, so this pin is what keeps the real
// project .dev.vars out of the E2E secrets chain. There is no default config
// and no project-root fallback: a missing or invalid path fails closed here,
// before the Cloudflare plugin or any child process is constructed.
const e2eWranglerConfigPath = (() => {
  if (!testMode) return undefined;
  const configured = process.env.EXPORTFLOW_E2E_WRANGLER_CONFIG_PATH;
  if (!configured || !String(configured).trim()) {
    throw new Error(
      "EXPORTFLOW_E2E_WRANGLER_CONFIG_REQUIRED: test runs must be pinned to the generated run-owned Worker config",
    );
  }
  const runRoot = process.env.EXPORTFLOW_E2E_ROOT;
  if (!runRoot || !String(runRoot).trim()) {
    throw new Error("EXPORTFLOW_E2E_ROOT_REQUIRED: the E2E config is validated against the run-owned root");
  }
  if (process.env.CLOUDFLARE_ENV !== "e2e") {
    throw new Error("EXPORTFLOW_E2E_ENV_MISMATCH: the E2E launcher must set CLOUDFLARE_ENV=e2e");
  }
  const configPath = path.resolve(String(configured));
  if (!path.isAbsolute(configPath)) {
    throw new Error("EXPORTFLOW_E2E_CONFIG_NOT_ABSOLUTE");
  }
  const ownedRoot = path.resolve(String(runRoot));
  const relativeToRunRoot = path.relative(ownedRoot, configPath);
  if (!relativeToRunRoot || relativeToRunRoot.startsWith("..") || path.isAbsolute(relativeToRunRoot)) {
    throw new Error("EXPORTFLOW_E2E_CONFIG_NOT_IN_RUN_ROOT");
  }
  // Lexical containment first (never resolves a protected store), then
  // existence checks on artifacts this launcher owns.
  assertIsolatedPersist(configPath, { root: process.cwd(), requireRunMarker: true });
  if (!existsSync(configPath)) {
    throw new Error("EXPORTFLOW_E2E_CONFIG_MISSING: the generated Worker config must exist before Vite starts");
  }
  if (!existsSync(path.join(path.dirname(configPath), ".dev.vars.e2e"))) {
    throw new Error("EXPORTFLOW_E2E_DEV_VARS_MISSING: synthetic secrets must exist before Vite starts");
  }
  return configPath;
})();

const testEnvDir = (() => {
  if (!testMode) return undefined;
  const ownedRoot = process.env.EXPORTFLOW_E2E_ROOT;
  if (!ownedRoot || !String(ownedRoot).trim()) {
    throw new Error("EXPORTFLOW_E2E_ROOT_REQUIRED: test runs must pin an owned Vite env directory");
  }
  const dir = path.join(path.resolve(String(ownedRoot)), "vite-env");
  assertIsolatedPersist(dir, { root: process.cwd(), requireRunMarker: true });
  return dir;
})();

export default defineConfig({
  // W1-G0: Vite resolves .env / .env.local / .env.[mode] from envDir, which
  // defaults to the project root. A test run must not read the real project
  // .env files, so envDir is pinned to an owned, deliberately empty directory
  // inside the run root. Normal development keeps the historical default.
  envDir: testMode ? testEnvDir : undefined,
  // E2E sets CI=1. Skip the inspector so this server does not fight another local workerd for port 9229.
  // E2E only: pin the generated run-owned config and forbid any remote binding
  // session (the installed plugin defaults to enabling remote bindings).
  plugins: [react(), tailwindcss(), cloudflare({ persistState: { path: persistPath }, inspectorPort: process.env.CI ? false : undefined, ...(e2eWranglerConfigPath ? { configPath: e2eWranglerConfigPath, remoteBindings: false as const } : {}) }), traceDispatch(), omitCopiedDevVars()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@server": path.resolve(__dirname, "server"),
      "@workspace/boosthis-runtime-web": path.resolve(__dirname, "lib/boosthis-runtime-web/src/index.ts"),
      "@workspace/boosthis-edge": path.resolve(__dirname, "lib/boosthis-edge/src/index.ts"),
    },
  },
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    // Keep HMR as an object. `hmr: false` makes Vite compute overlay as enabled
    // (`hmrConfig?.overlay !== false`), so the fetch-failed overlay still blocks clicks.
    hmr: { overlay: false },
    // E2E sets CI=1. File watching restarts the Worker mid-suite.
    // Local runs also must not watch unrelated checkouts or wrangler state:
    // a locked file there (EBUSY) kills the watcher and the dev server with it.
    watch: process.env.CI
      ? null
      : { ignored: ["**/ingaz_doc/**", "**/.wrangler*/**", "**/dist/**", "**/playwright-report/**"] },
  },
  preview: {
    host: "127.0.0.1",
    port,
    strictPort: true,
  },
});
