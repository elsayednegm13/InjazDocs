/** Which isolate are we in, what can it give us, and how do we keep working
 *  after the response has left?
 *
 * Everything in here is feature detection against globals. No imports, no
 * built-ins, nothing that fails to *load* on a host we have not met — an
 * unknown isolate degrades to "unknown-isolate" and still measures.
 */

import { safe } from "./safe";

/** The hosts this kit is offered for. `unknown-isolate` is the honest answer
 *  for a web-standards host we do not recognise: the kit still runs, and the
 *  dashboard says so rather than guessing. */
export type EdgePlatform =
  | "cloudflare-workers"
  | "deno-deploy"
  | "deno"
  | "supabase-edge"
  | "vercel-edge"
  | "netlify-edge"
  | "unknown-isolate";

/** Human-readable platform names. These are what the dashboard shows next to
 *  the project, so a Worker never reads as "Node". */
export const EDGE_PLATFORM_LABELS: Readonly<Record<EdgePlatform, string>> = {
  "cloudflare-workers": "Cloudflare Workers",
  "deno-deploy": "Deno Deploy",
  deno: "Deno",
  "supabase-edge": "Supabase Edge Functions",
  "vercel-edge": "Vercel Edge Functions",
  "netlify-edge": "Netlify Edge Functions",
  "unknown-isolate": "Edge isolate",
};

interface DenoGlobal {
  env?: { get(name: string): string | undefined };
  version?: { deno?: string };
}

interface EdgeRuntimeGlobal {
  waitUntil?: (p: Promise<unknown>) => void;
}

function denoGlobal(): DenoGlobal | undefined {
  return safe(
    () => (globalThis as { Deno?: DenoGlobal }).Deno,
    undefined as DenoGlobal | undefined,
  );
}

function edgeRuntimeGlobal(): EdgeRuntimeGlobal | string | undefined {
  return safe(
    () => (globalThis as { EdgeRuntime?: EdgeRuntimeGlobal | string }).EdgeRuntime,
    undefined as EdgeRuntimeGlobal | string | undefined,
  );
}

/** Work out where we are running. Pure detection — never throws, never caches
 *  a wrong answer from a different isolate (module state IS per-isolate). */
