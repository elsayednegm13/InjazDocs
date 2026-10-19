import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

// Measured on this Windows host: serial POST bodies through the Vite plugin's
// Miniflare workerd pool fail with ECONNRESET before Hono. GET and empty POST
// do not. The pool keeps the socket for 1s and sets undici reset=false, so the
// next body request reuses a socket workerd has already reset. Closing that
// socket after one request still races the following POST unless dispatch is
// serialized until the socket is gone. This is local dispatch only. It does
// not retry a request and does not change the Worker.
const requireFromMiniflare = createRequire(
  path.resolve("node_modules/.pnpm/miniflare@5.20261006.1-alpha_@types+node@24.19.2/node_modules/miniflare/package.json"),
);
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
const persistPath = process.env.EXPORTFLOW_PERSIST ?? ".wrangler/state";

export default defineConfig({
  // E2E sets CI=1. Skip the inspector so this server does not fight another local workerd for port 9229.
  plugins: [react(), tailwindcss(), cloudflare({ persistState: { path: persistPath }, inspectorPort: process.env.CI ? false : undefined }), traceDispatch(), omitCopiedDevVars()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@server": path.resolve(__dirname, "server"),
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
    watch: process.env.CI ? null : undefined,
  },
  preview: {
    host: "127.0.0.1",
    port,
    strictPort: true,
  },
});
