/** The one way out of an isolate, watched.
 *
 * An isolate has no driver to wrap, no process to sample and no thread to
 * follow. It has `fetch`. Everything the app reaches — a model provider, a
 * hosted database, an ordinary API — leaves through that single function, so
 * watching it is the only honest route to an AI reading or a database reading
 * here, and one watch gives us both.
 *
 * FOUR RULES THIS FILE IS BUILT AROUND.
 *
 * 1. NOTHING SURVIVES THE RESPONSE. The platform may freeze the isolate the
 *    moment a response completes, so there is no timer, no scheduled backstop
 *    and no work after the handler returns. Every number is folded in at the
 *    moment the handler gives its Response back (see {@link foldScope}), and a
 *    call still in flight at that point is simply not a measurement.
 *
 * 2. OUR OWN UPLOADS ARE NOT THE APP'S TRAFFIC. The kit sends through the
 *    fetch it captured at import time (`ownFetch.ts`), which is a different
 *    function object from the wrapper installed here — so a kit upload never
 *    enters this code at all. There is no URL to recognise and no name to
 *    check, which is why moving or renaming an endpoint cannot leak our
 *    traffic into the customer's reading.
 *
 * 3. ONLY WHAT THE APP ACTUALLY REACHED IS COUNTED. A call is classified once,
 *    against the maintained provider, hosted-database and dependency-kind
 *    lists, and lands in exactly one reading.
 *
 * 4. NUMBERS ONLY. No URL, no header value, no prompt, no answer and no query
 *    text is stored or uploaded. Prompts are reduced to a 32-bit hash inside
 *    the isolate for the "same prompt twice in one request" reading and the
 *    text is dropped on the same line; a streamed answer's content deltas are
 *    never even decoded into an object.
 */

import { callFailure, countFailure, countService, emptyFailures, topServices, emptyDbFailures, countDbFailure, type DbFailureCounts, type FailureCounts, type ServiceCounts } from "./callFailures";
import {
  aiProviderCodeOrDeclared,
  DECLARED_PROVIDER_CODE,
  isAiShapedPath,
  isHostedDatabaseCall,
} from "./aiProviders";
import {
  estimateCostMicros,
  readAiHeaders,
  readAiOutcome,
  readAiUsage,
  streamLineIsInteresting,
  streamLineIsTerminal,
  type AiUsageRead,
} from "./aiUsage";
import {
  declaredCallCounts,
  matchDeclaredFetch,
  noteDeclaredCallExcluded,
  type DeclaredCallMatch,
} from "./declaredWaits";
import { inKitSend } from "./ownFetch";
import {
  closeLinkedScope,
  noteLinkedCall,
  openLinkedScope,
  type LinkedFold,
  type LinkedScope,
} from "./linkedSteps";
import { nowMs } from "./platform";
import { SETTLE_FAMILIES, isSettledAt } from "./settleRule";
import { safe, safeVoid } from "./safe";
import {
  DEPENDENCY_KINDS,
  dependencyKindFor,
  dependencyFor,
  type DependencyKind,
} from "./dependencyKinds";

/* ── Ceilings. An isolate's memory is the customer's memory. ─────────────── */

/** Quiet gap inside a streamed answer that counts as a stall. Detected when
 *  the NEXT chunk arrives or the stream ends — never by a timer, which an
 *  isolate cannot keep. */
export const AI_STREAM_STALL_MS = 10_000;
/** Longest slice of a request body hashed for prompt identity. */
const MAX_PROMPT_CHARS = 4096;
/** Distinct prompt identities tracked inside ONE request. */
const MAX_DISTINCT_PROMPTS = 128;
/** Distinct statement identities tracked inside ONE request. */
const MAX_DISTINCT_STATEMENTS = 128;
/** Durations kept for a percentile. Older ones roll off. */
const DURATION_RING = 256;
/** Undecoded tail carried between stream chunks before it is dropped. */
const MAX_STREAM_CARRY = 8192;
/** Text length past which a `text()` reply is not parsed for usage at all. */
const MAX_TEXT_PARSE_CHARS = 256_000;
/** Calls tracked inside ONE request. */
const MAX_CALLS_PER_SCOPE = 200;
/** Most database intervals retained in one request. */
export const DB_WAVE_MAX_CALLS = 256;
/** Requests that may be open at once before the watch stops attributing. */
const MAX_OPEN_SCOPES = 64;

/** Contract bound: six kinds times 128 durations. */
const DEPENDENCY_KIND_RING = 128;
interface CallRecord {
  /** 1-based provider position, or 0 for a hosted-database call. */
  provider: number;
  stream: boolean;
  usageReported: boolean;
  /** Already counted as "usage never reported". Reversible: a body read after
   *  settlement corrects the counter rather than leaving a false finding. */
  settledMissing: boolean;
  settled: boolean;
  cacheVerdict: CacheVerdict | null;
  repeatIdentity: number;
}

/* ── One request's outbound work ─────────────────────────────────────────── */

interface StatementTally {
  n: number;
  ms: number;
}

export interface RequestScope {
  startedAtMs: number;
  /** When the request started on the epoch clock (the start-up rule's clock;
   *  `startedAtMs` is the platform's monotonic one). */
  startedEpochMs: number;
  closed: boolean;
  aiCalls: number;
  aiMs: number;
  aiCostMicros: number;
  prompts: Map<number, number>;
  dbCalls: number;
  dbMs: number;
  dbSpans: number[];
  dbSpansOver: boolean;
  statements: Map<number, StatementTally>;
  tracked: number;
  depCalls: number;
  depMs: number;
  depKinds: Set<DependencyKind>;
  repeated: Map<number, StatementTally>;
  dataCalls: number;
  dataFailed: number;
  /** This request's linked steps (`linkedSteps.ts`): its database and
   *  outside-service calls, folded by word, for the map's lines. */
  linked: LinkedScope;
}

interface DependencyKindTotals extends FailureCounts {
  services: Map<string, ServiceCounts>;
  calls: number;
  ok: number;
  failed: number;
  timedOut: number;
  requests: number;
  durations: number[];
  worstMs: number;
}
interface Session {
  dbFailures: DbFailureCounts;
  aiWatchedRequests: number;
  aiWatchedRequestMs: number;
  aiMs: number;
  callCount: number;
  providers: Set<number>;
  providerCounts: Map<number, number>;
  durations: number[];
  worstMs: number;
  streamCount: number;
  ttfts: number[];
  /** Start-up rule (latencyTail): first-words waits of streams that started
   *  after the settle period, never a provider's first (TLS and model warm-up). */
  settledTtfts: number[];
  ttftProviders: Set<number>;
  stallCount: number;
  failCount: number;
  rateLimitedCount: number;
  quotaCount: number;
  timeoutCount: number;
  truncatedCount: number;
  filteredCount: number;
  serverMs: number[];
  tokensIn: number;
  tokensOut: number;
  cachedIn: number;
  costMicros: number;
  reportedCostCalls: number;
  pricedCalls: number;
  unpricedCalls: number;
  declaredCalls: number;
  declaredUnpricedCalls: number;
  /** Calls whose PATH was an inference shape while their host matched neither
   *  the maintained provider list nor anything this worker declared. A count
   *  and nothing else: the destination is read inside the isolate, compared,
   *  and dropped. */
  unclassifiedAiShaped: number;
  worstRequestCostMicros: number;
  firstCallAtMs: number | null;
  lastCallAtMs: number | null;
  usageMissingCalls: number;
  streamUsageMissingCalls: number;
  promptRepeatWorst: number;
  promptRepeatRequests: number;
  headroomReads: number;
  worstRequestsPct: number | null;
  worstTokensPct: number | null;
  /** Start-up rule (startupEvent): headroom reads taken after settling, with
   *  their epoch instants, so a verdict rests on the typical recent reading
   *  and never on a boot-window low that has since recovered. */
  headroomSettled: Array<{ at: number; req: number | null; tok: number | null }>;
  worstRetryAfterMs: number;
  dbWatchedRequests: number;
  dbWatchedRequestMs: number;
  dbMs: number;
  dbCallCount: number;
  dbRepeatWorst: number;
  dbRepeatRequests: number;
  dbRepeatMs: number;
  dbWaveRequests: number;
  dbWavesTotal: number;
  dbWavesWorst: number;
  dbWaveSpanMs: number;
  dbWaveSumMs: number;
  depWatchedRequests: number;
  depWatchedRequestMs: number;
  depMs: number;
  depDbMs: number;
  depAiMs: number;
  depCallCount: number;
  depKinds: Map<DependencyKind, DependencyKindTotals>;
  repeatedWatchedRequests: number;
  /** Requests whose repeat identity was set aside as start-up. */
  repeatedSettlingRequests: number;
  /** Cache verdicts given while settling (every first request misses). */
  cacheSettling: number;
  /** db / dependency requests set aside as start-up (latencyTail). */
  dbSettlingRequests: number;
  depSettlingRequests: number;
  dbSeenRequests: number;
  depSeenRequests: number;
  repeatedRequests: number;
  repeatedWorst: number;
  repeatedMs: number;
  repeatedRequestMs: number;
  containmentWatched: number;
  containmentContained: number;
  containmentCollapsed: number;
  containmentAllFailed: number;
  containmentUnattributed: number;
  cacheHits: number;
  cacheMisses: number;
  cacheStale: number;
  cacheBypass: number;
}

