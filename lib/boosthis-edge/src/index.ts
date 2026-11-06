/** Boosthis for V8 isolate back ends — Cloudflare Workers, Deno / Deno Deploy,
 *  and hosted edge functions (the runtime Lovable and Base44 back ends run on).
 *
 * Wrap your handler and every request is timed. Nothing is written to disk
 * (there is no disk), nothing runs on a timer (no timer survives the response),
 * and the visitor never waits for us: uploads happen after the response has
 * left, using whatever mechanism the platform gives for continuing work.
 *
 * Cloudflare Workers
 *   import { withBoosthis } from "boosthis-edge";
 *   export default withBoosthis({
 *     async fetch(request, env, ctx) { return new Response("ok"); },
 *   });
 *
 * Deno / Deno Deploy / hosted edge functions
 *   import { boosthisHandler } from "boosthis-edge";
 *   Deno.serve(boosthisHandler(async (request) => new Response("ok")));
 */

import { sayOnce, announceStart, type Notice } from "./announce";
import {
  clearCollector,
  noteDeclaredRequest,
  noteRequest,
  drainSamples,
  discardSamples,
  returnSamples,
  readState,
  pendingCount,
} from "./collector";
import {
  _resetCoverageForTests,
  clearEntryPointRuns,
  coverageInventory,
  markEntryPointMeasured,
  noteEntryPointRun,
  noteWorkerEntryPoints,
  type EntryPointKind,
} from "./coverage";
import {
  _resetCrashesForTests,
  acknowledgeCrashes,
  clearCrashes,
  pendingCrashCount,
  dueCrashBatches,
  retryCrashBatch,
  reportUnhandledError,
} from "./crashReporter";
import { resolveProjectKey } from "./credentials";
import {
  askDue,
  askNow,
  entitlement,
  heldGeneration,
  isDissolved,
  learnRefusal,
  mayMeasure,
  mayUpload,
  setLockHandlers,
} from "./entitlement";
import { resolveInstallId } from "./identity";
import {
  afterResponseAssurance,
  detectPlatform,
  nowMs,
  readEnv,
  resolveAfterResponse,
  type EdgePlatform,
} from "./platform";
import { beginRequestTrace, newTraceId } from "./trace";
import { _spanScopeInternals, beginSpan } from "./spanScope";
import { outcomeForStatus } from "./spanWork";
import {
  _resetSpansForTests,
  clearSpans,
  drainSpans,
  discardSpans,
  enqueueSpan,
  MAX_BUFFERED_LINKED_STEPS,
  MAX_BUFFERED_SPANS,
  MAX_SPAN_BATCH,
  pendingSpanCount,
  rateSpanDuration,
  returnLinked,
  returnSpans,
  takeReadyLinked,
} from "./spanEmitter";
import { linkedSpans, type LinkedFold } from "./linkedSteps";
import {
  _resetOutboundForTests,
  armOutbound,
  closeLinkedSteps,
  disarmOutbound,
  foldScope,
  getAiStats,
  getDbStats,
  getDependencyStats,
  openScope,
} from "./outbound";
import {
  _resetHostFactsForTests,
  clearHostFacts,
  edgeHostFacts,
  noteAfterResponseCompleted,
} from "./hostFacts";
import {
  ask,
  forgetRegistration,
  registrationState,
  type RegistrationState,
} from "./registration";
import {
  _resetJobRunsForTests,
  clearJobRuns,
  discardJobRuns,
  fileJobRun,
  pendingJobRunCount,
  returnJobRuns,
  takeJobRuns,
} from "./jobReporter";
import { MAX_PART_NAME, normalizePath } from "./routeLabel";
import { safe, safeVoid } from "./safe";
import {
  buildSnapshot,
  type CookieCounts,
  type CorsCounts,
  type StatusCounts,
} from "./snapshot";
import type { SettledStatusCounts } from "./axes";
import { __resetIsolateClockForTests, isSettledAt } from "./settleRule";
import { MAX_SAMPLES_PER_BATCH, send, batchRefused, type SendOutcome } from "./transmit";
import { RUNTIME_VERSION } from "./version";
import {
  _resetDeclaredAiEndpointsForTests,
  setDeclaredAiEndpoints,
} from "./aiProviders";
import {
  _resetRequestMetersForTests,
  beginInvocation,
  endInvocation,
  unhookRequestMeters,
} from "./requestMeters";
import {
  _resetDeclaredWaitsForTests,
  clearDeclaredWaitCounts,
  noteDeclaredRouteCall,
  setDeclaredWaits,
  type DeclaredWaitsOption,
} from "./declaredWaits";

export { CALL_DEPENDENT_AXES, MEASURABLE_AXES, NOT_MEASURABLE } from "./axes";
export { NON_FETCH_ENTRY_POINTS, type EntryPointKind } from "./coverage";
export {
  EDGE_PLATFORM_LABELS,
  afterResponseAssurance,
  detectPlatform,
  type AfterResponseAssurance,
  type AfterResponseStatement,
  type EdgePlatform,
} from "./platform";
export { RUNTIME_TAG, RUNTIME_VERSION } from "./version";
// Background jobs: each run of a scheduled handler wrapped with
// boosthisEntryPoint, filed under the name it was given or the cron pattern
// that fired it (see jobReporter.ts). Read-only counts for the host app.
export {
  MAX_JOB_NAME,
  jobNameRefusals,
  jobRunsLost,
} from "./jobReporter";
export {
  declaredAiEndpointCount,
  setDeclaredAiEndpoints,
} from "./aiProviders";
// Waits declared on purpose (docs/held-open-calls.md): a route this function
// answers that waits on purpose — a long-poll — and a call it makes that does,
// such as a bot long-polling its messaging service. Accepted by
// `withBoosthis(worker, { declaredWaits })` and `boosthisHandler(fn, { declaredWaits })`.
export type { DeclaredWaitsOption } from "./declaredWaits";

// Full-stack trace tag. Adopt the caller's correlation id on the way in rather
// than minting one, so a chain that ENTERS the system through this worker is
// one trace and not two.
export {
  TRACE_HEADER,
  TRACE_ID_RE,
  ELAPSED_HEADER,
  beginRequestTrace,
  isValidTraceId,
  newTraceId,
  sanitizeTraceElapsed,
  sanitizeTraceId,
  type InboundTrace,
} from "./trace";

// Full-stack trace causality. A span carries its own identity and the identity
// of the call that caused it, so the waterfall nests and can name the hop
// RESPONSIBLE for the end-to-end time rather than merely the longest one.
export {
  MAX_ACTIVE_SPANS,
  PARENT_HEADER,
  SPAN_ID_RE,
  adoptParentSpanId,
  beginSpan,
  currentAction,
  currentSpanId,
  isValidSpanId,
  newSpanId,
  runInSpan,
  sanitizeSpanId,
  type ActionContext,
  type SpanHandle,
} from "./spanScope";

// Span emission. Recorded synchronously inside the request that produced it
// and carried away on the host's own after-response mechanism — an isolate
// gets no later opportunity.
export {
  MAX_SPAN_BATCH,
  drainSpans,
  droppedSpanCount,
  enqueueSpan,
  pendingSpanCount,
  rateSpanDuration,
  returnSpans,
  type SpanLayer,
  type SpanRating,
  type TraceSpan,
} from "./spanEmitter";
export {
  SPAN_OUTCOMES,
  SPAN_WORK_KINDS,
  outcomeForStatus,
  sanitizeOutcome,
  sanitizeWorkKind,
  type SpanOutcome,
  type SpanWorkKind,
} from "./spanWork";

/** Where uploads go when the developer has not said otherwise. */
export const DEFAULT_ENDPOINT = "https://www.boosthis.com/api";

/** An isolate that was created to serve this request boots and answers within
 *  a moment. If the first request arrives long after the isolate started, this
 *  is a long-lived server (a plain `Deno.serve` process), and the gap is idle
 *  time, not a cold start — so cold start is not reported at all rather than
 *  reported as a huge number. */
