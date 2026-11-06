/** What a V8 isolate can honestly measure — and what it cannot, by name.
 *
 * An isolate is not a small server. It has no process, no event loop we may
 * watch between invocations, no heap reading, no CPU clock, no uptime, no
 * container. Half the meters a Node service reports are not "warming up" here;
 * they can never exist. The rule this file enforces is that the difference is
 * always visible: a reading we cannot take is NAMED, with the reason, and is
 * never reported as a zero, a blank, or a tile that warms up forever.
 *
 * The two lists below are the kit's own truth. The dashboard is taught the
 * same two lists, and a guard checks they still agree.
 */

import type { Rating } from "./version";
import { SETTLE_FAMILIES, markSettled, settlingReading } from "./settleRule";

/** Meters this kit really does upload once it has enough traffic. */
export const MEASURABLE_AXES = [
  "reliability",
  "accessPressure",
  "cookieExposure",
  "corsExposure",
  "coldStart",
  "crashFree",
  "latencyFloor",
  "loadDeflection",
  "resilience",
  "routeFailures",
  "swallowedErrors",
  "unhandledErrors",
] as const;

export type MeasurableAxis = (typeof MEASURABLE_AXES)[number];

/** Meters this kit takes only when the app makes the calls they measure.
 *
 * The readings above are taken from the isolate's own requests, so any project
 * that serves traffic gets them. These come from watching the one way out
 * of an isolate (see `outbound.ts`), and an app that never calls a model
 * provider, hosted database or ordinary outside service gives them nothing to
 * read. That is not a
 * pending reading and must never be shown as one: the axis is simply ABSENT,
 * exactly as it is for an app with no AI in it on any other runtime.
 *
 * The dashboard is taught this list separately from the one above for that
 * reason — the four above are expected of every edge install and warm up, and
 * these call-dependent readings are only ever present or absent. A guard
 * checks both lists still agree with the dashboard's copies. */
export const CALL_DEPENDENT_AXES = [
  "dbWork",
  "dbSequencing",
  "aiCalls",
  "aiSpend",
  "aiHeadroom",
  "dependencies",
  "failureContainment",
  "repeatedWork",
  "upstreamCache",
] as const;

export type CallDependentAxis = (typeof CALL_DEPENDENT_AXES)[number];

/** Meters that cannot exist inside an isolate, each with the reason a
 *  developer can check for themselves. Uploaded with the snapshot so the
 *  project page can say why, in the kit's own words, rather than leaving a
 *  hole the reader has to interpret. */