function emptySession(): Session {
  return {
    aiWatchedRequests: 0,
    aiWatchedRequestMs: 0,
    aiMs: 0,
    callCount: 0,
    providers: new Set<number>(),
    providerCounts: new Map<number, number>(),
    durations: [],
    worstMs: 0,
    streamCount: 0,
    ttfts: [],
    settledTtfts: [],
    ttftProviders: new Set<number>(),
    stallCount: 0,
    failCount: 0,
    rateLimitedCount: 0,
    quotaCount: 0,
    timeoutCount: 0,
    truncatedCount: 0,
    filteredCount: 0,
    serverMs: [],
    tokensIn: 0,
    tokensOut: 0,
    cachedIn: 0,
    costMicros: 0,
    reportedCostCalls: 0,
    pricedCalls: 0,
    unpricedCalls: 0,
    declaredCalls: 0,
    declaredUnpricedCalls: 0,
    unclassifiedAiShaped: 0,
    worstRequestCostMicros: 0,
    firstCallAtMs: null,
    lastCallAtMs: null,
    usageMissingCalls: 0,
    streamUsageMissingCalls: 0,
    promptRepeatWorst: 0,
    promptRepeatRequests: 0,
    headroomReads: 0,
    worstRequestsPct: null,
    worstTokensPct: null,
    headroomSettled: [],
    worstRetryAfterMs: 0,
    dbWatchedRequests: 0,
    dbWatchedRequestMs: 0,
    dbMs: 0,
    dbCallCount: 0,
    dbFailures: emptyDbFailures(),
    dbRepeatWorst: 0,
    dbRepeatRequests: 0,
    dbRepeatMs: 0,
    dbWaveRequests: 0,
    dbWavesTotal: 0,
    dbWavesWorst: 0,
    dbWaveSpanMs: 0,
    dbWaveSumMs: 0,
    depWatchedRequests: 0,
    depWatchedRequestMs: 0,
    depMs: 0,
    depDbMs: 0,
    depAiMs: 0,
    depCallCount: 0,
    depKinds: new Map(),
    repeatedWatchedRequests: 0,
    repeatedSettlingRequests: 0,
    cacheSettling: 0,
    dbSettlingRequests: 0,
    depSettlingRequests: 0,
    dbSeenRequests: 0,
    depSeenRequests: 0,
    repeatedRequests: 0,
    repeatedWorst: 0,
    repeatedMs: 0,
    repeatedRequestMs: 0,
    containmentWatched: 0,
    containmentContained: 0,
    containmentCollapsed: 0,
    containmentAllFailed: 0,
    containmentUnattributed: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheStale: 0,
    cacheBypass: 0,
  };
}

/** Module state IS per-isolate: this is one isolate's own view, and it dies
 *  with the isolate exactly like the request collector does. */
let session: Session = emptySession();
const openScopes = new Set<RequestScope>();
/** Calls whose reply has arrived but whose body the app may still read. Held
 *  only until the next fold, which is always before a response completes. */
let pending: CallRecord[] = [];
let armed = false;
/** What was on `globalThis.fetch` when the watch was armed, so a stop under
 *  the lock rule (and the test seam) can put the isolate back exactly as it
 *  found it. */
let preArmFetch: FetchFn | null = null;
/** Our watch, while it is still somewhere in the isolate's fetch chain. */
let ourWrapper: FetchFn | null = null;
/** Set while stopped when our watch could not be taken out (something wrapped
 *  `fetch` over it): it then passes every call straight through. */
let standingDown = false;
/** A stop happened since the last arm: the next arm starts the readings
 *  again from nothing. */
let wipeOnArm = false;

/* ── Small helpers ───────────────────────────────────────────────────────── */

function ring(values: number[], v: number): void {
  values.push(v);
  if (values.length > DURATION_RING) values.shift();
}

function dependencyTotals(kind: DependencyKind): DependencyKindTotals {
  let totals = session.depKinds.get(kind);
  if (!totals) {
    totals = {
      ...emptyFailures(),
      services: new Map(),
      calls: 0,
      ok: 0,
      failed: 0,
      timedOut: 0,
      requests: 0,
      durations: [],
      worstMs: 0,
    };
    session.depKinds.set(kind, totals);
  }
  return totals;
}
function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return Math.round(sorted[idx]!);
}

/** 32-bit FNV-1a. The prompt text reaches this function and nothing else, and
 *  what comes back is a number. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/* ── Classification ──────────────────────────────────────────────────────── */

export interface OutboundTarget {
  host: string;
  path: string;
  method: string;
}

/** Pull the bare hostname, path and method out of a fetch call. Never throws;
 *  returns null for anything it cannot read, which is then left alone. */
export function targetOf(
  input: unknown,
  init?: { method?: string } | undefined,
): OutboundTarget | null {
  return safe(() => {
    let href = "";
    if (typeof input === "string") href = input;
    else if (input instanceof URL) href = input.href;
    else {
      const asRequest = input as { url?: unknown; method?: unknown };
      if (typeof asRequest?.url === "string") href = asRequest.url;
    }
    if (!href) return null;
    const u = new URL(href);
    const method =
      typeof init?.method === "string" && init.method
        ? init.method.toUpperCase()
        : typeof (input as { method?: unknown })?.method === "string"
          ? String((input as { method?: unknown }).method).toUpperCase()
          : "GET";
    return { host: u.hostname.toLowerCase(), path: u.pathname, method };
  }, null as OutboundTarget | null);
}

/** Which reading, if any, this destination belongs to. One call, one answer:
 *  AI, database and ordinary outside-service work never overlap. `none` is
 *  reserved for an input whose destination could not be read. */
export type OutboundKind = "ai" | "db" | "dependency" | "none";

export function classify(target: OutboundTarget | null): {
  kind: OutboundKind;
  provider: number;
} {
  if (!target) return { kind: "none", provider: 0 };
  const provider = aiProviderCodeOrDeclared(target.host);
  if (provider > 0) return { kind: "ai", provider };
  if (isHostedDatabaseCall(target.host, target.path)) {
    return { kind: "db", provider: 0 };
  }
  return { kind: "dependency", provider: 0 };
}

/* ── Attribution ─────────────────────────────────────────────────────────── */

/**
 * Which request issued this call?
 *
 * An isolate has no async-local storage to carry a scope through the host's
 * own promises, so the honest answer is the one the open-request set can
 * prove: with exactly one request in flight the call belongs to it, and with
 * two or more it cannot be attributed to either. An unattributed call still
 * counts towards what the app spent and how the provider answered — it is
 * only kept out of the per-request SHARES, which is the one place a wrong
 * guess would show up as a wrong number.
 */
function attributableScope(): RequestScope | null {
  if (openScopes.size !== 1) return null;
  for (const scope of openScopes) {
    if (!scope.closed && scope.tracked < MAX_CALLS_PER_SCOPE) return scope;
  }
  return null;
}

/** Open a request scope. Called by the handler before the app's code runs. */
export function openScope(startedAtMs: number): RequestScope {
  const scope: RequestScope = {
    startedAtMs,
    startedEpochMs: Date.now(),
    closed: false,
    aiCalls: 0,
    aiMs: 0,
    aiCostMicros: 0,
    prompts: new Map<number, number>(),
    dbCalls: 0,
    dbMs: 0,
    dbSpans: [],
    dbSpansOver: false,
    statements: new Map<number, StatementTally>(),
    tracked: 0,
    depCalls: 0,
    depMs: 0,
    depKinds: new Set(),
    repeated: new Map(),
    dataCalls: 0,
    dataFailed: 0,
    linked: openLinkedScope(startedAtMs),
  };
  // A runaway isolate must never grow this set without bound. Past the cap
  // the scope simply is not registered: nothing is attributed rather than
  // being attributed to the wrong request.
  if (openScopes.size < MAX_OPEN_SCOPES) openScopes.add(scope);
  else scope.closed = true;
  return scope;
}