export const COLD_START_ATTRIBUTION_MS = 1000;

/** How rarely one isolate re-sends the whole picture. Sample rows carry the
 *  detail; the snapshot is the meter page, and it does not need to be resent
 *  per request. */
export const SNAPSHOT_MIN_GAP_MS = 30_000;

/** Most sends we will make after any single response. A hard cap on what we
 *  spend of the host's after-response budget.
 *
 *  Raised from two to three when spans arrived. Spans are not an extra copy of
 *  something already being sent: a sample says how long a request took, and a
 *  span says which ACTION that request belonged to and what called it. A trace
 *  is missing its edge hop entirely if the span does not travel, and the edge
 *  hop is usually the first one — so the cap moved rather than the spans
 *  waiting behind samples for an after-response that may never come again.
 *
 *  The order below is deliberate and does not shuffle: crashes (evidence of
 *  something broken), then spans (perishable — an isolate that freezes loses
 *  the whole hop, where a sample only loses one of many), then samples, then
 *  the snapshot, which is a periodic re-send and is the honest thing to drop. */
export const MAX_SENDS_PER_RESPONSE = 3;

export interface BoosthisEdgeOptions {
  /** Project key from your Boosthis dashboard. Read from BOOSTHIS_PROJECT_KEY
   *  (a Worker secret, a Deno environment variable) when not passed here; the
   *  older name BOOSTHIS_KEY is still read, first when both are set. */
  projectKey?: string;
  /** Display name for this function in your dashboard. Max 60 characters. */
  appName?: string;
  /** Pin an existing install id (moving a project onto an isolate host). By
   *  default the id is derived from the key + slot, identically on every wake. */
  installId?: string;
  /** Separates two functions that share one project key. Defaults to the app
   *  name; two functions given the same slot deliberately count as one project. */
  slot?: string;
  endpoint?: string;
  /** Override platform detection. Only useful in tests. */
  platform?: EdgePlatform;
  fetchImpl?: typeof fetch;
  /** Self-hosted or private AI endpoints this app calls. Hostnames never leave
   *  the isolate; only the fixed "declared" provider code is reported. */
  aiEndpoints?: readonly string[];
  /** Opt in to sanitized JavaScript stack frames (function, file basename,
   * generated line and column) on crash reports. Minimal crash fingerprints
   * are always reported for registered apps. */
  crashDetails?: boolean;
  /** Where the kit's own lines go. Defaults to console.warn. */
  notice?: Notice;
  /** Waits declared on purpose (docs/held-open-calls.md). Only you know a
   *  request waits because it is meant to, so you name it, exactly, and the kit
   *  keeps its duration out of every speed reading and counts it instead —
   *  errors still count. At most ten names in each list.
   *
   *  `routes` — routes this function answers that wait on purpose, such as a
   *  long-poll: `"GET /poll"`, or `"/poll"` for every method of that route.
   *
   *  `calls` — `fetch` calls this function makes that wait on purpose, by full
   *  address without the query, with `:name` for a segment that changes:
   *  `"https://api.telegram.org/bot:token/getUpdates"`. Compared inside the
   *  isolate; the address is never sent. */
  declaredWaits?: DeclaredWaitsOption;
}

/** The shape a Cloudflare module worker exports. */
export interface WorkerEntry {
  fetch(request: Request, env?: unknown, ctx?: unknown): Response | Promise<Response>;
}

/** What `boosthisEntryPoint` takes beyond the options every wrapper takes. */
export interface BoosthisEntryPointOptions extends BoosthisEdgeOptions {
  /** The job's name as written in your app — `"nightly-rebuild"`. Each run of
   *  the wrapped handler is then filed as a run of that background job, and
   *  appears in the project's list of jobs. A scheduled handler on Cloudflare
   *  needs none: its run is filed under the cron pattern that fired it. Deno
   *  Deploy hands a cron handler nothing to name it by, so a Deno cron is named
   *  here. Spaces are fine; 80 characters at most, and a name built out of a
   *  value (an email address, an id) is refused and said, never sent. */
  job?: string;
}

// ── Per-isolate state ────────────────────────────────────────────────────────
// Module scope IS isolate scope: created with the isolate, discarded with it,
// never shared between them. Nothing here outlives a wake, and nothing here
// needs to.

const bootAtMs = nowMs();
let firstRequestAtMs: number | null = null;
let coldStartMs: number | null = null;
/** The request that would have closed the cold-start interval was a declared
 *  wait: its end is the wait it was declared for, not the end of the start, so
 *  this isolate's start is not measured at all — never by a later request,
 *  whose end is further still from the start. */
let coldStartForgone = false;
let lastSnapshotAtMs = 0;
/** The LAST flush pass scheduled in this isolate, not merely the one running.
 *  Responses that arrive while a pass is draining chain onto this rather than
 *  joining it — see `scheduleFlush`. */
let flushTail: Promise<void> | null = null;
/** Whether a follow-up pass is already queued behind the tail. One is enough:
 *  every response that arrives during the current pass can wait for the same
 *  follow-up, and each pass drains whatever is in the buffer when it runs. */
let flushFollowUpQueued = false;
/** How many uploads one handoff may make before it hands the rest to the next
 *  response. A pass takes at most `MAX_SPAN_BATCH` off a buffer that holds
 *  `MAX_BUFFERED_SPANS` requests' own steps plus `MAX_BUFFERED_LINKED_STEPS`
 *  linked steps whose own step has left, so this is what emptying a full
 *  buffer takes, plus one for what arrived while it was being emptied. A hard
 *  number on purpose: an unbounded loop inside a host's keep-alive is a worse
 *  failure than a span that leaves on the next request. */
const MAX_DRAIN_PASSES =
  Math.ceil((MAX_BUFFERED_SPANS + MAX_BUFFERED_LINKED_STEPS) / MAX_SPAN_BATCH) + 1;

const status: StatusCounts = {
  unauthorized: 0,
  forbidden: 0,
  notFound: 0,
  rateLimited: 0,
  serverErrors: 0,
};
const cookies: CookieCounts = {
  cookiesSet: 0,
  responses: 0,
  noSecure: 0,
  noHttpOnly: 0,
  noSameSite: 0,
  noneWithoutSecure: 0,
};
const cors: CorsCounts = {
  responses: 0,
  originRequests: 0,
  anyOrigin: 0,
  reflected: 0,
  wildcardCredentials: 0,
  firstAtMs: null,
};

/** The same responses counted once the isolate has settled (start-up rule,
 *  peakRate): the window access pressure is judged over. The lifetime counts
 *  above still feed reliability, which the trace cleared. */
const settledStatus: SettledStatusCounts = {
  requests: 0,
  unauthorized: 0,
  forbidden: 0,
  notFound: 0,
  rateLimited: 0,
  serverErrors: 0,
  firstAtMs: null,
  settlingRejections: 0,
};

// ── The lock rule's acts (docs/kit-lock-rule.md) ─────────────────────────────
// entitlement.ts decides whether this isolate runs; these are what it does
// when the answer stops it. Wired once, at import, as a real isolate is.

/** The response counts, back to nothing. */
function clearResponseCounts(): void {
  status.unauthorized = 0;
  status.forbidden = 0;
  status.notFound = 0;
  status.rateLimited = 0;
  status.serverErrors = 0;
  settledStatus.requests = 0;
  settledStatus.unauthorized = 0;
  settledStatus.forbidden = 0;
  settledStatus.notFound = 0;
  settledStatus.rateLimited = 0;
  settledStatus.serverErrors = 0;
  settledStatus.firstAtMs = null;
  settledStatus.settlingRejections = 0;
  cookies.cookiesSet = 0;
  cookies.responses = 0;
  cookies.noSecure = 0;
  cookies.noHttpOnly = 0;
  cookies.noSameSite = 0;
  cookies.noneWithoutSecure = 0;
  cors.responses = 0;
  cors.originRequests = 0;
  cors.anyOrigin = 0;
  cors.reflected = 0;
  cors.wildcardCredentials = 0;
  cors.firstAtMs = null;
}