export const NOT_MEASURABLE: Readonly<Record<string, string>> = {
  eventLoopLag: "an isolate has no event loop of its own to watch between requests",
  eventLoopUtilization:
    "an isolate has no event loop of its own to watch between requests",
  worstFreeze: "nothing runs between requests, so there is no freeze to time",
  // The memory and collection family, every reading of it. A V8 isolate runs
  // inside a process it is not allowed to see: there is no resident-memory
  // figure, no heap statistic, no allocation counter and no collection
  // counter anywhere in the platform APIs, on any of the hosts this kit runs
  // on. Each one is named separately rather than as a single "no memory
  // readings here" line, because the dashboard draws one row per reading and
  // a developer comparing an edge project with a Node one needs each row to
  // say why it is empty. The two phone readings at the end are on the same
  // list for the same reason: the dashboard asks every kit about them.
  memoryStability: "an isolate exposes no heap reading",
  heapHeadroom: "an isolate exposes no heap reading",
  peakRss: "an isolate exposes no process resident-memory high-water mark",
  residentGrowth: "an isolate exposes no process resident-memory samples",
  memoryPerRequest: "an isolate exposes no process memory before and after a request",
  allocPerRequest: "an isolate exposes no allocation-byte counter",
  heapFragmentation: "an isolate exposes neither committed heap nor a heap ceiling",
  gcPressure: "an isolate exposes no garbage-collection counters",
  gcPauseTail: "an isolate exposes no garbage-collection counters",
  gcTax: "an isolate exposes no garbage-collection counters",
  gcGenerationBalance: "an isolate exposes no garbage-collection counters",
  finalizerBacklog: "an isolate exposes no finalization-queue depth",
  codeCachePressure: "an isolate exposes no compiled-code cache capacity",
  memoryWarnings: "an isolate has no foreground operating-system memory-warning callback",
  screenLeaks: "an isolate has no screen lifecycle",
  cpuConsumption: "an isolate exposes no CPU clock",
  cpuThrottling: "an isolate exposes no CPU clock",
  uptimeStability: "an isolate has no uptime — the platform creates and discards it",
  containerPressure: "there is no container: the platform never exposes one",
  backpressure: "the platform owns the connection; the kit never touches a socket",
  handleLeak: "an isolate has no handle table to read",
  handleChurn: "an isolate has no handle table to read",
  diskPressure: "an isolate has no filesystem",
  // dbPoolPressure is SETTLED but deliberately not declared here. Every other
  // server kit reads its pool's own state because the pool lives in the app's
  // process: a pg.Pool, a HikariDataSource, a sqlx::Pool. An isolate holds no
  // connection of any kind — it reaches a database over the one fetch it is
  // given, and whatever reuse happens (Cloudflare Hyperdrive, a Neon or
  // Supabase pooler, the platform's own connection cache) happens OUTSIDE the
  // isolate, in infrastructure it cannot address let alone count. There is no
  // busy, no idle, no queue and no maximum, and inventing a pool of one from
  // "this request made a query" would ship a saturation figure about a pool
  // that does not exist.
  //
  // It is not listed because the coverage contract puts all four database
  // readings on ONE boundary — "the app has a database client" — and so reads
  // a permanent no-pool claim as a lie about a merely unbuilt reading. Having
  // a client is not having a pool. Until dbPoolPressure earns its own
  // boundary in scripts/src/meter-coverage/contract.ts, declaring it here
  // fails that guard. Reasoning: docs/decisions/edge-isolate-database-pool.md.
  //
  // The one entry here that is OUR gap rather than the platform's boundary,
  // and it says so in the word "yet". An isolate does see database work —
  // it reaches a hosted database over its own fetch and times it, which is
  // why dbWork and dbSequencing are both taken here. How much came BACK is
  // the part it cannot reach the same way: a driver hands a row count back,
  // an HTTP reply does not, and nothing in this kit opens a reply's body.
  // Named rather than left blank because a missing tile beside a Database
  // Work tile reads as "the results were small", which is a claim no isolate
  // install has earned. It sits in the coverage backlog with every other
  // unbuilt reading.
  dbRowVolume:
    "counting the rows in a hosted database's HTTP reply is not built for an isolate yet",
  // Connections the app holds open, and work that failed with nobody
  // waiting, are deliberately NOT listed here even though an isolate can
  // watch neither. The kit attaches all three readings and answers each one
  // `measurable: 0` with the platform's own reason, so the refusal reaches
  // the customer on the tile itself. A reading named in this list never
  // arrives at all, and these three do.
  dependencyDistance:
    "the Fetch API exposes only the whole HTTP operation, not separate TCP connect and TLS handshake phases",
} as const;

/** Meters that cannot exist on ONE platform, even though a sibling isolate
 *  host can take them. Proven on a real run, not assumed:
 *
 *  Cloudflare Workers freezes its clock. Both `Date.now()` and
 *  `performance.now()` read 0 while the isolate's own code is being evaluated
 *  and only move once the isolate does input or output. A Worker therefore
 *  cannot time its own start — the boot clock is not merely inaccurate there,
 *  it does not exist. Durations INSIDE a request are unaffected (the clock has
 *  moved by then), which is why every other reading on this list stays.
 *
 *  Reported by name and reason, exactly like the list above, rather than
 *  quietly shipping a zero or a nonsense number on one platform only. */
export const NOT_MEASURABLE_BY_PLATFORM: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  "cloudflare-workers": {
    coldStart:
      "Cloudflare's clock does not move until the function does input or output, so a Worker cannot time its own start",
  },
} as const;

/** Everything this kit cannot measure on the given platform: the isolate-wide
 *  list plus that platform's own additions. */
export function notMeasurableFor(platform: string): Record<string, string> {
  return { ...NOT_MEASURABLE, ...(NOT_MEASURABLE_BY_PLATFORM[platform] ?? {}) };
}

/** Everything this kit really can measure on the given platform. */
export function measurableFor(platform: string): MeasurableAxis[] {
  const blocked = notMeasurableFor(platform);
  return MEASURABLE_AXES.filter((axis) => !(axis in blocked));
}

/** A reading may also be "pending": present, but with too little behind it to
 *  score yet. Same word the server kits use, so one dashboard renders both. */
export type AxisRating = Rating | "pending" | "not-scored";