/**
 * Close one request's linked steps and fold them: one per word, seven at
 * most. Called at the same freeze boundary as `foldScope`, so a call still in
 * flight is not linked to the request. Never throws.
 */
export function closeLinkedSteps(scope: RequestScope | null | undefined): LinkedFold[] {
  return safe(() => (scope ? closeLinkedScope(scope.linked) : []), [] as LinkedFold[]);
}

/**
 * Fold one request's outbound work into the isolate's totals.
 *
 * This is the freeze boundary. It runs synchronously the moment the handler
 * hands its Response back, before anything can be suspended, and it is the
 * only place a per-request share is ever computed.
 */
export function foldScope(scope: RequestScope, endedAtMs: number, responseStatus = 200): void {
  try {
    openScopes.delete(scope);
    if (scope.closed) return;
    scope.closed = true;
    settlePending();
    const wallMs = Math.max(0, Math.round(endedAtMs - scope.startedAtMs));
    let repeatWorst = 0;
    let repeatMs = 0;
    let identified = 0;
    for (const tally of scope.repeated.values()) {
      identified += tally.n;
      repeatWorst = Math.max(repeatWorst, tally.n);
      if (tally.n > 1) repeatMs += (tally.ms * (tally.n - 1)) / tally.n;
    }
    // Start-up rule (startupEvent): a request that started while the isolate
    // was settling fetches its config and warms its caches once; it is set
    // aside, never folded into the repeated-work verdict.
    const repeatSettled = isSettledAt("startupEvent", scope.startedEpochMs);
    if (identified > 0 && !repeatSettled) session.repeatedSettlingRequests += 1;
    if (identified > 0 && repeatSettled) {
      session.repeatedWatchedRequests += 1;
      session.repeatedRequestMs += wallMs;
      session.repeatedWorst = Math.max(session.repeatedWorst, repeatWorst);
      if (repeatWorst > 1) {
        session.repeatedRequests += 1;
        session.repeatedMs += Math.min(wallMs, Math.round(repeatMs));
      }
    }
    if (scope.dataCalls > 0) {
      session.containmentWatched += 1;
      if (scope.dataFailed <= 0) {
        if (responseStatus >= 500) session.containmentUnattributed += 1;
      } else if (responseStatus < 500) session.containmentContained += 1;
      else if (scope.dataFailed >= scope.dataCalls) session.containmentAllFailed += 1;
      else session.containmentCollapsed += 1;
    }
    if (scope.aiCalls > 0) {
      session.aiWatchedRequests += 1;
      session.aiWatchedRequestMs += wallMs;
      // Calls can overlap, and a share above 100% of the request is not a
      // reading anybody can act on: clamped to the wall clock, exactly as the
      // server kits clamp theirs.
      session.aiMs += Math.min(Math.round(scope.aiMs), wallMs);
      if (scope.aiCostMicros > session.worstRequestCostMicros) {
        session.worstRequestCostMicros = Math.round(scope.aiCostMicros);
      }
      let worst = 0;
      let repeated = false;
      for (const n of scope.prompts.values()) {
        if (n > worst) worst = n;
        if (n > 1) repeated = true;
      }
      if (worst > session.promptRepeatWorst) session.promptRepeatWorst = worst;
      if (repeated) session.promptRepeatRequests += 1;
    }
    // Start-up rule (latencyTail): the isolate's first database request, or
    // one that started while settling, pays for the connection and the cold
    // plan. It is counted as settling and never judged.
    const dbSettled =
      scope.dbCalls > 0 &&
      session.dbSeenRequests++ >= SETTLE_FAMILIES.latencyTail.skipFirstRequests &&
      isSettledAt("latencyTail", scope.startedEpochMs);
    if (scope.dbCalls > 0 && !dbSettled) {
      session.dbSettlingRequests += 1;
      scope.dbSpans.length = 0;
    }
    if (dbSettled) {
      session.dbWatchedRequests += 1;
      session.dbWatchedRequestMs += wallMs;
      session.dbMs += Math.min(Math.round(scope.dbMs), wallMs);
      let worst = 0;
      let repeated = false;
      let redundantMs = 0;
      for (const st of scope.statements.values()) {
        if (st.n > worst) worst = st.n;
        if (st.n > 1) {
          repeated = true;
          redundantMs += (st.ms * (st.n - 1)) / st.n;
        }
      }
      if (worst > session.dbRepeatWorst) session.dbRepeatWorst = worst;
      if (repeated) session.dbRepeatRequests += 1;
      session.dbRepeatMs += Math.min(Math.round(redundantMs), wallMs);
      if (!scope.dbSpansOver && scope.dbSpans.length > 0) {
        const wave = sweepDbWaves(scope.dbSpans);
        session.dbWaveRequests += 1;
        session.dbWavesTotal += wave.waves;
        if (wave.waves > session.dbWavesWorst) session.dbWavesWorst = wave.waves;
        session.dbWaveSpanMs +=
          wallMs > 0 ? Math.min(wave.spanMs, wallMs) : wave.spanMs;
        session.dbWaveSumMs += wave.sumMs;
      }
      scope.dbSpans.length = 0;
    }
    const depSettled =
      scope.depCalls > 0 &&
      session.depSeenRequests++ >= SETTLE_FAMILIES.latencyTail.skipFirstRequests &&
      isSettledAt("latencyTail", scope.startedEpochMs);
    if (scope.depCalls > 0 && !depSettled) {
      session.depSettlingRequests += 1;
      scope.depKinds.clear();
    }
    if (depSettled) {
      session.depWatchedRequests += 1;
      session.depWatchedRequestMs += wallMs;
      session.depMs += Math.min(Math.round(scope.depMs), wallMs);
      session.depDbMs += Math.min(Math.round(scope.dbMs), wallMs);
      session.depAiMs += Math.min(Math.round(scope.aiMs), wallMs);
      for (const kind of scope.depKinds) dependencyTotals(kind).requests += 1;
      scope.depKinds.clear();
    }
  } catch {
    /* a measurement must never break the response it was taken during */
  }
}

type CacheVerdict = "hit" | "miss" | "stale" | "bypass";
const CACHE_HEADERS = [
  "x-vercel-cache",
  "cf-cache-status",
  "x-nextjs-cache",
  "cache-status",
  "x-cache",
] as const;
function cacheVerdict(res: Response): CacheVerdict | null {
  for (const name of CACHE_HEADERS) {
    const raw = safe(() => res.headers.get(name)?.trim().toUpperCase() ?? "", "");
    if (!raw) continue;
    if (/(^|[;\s])HIT([;\s,]|$)|PRERENDER/.test(raw)) return "hit";
    if (/STALE|EXPIRED|UPDATING|REVALIDATED|FWD=STALE/.test(raw)) return "stale";
    if (/BYPASS|DYNAMIC|IGNORED|FWD=(BYPASS|METHOD)/.test(raw)) return "bypass";
    if (/MISS|FWD=(MISS|URI-MISS|VARY-MISS)/.test(raw)) return "miss";
  }
  return null;
}

/** Count one cache verdict. Start-up rule (startupEvent): every first request
 *  misses a cold cache, so a verdict given while the isolate settles is set
 *  aside and never enters the hit share. */
function noteCacheVerdict(verdict: CacheVerdict | null): void {
  if (verdict === null) return;
  if (!isSettledAt("startupEvent", Date.now())) {
    session.cacheSettling += 1;
    return;
  }
  if (verdict === "hit") session.cacheHits += 1;
  else if (verdict === "miss") session.cacheMisses += 1;
  else if (verdict === "stale") session.cacheStale += 1;
  else if (verdict === "bypass") session.cacheBypass += 1;
}

/** Characters at each end of a string body ever read into an operation
 *  fingerprint. */
const OPERATION_BODY_SCAN_MAX = 4096;
/** Characters at each end of a call's query ever read into the same
 *  fingerprint; a longer query contributes its length and two hashes. */
const OPERATION_QUERY_SCAN_MAX = 4096;
let uniqueOperationSeq = 0;
/**
 * What makes one call a DIFFERENT operation from another to the same path:
 * its query and its body (shared decision, repeatedWork / dbWork). Folded into
 * a local hash, compared inside the request and never kept or sent. Only a
 * string body is read; any other body (a stream, bytes, a form, or a Request
 * object's own body) makes the call unique, because two calls are only ever
 * "the same work" on positive evidence.
 */