/** Every reading this isolate holds, gone: rows, samples, spans, crashes, the
 *  response counts, the start it measured, and whatever waited for the first
 *  answer. Nothing of it is ever sent. Each part is cleared on its own, so one
 *  that throws cannot keep the rest. */
function dropEverythingHeld(): void {
  safeVoid(() => clearCollector());
  safeVoid(() => clearCrashes());
  safeVoid(() => clearSpans());
  safeVoid(() => clearJobRuns());
  safeVoid(() => clearHostFacts());
  safeVoid(() => clearEntryPointRuns());
  safeVoid(() => clearDeclaredWaitCounts());
  safeVoid(() => clearResponseCounts());
  // The isolate is no longer starting, so its start is never measured again.
  coldStartMs = null;
  coldStartForgone = true;
  lastSnapshotAtMs = 0;
}

/** The watch comes off the app's outgoing calls and its error log, and the
 *  readings each held go with it. */
function unhookKit(): void {
  safeVoid(() => disarmOutbound());
  safeVoid(() => unhookRequestMeters());
}

/** Forget this install. Everything this isolate keeps about it is in its own
 *  memory; the project's history on our server is not this kit's to remove. */
function forgetThisInstall(): void {
  safeVoid(() => forgetRegistration());
}

setLockHandlers({
  clearSamples: dropEverythingHeld,
  unhook: unhookKit,
  removeLocal: forgetThisInstall,
});

function noteStatus(code: number): void {
  if (code === 401) status.unauthorized += 1;
  else if (code === 403) status.forbidden += 1;
  else if (code === 404) status.notFound += 1;
  else if (code === 429) status.rateLimited += 1;
  else if (code >= 500) status.serverErrors += 1;
  const at = Date.now();
  const turnedAway = code === 401 || code === 403 || code === 404 || code === 429;
  if (!isSettledAt("peakRate", at)) {
    if (turnedAway) settledStatus.settlingRejections += 1;
    return;
  }
  if (settledStatus.firstAtMs === null) settledStatus.firstAtMs = at;
  settledStatus.requests += 1;
  if (code === 401) settledStatus.unauthorized += 1;
  else if (code === 403) settledStatus.forbidden += 1;
  else if (code === 404) settledStatus.notFound += 1;
  else if (code === 429) settledStatus.rateLimited += 1;
  else if (code >= 500) settledStatus.serverErrors += 1;
}

/** Set-Cookie lines examined per response. Past this the rest are counted as
 *  set and nothing else is looked at. */
const COOKIE_PER_RESPONSE_MAX = 20;
/** Characters of the ATTRIBUTE tail — everything AFTER the first ';' — that are
 *  ever examined. The cookie's own name and value sit before that semicolon and
 *  are never read, and this is what keeps a huge value from costing unbounded
 *  work inside the response path. */
const COOKIE_ATTR_SCAN_MAX = 2048;
/** Attribute segments examined per cookie. */
const COOKIE_ATTR_SEGMENT_MAX = 20;

/** Count what protections one Set-Cookie line is missing, reading ONLY its
 *  attribute tail: the name and the value are cut off before anything is
 *  matched or lower-cased. */
function noteOneCookie(raw: string): void {
  cookies.cookiesSet += 1;
  const firstSemi = raw.indexOf(";");
  // No ';' at all means no attributes at all — no Secure, no HttpOnly, no
  // SameSite — and the name=value part is still never examined.
  const tail =
    firstSemi < 0
      ? ""
      : raw.slice(firstSemi + 1, firstSemi + 1 + COOKIE_ATTR_SCAN_MAX);
  const segments = tail.split(";");
  const limit = Math.min(segments.length, COOKIE_ATTR_SEGMENT_MAX);
  let secure = false;
  let httpOnly = false;
  let sameSite: string | null = null;
  for (let i = 0; i < limit; i++) {
    // Short attribute segments only — no whole header value is lower-cased.
    const seg = segments[i];
    const eq = seg.indexOf("=");
    const key = (eq < 0 ? seg : seg.slice(0, eq)).trim().toLowerCase();
    if (key === "secure") secure = true;
    else if (key === "httponly") httpOnly = true;
    else if (key === "samesite") {
      sameSite = eq < 0 ? "" : seg.slice(eq + 1).trim().toLowerCase();
    }
  }
  if (!secure) cookies.noSecure += 1;
  if (!httpOnly) cookies.noHttpOnly += 1;
  if (sameSite === null) cookies.noSameSite += 1;
  if (sameSite === "none" && !secure) cookies.noneWithoutSecure += 1;
}

/** Read the response's own Set-Cookie headers and count what protections are
 *  missing. Flag NAMES and counts only — never a cookie name, never a value. */
function noteCookies(res: Response): void {
  safeVoid(() => {
    const headers = res.headers;
    const list: string[] = safe(() => {
      const getAll = (headers as { getSetCookie?: () => string[] }).getSetCookie;
      if (typeof getAll === "function") return getAll.call(headers);
      const single = headers.get("set-cookie");
      return single ? [single] : [];
    }, []);
    if (list.length > 0) cookies.responses += 1;
    let seen = 0;
    for (const raw of list) {
      if (seen >= COOKIE_PER_RESPONSE_MAX) break;
      if (typeof raw !== "string" || raw === "") continue;
      seen++;
      noteOneCookie(raw);
    }
  });
}

/** Characters of a cross-origin header value ever compared. A real origin is
 *  far shorter; past this the value is not one we compare. */
const CORS_VALUE_SCAN_MAX = 512;

/** The FIRST value of a header, trimmed — the rule every server kit uses. A
 *  `Headers.get()` joins repeated values with ", ", and an origin can never
 *  contain a comma, so the text before the first comma IS the first value. */
function firstCorsValue(raw: string | null): string {
  if (typeof raw !== "string" || raw.length > CORS_VALUE_SCAN_MAX) return "";
  const comma = raw.indexOf(",");
  return (comma < 0 ? raw : raw.slice(0, comma)).trim();
}

/** Read the cross-origin answer this function served and count its SHAPE:
 *  any origin, the asking origin echoed back, a wildcard with credentials.
 *  The origin and both header values live only on this stack — counts leave
 *  it, nothing else. Same comparison as every server kit. */
function noteCors(request: Request, res: Response): void {
  safeVoid(() => {
    const origin = firstCorsValue(safe(() => request.headers.get("origin"), null));
    const acao = firstCorsValue(
      safe(() => res.headers.get("access-control-allow-origin"), null),
    );
    const acac = firstCorsValue(
      safe(() => res.headers.get("access-control-allow-credentials"), null),
    ).toLowerCase();
    if (cors.firstAtMs === null) cors.firstAtMs = Date.now();
    cors.responses += 1;
    if (origin !== "") cors.originRequests += 1;
    if (acao === "*") {
      cors.anyOrigin += 1;
      if (acac === "true") cors.wildcardCredentials += 1;
    } else if (origin !== "" && acao !== "" && acao.toLowerCase() === origin.toLowerCase()) {
      cors.reflected += 1;
    }
  });
}

function labelFor(request: Request): string | null {
  return safe(() => {
    const url = new URL(request.url);
    const method = (request.method || "GET").toUpperCase().slice(0, 10);
    const path = normalizePath(url.pathname);
    if (path === null) return null;
    const label = `${method} ${path}`;
    return label.length <= MAX_PART_NAME ? label : null;
  }, null);
}

/** Is this finished request a route the developer declared as waiting on
 *  purpose? Compared against the route as the dashboard shows it AND against
 *  the request's own path, because an isolate has no route table and the
 *  label is built from the path and redacted (`/poll` shows as `/:id`). The
 *  path is compared and dropped; it is never kept or sent. */