export interface AxisValue {
  /** Null for a pending, unscored, or platform-withheld reading. */
  score: number | null;
  rating: AxisRating;
  [k: string]: unknown;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function band(value: number, good: number, poor: number): Rating {
  if (value <= good) return "good";
  if (value >= poor) return "poor";
  return "needs-work";
}

/** Reliability — the share of answered requests that failed with a 5xx. Same
 *  meaning as every other server kit's reliability axis. */
export const MIN_RESPONSES_FOR_RELIABILITY = 10;
export function computeReliability(args: {
  requests: number;
  errors: number;
}): AxisValue | null {
  if (args.requests < MIN_RESPONSES_FOR_RELIABILITY) return null;
  const errorRate = args.errors / args.requests;
  // FIELD NAMES ARE A WIRE CONTRACT, not a local choice. The server keeps a
  // closed allowlist of axis slots and silently drops anything outside it, so
  // an invented name does not error — it arrives as an axis with no numbers in
  // it. These are the same slots the Node kit's reliability axis fills, which
  // is also why one dashboard can render both without a special case.
  return {
    score: clamp(100 - errorRate * 100),
    rating: band(errorRate, 0.001, 0.02),
    errorRate: Math.round(errorRate * 10000) / 10000,
    errorPct: Math.round(errorRate * 1000) / 10,
    total: args.requests,
    errors: args.errors,
  };
}

/** Access pressure — the share of requests turned away (401 / 403 / 404 / 429).
 *  Shape-only, exactly as on the server kits: counts and a share, never a path,
 *  a header or an address. */
export const MIN_RESPONSES_FOR_ACCESS_PRESSURE = 10;

/** Responses counted only once the isolate has settled (start-up rule,
 *  peakRate): the window a turned-away share is judged over. */
export interface SettledStatusCounts {
  requests: number;
  unauthorized: number;
  forbidden: number;
  notFound: number;
  rateLimited: number;
  serverErrors: number;
  /** The first settled response (epoch ms), or null before one. */
  firstAtMs: number | null;
  /** Turned-away responses set aside while the isolate settled. */
  settlingRejections: number;
}

export function computeAccessPressure(args: {
  requests: number;
  unauthorized: number;
  forbidden: number;
  notFound: number;
  rateLimited: number;
  serverErrors: number;
  /** Start-up rule (peakRate): when given, only this settled window is
   *  judged, and only once it spans the family's minimum. */
  settled?: SettledStatusCounts;
  nowMs?: number;
}): AxisValue | null {
  if (args.requests < MIN_RESPONSES_FOR_ACCESS_PRESSURE) return null;
  let counts: {
    requests: number;
    unauthorized: number;
    forbidden: number;
    notFound: number;
    rateLimited: number;
    serverErrors: number;
  } = args;
  const settled = args.settled;
  if (settled) {
    // Start-up rule (peakRate): the first requests of an isolate (the probe
    // before the route exists, the client retrying a token it has not got
    // yet) are not pressure. Judged over the settled window only, and only
    // once that window spans the family's minimum.
    const spanMs =
      settled.firstAtMs === null ? 0 : (args.nowMs ?? Date.now()) - settled.firstAtMs;
    if (
      settled.requests < MIN_RESPONSES_FOR_ACCESS_PRESSURE ||
      spanMs < SETTLE_FAMILIES.peakRate.minSpanSec * 1000
    ) {
      const seen =
        settled.settlingRejections +
        settled.unauthorized +
        settled.forbidden +
        settled.notFound +
        settled.rateLimited;
      // The counts ride, ungraded: what this isolate answered is a fact at
      // any age, and most isolates never live long enough to settle. Only
      // the share's grade waits.
      return seen > 0
        ? settlingReading({
            score: null,
            unauth: args.unauthorized,
            forbidden: args.forbidden,
            limited: args.rateLimited,
            notFound: args.notFound,
            serverError: args.serverErrors,
            total: args.requests,
          })
        : null;
    }
    counts = settled;
  }
  const rejections =
    counts.unauthorized + counts.forbidden + counts.notFound + counts.rateLimited;
  const share = rejections / counts.requests;
  // Same wire slots as the server kits' accessPressure (see the note on
  // reliability above). The per-minute burst and surge fields those kits also
  // send are deliberately absent: an isolate lives for seconds and cannot hold
  // a per-minute baseline, and a made-up one would read as a real reading.
  const reading: AxisValue = {
    score: clamp(100 - share * 120),
    rating: band(share, 0.1, 0.3),
    unauth: counts.unauthorized,
    forbidden: counts.forbidden,
    limited: counts.rateLimited,
    notFound: counts.notFound,
    serverError: counts.serverErrors,
    total: counts.requests,
  };
  return settled ? markSettled(reading) : reading;
}

/** Cookie exposure — cookies this function set without the protections a
 *  browser needs. Read from the response's own Set-Cookie headers: flag NAMES
 *  and counts only, never a cookie name and never a value. */
export function computeCookieExposure(args: {
  cookiesSet: number;
  responses: number;
  noSecure: number;
  noHttpOnly: number;
  noSameSite: number;
  noneWithoutSecure: number;
}): AxisValue | null {
  if (args.cookiesSet <= 0) return null;
  const unsafeShare =
    (args.noSecure + args.noneWithoutSecure) / args.cookiesSet;
  const weakShare =
    (args.noHttpOnly + args.noSameSite) / (args.cookiesSet * 2);
  const rating: Rating =
    args.noSecure > 0 || args.noneWithoutSecure > 0
      ? "poor"
      : args.noHttpOnly > 0 || args.noSameSite > 0
        ? "needs-work"
        : "good";
  // Same wire slots as the server kits' cookieExposure (see reliability).
  return {
    score: clamp(100 - 70 * unsafeShare - 30 * weakShare),
    rating,
    setCount: args.cookiesSet,
    responses: args.responses,
    noSecure: args.noSecure,
    noHttpOnly: args.noHttpOnly,
    noSameSite: args.noSameSite,
    noneWithoutSecure: args.noneWithoutSecure,
  };
}

/** The closed reason code for a reading that is real and deliberately never
 *  graded — the same code (6, "nothing to compare") every server kit sends
 *  beside its unscored readings. */
const REASON_NOTHING_TO_COMPARE = 6;

/** Cross-origin exposure — the SHAPE of the cross-origin answers this
 *  function served: `*` (any origin), the asking origin echoed back, and a
 *  wildcard paired with `Access-Control-Allow-Credentials: true`. Counts only:
 *  the origin, both header values and the route were compared on the request
 *  path and dropped (see `noteCors` in index.ts).
 *
 *  Never scored, by design and in every kit: a correct allowlist echoes an
 *  allowed origin exactly as an app that echoes every origin does, and one
 *  response cannot tell them apart. So the rating says "not-scored" for good,
 *  and the window is the life of this isolate's counts. */
export function computeCorsExposure(
  args: {
    responses: number;
    originRequests: number;
    anyOrigin: number;
    reflected: number;
    wildcardCredentials: number;
    firstAtMs: number | null;
  },
  nowMs: number,
): AxisValue | null {
  if (args.responses <= 0 || args.firstAtMs === null) return null;
  return {
    score: null,
    rating: "not-scored",
    responses: args.responses,
    originRequests: args.originRequests,
    anyOrigin: args.anyOrigin,
    reflected: args.reflected,
    wildcardCredentials: args.wildcardCredentials,
    windowMs: Math.max(0, Math.round(nowMs - args.firstAtMs)),
    measurable: 1,
    reasonCode: REASON_NOTHING_TO_COMPARE,
  };
}

/** Which interval this kit's cold-start figure covers, from the closed
 *  cross-runtime code set (docs/cold-start-boundary-contract.md): isolate
 *  created → its first request finished. A complete interval, so it is rated. */
const MEASURED_TO_FIRST_RESPONSE = 3;

/** Cold start — how long this isolate took from being created to finishing its
 *  first request. On an isolate host this is the reading that matters most and
 *  the one a Node service can only approximate: every wake is a real, timed
 *  cold start, measured once, never averaged away. */
export function computeColdStart(coldStartMs: number | null): AxisValue | null {
  if (coldStartMs === null || !Number.isFinite(coldStartMs) || coldStartMs < 0) {
    return null;
  }
  const ms = Math.round(coldStartMs);
  // `startupMs` is the wire slot every other kit's cold-start reading uses.
  // `measuredTo` names WHICH interval that figure covers, from the closed
  // cross-runtime code set (docs/cold-start-boundary-contract.md). An isolate
  // has no separate readiness moment to wait for — creation through the end of
  // its first request IS the whole of its start — so this is a complete
  // interval (code 3) and may be rated. A reading that arrives without the code
  // is rendered unrated by the server, which is what keeps a kit measuring only
  // as far as its own switch-on from being read as "this app starts fast".
  return {
    score: clamp(100 - (ms / 1000) * 55),
    rating: band(ms, 200, 1000),
    startupMs: ms,
    measuredTo: MEASURED_TO_FIRST_RESPONSE,
    count: 1,
  };
}