export function operationFingerprint(input: unknown, init?: { body?: unknown } | undefined): string {
  return safe(() => {
    let href = "";
    if (typeof input === "string") href = input;
    else if (input instanceof URL) href = input.href;
    else if (typeof (input as { url?: unknown })?.url === "string") {
      href = (input as { url: string }).url;
    }
    const q = href.indexOf("?");
    let query = "";
    if (q >= 0) {
      const length = href.length - q;
      query =
        length <= OPERATION_QUERY_SCAN_MAX
          ? href.slice(q)
          : `?${length}:${fnv1a(href.slice(q, q + OPERATION_QUERY_SCAN_MAX))}:${fnv1a(href.slice(-OPERATION_QUERY_SCAN_MAX))}`;
    }
    const body = init?.body;
    let bodyPart = "";
    if (body === undefined || body === null) {
      const requestBody =
        typeof input === "object" && input !== null && !(input instanceof URL)
          ? (input as { body?: unknown }).body
          : null;
      if (requestBody !== undefined && requestBody !== null) {
        bodyPart = `#u${++uniqueOperationSeq}`;
      }
    } else if (typeof body === "string") {
      const head = body.slice(0, OPERATION_BODY_SCAN_MAX);
      const tail = body.length > OPERATION_BODY_SCAN_MAX ? body.slice(-OPERATION_BODY_SCAN_MAX) : "";
      bodyPart = `#b${body.length}:${fnv1a(head)}:${fnv1a(tail)}`;
    } else {
      bodyPart = `#u${++uniqueOperationSeq}`;
    }
    return `${query}${bodyPart}`;
  }, `#u${++uniqueOperationSeq}`);
}

function noteRepeated(scope: RequestScope | null, identity: number, durationMs: number): void {
  if (!scope || scope.closed) return;
  const tally = scope.repeated.get(identity);
  if (tally) {
    tally.n += 1;
    tally.ms += durationMs;
  } else if (scope.repeated.size < MAX_DISTINCT_STATEMENTS) {
    scope.repeated.set(identity, { n: 1, ms: durationMs });
  }
}

function noteDataOutcome(scope: RequestScope | null, failed: boolean): void {
  if (!scope || scope.closed) return;
  scope.dataCalls += 1;
  if (failed) scope.dataFailed += 1;
}

export interface DbWaveSweep {
  waves: number;
  spanMs: number;
  sumMs: number;
}

/** Apply the shared half-open wave rule after sorting by issue instant. */
export function sweepDbWaves(spans: number[]): DbWaveSweep {
  const pairs: Array<[number, number, number]> = [];
  for (let i = 0; i + 1 < spans.length; i += 2) {
    const start = spans[i]!;
    const end = spans[i + 1]!;
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      pairs.push([start, end, i / 2]);
    }
  }
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  let waves = 0;
  let spanMs = 0;
  let sumMs = 0;
  let segmentStart = 0;
  let segmentEnd = 0;
  let open = false;
  for (const [start, end] of pairs) {
    sumMs += end - start;
    if (!open) {
      open = true;
      waves += 1;
      segmentStart = start;
      segmentEnd = end;
    } else if (start < segmentEnd) {
      if (end > segmentEnd) segmentEnd = end;
    } else {
      spanMs += segmentEnd - segmentStart;
      waves += 1;
      segmentStart = start;
      segmentEnd = end;
    }
  }
  if (open) spanMs += segmentEnd - segmentStart;
  return { waves, spanMs, sumMs };
}

function noteDbSpan(scope: RequestScope, start: number, end: number): void {
  if (scope.dbSpansOver) return;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return;
  if (scope.dbSpans.length >= DB_WAVE_MAX_CALLS * 2) {
    scope.dbSpansOver = true;
    return;
  }
  scope.dbSpans.push(start, end);
}

/**
 * Decide the fate of every call whose reply has arrived but whose body the
 * app never read: its usage was never reported.
 *
 * Runs at each fold and again when the snapshot is built — both synchronous,
 * both before a response completes. Never on a timer.
 */
function settlePending(): void {
  if (pending.length === 0) return;
  for (const call of pending) {
    if (call.settled) continue;
    call.settled = true;
    if (!call.usageReported) {
      call.settledMissing = true;
      session.usageMissingCalls += 1;
      if (call.stream) session.streamUsageMissingCalls += 1;
    }
  }
  pending = [];
}

/* ── Recording one call ──────────────────────────────────────────────────── */

function noteUsage(call: CallRecord, read: AiUsageRead): void {
  if (read.reported !== 1) return;
  if (call.settledMissing) {
    // The app read the body after we had already written the call off. Correct
    // the counter rather than leaving a finding that is no longer true.
    session.usageMissingCalls = Math.max(0, session.usageMissingCalls - 1);
    if (call.stream) {
      session.streamUsageMissingCalls = Math.max(
        0,
        session.streamUsageMissingCalls - 1,
      );
    }
    call.settledMissing = false;
  }
  if (call.usageReported) return;
  call.usageReported = true;
  session.tokensIn += read.tokensIn;
  session.tokensOut += read.tokensOut;
  session.cachedIn += read.cachedIn;
  if (read.reportedCostMicros !== null) {
    session.costMicros += read.reportedCostMicros;
    session.reportedCostCalls += 1;
    session.pricedCalls += 1;
    return;
  }
  if (call.provider === DECLARED_PROVIDER_CODE) {
    // A private deployment's model name does not establish its price. Tokens
    // still count; only money guessed from somebody else's price table is
    // withheld. This cannot overlap usage-missing because we are in noteUsage.
    session.unpricedCalls += 1;
    session.declaredUnpricedCalls += 1;
    return;
  }
  const estimated = estimateCostMicros(read);
  if (estimated !== null) {
    session.costMicros += estimated;
    session.pricedCalls += 1;
  } else {
    // Never treated as free: a call this kit has no price for is counted as
    // unpriced so the spend reading can say what it could not put a price on.
    session.unpricedCalls += 1;
  }
}

function noteOutcome(body: unknown): void {
  const outcome = readAiOutcome(body);
  if (outcome.truncated === 1) session.truncatedCount += 1;
  if (outcome.filtered === 1) session.filteredCount += 1;
  if (outcome.quota === 1) session.quotaCount += 1;
  if (outcome.rateLimited === 1) session.rateLimitedCount += 1;
}

/** One parsed reply body — from `json()`, from `text()`, or from a stream line
 *  that announced usage. Only usage numbers and closed-list codes are read out
 *  of it; the caller measures what the money moved by, so the per-request cost
 *  and the session cost can never disagree. */
function noteBody(call: CallRecord, body: unknown): void {
  try {
    if (body === null || typeof body !== "object") return;
    noteUsage(call, readAiUsage(body));
    noteOutcome(body);
  } catch {
    /* never let a reply's shape disturb the host */
  }
}

/* ── Watching a reply ────────────────────────────────────────────────────── */

/**
 * Shadow `json()` and `text()` so the usage numbers can be read out of a reply
 * the app itself reads — without buffering it, cloning it or delaying it. The
 * app gets exactly what the provider sent; this kit only ever sees the parsed
 * object it was going to build anyway.
 */
function observeBody(
  res: Response,
  call: CallRecord,
  onCost: (micros: number) => void,
): void {
  safe(() => {
    const origJson = res.json.bind(res);
    Object.defineProperty(res, "json", {
      configurable: true,
      writable: true,
      value: async (): Promise<unknown> => {
        const value = await origJson();
        const before = session.costMicros;
        noteBody(call, value);
        onCost(session.costMicros - before);
        return value;
      },
    });
    const origText = res.text.bind(res);
    Object.defineProperty(res, "text", {
      configurable: true,
      writable: true,
      value: async (): Promise<string> => {
        const text = await origText();
        if (text.length <= MAX_TEXT_PARSE_CHARS) {
          const parsed = safe(() => JSON.parse(text) as unknown, null as unknown);
          const before = session.costMicros;
          noteBody(call, parsed);
          onCost(session.costMicros - before);
        }
        return text;
      },
    });
  }, undefined);
}

/**
 * Watch a streamed reply as it flows to whoever asked for it.
 *
 * The stream is not buffered and not consumed: a pass-through transform times
 * the first chunk and the gaps between chunks, and looks at a decoded line
 * ONLY when it carries one of the closed-list markers that announce usage or
 * an ending. A content delta matches none of them, so an answer's text is
 * never parsed, never inspected and never kept.
 */