function isDeclaredRoute(request: Request, label: string | null, durationMs: number): boolean {
  return safe(
    () =>
      noteDeclaredRouteCall(
        request.method || "GET",
        label,
        new URL(request.url).pathname,
        durationMs,
      ),
    false,
  );
}

interface Resolved {
  endpoint: string;
  projectKey: string | null;
  keyTail: string | null;
  appName: string | undefined;
  slot: string;
  platform: EdgePlatform;
}

function resolveConfig(
  opts: BoosthisEdgeOptions,
  env: Record<string, unknown> | undefined,
): Resolved {
  const key = resolveProjectKey(opts.projectKey, env);
  const appName = (opts.appName ?? readEnv("BOOSTHIS_APP_NAME", env))?.slice(0, 60);
  return {
    endpoint: (opts.endpoint ?? readEnv("BOOSTHIS_ENDPOINT", env) ?? DEFAULT_ENDPOINT).replace(
      /\/+$/,
      "",
    ),
    projectKey: key.key,
    keyTail: key.tail,
    appName,
    slot: opts.slot ?? appName ?? "default",
    platform: opts.platform ?? detectPlatform(),
  };
}

/**
 * Take the app's declarations of its own model endpoints, from BOTH places a
 * function host offers them: the option, and the environment binding.
 *
 * An isolate has no `process.env` — its environment arrives per request, in
 * the `env` argument the host passes the handler. So this cannot run once at
 * wrap time the way the Node kit's does: the binding is not knowable until a
 * request is in hand. It runs on the way in, BEFORE the outbound watcher is
 * armed, because a declaration that lands after the first model call has
 * already let that call be filed as an unrecognised outbound request.
 *
 * Idempotent by signature: the declarations are re-applied only when what was
 * resolved actually changed, so the steady state costs one string compare per
 * request rather than a re-parse.
 */
let declaredUnion: Set<string> | null = null;
let lastEnvRaw: string | null = null;
let lastOptsRef: readonly string[] | undefined;
let lastResolveSeen = false;
function applyDeclaredEndpoints(
  opts: BoosthisEdgeOptions,
  env: Record<string, unknown> | undefined,
): void {
  safeVoid(() => {
    const fromEnv = readEnv("BOOSTHIS_AI_ENDPOINTS", env);
    const envRaw = typeof fromEnv === "string" ? fromEnv : null;
    const optsRef = Array.isArray(opts.aiEndpoints) ? opts.aiEndpoints : undefined;
    // Steady state is the same binding string and the same options array as
    // the last request: two compares, no split and no allocation, before we
    // touch anything.
    if (lastResolveSeen && envRaw === lastEnvRaw && optsRef === lastOptsRef) return;
    lastEnvRaw = envRaw;
    lastOptsRef = optsRef;
    lastResolveSeen = true;

    // The registry is isolate-wide, but it is written from a REQUEST, and one
    // isolate can hold several wrapped handlers with different options. A
    // registry that is replaced per invocation lets two handlers overwrite
    // each other mid-flight, so a call already in the air gets judged against
    // whichever configuration wrote last. Accumulating instead removes the
    // race: whether an address is the customer's own model endpoint is a fact
    // about the ADDRESS, not about which handler happened to run, and a union
    // reaches the same answer in any arrival order. It only ever grows, so a
    // declaration cannot go missing between two requests either.
    const union = declaredUnion ?? (declaredUnion = new Set<string>());
    const before = union.size;
    if (optsRef) {
      for (const e of optsRef) if (typeof e === "string" && e.trim()) union.add(e.trim());
    }
    if (envRaw) {
      for (const e of envRaw.split(",")) if (e.trim()) union.add(e.trim());
    }
    if (union.size === before) return;
    // Normalising, de-duplicating, capping and rejecting junk is the setter's
    // job, and it never throws — a bad value in a binding must not be able to
    // stop a customer's function measuring anything at all.
    setDeclaredAiEndpoints([...union]);
  });
}

const NO_KEY_LINE =
  "no project key found — set BOOSTHIS_PROJECT_KEY and this function will appear on your dashboard. Nothing is being uploaded.";

/** May this request be measured? Never without a key (said once), and only
 *  while the lock rule allows: before the first word, into memory; after it,
 *  on an exact `active` inside its grace. */
function measuring(cfg: Resolved, opts: BoosthisEdgeOptions): boolean {
  if (!cfg.projectKey) {
    safeVoid(() => sayOnce("no-key", NO_KEY_LINE, opts.notice));
    return false;
  }
  return safe(() => mayMeasure(), false);
}

/** Is what a request began recording into still the data this isolate holds?
 *  False once a stop threw that data away. */
function stillHeld(heldAt: number): boolean {
  return safe(() => heldGeneration() === heldAt, false);
}

/** Hand the host the after-response work when there is any: the uploads while
 *  measuring, the ask when it is due. A stopped isolate with no ask due hands
 *  it nothing at all. */
function afterResponse(cfg: Resolved, opts: BoosthisEdgeOptions, ctx: unknown): void {
  if (!cfg.projectKey) return;
  if (!safe(() => mayMeasure() || askDue(), false)) return;
  safeVoid(() => scheduleFlush(cfg, opts, ctx));
}

/** Say why this isolate stopped: once per stop, never once per ask, and only
 *  while it is true. */
function sayStopped(opts: BoosthisEdgeOptions): void {
  safeVoid(() => {
    const e = entitlement();
    if (e.state === "dissolved") {
      sayOnce(
        `stopped-${e.lockEpoch}`,
        `Boosthis has ended this project (${e.reason ?? "dissolved"}). Everything this instance held has been erased, and it measures and sends nothing more until it restarts.`,
        opts.notice,
      );
    } else if (e.state === "refused") {
      sayOnce(
        `stopped-${e.lockEpoch}`,
        `Boosthis has not confirmed this project (${e.reason ?? "no reason given"}). Measuring has stopped in this instance and what it held has been thrown away, unsent.`,
        opts.notice,
      );
    }
  });
}

/** Say what an ask that brought no word means. Only while there is no word
 *  yet: the readings are then held in memory, and nothing has left. */
function sayNoWordYet(reg: RegistrationState, opts: BoosthisEdgeOptions): void {
  safeVoid(() => {
    if (entitlement().state !== "unknown") return;
    if (reg === "unreachable") {
      sayOnce(
        "registration-unreachable",
        "could not reach Boosthis to confirm this project; readings are held in this instance's memory and nothing is sent until Boosthis answers.",
        opts.notice,
      );
    } else if (reg === "registered") {
      sayOnce(
        "registration-no-word",
        "Boosthis answered without saying whether this project may run; readings are held in this instance's memory and nothing is sent until it does.",
        opts.notice,
      );
    }
  });
}

/** What one upload's reply means. A 2xx teaches nothing: rows landing says
 *  nothing about whether this project may run. A refusal by name stops the
 *  isolate. A 404 means the server no longer has this install on file, so the
 *  next pass asks first. Anything else leaves the batch for the next pass. */
function readUploadReply(outcome: SendOutcome): "sent" | "stopped" | "gone" | "failed" {
  if (outcome.ok) return "sent";
  if (learnRefusal(outcome.status, outcome.body)) return "stopped";
  if (outcome.status === 404) {
    askNow();
    return "gone";
  }
  return "failed";
}

/** Everything we do after the customer's response has left. Bounded, capped,
 *  and never allowed to throw into the host's after-response hook.
 *
 *  THE ORDER IS THE LOCK RULE. Ask when an ask is due — the reply carries the
 *  answer — and send nothing else unless that answer is exactly `active`. */