export function detectPlatform(): EdgePlatform {
  const deno = denoGlobal();
  const edgeRuntime = edgeRuntimeGlobal();
  if (deno) {
    // Supabase Edge Functions are Deno isolates that additionally expose
    // EdgeRuntime.waitUntil — this is the runtime Lovable and Base44 back ends
    // are served from, so it is checked before plain Deno.
    if (edgeRuntime) return "supabase-edge";
    const id = safe(() => deno.env?.get("DENO_DEPLOYMENT_ID"), undefined);
    if (id) return "deno-deploy";
    return "deno";
  }
  // Cloudflare's documented marker. workerd sets it in production and locally.
  const ua = safe(
    () => (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent,
    undefined as string | undefined,
  );
  if (ua === "Cloudflare-Workers") return "cloudflare-workers";
  if (safe(() => "Netlify" in globalThis, false)) return "netlify-edge";
  if (edgeRuntime) return "vercel-edge";
  return "unknown-isolate";
}

/* ─── Where this project runs ─────────────────────────────────────────── */

/** The three words this kit reports about where it runs. Same shape and same
 *  closed vocabulary as every other kit — see
 *  artifacts/api-server/src/lib/hostingPlatforms.ts, which checks each word on
 *  arrival and stores anything it does not hold as "unrecognised". */
export interface HostingFacts {
  platform: string;
  region: string;
  environment: string;
}

/** The hosting word for each isolate host.
 *
 *  Plain `deno` answers "undeclared" because it is not a place: a `deno run`
 *  process can be on a laptop or a rented box, and nothing declared a host.
 *  An isolate we do not recognise answers "unrecognised" — something DID
 *  declare itself and we could not place it, which is a different fact. */
const HOSTING_PLATFORM_FOR: Readonly<Record<EdgePlatform, string>> = {
  "cloudflare-workers": "cloudflare-workers",
  "deno-deploy": "deno-deploy",
  deno: "undeclared",
  "supabase-edge": "supabase-edge",
  "vercel-edge": "vercel-edge",
  "netlify-edge": "netlify-edge",
  "unknown-isolate": "unrecognised",
};

/** `process.env`, if this host happens to have one. Vercel Edge does; a
 *  Cloudflare Worker has no process-wide environment at all. Guarded, because
 *  touching an absent global must never cost the host a request. */
function processEnv(name: string): string | undefined {
  return safe(() => {
    const p = (globalThis as { process?: { env?: Record<string, unknown> } })
      .process;
    const v = p?.env?.[name];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  }, undefined as string | undefined);
}

/**
 * Where this isolate is running, from what the host publishes about itself.
 *
 * Isolate hosts say much less about themselves than ordinary servers do —
 * most publish no region and no environment — so most of these come back
 * "undeclared" and "unknown", which are real answers rather than blanks. The
 * two that do declare something are read straight through.
 */
export function hostingFacts(platform: EdgePlatform): HostingFacts {
  const facts: HostingFacts = {
    platform: HOSTING_PLATFORM_FOR[platform] ?? "unrecognised",
    region: "undeclared",
    environment: "unknown",
  };
  if (platform === "deno-deploy") {
    facts.region = readEnv("DENO_REGION") ?? "undeclared";
    return facts;
  }
  if (platform === "vercel-edge") {
    facts.region = processEnv("VERCEL_REGION") ?? "undeclared";
    const e = (processEnv("VERCEL_ENV") ?? "").toLowerCase();
    if (e === "production" || e === "preview" || e === "development") {
      facts.environment = e;
    }
    return facts;
  }
  if (platform === "netlify-edge") {
    const c = (readEnv("CONTEXT") ?? "").toLowerCase();
    // Netlify's deploy previews and branch deploys are both previews; its
    // "dev" is a local run, which is development. Anything else stays unknown
    // rather than being read optimistically as production.
    if (c === "production") facts.environment = "production";
    else if (c === "deploy-preview" || c === "branch-deploy") {
      facts.environment = "preview";
    } else if (c === "dev") facts.environment = "development";
    return facts;
  }
  return facts;
}

/** Read a configuration value from whatever this host calls "the environment".
 *
 * Cloudflare hands secrets to the handler as an `env` object (there is no
 * process-wide environment at all); Deno and Supabase expose `Deno.env`. The
 * per-request `env` wins because that is the only one Cloudflare has.
 */
export function readEnv(
  name: string,
  env?: Record<string, unknown> | undefined,
): string | undefined {
  const fromBinding = safe(() => {
    const v = env?.[name];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  }, undefined as string | undefined);
  if (fromBinding !== undefined) return fromBinding;
  return safe(() => {
    const v = denoGlobal()?.env?.get(name);
    return typeof v === "string" && v.length > 0 ? v : undefined;
  }, undefined as string | undefined);
}

/** How this host lets us keep working once the customer's response has left.
 *
 *  - `ctx`      — Cloudflare's ExecutionContext.waitUntil, handed to the fetch
 *                 handler as its third argument.
 *  - `runtime`  — EdgeRuntime.waitUntil (Supabase Edge Functions, Vercel Edge).
 *  - `floating` — no hook at all: the isolate is a long-lived server (a plain
 *                 `Deno.serve` process), so an unawaited promise simply keeps
 *                 running. This is a real mechanism, not a fallback that loses
 *                 the work.
 */
export type AfterResponseKind = "ctx" | "runtime" | "floating";

export interface AfterResponse {
  kind: AfterResponseKind;
  /** Hand a promise to the host. Never throws; never awaited by the caller. */
  run(p: Promise<unknown>): void;
}

interface CtxLike {
  waitUntil?: (p: Promise<unknown>) => void;
}

/** Resolve the after-response mechanism for this invocation. `ctx` is whatever
 *  the platform passed the handler (Cloudflare's ExecutionContext); everything
 *  else is detected from globals. */
export function resolveAfterResponse(ctx?: unknown): AfterResponse {
  const ctxWaitUntil = safe(() => {
    const f = (ctx as CtxLike | undefined)?.waitUntil;
    return typeof f === "function" ? f.bind(ctx) : undefined;
  }, undefined as ((p: Promise<unknown>) => void) | undefined);
  if (ctxWaitUntil) {
    return {
      kind: "ctx",
      run(p) {
        try {
          ctxWaitUntil(p);
        } catch {
          void p;
        }
      },
    };
  }
  const er = edgeRuntimeGlobal();
  const runtimeWaitUntil = safe(() => {
    if (!er || typeof er === "string") return undefined;
    const f = er.waitUntil;
    return typeof f === "function" ? f.bind(er) : undefined;
  }, undefined as ((p: Promise<unknown>) => void) | undefined);
  if (runtimeWaitUntil) {
    return {
      kind: "runtime",
      run(p) {
        try {
          runtimeWaitUntil(p);
        } catch {
          void p;
        }
      },
    };
  }
  return {
    kind: "floating",
    run(p) {
      // Deliberately unawaited: a long-lived `Deno.serve` process keeps the
      // promise running after the response is written. Attach a catch so an
      // upload failure can never surface as an unhandled rejection in the
      // customer's logs.
      void p.catch(() => {});
    },
  };
}

/* ─── What this host will and will not let us finish ─────────────────────── */

/** How sure this kit is that work handed over AFTER the reply really runs.
 *
 *  - `host-hook`          — the platform offered an explicit mechanism
 *                           (`ctx.waitUntil` / `EdgeRuntime.waitUntil`) and
 *                           documents that it keeps the isolate alive for it.
 *  - `long-lived-process` — no hook, but this is a plain server process (a
 *                           `deno run` box): an unawaited promise keeps running
 *                           because nothing tears the process down.
 *  - `unproven`           — an isolate host that offered NO hook at this call
 *                           site. The platform is entitled to freeze or discard
 *                           the isolate the moment the response is written, so
 *                           anything handed over afterwards may simply never
 *                           run. Not "broken" and not "fine": unproven.
 */
export type AfterResponseAssurance =
  | "host-hook"
  | "long-lived-process"
  | "unproven";

/** What this host allows, and the sentence a developer reads when part of it
 *  cannot be guaranteed. */
export interface AfterResponseStatement {
  assurance: AfterResponseAssurance;
  /** Null when nothing is withheld. Otherwise the WHOLE sentence: which part
   *  cannot be relied on here, and why. Never a code, never a bare flag —
   *  this is the one thing standing between a developer and a dashboard that
   *  looks quietly empty for a reason nobody wrote down. */
  limitation: string | null;
}

/** Isolate hosts that create and discard an isolate per request. On these, a
 *  floating promise is a promise the platform may never let finish — which is
 *  a different fact from a long-lived process, and must not be filed as one. */
const FREEZES_AT_RESPONSE: Readonly<Record<EdgePlatform, boolean>> = {
  "cloudflare-workers": true,
  "deno-deploy": true,
  deno: false,
  "supabase-edge": true,
  "vercel-edge": true,
  "netlify-edge": true,
  // We do not know what an unrecognised isolate does, and "we do not know" is
  // the same practical answer as "it may freeze": we cannot promise the work
  // finished. Recorded as unproven rather than assumed either way.
  "unknown-isolate": true,
};

/**
 * Say what this platform allows for work that outlives a response.
 *
 * Everything this kit sends — samples, the snapshot, crashes, and now spans —
 * leaves on the after-response handoff, because a visitor must never wait for
 * Boosthis. On a host that offers a hook, that is a promise the platform made.
 * On a host that offers nothing, it is a hope. The two are not the same and
 * this kit does not let them look the same: an install whose spans may be
 * dropped by its host says so, once, in the log, instead of appearing to work
 * and rendering an empty waterfall on the dashboard.
 *
 * `resolveAfterResponse` already picks the mechanism. This reads the answer it
 * came back with, together with where we are, and turns the pair into words.
 */
export function afterResponseAssurance(
  platform: EdgePlatform,
  kind: AfterResponseKind,
): AfterResponseStatement {
  if (kind === "ctx" || kind === "runtime") {
    return { assurance: "host-hook", limitation: null };
  }
  if (!FREEZES_AT_RESPONSE[platform]) {
    return { assurance: "long-lived-process", limitation: null };
  }
  const where = EDGE_PLATFORM_LABELS[platform] ?? "this isolate host";
  return {
    assurance: "unproven",
    limitation:
      `${where} gave this handler no way to continue work after the reply ` +
      `(no ctx.waitUntil, no EdgeRuntime.waitUntil), and an isolate may be ` +
      `frozen the moment its response is written. Spans, samples and crash ` +
      `reports are recorded while the request is still running, but the ` +
      `upload that carries them away may never get to run — so this ` +
      `function may appear on your dashboard with nothing behind it. On ` +
      `Cloudflare, take the third argument and pass it through: ` +
      `fetch(request, env, ctx).`,
  };
}

/** A monotonic clock every isolate has. `performance.now()` exists in workerd,
 *  Deno and every hosted edge runtime; Date.now() is the last resort. */
export function nowMs(): number {
  return safe(() => {
    const p = (globalThis as { performance?: { now(): number } }).performance;
    return typeof p?.now === "function" ? p.now() : Date.now();
  }, Date.now());
}