function observeStream(
  res: Response,
  call: CallRecord,
  startedAtMs: number,
  onTtft: (ms: number) => void,
  onCost: (micros: number) => void,
): void {
  safe(() => {
    const source = res.body;
    if (!source) return;
    let first = true;
    let lastAtMs = startedAtMs;
    let carry = "";
    const decoder = new TextDecoder();
    const feed = (text: string, final: boolean): void => {
      carry += text;
      let nl = carry.indexOf("\n");
      while (nl >= 0) {
        const line = carry.slice(0, nl);
        carry = carry.slice(nl + 1);
        inspectLine(line);
        nl = carry.indexOf("\n");
      }
      if (final && carry) {
        inspectLine(carry);
        carry = "";
      }
      // A provider that never sends a newline must not grow this without
      // bound. Past the ceiling the tail is dropped, which costs a usage read
      // and nothing else.
      if (carry.length > MAX_STREAM_CARRY) carry = "";
    };
    const inspectLine = (raw: string): void => {
      if (!raw) return;
      if (streamLineIsTerminal(raw)) return;
      if (!streamLineIsInteresting(raw)) return;
      const trimmed = raw.startsWith("data:") ? raw.slice(5).trim() : raw.trim();
      if (!trimmed || trimmed.length > MAX_STREAM_CARRY) return;
      const parsed = safe(() => JSON.parse(trimmed) as unknown, null as unknown);
      if (parsed === null) return;
      const before = session.costMicros;
      noteBody(call, parsed);
      onCost(session.costMicros - before);
    };
    const watcher = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        try {
          const at = nowMs();
          if (first) {
            first = false;
            onTtft(Math.max(0, at - startedAtMs));
          } else if (at - lastAtMs >= AI_STREAM_STALL_MS) {
            // A gap only becomes a fact when the next chunk arrives; an
            // isolate has no timer that could notice it any sooner.
            session.stallCount += 1;
          }
          lastAtMs = at;
          feed(decoder.decode(chunk, { stream: true }), false);
        } catch {
          /* never disturb the stream the app is serving */
        }
        controller.enqueue(chunk);
      },
      flush() {
        try {
          feed(decoder.decode(), true);
        } catch {
          /* as above */
        }
      },
    });
    // Piped only if the app actually takes the stream. Piping eagerly would
    // LOCK the reply's body, and an app that answered a streamed reply with
    // `res.text()` would get an error it never had before us. The watch may
    // cost a reading; it may never cost the app its answer.
    let watched: ReadableStream<Uint8Array> | null = null;
    Object.defineProperty(res, "body", {
      configurable: true,
      get: () => {
        if (!watched) watched = safe(() => source.pipeThrough(watcher), source);
        return watched;
      },
    });
  }, undefined);
}

/* ── The wrapper ─────────────────────────────────────────────────────────── */

type FetchFn = typeof fetch;

async function watchAiCall(
  real: FetchFn,
  input: Parameters<FetchFn>[0],
  init: Parameters<FetchFn>[1],
  provider: number,
): Promise<Response> {
  const scope = attributableScope();
  const startedAtMs = nowMs();
  const call: CallRecord = {
    provider,
    stream: false,
    usageReported: false,
    settledMissing: false,
    settled: false,
    cacheVerdict: null,
    repeatIdentity: 0,
  };
  // Everything before the call is measurement, and measurement never decides
  // whether the app's call happens.
  safeVoid(() => {
    const promptId = safe(() => {
      const body = (init as { body?: unknown } | undefined)?.body;
      if (typeof body !== "string" || !body) return null;
      // Only a bounded prefix is hashed — an isolate's memory is the
      // customer's — but the body's FULL length is folded in with it, exactly
      // as the Node, web and Python kits do. Real prompts are a fixed system
      // preamble followed by a short varying question, so a prefix alone
      // reads two different prompts as the same one and the repeat reading
      // then over-reports the very thing it exists to count.
      const head =
        body.length > MAX_PROMPT_CHARS ? body.slice(0, MAX_PROMPT_CHARS) : body;
      // The TAIL too: two long prompts of one length that share a preamble
      // differ at the end, and a prefix alone reads them as one.
      const tail = body.length > MAX_PROMPT_CHARS ? body.slice(-MAX_PROMPT_CHARS) : "";
      return fnv1a(`${body.length}:${head}:${fnv1a(tail)}`);
    }, null as number | null);
    session.callCount += 1;
    call.repeatIdentity = fnv1a(
      `ai:${provider}:${
        promptId === null
          ? `${targetOf(input, init as { method?: string })?.path ?? ""}${operationFingerprint(input, init as { body?: unknown })}`
          : promptId
      }`,
    );
    if (provider === DECLARED_PROVIDER_CODE) session.declaredCalls += 1;
    session.providers.add(provider);
    session.providerCounts.set(
      provider,
      (session.providerCounts.get(provider) ?? 0) + 1,
    );
    if (session.firstCallAtMs === null) session.firstCallAtMs = startedAtMs;
    if (scope) {
      scope.tracked += 1;
      scope.aiCalls += 1;
      if (promptId !== null && scope.prompts.size < MAX_DISTINCT_PROMPTS) {
        scope.prompts.set(promptId, (scope.prompts.get(promptId) ?? 0) + 1);
      }
    }
  });
  const onCost = (micros: number): void => {
    if (micros > 0 && scope && !scope.closed) scope.aiCostMicros += micros;
  };
  let res: Response;
  try {
    res = await real(input, init);
  } catch (e) {
    safeVoid(() => {
      const at = nowMs();
      const durationMs = Math.max(0, Math.round(at - startedAtMs));
      session.failCount += 1;
      const name = safe(() => String((e as { name?: unknown }).name ?? ""), "");
      if (name === "TimeoutError" || name === "AbortError") {
        session.timeoutCount += 1;
      }
      ring(session.durations, durationMs);
      if (durationMs > session.worstMs) session.worstMs = durationMs;
      session.lastCallAtMs = at;
      if (scope && !scope.closed) scope.aiMs += durationMs;
      // A call that never answered reported no usage, and there is no body
      // coming: settle it here rather than leaving it for a fold.
      call.settled = true;
      session.usageMissingCalls += 1;
      noteDataOutcome(scope, true);
      noteRepeated(scope, call.repeatIdentity, durationMs);
    });
    // The app's error, untouched.
    throw e;
  }
  // The reply is the app's the moment it exists. From here nothing may throw:
  // a bug in the measurement must cost a reading, never the app's answer.
  safeVoid(() => measureAiReply(res, call, scope, startedAtMs, onCost));
  return res;
}

/** Everything read off an AI reply. Split out so the call path can guarantee
 *  the app gets its Response even if this throws. */
function measureAiReply(
  res: Response,
  call: CallRecord,
  scope: RequestScope | null,
  startedAtMs: number,
  onCost: (micros: number) => void,
): void {
  const at = nowMs();
  const durationMs = Math.max(0, Math.round(at - startedAtMs));
  ring(session.durations, durationMs);
  if (durationMs > session.worstMs) session.worstMs = durationMs;
  session.lastCallAtMs = at;
  if (scope && !scope.closed) scope.aiMs += durationMs;

  const status = safe(() => res.status, 0);
  noteRepeated(scope, call.repeatIdentity, durationMs);
  noteDataOutcome(scope, status >= 500 || status === 429);
  noteCacheVerdict(cacheVerdict(res));
  if (status >= 400) session.failCount += 1;
  if (status === 429) session.rateLimitedCount += 1;
  if (status === 402) session.quotaCount += 1;
  if (status === 408 || status === 504) session.timeoutCount += 1;

  const headers = readAiHeaders((name) =>
    safe(() => res.headers.get(name), null as string | null),
  );
  const pct = (remaining: number | null, limit: number | null): number | null =>
    remaining !== null && limit !== null && limit > 0
      ? Math.max(0, Math.min(100, (remaining / limit) * 100))
      : null;
  const reqPct = pct(headers.requestsRemaining, headers.requestsLimit);
  const tokPct = pct(headers.tokensRemaining, headers.tokensLimit);
  if (reqPct !== null || tokPct !== null) {
    session.headroomReads += 1;
    const readAt = Date.now();
    if (isSettledAt("startupEvent", readAt)) {
      session.headroomSettled.push({ at: readAt, req: reqPct, tok: tokPct });
      if (session.headroomSettled.length > DURATION_RING) session.headroomSettled.shift();
    }
    if (reqPct !== null) {
      session.worstRequestsPct =
        session.worstRequestsPct === null
          ? reqPct
          : Math.min(session.worstRequestsPct, reqPct);
    }
    if (tokPct !== null) {
      session.worstTokensPct =
        session.worstTokensPct === null
          ? tokPct
          : Math.min(session.worstTokensPct, tokPct);
    }
  }
  if (headers.retryAfterMs !== null && headers.retryAfterMs > session.worstRetryAfterMs) {
    session.worstRetryAfterMs = Math.round(headers.retryAfterMs);
  }
  if (headers.serverMs !== null) ring(session.serverMs, Math.round(headers.serverMs));

  const streamed = safe(() => {
    const type = res.headers.get("content-type") ?? "";
    return type.includes("event-stream") || type.includes("x-ndjson");
  }, false);
  call.stream = streamed;
  if (streamed) {
    session.streamCount += 1;
    observeStream(
      res,
      call,
      at,
      (ttft) => {
        ring(session.ttfts, Math.round(ttft));
        const firstForProvider = !session.ttftProviders.has(call.provider);
        if (firstForProvider && session.ttftProviders.size < 1_000) {
          session.ttftProviders.add(call.provider);
        }
        const startedEpochMs = Date.now() - Math.max(0, nowMs() - startedAtMs);
        if (!firstForProvider && isSettledAt("latencyTail", startedEpochMs)) {
          ring(session.settledTtfts, Math.round(ttft));
        }
      },
      onCost,
    );
  }
  observeBody(res, call, onCost);
  pending.push(call);
}