async function flush(cfg: Resolved, opts: BoosthisEdgeOptions): Promise<void> {
  if (!cfg.projectKey) {
    sayOnce("no-key", NO_KEY_LINE, opts.notice);
    return;
  }
  if (isDissolved()) return;

  const installId = await resolveInstallId({
    projectKey: cfg.projectKey,
    slot: cfg.slot,
    pinned: opts.installId,
  });

  if (askDue()) {
    const reg = await ask({
      endpoint: cfg.endpoint,
      installId,
      projectKey: cfg.projectKey,
      appName: cfg.appName,
      platform: cfg.platform,
      fetchImpl: opts.fetchImpl,
      // WHAT THIS ISOLATE REACHED, and what it found and cannot watch. Sent
      // with the ask, after the first response, which is the earliest moment
      // the answer is worth anything: by now a request has been through the
      // boundary, and the wrapper has already seen whatever else the worker
      // exports. Never from a stopped isolate: it holds no readings.
      coverage: safe(() => mayMeasure(), false)
        ? safe(() => coverageInventory(), undefined)
        : undefined,
    });
    sayNoWordYet(reg, opts);
  }
  if (!mayUpload()) {
    sayStopped(opts);
    return;
  }

  let sends = 0;

  for (const crashBatch of dueCrashBatches()) {
    if (sends >= MAX_SENDS_PER_RESPONSE) break;
    sends += 1;
    const outcome = await send({
      url: `${cfg.endpoint}/crashes`,
      bearer: cfg.projectKey,
      payload: {
        installId,
        packageVersion: RUNTIME_VERSION,
        deliveryId: crashBatch.deliveryId,
        crashes: crashBatch.crashes,
      },
      fetchImpl: opts.fetchImpl,
    });
    const reply = readUploadReply(outcome);
    if (reply === "sent") {
      acknowledgeCrashes(crashBatch.crashes);
      continue;
    }
    if (reply === "stopped") {
      sayStopped(opts);
      return;
    }
    // The sealed batch stays where it is and goes again, under the same
    // delivery id, once its retry wait is over (and, after a 404, once the
    // server has this install back on file).
    retryCrashBatch(crashBatch);
    if (reply === "gone") return;
    if (!outcome.ok && (outcome.status === 429 || outcome.reason === "network" || outcome.reason === "timeout")) return;
  }

  // FINISHED BACKGROUND-JOB RUNS, after crashes, ahead of every other reading,
  // and OUTSIDE the per-response cap. They exist only on a handoff whose run was a job, one
  // upload carries them all, and the cap would otherwise spend a cron-only
  // worker's last send on them every time: its snapshot — the third of span,
  // sample and snapshot — would never leave again. A run that does not land
  // waits for this isolate's next handoff; see jobReporter.ts.
  const jobs = takeJobRuns();
  if (jobs.wire.length > 0) {
    const outcome = await send({
      url: `${cfg.endpoint}/job-runs`,
      bearer: cfg.projectKey,
      payload: {
        installId,
        packageVersion: RUNTIME_VERSION,
        runs: jobs.wire,
      },
      fetchImpl: opts.fetchImpl,
    });
    const reply = readUploadReply(outcome);
    if (reply === "stopped") {
      // The stop has thrown away everything held; these runs go with it.
      sayStopped(opts);
      return;
    }
    if (reply !== "sent") {
      if (reply === "failed" && batchRefused(outcome)) {
        // Refused for good: it would be refused again. Let go, and counted.
        discardJobRuns(jobs.held.length);
      } else {
        returnJobRuns(jobs.held);
        if (reply === "gone") return;
      }
    }
  }

  // Spans go before samples: see the note on MAX_SENDS_PER_RESPONSE. A lost
  // sample costs one row out of many; a lost span costs the whole edge hop of
  // a trace, and the edge hop is usually the one the request came in through.
  //
  // Linked steps ride in the room the batch has left, whole groups at a time,
  // and only once the request step they belong to has been taken: those still
  // waiting leave on the next pass.
  const spanBatch = sends < MAX_SENDS_PER_RESPONSE ? drainSpans(MAX_SPAN_BATCH) : [];
  const linkedBatch =
    sends < MAX_SENDS_PER_RESPONSE ? takeReadyLinked(MAX_SPAN_BATCH - spanBatch.length) : [];
  if (spanBatch.length + linkedBatch.length > 0 && sends < MAX_SENDS_PER_RESPONSE) {
    sends += 1;
    const outcome = await send({
      url: `${cfg.endpoint}/spans`,
      bearer: cfg.projectKey,
      payload: {
        installId,
        packageVersion: RUNTIME_VERSION,
        spans: [...spanBatch, ...linkedBatch],
      },
      fetchImpl: opts.fetchImpl,
    });
    const reply = readUploadReply(outcome);
    if (reply === "stopped") {
      // The stop has thrown away everything held; this batch goes with it.
      sayStopped(opts);
      return;
    }
    if (reply !== "sent") {
      if (reply === "failed" && batchRefused(outcome)) {
        // Refused for good (a bad payload, or our own privacy or size check):
        // a verdict, not a hiccup. These rows are not coming back, and
        // holding them would only cost the customer memory.
        discardSpans(spanBatch.length + linkedBatch.length);
      } else {
        returnSpans(spanBatch);
        returnLinked(linkedBatch);
        if (reply === "gone") return;
      }
    }
  }

  const batch = sends < MAX_SENDS_PER_RESPONSE ? drainSamples(MAX_SAMPLES_PER_BATCH) : [];
  if (batch.length > 0 && sends < MAX_SENDS_PER_RESPONSE) {
    sends += 1;
    const outcome = await send({
      url: `${cfg.endpoint}/samples`,
      bearer: cfg.projectKey,
      payload: {
        installId,
        packageVersion: RUNTIME_VERSION,
        samples: batch.map((s) => ({
          routeLabel: s.routeLabel,
          durationMs: s.durationMs,
          rating: s.rating,
        })),
      },
      fetchImpl: opts.fetchImpl,
    });
    const reply = readUploadReply(outcome);
    if (reply === "stopped") {
      sayStopped(opts);
      return;
    }
    if (reply !== "sent") {
      if (reply === "failed" && batchRefused(outcome)) {
        // Refused for good: a verdict, not a hiccup — the rows are not coming back.
        discardSamples(batch.length);
      } else {
        returnSamples(batch);
        if (reply === "gone") return;
      }
    }
  }

  const now = nowMs();
  const due = lastSnapshotAtMs === 0 || now - lastSnapshotAtMs >= SNAPSHOT_MIN_GAP_MS;
  if (due && mayUpload() && sends < MAX_SENDS_PER_RESPONSE) {
    sends += 1;
    lastSnapshotAtMs = now;
    const snapshot = buildSnapshot({
      collector: readState(),
      status,
      settledStatus,
      cookies,
      cors,
      coldStartMs,
      platform: cfg.platform,
      capturedAt: Date.now(),
      // Folded per request while the handler was still running (see
      // `outbound.ts`); read here, never gathered here.
      ai: getAiStats(),
      db: getDbStats(),
      dependencies: getDependencyStats(),
      // What this isolate observed about the PLATFORM, keeping the server's
      // record of what each one allows current. Empty until something has
      // actually been observed, and empty is omitted.
      hostFacts: edgeHostFacts(),
    });
    const outcome = await send({
      url: `${cfg.endpoint}/snapshots`,
      bearer: cfg.projectKey,
      payload: {
        installId,
        packageVersion: RUNTIME_VERSION,
        capturedAt: Date.now(),
        snapshot,
      },
      fetchImpl: opts.fetchImpl,
    });
    const reply = readUploadReply(outcome);
    if (reply === "stopped") sayStopped(opts);
    // Not on file any more: the picture goes again right after the next ask.
    else if (reply === "gone") lastSnapshotAtMs = 0;
  }
}

function scheduleFlush(cfg: Resolved, opts: BoosthisEdgeOptions, ctx: unknown): void {
  const after = resolveAfterResponse(ctx);
  // SAY WHAT THIS HOST WOULD NOT ALLOW. Everything the kit sends leaves on
  // this handoff. On a platform that offered no mechanism for it, the upload
  // may simply never run — and the failure is invisible from inside, because a
  // frozen isolate does not get to report that it was frozen. So the developer
  // is told once, here, at the moment we find out, rather than being left with
  // a dashboard that looks empty for a reason nobody wrote down.
  safeVoid(() => {
    const statement = afterResponseAssurance(cfg.platform, after.kind);
    if (statement.limitation !== null) {
      sayOnce("after-response-unproven", statement.limitation, opts.notice);
    }
  });
  const onePass = async (): Promise<void> => {
    // DRAIN, DO NOT DIP. One flush carries at most a batch, and the buffer
    // holds several batches, so a single upload can leave spans behind — and
    // this promise is what tells the host the work is finished. So keep going
    // while there is something left AND the last upload actually moved
    // something: a transport that is refusing hands its batch back, and
    // retrying it here would spin inside the host's keep-alive rather than
    // leaving the work for the next response to carry.
    for (let pass = 0; pass < MAX_DRAIN_PASSES; pass++) {
      const before = safe(() => pendingSpanCount(), 0);
      try {
        await flush(cfg, opts);
      } catch {
        /* a failed upload is never the host's problem */
        break;
      }
      const left = safe(() => pendingSpanCount(), 0);
      if (left === 0 || left >= before) break;
    }
    // Reaching here at all is the proof that this platform really does run
    // work handed to it after the reply. A platform that froze the isolate
    // the moment the response left never gets here, and says nothing. It is a
    // reading like any other: a stopped isolate notes nothing.
    if (safe(() => mayMeasure(), false)) {
      safeVoid(() => noteAfterResponseCompleted(after.kind));
    }
  };
  // JOIN THE QUEUE, NEVER THE PASS IN FLIGHT. A pass takes its batch off the
  // buffer at the moment it starts, so a span recorded by a LATER response is
  // not in it and cannot be carried by it. Handing that response the running
  // pass's promise would tell the host "this work is done" while the span is
  // still buffered — and the host is then free to freeze the isolate with it
  // inside. So an arrival during a pass chains a follow-up drain behind it and
  // waits for THAT. One follow-up is enough however many responses arrive: it
  // drains whatever is in the buffer when it runs, and an arrival during the
  // follow-up queues the next one.
  const run = (): Promise<void> => {
    const previous = flushTail;
    if (previous === null) {
      const pass: Promise<void> = onePass().finally(() => {
        if (flushTail === pass) flushTail = null;
      });
      flushTail = pass;
      return pass;
    }
    if (!flushFollowUpQueued) {
      flushFollowUpQueued = true;
      const pass: Promise<void> = previous
        .then(() => {
          flushFollowUpQueued = false;
          return onePass();
        })
        .finally(() => {
          if (flushTail === pass) flushTail = null;
        });
      flushTail = pass;
      return pass;
    }
    return previous;
  };
  safeVoid(() => after.run(run()));
}

/** Wrap one request handler. This is the whole attachment point: the host's own
 *  behaviour is untouched, its response object is returned unchanged, and an
 *  error inside Boosthis can never become the customer's 500. */
export function boosthisHandler<
  H extends (request: Request, ...rest: never[]) => Response | Promise<Response>,
>(handler: H, opts: BoosthisEdgeOptions = {}): H {
  const wrapped = async (
    request: Request,
    ...rest: unknown[]
  ): Promise<Response> => {
    const env = safe(
      () => (rest[0] && typeof rest[0] === "object" ? (rest[0] as Record<string, unknown>) : undefined),
      undefined as Record<string, unknown> | undefined,
    );
    const ctx = rest[1];
    const cfg = safe(
      () => resolveConfig(opts, env),
      {
        endpoint: DEFAULT_ENDPOINT,
        projectKey: null,
        keyTail: null,
        appName: undefined,
        slot: "default",
        platform: "unknown-isolate" as EdgePlatform,
      },
    );
    safeVoid(() =>
      announceStart({ platform: cfg.platform, keyTail: cfg.keyTail, notice: opts.notice }),
    );

    // THE LOCK RULE (docs/kit-lock-rule.md). With no key, or once Boosthis has
    // said anything but exactly `active`, the app runs as if this kit were not
    // here: no reading, no watch on its calls, its own errors untouched. Only
    // the ask goes on, after the response, when it is due.
    if (!measuring(cfg, opts)) {
      afterResponse(cfg, opts, ctx);
      return (handler as unknown as (
        r: Request,
        ...a: unknown[]
      ) => Response | Promise<Response>)(request, ...rest);
    }
    // What this request records when it ends belongs to the held data of NOW.
    // A stop while it runs throws that data away, and the request then records
    // nothing (the generation has moved).
    const heldAt = safe(() => heldGeneration(), -1);

    const startedAt = nowMs();
    const invocation = beginInvocation(startedAt);
    if (firstRequestAtMs === null) firstRequestAtMs = startedAt;

    // The app's own model endpoints, from the option AND the host's binding.
    // Before the watcher below, never after: a declaration that arrives once
    // the first model call has already gone out leaves that call filed as an
    // unrecognised outbound request rather than as AI.
    applyDeclaredEndpoints(opts, env);
    // Waits declared on purpose, for the same reason before the watcher: a
    // declared call made by the handler must meet its name. Once per options
    // object; the names are the union of every wrapped handler's.
    safeVoid(() => setDeclaredWaits(opts.declaredWaits, opts.notice));

    // Watch the one way out of this isolate before the app's code can use it.
    // Once per isolate; the kit's own uploads travel a different function and
    // never enter it (see `ownFetch.ts`).
    safeVoid(() => armOutbound());
    const scope = safe(() => openScope(startedAt), null as ReturnType<typeof openScope> | null);

    // WHOSE ACTION IS THIS? Read on the way in, at the one boundary that sees
    // the caller's headers. An edge worker is usually the FIRST hop, so if it
    // mints a new id here instead of adopting the one it was handed, the chain
    // is cut at the point the request entered the system and every service
    // below it is filed under a trace nobody else knows about.
    //
    // Held in LOCALS, never in module state: one isolate serves many requests
    // concurrently on a single thread, and a request's identity parked in a
    // module variable would be read by whichever other request happened to be
    // interleaved with it.
    const inbound = safe(() => beginRequestTrace(request), {
      traceId: newTraceId(),
      parentSpanId: null,
      startOffsetMs: 0,
      adopted: false,
    });
    const span = safe(
      () =>
        beginSpan({
          parentSpanId: inbound.parentSpanId,
          traceId: inbound.traceId,
        }),
      null as ReturnType<typeof beginSpan> | null,
    );

    // This request's linked steps, closed at the same boundary its outbound
    // work is folded: a call still in flight then is not linked to it.
    let linkedFolds: LinkedFold[] = [];
    let response: Response;
    try {
      response = await (handler as unknown as (
        r: Request,
        ...a: unknown[]
      ) => Response | Promise<Response>)(request, ...rest);
    } catch (err) {
      // Stopped while the handler ran: what it held is gone, and this request
      // adds nothing to it. The host's error goes back untouched.
      if (!stillHeld(heldAt)) {
        afterResponse(cfg, opts, ctx);
        throw err;
      }
      // The handler is over, so its outbound work is over too: fold it in here
      // rather than leaving it for something that will never run.
      safeVoid(() => {
        linkedFolds = closeLinkedSteps(scope);
        if (scope) foldScope(scope, nowMs(), 500);
      });
      // Capture before scheduling after-response work: once the host receives
      // the rejection this isolate may freeze. The reporter is guarded and can
      // never replace the host's original error.
      //
      // The action is handed in rather than read from an ambient scope. We are
      // on the throwing stack and hold this request's own identity in a local,
      // which is the only way to be sure of it here: an isolate interleaves
      // requests, so "whichever action was most recent" would attach the crash
      // to a different visitor's request as confidently as to the right one.
      safeVoid(() =>
        reportUnhandledError(err, opts.crashDetails === true, {
          traceId: inbound.traceId,
          spanId: span?.spanId ?? null,
          routeLabel: labelFor(request),
        }),
      );
      // Record it as a 500 so reliability tells the truth, then rethrow
      // untouched.
      safeVoid(() => {
        const durationMs = nowMs() - startedAt;
        const label = labelFor(request);
        // A declared route that failed is still a failure — counted as one,
        // with its crash — but its duration is the wait it was declared for.
        const declared = isDeclaredRoute(request, label, durationMs);
        endInvocation(invocation, nowMs(), durationMs, true, 500, label, declared);
        noteStatus(500);
        if (label !== null && declared) {
          noteDeclaredRequest(Date.now());
        } else if (label !== null) {
          noteRequest({
            label,
            durationMs,
            status: 500,
            atMs: Date.now(),
          });
        }
        // A hop that failed is still a hop. Leaving it out would draw the
        // trace as if the request had never reached this worker, which is the
        // opposite of what happened.
        if (span && label !== null) {
          enqueueSpan(
            {
              traceId: inbound.traceId,
              layer: "edge",
              routeLabel: label,
              durationMs,
              startOffsetMs: inbound.startOffsetMs,
              rating: rateSpanDuration(durationMs),
              spanId: span.spanId,
              parentSpanId: span.parentSpanId,
              kind: "handler",
              outcome: outcomeForStatus(null, true),
              ...(declared ? { wait: "declared" as const } : {}),
            },
            linkedSpans(linkedFolds, inbound.traceId, span.spanId, inbound.startOffsetMs),
          );
        }
      });
      afterResponse(cfg, opts, ctx);
      throw err;
    }

    if (!stillHeld(heldAt)) {
      afterResponse(cfg, opts, ctx);
      return response;
    }

    // THE FREEZE BOUNDARY. The handler has produced its Response, so every
    // outbound call it is going to make has been made: fold the request's AI
    // and database work in now, synchronously, before the platform is entitled
    // to suspend this isolate. Nothing here is deferred and nothing is left
    // for a timer, because in an isolate neither would ever run.
    safeVoid(() => {
      linkedFolds = closeLinkedSteps(scope);
      if (scope) foldScope(scope, nowMs(), safe(() => response.status, 200));
    });
    safeVoid(() => {
      const durationMs = nowMs() - startedAt;
      const code = safe(() => response.status, 200);
      const label = labelFor(request);
      // A route the developer declared as waiting on purpose (a long-poll that
      // answers when there is news) keeps its duration out of every speed
      // reading, counted instead; its status, errors and in-flight bracket
      // still count (declaredWaits.ts).
      const declared = isDeclaredRoute(request, label, durationMs);
      endInvocation(invocation, nowMs(), durationMs, false, code, label, declared);
      noteStatus(code);
      noteCookies(response);
      noteCors(request, response);
      if (label !== null && declared) {
        noteDeclaredRequest(Date.now());
      } else if (label !== null) {
        noteRequest({
          label,
          durationMs,
          status: code,
          atMs: Date.now(),
        });
      }
      // THE WORKER'S OWN SPAN, recorded here and not a moment later. This is
      // part of the request that produced it — no timer, no queue, no "we will
      // do it on the next invocation", because in an isolate none of those are
      // guaranteed to exist. By the time anything after this line runs, the
      // platform is entitled to have thrown the isolate away.
      if (span && label !== null) {
        enqueueSpan(
          {
            traceId: inbound.traceId,
            layer: "edge",
            routeLabel: label,
            durationMs,
            startOffsetMs: inbound.startOffsetMs,
            rating: rateSpanDuration(durationMs),
            spanId: span.spanId,
            parentSpanId: span.parentSpanId,
            kind: "handler",
            outcome: outcomeForStatus(code),
            ...(declared ? { wait: "declared" as const } : {}),
          },
          linkedSpans(linkedFolds, inbound.traceId, span.spanId, inbound.startOffsetMs),
        );
      }
      if (
        coldStartMs === null &&
        !coldStartForgone &&
        firstRequestAtMs !== null &&
        firstRequestAtMs - bootAtMs <= COLD_START_ATTRIBUTION_MS
      ) {
        if (declared) coldStartForgone = true;
        else coldStartMs = nowMs() - bootAtMs;
      }
    });
    afterResponse(cfg, opts, ctx);
    return response;
  };
  return wrapped as unknown as H;
}