async function watchDbCall(
  real: FetchFn,
  input: Parameters<FetchFn>[0],
  init: Parameters<FetchFn>[1],
  target: OutboundTarget,
): Promise<Response> {
  const scope = attributableScope();
  const startedAtMs = nowMs();
  // Statement identity: the METHOD, the path, the query and the body, hashed
  // together (shared decision, dbWork). The query is where a PostgREST filter
  // carries its columns and values, so two calls that differ there are two
  // different statements, never a repeat. Only the hash is compared, inside
  // this request, and nothing about either call leaves the isolate.
  const identity = safe(
    () =>
      fnv1a(
        `${target.method} ${target.host}${target.path}${operationFingerprint(input, init as { body?: unknown })}`,
      ),
    0,
  );
  safeVoid(() => {
    session.dbCallCount += 1;
    if (scope) scope.tracked += 1;
  });
  let res: Response | null = null;
  let thrown: unknown = null;
  try {
    res = await real(input, init);
  } catch (e) {
    thrown = e;
  }
  // A database call that failed still cost the request its wait, so it is
  // timed either way — and a bug in the timing costs a reading, never the
  // app's call.
  safeVoid(() => {
    const endedAtMs = nowMs();
    const durationMs = Math.max(0, Math.round(endedAtMs - startedAtMs));
    const status = res?.status;
    if (thrown !== null || (status !== undefined && (status >= 500 || status === 429))) {
      countDbFailure(session.dbFailures, callFailure(status, thrown));
    }
    if (scope && !scope.closed) {
      noteRepeated(scope, identity, durationMs);
      noteDataOutcome(scope, thrown !== null || safe(() => (res as Response).status >= 500 || (res as Response).status === 429, false));
      scope.dbCalls += 1;
      scope.dbMs += durationMs;
      noteDbSpan(scope, startedAtMs, endedAtMs);
      // This request's "database" linked step: a timing and an outcome,
      // never the address or the statement.
      noteLinkedCall(
        scope.linked,
        "database",
        startedAtMs,
        endedAtMs,
        thrown !== null || safe(() => (res as Response).status >= 500 || (res as Response).status === 429, false),
      );
      if (scope.statements.size < MAX_DISTINCT_STATEMENTS) {
        const tally = scope.statements.get(identity);
        if (tally) {
          tally.n += 1;
          tally.ms += durationMs;
        } else {
          scope.statements.set(identity, { n: 1, ms: durationMs });
        }
      }
    }
    if (res) {
      noteCacheVerdict(cacheVerdict(res));
    }
  });
  if (thrown !== null) throw thrown;
  return res as Response;
}

async function watchDependencyCall(
  real: FetchFn,
  input: Parameters<FetchFn>[0],
  init: Parameters<FetchFn>[1],
  target: OutboundTarget,
): Promise<Response> {
  const scope = attributableScope();
  const { kind, service } = dependencyFor(target.host);
  const startedAtMs = nowMs();
  let res: Response | null = null;
  let thrown: unknown = null;
  try {
    res = await real(input, init);
  } catch (error) {
    thrown = error;
  }
  safeVoid(() => {
    const endedAtMs = nowMs();
    const durationMs = Math.max(0, Math.round(endedAtMs - startedAtMs));
    const totals = dependencyTotals(kind);
    // Shared decision (repeatedWork): the query and a body fingerprint are
    // part of the identity, so two different operations are never one.
    const identity = fnv1a(
      `${target.method} ${target.host}${target.path}${operationFingerprint(input, init as { body?: unknown })}`,
    );
    noteRepeated(scope, identity, durationMs);
    totals.calls += 1;
    session.depCallCount += 1;
    const beforeFailed = totals.failed;
    const beforeTimeout = totals.timedOut;
    if (thrown !== null) {
      // Only a deadline is a timeout. A call the app aborted itself (an
      // AbortError) failed, and is sorted as cancelled — the shared rule
      // (docs/server-call-failures.md §2), as the Node kit counts it.
      const name = safe(() => String((thrown as { name?: unknown }).name ?? ""), "");
      if (name === "TimeoutError") totals.timedOut += 1;
      else totals.failed += 1;
    } else {
      const status = safe(() => (res as Response).status, 0);
      if (status >= 500 || status === 429) totals.failed += 1;
      else totals.ok += 1;
    }
    countFailure(totals, callFailure(res?.status, thrown), totals.failed > beforeFailed, totals.timedOut > beforeTimeout);
    countService(totals.services, service, totals.failed > beforeFailed, totals.timedOut > beforeTimeout);
    noteDataOutcome(
      scope,
      thrown !== null ||
        safe(() => (res as Response).status >= 500 || (res as Response).status === 429, false),
    );
    if (res) {
      noteCacheVerdict(cacheVerdict(res));
    }
    ring(totals.durations, durationMs);
    if (totals.durations.length > DEPENDENCY_KIND_RING) totals.durations.shift();
    if (durationMs > totals.worstMs) totals.worstMs = durationMs;
    if (scope && !scope.closed) {
      scope.tracked += 1;
      scope.depCalls += 1;
      scope.depMs += durationMs;
      scope.depKinds.add(kind);
      // This request's linked step under the group's word — never the host.
      // A timeout and a refusal both fail it, exactly as the totals count.
      noteLinkedCall(
        scope.linked,
        kind,
        startedAtMs,
        endedAtMs,
        thrown !== null ||
          safe(() => (res as Response).status >= 500 || (res as Response).status === 429, false),
      );
    }
  });
  if (thrown !== null) throw thrown;
  return res as Response;
}
/**
 * A call to an outside service the developer declared as waiting on purpose
 * (declaredWaits.ts; contract: docs/held-open-calls.md). Its wait is the point
 * of the call — a long-poll answers only when there is news — so it is never a
 * duration anywhere: not in the outside-service reading, not in the request's
 * waiting share, not a repeat, not a cache verdict and not a linked step. An
 * answer is counted as kept out, with the longest wait. A FAILURE still counts,
 * exactly as an undeclared call's would — a call, a failure or a timeout, and a
 * failed data call its request had to survive — only never with its duration.
 */
async function watchDeclaredDependencyCall(
  real: FetchFn,
  input: Parameters<FetchFn>[0],
  init: Parameters<FetchFn>[1],
  target: OutboundTarget,
  match: DeclaredCallMatch,
): Promise<Response> {
  const scope = attributableScope();
  const startedAtMs = nowMs();
  let res: Response | null = null;
  let thrown: unknown = null;
  try {
    res = await real(input, init);
  } catch (error) {
    thrown = error;
  }
  safeVoid(() => {
    const durationMs = Math.max(0, Math.round(nowMs() - startedAtMs));
    const status = res === null ? 0 : safe(() => (res as Response).status, 0);
    const failed = thrown !== null || status >= 500 || status === 429;
    if (!failed) {
      noteDeclaredCallExcluded(match, durationMs);
      return;
    }
    const { kind, service } = dependencyFor(target.host);
    const totals = dependencyTotals(kind);
    totals.calls += 1;
    session.depCallCount += 1;
    const name =
      thrown === null ? "" : safe(() => String((thrown as { name?: unknown }).name ?? ""), "");
    // As an undeclared call: only a deadline is a timeout; an abort the app
    // made itself is failed and sorted as cancelled.
    const timedOut = name === "TimeoutError";
    if (timedOut) totals.timedOut += 1;
    else totals.failed += 1;
    countFailure(totals, callFailure(status, thrown), !timedOut, timedOut);
    countService(totals.services, service, !timedOut, timedOut);
    noteDataOutcome(scope, true);
  });
  if (thrown !== null) throw thrown;
  return res as Response;
}

/**
 * Install the watch on this isolate's fetch. Once per isolate, and never over
 * itself: module state is per-isolate, so a second arm is a no-op.
 */
export function armOutbound(): void {
  if (armed) return;
  armed = true;
  standingDown = false;
  // Armed again after a stop: whatever a call still in flight at the stop
  // wrote since is a reading from before it, and goes.
  if (wipeOnArm) {
    wipeOnArm = false;
    session = emptySession();
    openScopes.clear();
    pending = [];
  }
  // Still in the chain from before the stop: it simply resumes, rather than a
  // second watch wrapping the first and counting every call twice.
  if (ourWrapper) return;
  safe(() => {
    const host = (globalThis as { fetch?: FetchFn }).fetch;
    if (typeof host !== "function") return;
    preArmFetch = host;
    const real = host.bind(globalThis) as FetchFn;
    const wrapper: FetchFn = (input, init) => {
      // The kit's own upload, on a host that gave us no fetch to keep at
      // import time. A fact about the call in progress, not a name check.
      // Or the kit is stopped and could not take this watch out: the app's
      // call goes straight through, unwatched.
      if (standingDown || inKitSend()) return real(input, init);
      let target: OutboundTarget | null = null;
      let kind: OutboundKind = "none";
      let provider = 0;
      try {
        target = targetOf(input, init as { method?: string } | undefined);
        const verdict = classify(target);
        kind = verdict.kind;
        provider = verdict.provider;
      } catch {
        kind = "none";
      }
      // A destination that classified to nothing AI-shaped is still worth one
      // number: an AI-shaped PATH on a host we could not name is the only
      // evidence this kit has that an undeclared model endpoint exists. Taken
      // before the early return, so a call with no readable target — the one
      // case with no path to match — is unaffected.
      if (kind !== "ai") noteUnclassifiedAiShape(target);
      if (kind === "none" || !target) return real(input, init);
      // NOT `safe(fn, real(input, init))`: a fallback argument is evaluated
      // before the call it is a fallback for, which would send the app's
      // request twice. The app's call is made exactly once, inside the watch.
      try {
        if (kind === "ai") return watchAiCall(real, input, init, provider);
        if (kind === "db") return watchDbCall(real, input, init, target);
        // Compared here, from the call's own address, and never kept.
        const declared = matchDeclaredFetch(input);
        if (declared !== null) {
          return watchDeclaredDependencyCall(real, input, init, target, declared);
        }
        return watchDependencyCall(real, input, init, target);
      } catch {
        return real(input, init);
      }
    };
    (globalThis as { fetch?: FetchFn }).fetch = wrapper;
    ourWrapper = wrapper;
  }, undefined);
}

/**
 * THE LOCK RULE (docs/kit-lock-rule.md): take the watch off this isolate's
 * fetch and throw away every call reading it holds.
 *
 * The original goes back only while our watch is still the one on top.
 * Something that wrapped `fetch` after us — another library, the app itself —
 * holds a reference to ours, and putting the original back under it would
 * take that wrapper away too. So ours stays in that chain, passing every call
 * straight through, until the kit runs again. Never throws.
 */
export function disarmOutbound(): void {
  armed = false;
  try {
    const g = globalThis as { fetch?: FetchFn };
    if (ourWrapper !== null && g.fetch === ourWrapper && preArmFetch !== null) {
      g.fetch = preArmFetch;
      ourWrapper = null;
      preArmFetch = null;
      standingDown = false;
    } else if (ourWrapper !== null) {
      standingDown = true;
    }
  } catch {
    if (ourWrapper !== null) standingDown = true;
  }
  // A request still open now is never folded (index.ts checks the held-data
  // generation); marking its scope closed keeps a late call out of it too.
  for (const scope of openScopes) scope.closed = true;
  openScopes.clear();
  session = emptySession();
  pending = [];
  wipeOnArm = true;
}

/**
 * Count one call whose PATH was an inference shape while its destination
 * classified to nobody. Never throws: it runs on calls this kit otherwise
 * leaves alone, so a mistake here would be a mistake in the app's own traffic.
 */
function noteUnclassifiedAiShape(target: OutboundTarget | null): void {
  try {
    if (!target || !isAiShapedPath(target.path)) return;
    // The evidence is a POST to an inference shape. A GET or a HEAD on the
    // same path is a health check, a probe or a proxy warming itself, and
    // counting one would turn the note into a false alarm on an app with no
    // AI in it at all.
    if (target.method !== "POST") return;
    session.unclassifiedAiShaped += 1;
  } catch {
    /* measurement never disturbs the worker */
  }
}

/** Is the watch installed in this isolate? */
export function outboundArmed(): boolean {
  return armed;
}

/* ── What the snapshot reads ─────────────────────────────────────────────── */

/** The AI aggregate, in the Node kit's own field names — every member a
 *  number, so no address, prompt, answer or model name can be in this shape. */
export interface EdgeAiStats {
  watchedRequests: number;
  watchedRequestMs: number;
  aiMs: number;
  callCount: number;
  providerCount: number;
  topProvider: number;
  p75Ms: number;
  worstMs: number;
  streamCount: number;
  ttftP75Ms: number;
  /** Start-up rule (latencyTail): streams judged for first words — started
   *  after settling, never a provider's first. `ttftP75Ms` is their p75. */
  ttftSettledCount?: number;
  stallCount: number;
  failCount: number;
  rateLimitedCount: number;
  quotaCount: number;
  timeoutCount: number;
  truncatedCount: number;
  filteredCount: number;
  serverMsP75: number;
  serverMsCalls: number;
  unwatchedClients: number;
  tokensIn: number;
  tokensOut: number;
  cachedIn: number;
  costMicros: number;
  reportedCostCalls: number;
  pricedCalls: number;
  unpricedCalls: number;
  /** Present on every aggregate produced by this kit. Optional only so older
   *  callers constructing this structural type remain source-compatible. */
  declaredCalls?: number;
  declaredUnpricedCalls?: number;
  /** AI-shaped calls to a destination this kit could not classify. Optional
   *  for the same source-compatibility reason as the two above. */
  unclassifiedCalls?: number;
  worstRequestCostMicros: number;
  windowMs: number;
  usageMissingCalls: number;
  streamUsageMissingCalls: number;
  promptRepeatWorst: number;
  promptRepeatRequests: number;
  headroomReads: number;
  worstRequestsPct: number | null;
  worstTokensPct: number | null;
  /** Start-up rule (startupEvent): settled headroom reads in the newest
   *  window, and the TYPICAL (median) headroom they show. */
  headroomSettledReads?: number;
  typicalRequestsPct?: number | null;
  typicalTokensPct?: number | null;
  worstRetryAfterMs: number;
}

/** The database aggregate, in the Node kit's own field names. */
export interface EdgeDbStats extends Partial<DbFailureCounts> {
  watchedRequests: number;
  watchedRequestMs: number;
  dbMs: number;
  callCount: number;
  hostedCalls: number;
  repeatWorst: number;
  repeatRequests: number;
  repeatMs: number;
  rowsWorst: number;
  unwatchedClients: number;
  waveRequests?: number;
  wavesTotal?: number;
  wavesWorst?: number;
  spanMs?: number;
  sumMs?: number;
  /** Requests set aside as start-up (start-up rule, latencyTail). */
  settlingRequests?: number;
}