/** Wrap a Cloudflare module worker. Returns the same object with an
 *  instrumented `fetch`; every other export (queue, scheduled, Durable Objects)
 *  is passed through untouched. */
export function withBoosthis<T extends WorkerEntry>(
  worker: T,
  opts: BoosthisEdgeOptions = {},
): T {
  const original = worker.fetch.bind(worker);
  // This is the ONE moment the kit is shown the whole worker. Note which other
  // entry points it declares now, while we can see them — the dashboard has no
  // other way to learn that the queue consumer doing most of this app's real
  // work is going unwatched.
  safeVoid(() => noteWorkerEntryPoints(worker));
  const instrumented = boosthisHandler(
    original as unknown as (request: Request) => Promise<Response>,
    opts,
  );
  return new Proxy(worker, {
    get(target, prop, receiver) {
      if (prop === "fetch") return instrumented;
      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * The background job a run of a marked entry point is filed under.
 *
 * The `job` option when the developer gave one, whatever the kind. Otherwise,
 * for a scheduled run only, the cron pattern the platform handed the handler
 * (`controller.cron` on Cloudflare) — and `""` when there is none (Deno Deploy
 * hands a cron handler nothing), which the reporter refuses and SAYS, so a cron
 * left unnamed is never silently missing from the list of jobs. `undefined`
 * for any other run: a queue consumer nobody named is measured as before and
 * filed as no job.
 */
function jobNameForRun(
  kind: EntryPointKind,
  opts: BoosthisEntryPointOptions,
  args: readonly unknown[],
): string | undefined {
  if (opts.job !== undefined) return typeof opts.job === "string" ? opts.job : "";
  if (kind !== "scheduled") return undefined;
  const cron = safe(() => {
    const controller = args[0];
    if (!controller || typeof controller !== "object") return undefined;
    const value = (controller as { cron?: unknown }).cron;
    return typeof value === "string" ? value : undefined;
  }, undefined as string | undefined);
  return cron ?? "";
}

/**
 * Mark one entry point that is not a web request — a queue consumer, a cron
 * handler, an email or tail handler, a Durable Object method — so its runs are
 * measured the way requests are.
 *
 * `withBoosthis` instruments the `fetch` export and nothing else, which leaves
 * a worker's real work invisible whenever it arrives on a queue or a schedule
 * instead of a socket. The coverage answer reports that gap, and this is the
 * way out it names: without a call to point at, that report would be a problem
 * with no fix attached, which is the one thing it must never be.
 *
 *     export default withBoosthis({
 *       fetch: myFetch,
 *       queue: boosthisEntryPoint("queue", async (batch, env, ctx) => { ... }),
 *     });
 *
 * The run is timed, its failures are counted, and the calls it makes out are
 * folded into it — the same measurement `boosthisHandler` takes. `kind` comes
 * from a closed list, so the label on the request meters is ours. A handler
 * carrying this mark stops being reported as a gap.
 *
 * A BACKGROUND JOB, BY NAME. A scheduled run is also filed as a run of a
 * background job — its name, how long ago it finished, how long it took and
 * whether it worked, and nothing else — so it appears in the project's list of
 * jobs. The name is the `job` option when given, otherwise the cron pattern
 * that fired the run (`controller.cron` on Cloudflare). Any other kind is filed
 * as a job only when it is named in the option. That name is the one string
 * the developer chose that travels, and it is screened the way every kit
 * screens a job's name; the handler's own function name never is:
 *
 *     export default withBoosthis({
 *       fetch: myFetch,
 *       scheduled: boosthisEntryPoint("scheduled", rebuildIndex),
 *     });
 *     Deno.cron("nightly-rebuild", "0 3 * * *",
 *       boosthisEntryPoint("scheduled", rebuildIndex, { job: "nightly-rebuild" }));
 *
 * Arguments are passed straight through and the return value comes back
 * untouched, so this is safe to wrap around a handler of any shape. As
 * everywhere in this kit, a fault inside Boosthis can never become the host's.
 */
export function boosthisEntryPoint<H extends (...args: never[]) => unknown>(
  kind: EntryPointKind,
  handler: H,
  opts: BoosthisEntryPointOptions = {},
): H {
  const wrapped = async (...args: unknown[]): Promise<unknown> => {
    // A module worker hands its handlers (payload, env, ctx), the same shape
    // `fetch` gets. Read them defensively: a handler called any other way must
    // still run.
    const env = safe(
      () =>
        args[1] && typeof args[1] === "object"
          ? (args[1] as Record<string, unknown>)
          : undefined,
      undefined as Record<string, unknown> | undefined,
    );
    const ctx = args[2];
    const cfg = safe(
      () => resolveConfig(opts, env),
      {
        endpoint: DEFAULT_ENDPOINT,
        projectKey: null,
        keyTail: null,
        appName: undefined,
        slot: "default",
        platform: "unknown-isolate" as EdgePlatform,
      },
    );
    safeVoid(() =>
      announceStart({
        platform: cfg.platform,
        keyTail: cfg.keyTail,
        notice: opts.notice,
      }),
    );

    // THE LOCK RULE, as on the request path: stopped, the run is the host's
    // alone, untouched and unwatched.
    if (!measuring(cfg, opts)) {
      afterResponse(cfg, opts, ctx);
      return (handler as unknown as (...a: unknown[]) => unknown)(...args);
    }
    const heldAt = safe(() => heldGeneration(), -1);

    const startedAt = nowMs();
    // Same as the request handler: the app's declared model endpoints, from
    // the option and from the host's binding, applied before the watcher is
    // armed. This path used to apply NEITHER, so a queue or cron entry point
    // on an isolate host reported a self-hosted model as an unrecognised
    // outbound call while the fetch handler beside it reported it correctly.
    applyDeclaredEndpoints(opts, env);
    safeVoid(() => armOutbound());
    const scope = safe(
      () => openScope(startedAt),
      null as ReturnType<typeof openScope> | null,
    );
    // `job:` is the same prefix the Node kit puts on work it measures by hand,
    // so a queue run reads as a queue run on the dashboard whichever runtime it
    // came from. Both halves are code-defined; neither is anything the customer
    // wrote. Cold-start attribution is deliberately left alone — that belongs
    // to the isolate's first REQUEST, and a queue run is not one.
    const label = `job:${kind}`;

    // A queue or cron run is its OWN action: nothing handed it a trace header,
    // so there is nothing to adopt and it is honestly a root. That is the one
    // difference from the request path — the id is minted rather than read,
    // and the span has no parent because there genuinely is no caller we can
    // see. A guessed parent would draw a chain that does not exist.
    const traceId = safe(() => newTraceId(), "");
    const span = safe(
      () => beginSpan({ parentSpanId: null, traceId }),
      null as ReturnType<typeof beginSpan> | null,
    );

    // A run is over when the handler is, whether it returned or threw: fold its
    // outbound work in at that moment, before the platform may suspend us.
    const close = (status: number): void => {
      // Stopped while it ran: it records nothing into data already gone.
      if (!stillHeld(heldAt)) {
        afterResponse(cfg, opts, ctx);
        return;
      }
      // The calls this run made, closed with its outbound work: they hang
      // from the run's own `job:<kind>` step, as a request's do.
      let linkedFolds: LinkedFold[] = [];
      safeVoid(() => {
        linkedFolds = closeLinkedSteps(scope);
        if (scope) foldScope(scope, nowMs());
      });
      const durationMs = safe(() => nowMs() - startedAt, 0);
      // Filed as a background job, under the name this run answers to — read
      // from the option or the platform's own controller, never from the
      // handler. `undefined` means this run is not one a job can be filed for.
      safeVoid(() => {
        const job = jobNameForRun(kind, opts, args);
        if (job === undefined) return;
        fileJobRun({ job, durationMs, ok: status < 400, notice: opts.notice });
      });
      safeVoid(() => {
        noteEntryPointRun();
        noteRequest({
          label,
          durationMs,
          status,
          atMs: Date.now(),
        });
        if (span && traceId) {
          enqueueSpan(
            {
              traceId,
              layer: "edge",
              routeLabel: label,
              durationMs,
              startOffsetMs: 0,
              rating: rateSpanDuration(durationMs),
              spanId: span.spanId,
              parentSpanId: null,
              // `job` rather than `handler`: this run did not answer a request,
              // and a reading that cannot tell the two apart would report a
              // nightly rebuild as a visitor waiting.
              kind: "job",
              outcome: outcomeForStatus(status),
            },
            linkedSpans(linkedFolds, traceId, span.spanId, 0),
          );
        }
      });
      afterResponse(cfg, opts, ctx);
    };

    let result: unknown;
    try {
      result = await (handler as unknown as (...a: unknown[]) => unknown)(
        ...args,
      );
    } catch (err) {
      // The host's failure is the host's to report. Record it as a failed run
      // so reliability tells the truth, then rethrow untouched.
      close(500);
      throw err;
    }
    close(200);
    return result;
  };
  // Stamp it, so `noteWorkerEntryPoints` does not go on reporting this entry
  // point as a gap once the developer has closed it.
  safeVoid(() => markEntryPointMeasured(wrapped));
  return wrapped as unknown as H;
}
/** What this isolate currently knows about itself. Read by the tests and by
 *  anyone debugging an install; carries no key and no customer data. */
export function boosthisStatus(): {
  runtimeVersion: string;
  platform: EdgePlatform;
  registration: ReturnType<typeof registrationState>;
  entitlement: ReturnType<typeof entitlement>;
  requests: number;
  pendingSamples: number;
  pendingCrashes: number;
  pendingSpans: number;
  /** Finished background-job runs waiting for an upload. */
  pendingJobRuns: number;
  coldStartMs: number | null;
} {
  return {
    runtimeVersion: RUNTIME_VERSION,
    platform: detectPlatform(),
    registration: registrationState(),
    entitlement: entitlement(),
    requests: readState().requests,
    pendingSamples: pendingCount(),
    pendingCrashes: pendingCrashCount(),
    pendingSpans: pendingSpanCount(),
    pendingJobRuns: pendingJobRunCount(),
    coldStartMs,
  };
}

/** Test seam: the response counts the next snapshot reads, as copies. */
export function _snapshotCountsForTests(): {
  status: StatusCounts;
  settledStatus: SettledStatusCounts;
  cookies: CookieCounts;
  cors: CorsCounts;
} {
  return {
    status: { ...status },
    settledStatus: { ...settledStatus },
    cookies: { ...cookies },
    cors: { ...cors },
  };
}

/** Test seam: reset the per-isolate state a real isolate gets for free. */
export function _resetIsolateStateForTests(): void {
  _resetCrashesForTests();
  _resetOutboundForTests();
  _resetDeclaredAiEndpointsForTests();
  // The accumulator and its skip-compares are a CACHE of what we already
  // pushed into that registry. Clearing the registry without clearing them
  // leaves the cache claiming the endpoints are still declared, so the next
  // request skips the re-apply and the isolate measures with an empty table.
  declaredUnion = null;
  lastEnvRaw = null;
  lastOptsRef = undefined;
  lastResolveSeen = false;
  _resetCoverageForTests();
  _resetHostFactsForTests();
  _resetSpansForTests();
  _resetJobRunsForTests();
  _resetRequestMetersForTests();
  // A fresh isolate starts its settle periods again (settleRule.ts).
  __resetIsolateClockForTests();
  _spanScopeInternals.reset();
  firstRequestAtMs = null;
  coldStartMs = null;
  coldStartForgone = false;
  _resetDeclaredWaitsForTests();
  lastSnapshotAtMs = 0;
  flushTail = null;
  flushFollowUpQueued = false;
  clearResponseCounts();
}