export interface EdgeDependencyGroup extends Partial<FailureCounts> {
  services?: ServiceCounts[];
  kind: DependencyKind;
  calls: number;
  ok: number;
  failed: number;
  timedOut: number;
  requests: number;
  p75Ms: number;
  worstMs: number;
  flaky: 0 | 1;
}
export function getAiStats(): EdgeAiStats {
  settlePending();
  let topProvider = 0;
  let topCount = 0;
  for (const [code, count] of session.providerCounts) {
    if (count > topCount) {
      topCount = count;
      topProvider = code;
    }
  }
  const windowMs =
    session.firstCallAtMs !== null && session.lastCallAtMs !== null
      ? Math.max(0, Math.round(session.lastCallAtMs - session.firstCallAtMs))
      : 0;
  return {
    watchedRequests: session.aiWatchedRequests,
    watchedRequestMs: Math.round(session.aiWatchedRequestMs),
    aiMs: Math.round(session.aiMs),
    callCount: session.callCount,
    providerCount: session.providers.size,
    topProvider,
    p75Ms: percentile(session.durations, 75),
    worstMs: session.worstMs,
    streamCount: session.streamCount,
    // Judged first-words waits only (start-up rule), as every kit sends them.
    ttftP75Ms: percentile(session.settledTtfts, 75),
    ttftSettledCount: session.settledTtfts.length,
    stallCount: session.stallCount,
    failCount: session.failCount,
    rateLimitedCount: session.rateLimitedCount,
    quotaCount: session.quotaCount,
    timeoutCount: session.timeoutCount,
    truncatedCount: session.truncatedCount,
    filteredCount: session.filteredCount,
    serverMsP75: percentile(session.serverMs, 75),
    serverMsCalls: session.serverMs.length,
    // There is no unwatchable HTTP client in an isolate: fetch is the only way
    // out, and this kit watches it. A blind spot here would be a fiction.
    unwatchedClients: 0,
    tokensIn: session.tokensIn,
    tokensOut: session.tokensOut,
    cachedIn: session.cachedIn,
    costMicros: Math.round(session.costMicros),
    reportedCostCalls: session.reportedCostCalls,
    pricedCalls: session.pricedCalls,
    unpricedCalls: session.unpricedCalls,
    declaredCalls: session.declaredCalls,
    declaredUnpricedCalls: session.declaredUnpricedCalls,
    unclassifiedCalls: session.unclassifiedAiShaped,
    worstRequestCostMicros: Math.round(session.worstRequestCostMicros),
    windowMs,
    usageMissingCalls: session.usageMissingCalls,
    streamUsageMissingCalls: session.streamUsageMissingCalls,
    promptRepeatWorst: session.promptRepeatWorst,
    promptRepeatRequests: session.promptRepeatRequests,
    headroomReads: session.headroomReads,
    worstRequestsPct: session.worstRequestsPct,
    worstTokensPct: session.worstTokensPct,
    ...typicalHeadroom(),
    worstRetryAfterMs: session.worstRetryAfterMs,
  };
}

/** How far back the typical headroom looks: limits reset on the provider's
 *  own clock, so an hour-old low says nothing about the window now. */
const HEADROOM_TYPICAL_WINDOW_MS = 30 * 60_000;
function typicalHeadroom(): {
  headroomSettledReads: number;
  typicalRequestsPct: number | null;
  typicalTokensPct: number | null;
} {
  const since = Date.now() - HEADROOM_TYPICAL_WINDOW_MS;
  const recent = session.headroomSettled.filter((r) => r.at >= since);
  const median = (vals: number[]): number | null => {
    if (vals.length === 0) return null;
    const sorted = [...vals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  };
  return {
    headroomSettledReads: recent.length,
    typicalRequestsPct: median(recent.flatMap((r) => (r.req === null ? [] : [r.req]))),
    typicalTokensPct: median(recent.flatMap((r) => (r.tok === null ? [] : [r.tok]))),
  };
}

export function getDbStats(): EdgeDbStats {
  return {
    ...session.dbFailures,
    watchedRequests: session.dbWatchedRequests,
    watchedRequestMs: Math.round(session.dbWatchedRequestMs),
    dbMs: Math.round(session.dbMs),
    callCount: session.dbCallCount,
    // Every database call an isolate can see arrived over HTTP, which is
    // exactly why the reading has to say so: see the dashboard's edge note.
    hostedCalls: session.dbCallCount,
    repeatWorst: session.dbRepeatWorst,
    repeatRequests: session.dbRepeatRequests,
    repeatMs: Math.round(session.dbRepeatMs),
    // A row COUNT would need the reply parsed as data. An isolate reads no
    // database body, so this stays 0 and the axis omits the field rather than
    // reporting a result size it never saw.
    rowsWorst: 0,
    // No driver exists here to be unwatchable.
    unwatchedClients: 0,
    waveRequests: session.dbWaveRequests,
    wavesTotal: session.dbWavesTotal,
    wavesWorst: session.dbWavesWorst,
    spanMs: session.dbWaveSpanMs,
    sumMs: session.dbWaveSumMs,
    settlingRequests: session.dbSettlingRequests,
  };
}

export function getDependencyStats(): EdgeDependencyStats {
  const groups: EdgeDependencyGroup[] = [];
  for (const kind of DEPENDENCY_KINDS) {
    const totals = session.depKinds.get(kind);
    if (!totals || totals.calls === 0) continue;
    groups.push({
      kind,
      calls: totals.calls,
      ok: totals.ok,
      failed: totals.failed,
      timedOut: totals.timedOut,
      couldNotConnect: totals.couldNotConnect,
      noAnswer: totals.noAnswer,
      turnedAway: totals.turnedAway,
      tooManyRequests: totals.tooManyRequests,
      serverError: totals.serverError,
      cancelled: totals.cancelled,
      ...(kind !== "other" ? topServices(totals.services) : {}),
      requests: totals.requests,
      p75Ms: percentile(totals.durations, 75),
      worstMs: Math.round(totals.worstMs),
      flaky: totals.ok > 0 && totals.failed + totals.timedOut > 0 ? 1 : 0,
    });
  }
  return {
    watchedRequests: session.depWatchedRequests,
    watchedRequestMs: Math.round(session.depWatchedRequestMs),
    depMs: Math.round(session.depMs),
    dbMs: Math.round(session.depDbMs),
    aiMs: Math.round(session.depAiMs),
    callCount: session.depCallCount,
    groups,
    settlingRequests: session.depSettlingRequests,
    declared: declaredCallCounts(),
  };
}
export function _resetOutboundForTests(): void {
  session = emptySession();
  openScopes.clear();
  pending = [];
  armed = false;
  ourWrapper = null;
  standingDown = false;
  wipeOnArm = false;
  // Put the isolate back as we found it, or a second arm would wrap our own
  // wrapper and one call would be counted twice.
  if (preArmFetch) {
    safe(() => {
      (globalThis as { fetch?: FetchFn }).fetch = preArmFetch as FetchFn;
    }, undefined);
    preArmFetch = null;
  }
}

export interface EdgeDependencyStats {
  watchedRequests: number;
  watchedRequestMs: number;
  depMs: number;
  dbMs: number;
  aiMs: number;
  callCount: number;
  groups: EdgeDependencyGroup[];
  /** Requests set aside as start-up (start-up rule, latencyTail). */
  settlingRequests?: number;
  /** The calls declared as waiting on purpose (declaredWaits.ts): the four
   *  counts the contract sends on this reading. Never a name or an address. */
  declared?: {
    waitDeclaredNames: number;
    waitDeclaredMatched: number;
    waitDeclaredExcluded: number;
    waitDeclaredWorstMs: number;
  };
}

export interface EdgeOutboundRequestStats {
  watchedRequests: number;
  requestsWithRepeat: number;
  worstRepeats: number;
  redundantMs: number;
  watchedRequestMs: number;
  containment: {
    watchedRequests: number;
    contained: number;
    collapsed: number;
    allFailed: number;
    unattributed: number;
  };
  cache: {
    hits: number;
    misses: number;
    stale: number;
    bypass: number;
  } | null;
  /** Start-up rule (startupEvent): requests and cache verdicts set aside
   *  while the isolate settled. */
  repeatSettlingRequests?: number;
  cacheSettling?: number;
}

export function getOutboundRequestStats(): EdgeOutboundRequestStats {
  const cacheTotal =
    session.cacheHits + session.cacheMisses + session.cacheStale + session.cacheBypass;
  return {
    watchedRequests: session.repeatedWatchedRequests,
    requestsWithRepeat: session.repeatedRequests,
    worstRepeats: session.repeatedWorst,
    redundantMs: Math.round(session.repeatedMs),
    watchedRequestMs: Math.round(session.repeatedRequestMs),
    containment: {
      watchedRequests: session.containmentWatched,
      contained: session.containmentContained,
      collapsed: session.containmentCollapsed,
      allFailed: session.containmentAllFailed,
      unattributed: session.containmentUnattributed,
    },
    cache:
      cacheTotal === 0
        ? null
        : {
            hits: session.cacheHits,
            misses: session.cacheMisses,
            stale: session.cacheStale,
            bypass: session.cacheBypass,
          },
    repeatSettlingRequests: session.repeatedSettlingRequests,
    cacheSettling: session.cacheSettling,
  };
}
