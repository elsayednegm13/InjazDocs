/** Request-scoped readings for an isolate.
 *
 * Nothing in this file advances on a background timer. Observation time is the
 * sum of completed invocation wall times, and latency windows advance only
 * while at least one invocation is actually running.
 */

import type { CollectorState } from "./collector";
import { declaredRoutesKeptOut } from "./declaredWaits";
import type { EdgeOutboundRequestStats } from "./outbound";
import { safeVoid } from "./safe";
import type { AxisValue, AxisRating } from "./axes";
import { linearScore, ratingFor as sharedRatingFor } from "./outboundAxes";
import {
  SETTLE_FAMILIES,
  isSettledAt,
  isSettling,
  markSettled,
  noteIsolateClock,
  settledFromMs,
  settlingReading,
} from "./settleRule";

export const PLATFORM_DOES_NOT_EXPOSE = 3;
const NOTHING_TO_COMPARE = 6;

/* ─── The shared resilience TAIL contract (isolate copy) ───────────────────
 *
 * p99/p50 — the tail blowup ratio — is judged the same way in every kit: the
 * same three numbers and the same four states, so a 22 ms tail is never rated
 * poor here for having a 3 ms median, and a fast endpoint whose median rounds
 * to zero abstains instead of being handed full marks. Bands stay per-kit and
 * are applied below; this decides only what can honestly be SAID.
 *
 * Copied rather than imported: this kit ships to the customer as standalone
 * source and may not reach a sibling package. The guard in
 * scripts/src/__tests__/resilience-tail-parity.test.ts holds every copy to the
 * same numbers.
 */

/** A p99 at or under this is fast in absolute terms: no tail problem exists,
 *  whatever the ratio says. */
export const RESILIENCE_TAIL_FLOOR_MS = 50;

/** Below this many samples a "p99" is just the slowest of a handful, so no
 *  tail is published at all. */
export const RESILIENCE_MIN_TAIL_SAMPLES = 20;

/** Durations are captured in whole milliseconds, so a median below this is not
 *  a small number — it is an unmeasured one, and no ratio can be taken from it. */
export const RESILIENCE_MIN_MEDIAN_MS = 1;

/** What the tail can honestly say about a set of samples. */
type TailReading =
  /** Too few samples for a p99 to mean anything — publish no tail at all. */
  | { state: "insufficient" }
  /** The slowest requests are fast in absolute terms. `ratio` is null when the
   *  median was unmeasurable. */
  | { state: "flat"; ratio: number | null }
  /** A real tail above the floor, but the median is below the capture
   *  resolution, so the ratio cannot be computed — abstain, never guess. */
  | { state: "unmeasurable" }
  /** A ratio worth scoring. */
  | { state: "rated"; ratio: number };

function readResilienceTail(
  p50Ms: number | null | undefined,
  p99Ms: number | null | undefined,
  sampleCount: number,
): TailReading {
  if (
    sampleCount < RESILIENCE_MIN_TAIL_SAMPLES ||
    p50Ms == null ||
    p99Ms == null ||
    !Number.isFinite(p50Ms) ||
    !Number.isFinite(p99Ms)
  ) {
    return { state: "insufficient" };
  }
  const measurableMedian = p50Ms >= RESILIENCE_MIN_MEDIAN_MS;
  if (p99Ms <= RESILIENCE_TAIL_FLOOR_MS) {
    return { state: "flat", ratio: measurableMedian ? p99Ms / p50Ms : null };
  }
  if (!measurableMedian) return { state: "unmeasurable" };
  return { state: "rated", ratio: p99Ms / p50Ms };
}
const RATE_WINDOW_MS = 5 * 60_000;
/** A busy-period p75 at or under this is fast in absolute terms (shared
 *  decision, loadDeflection — the same floor as every kit carrying it). */
export const LOAD_DEFLECTION_FAST_P75_MS = 100;
/** Settled requests repeatedWork needs before a verdict (every kit's floor). */
export const REPEATED_WORK_MIN_REQUESTS = 5;
export const REPEATED_WORK_TIME_PCT_THRESHOLDS = { good: 1, poor: 20 } as const;
export const REPEATED_WORK_BURST_THRESHOLDS = { good: 1, poor: 10 } as const;
/** Settled cache verdicts a hit share is judged from (latencyTail's floor:
 *  below it one ordinary miss decides the share). */
export const UPSTREAM_CACHE_MIN_VERDICTS = 20;
const LATENCY_WINDOW_MS = 10_000;

interface InvocationToken {
  inFlight: number;
}

let inFlight = 0;
let peakInFlight = 0;
let invocationMs = 0;
let crashes = 0;
let unhandled = 0;
let swallowed = 0;
let consoleInstalled = false;
let originalConsoleError: ((...args: unknown[]) => void) | null = null;
/** What sat on `console.error` before our watch, exactly as it was, so the
 *  lock rule can put it back; and our watch itself, to know whether it is
 *  still the one on top. */
let rawConsoleError: unknown = null;
let consoleWrapper: ((...args: unknown[]) => void) | null = null;
/** Set while stopped when our watch could not be taken out (something wrapped
 *  `console.error` over it): it then only forwards, and notes nothing. */
let consoleStandingDown = false;

/** Settled requests only (start-up rule, latencyTail): a request that
 *  STARTED inside the settle period, or a route's first, met cold handlers. */
const loadSamples: Array<{ inFlight: number; durationMs: number }> = [];
let settledPeakInFlight = 0;
let activePeriodStart = 0;
let nextLatencyBoundary = 0;
let latencySamples: Array<{ at: number; durationMs: number }> = [];
let latencyWorst = 0;
let latencyWindows = 0;
let requestRuns = 0;
let requestObserved = 0;
let requestFailed = 0;
let requestUntracked = 0;
const requestParts = new Set<string>();
/** Durations of settled requests (start-up rule, latencyTail): started after
 *  the settle period, and never the first request of a route. */
const requestDurations: number[] = [];
/** Requests the tail meters set aside as start-up (inside the settle period,
 *  or a route's first). Non-zero is what lets a young isolate say "settling". */
let latencySettlingRequests = 0;
/** Requests seen per route, to set each route's first aside. Bounded: a route
 *  past the cap is never judged, which is the safe direction. */
const routeRequestsSeen = new Map<string, number>();
const ROUTE_SEEN_CAP = 1_000;

/* ─── Swallowed errors (shared decision, startupEvent) ────────────────────
 * A swallowed error is a CAUGHT exception the app logged and carried on from:
 * an Error handed to console.error, or text carrying a stack. A plain error
 * LINE is the app reporting a condition it chose to report and never counts.
 * Counted over the settled part of the last hour of the isolate's own clock,
 * on the same band as every other kit; one caught during start-up (an import
 * or config probe) is booting. Records only a timestamp. */
const SWALLOWED_GOOD_PER_HOUR = 1;
const SWALLOWED_POOR_PER_HOUR = 60;
const SWALLOWED_WINDOW_MS = 60 * 60_000;
const SWALLOWED_MIN_WINDOW_MS = 5 * 60_000;
const SWALLOWED_RING_CAP = 400;
const SWALLOWED_STACK_FRAME_RE = /\n\s+at\s/;
const SWALLOWED_ARG_SCAN_MAX = 8;
const SWALLOWED_TEXT_SCAN_MAX = 4096;
const swallowedTs: number[] = [];
let swallowedSettling = 0;

function argsCarryException(args: readonly unknown[]): boolean {
  const n = Math.min(args.length, SWALLOWED_ARG_SCAN_MAX);
  for (let i = 0; i < n; i++) {
    const a = args[i];
    if (a instanceof Error) return true;
    if (a !== null && typeof a === "object") {
      if (Object.prototype.toString.call(a) === "[object Error]") return true;
    } else if (
      typeof a === "string" &&
      SWALLOWED_STACK_FRAME_RE.test(a.slice(0, SWALLOWED_TEXT_SCAN_MAX))
    ) {
      return true;
    }
  }
  return false;
}

function noteSwallowed(args: readonly unknown[]): void {
  if (!argsCarryException(args)) return;
  swallowed += 1;
  const now = Date.now();
  if (!isSettledAt("startupEvent", now)) {
    swallowedSettling += 1;
    return;
  }
  swallowedTs.push(now);
  if (swallowedTs.length > SWALLOWED_RING_CAP) swallowedTs.shift();
}

function readSwallowedErrors(): AxisValue | null {
  if (!consoleInstalled) return null;
  const now = Date.now();
  if (isSettling("startupEvent", now)) {
    // Start-up rule (startupEvent): nothing logged while the isolate starts is
    // judged, and the reading says it is settling rather than going silent.
    return settlingReading({ score: null });
  }
  const from = Math.max(now - SWALLOWED_WINDOW_MS, settledFromMs("startupEvent"));
  const windowMs = Math.max(0, now - from);
  const windowMin = Math.round((windowMs / 60_000) * 100) / 100;
  let count = 0;
  for (const t of swallowedTs) if (t >= from) count++;
  if (windowMs < SWALLOWED_MIN_WINDOW_MS) {
    return markSettled({
      score: null,
      rating: "pending" as AxisRating,
      count,
      perHour: null,
      windowMin,
    });
  }
  const perHour = Math.round(((count * 3_600_000) / windowMs) * 10) / 10;
  const score = linearScore(perHour, SWALLOWED_GOOD_PER_HOUR, SWALLOWED_POOR_PER_HOUR);
  // Counts only: the server writes the words for this reading (a kit-written
  // caption was deleted at ingest, so it never reached a reader).
  return markSettled({
    score,
    rating: sharedRatingFor(score),
    count,
    perHour,
    windowMin,
  });
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function ratingFor(score: number): AxisRating {
  return score >= 80 ? "good" : score >= 50 ? "needs-work" : "poor";
}

function windowMin(): number {
  return Math.round((invocationMs / 60_000) * 100) / 100;
}

function rateAxis(count: number, poorPerHour: number): AxisValue {
  const base = { count, windowMin: windowMin(), perHour: null as number | null };
  if (invocationMs < RATE_WINDOW_MS) {
    return { score: null, rating: "pending", ...base };
  }
  const perHour = Math.round(((count * 3_600_000) / invocationMs) * 10) / 10;
  const score = clamp(100 - (perHour / poorPerHour) * 100);
  return { score, rating: ratingFor(score), ...base, perHour };
}

function installConsoleObserver(): void {
  // Still in the chain from before a stop: it simply resumes, rather than a
  // second watch wrapping the first.
  if (consoleInstalled) {
    consoleStandingDown = false;
    return;
  }
  safeVoid(() => {
    if (typeof console?.error !== "function") return;
    rawConsoleError = console.error;
    originalConsoleError = console.error.bind(console);
    const wrapper = (...args: unknown[]): void => {
      if (!consoleStandingDown && inFlight > 0) safeVoid(() => noteSwallowed(args));
      originalConsoleError?.(...args);
    };
    console.error = wrapper;
    consoleWrapper = wrapper;
    consoleStandingDown = false;
    consoleInstalled = true;
  });
}

/**
 * THE LOCK RULE (docs/kit-lock-rule.md): take the watch off the app's error
 * log and throw away every request reading this isolate holds.
 *
 * The original goes back only while our watch is still the one on top.
 * Something that wrapped `console.error` after us holds a reference to ours,
 * and putting the original back under it would take that wrapper away too; so
 * ours stays in that chain, forwarding every line untouched and noting
 * nothing. Never throws.
 */
export function unhookRequestMeters(): void {
  safeVoid(() => {
    if (!consoleInstalled) return;
    if (console.error === consoleWrapper) {
      console.error = rawConsoleError as typeof console.error;
      consoleInstalled = false;
      consoleWrapper = null;
      originalConsoleError = null;
      rawConsoleError = null;
      consoleStandingDown = false;
    } else {
      consoleStandingDown = true;
    }
  });
  clearRequestMeters();
}

/** Every request reading this isolate holds, gone. A request still running
 *  when this runs records nothing when it ends (index.ts checks the held-data
 *  generation), so the in-flight count starts again from zero with it. */
export function clearRequestMeters(): void {
  inFlight = 0;
  peakInFlight = 0;
  settledPeakInFlight = 0;
  latencySettlingRequests = 0;
  routeRequestsSeen.clear();
  swallowedTs.length = 0;
  swallowedSettling = 0;
  invocationMs = 0;
  crashes = 0;
  unhandled = 0;
  swallowed = 0;
  loadSamples.length = 0;
  activePeriodStart = 0;
  nextLatencyBoundary = 0;
  latencySamples = [];
  latencyWorst = 0;
  latencyWindows = 0;
  requestRuns = 0;
  requestObserved = 0;
  requestFailed = 0;
  requestUntracked = 0;
  requestParts.clear();
  requestDurations.length = 0;
}

export function beginInvocation(now: number): InvocationToken {
  // The isolate's clock starts at its first request, read INSIDE it (some
  // hosts report the epoch at module scope).
  safeVoid(() => noteIsolateClock());
  installConsoleObserver();
  inFlight += 1;
  if (inFlight > peakInFlight) peakInFlight = inFlight;
  if (inFlight === 1) {
    activePeriodStart = now;
    nextLatencyBoundary = now + LATENCY_WINDOW_MS;
    latencySamples = [];
  }
  return { inFlight };
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return Math.round(sorted[i] ?? 0);
}

/**
 * Close one invocation. `declared` is a request to a route the developer
 * declared as waiting on purpose (declaredWaits.ts): it is counted — a run, a
 * route part, a failure and a crash like any other, and its in-flight bracket
 * still closes here — but its duration is the wait it was declared for, so it
 * reaches no speed reading (resilience, latency floor, load deflection) and no
 * rate window either: twenty-five seconds of waiting on purpose would
 * otherwise dilute the crash and unhandled-error rates of everything else.
 */
export function endInvocation(
  token: InvocationToken,
  endedAt: number,
  durationMs: number,
  threw: boolean,
  status = threw ? 500 : 200,
  label: string | null = null,
  declared = false,
): void {
  const duration = Math.max(0, Number.isFinite(durationMs) ? durationMs : 0);
  if (!declared) invocationMs += duration;
  requestRuns += 1;
  if (label === null) {
    requestUntracked += 1;
  } else if (requestParts.has(label) || requestParts.size < 60) {
    requestParts.add(label);
    requestObserved += 1;
    if (status >= 500) requestFailed += 1;
  } else {
    requestUntracked += 1;
  }
  if (threw) {
    crashes += 1;
    unhandled += 1;
  }
  // A declared wait files no sample of any kind — not settled, not settling —
  // but its end closes the latency windows it spanned like any other request's,
  // since the bracket it held open is real.
  let tailSettled = false;
  if (!declared) {
    // The start-up rule (latencyTail): a request that started inside the
    // settle period, or the first of its route, carries set-up and is never
    // judged.
    const startedEpochMs = Date.now() - duration;
    const routeKey = label ?? "";
    const seenBefore = routeRequestsSeen.get(routeKey) ?? 0;
    if (seenBefore > 0 || routeRequestsSeen.size < ROUTE_SEEN_CAP) {
      routeRequestsSeen.set(routeKey, seenBefore + 1);
    }
    tailSettled =
      seenBefore >= SETTLE_FAMILIES.latencyTail.skipFirstRequests &&
      isSettledAt("latencyTail", startedEpochMs);
    if (tailSettled) {
      requestDurations.push(duration);
      if (requestDurations.length > 12_000) requestDurations.shift();
      loadSamples.push({ inFlight: token.inFlight, durationMs: duration });
      if (loadSamples.length > 256) loadSamples.shift();
      if (token.inFlight > settledPeakInFlight) settledPeakInFlight = token.inFlight;
    } else {
      latencySettlingRequests += 1;
    }
  }

  if (tailSettled) latencySamples.push({ at: endedAt, durationMs: duration });
  while (nextLatencyBoundary > activePeriodStart && endedAt >= nextLatencyBoundary) {
    const from = nextLatencyBoundary - LATENCY_WINDOW_MS;
    const values = latencySamples
      .filter((s) => s.at > from && s.at <= nextLatencyBoundary)
      .map((s) => s.durationMs);
    // A window's p95 from fewer than the family's floor is its slowest
    // request, and a cold one at that: such a window is not judged.
    if (values.length >= SETTLE_FAMILIES.latencyTail.minSamples) {
      latencyWorst = Math.max(latencyWorst, percentile(values, 0.95));
      latencyWindows += 1;
    }
    latencySamples = latencySamples.filter((s) => s.at > nextLatencyBoundary);
    nextLatencyBoundary += LATENCY_WINDOW_MS;
  }
  inFlight = Math.max(0, inFlight - 1);
  if (inFlight === 0) latencySamples = [];
}

export function readRequestAxes(
  _collector: CollectorState,
  outbound: EdgeOutboundRequestStats,
  // Which isolate host this is rides on the snapshot's own `platform` field,
  // a closed word ingest keeps. No reading repeats it: the function family's
  // `hostKind` slot is a numeric CODE on the server, so a host NAME sent there
  // was deleted at ingest on every upload.
  _platform: string,
): Record<string, AxisValue> {
  const axes: Record<string, AxisValue> = {};

  if (requestParts.size > 0 || requestUntracked > 0) {
    axes.routeFailures = {
      score: null,
      rating: "not-scored",
      parts: requestParts.size,
      observed: requestObserved,
      failed: requestFailed,
      untracked: requestUntracked,
    };
  }

  axes.timeoutHeadroom = {
    score: null,
    rating: "pending",
    measurable: 0,
    reasonCode: PLATFORM_DOES_NOT_EXPOSE,
    runs: requestRuns,
  };
  // The reason is the CODE; the server writes the sentence for it. A
  // kit-written caption was deleted at ingest, so it never reached a reader.
  axes.liveConnections = {
    score: null,
    rating: "pending",
    measurable: 0,
    reasonCode: PLATFORM_DOES_NOT_EXPOSE,
    flowMeasurable: 0,
  };

  // The same four fields every other kit's crash reading carries. A per-hour
  // projection is the server's to derive (and to withhold over a short window);
  // the one this kit used to send was deleted at ingest.
  const crash = rateAxis(crashes, 3);
  axes.crashFree = {
    score: crash.score,
    rating: crash.rating,
    crashes,
    windowMin: crash.windowMin,
  };
  axes.unhandledErrors = rateAxis(unhandled, 5);
  const swallowedAxis = readSwallowedErrors();
  if (swallowedAxis) axes.swallowedErrors = swallowedAxis;
  for (const key of ["promiseRejections", "rejectionPressure"] as const) {
    axes[key] = {
      score: null,
      rating: "pending",
      measurable: 0,
      reasonCode: PLATFORM_DOES_NOT_EXPOSE,
      ...(key === "promiseRejections"
        ? { count: 0, windowMin: windowMin(), perHour: null }
        : { lateHandled: 0, unhandled: 0, perHour: null }),
    };
  }

  const durations = requestDurations;
  if (durations.length > 0) {
    const p50Ms = percentile(durations, 0.5);
    const p99Ms = percentile(durations, 0.99);
    const tail = readResilienceTail(p50Ms, p99Ms, durations.length);
    const seen = { p50Ms, p99Ms, sampleCount: durations.length };
    const round1 = (n: number): number => Math.round(n * 10) / 10;
    if (tail.state === "flat") {
      // Every request finished inside the absolute floor. There is no tail
      // problem to report whatever the ratio works out at, and the ratio is
      // still shown when the median was large enough to compute one.
      axes.resilience = markSettled({
        score: 100,
        rating: "good",
        tailRatio: tail.ratio === null ? null : round1(tail.ratio),
        ...seen,
      });
    } else if (tail.state === "unmeasurable") {
      // A real tail, but the median is under the capture resolution, so the
      // ratio would be an artefact of rounding rather than a reading.
      axes.resilience = markSettled({
        score: null,
        rating: "pending",
        tailRatio: null,
        ...seen,
      });
    } else if (tail.state === "rated") {
      const tailRatio = round1(tail.ratio);
      axes.resilience = markSettled({
        score: clamp(100 - ((tailRatio - 3) / 17) * 100),
        rating: tailRatio <= 3 ? "good" : tailRatio >= 20 ? "poor" : "needs-work",
        tailRatio,
        ...seen,
      });
    }
    // "insufficient" publishes nothing at all: below
    // RESILIENCE_MIN_TAIL_SAMPLES a p99 is just the slowest of a handful.
  }
  if (!axes.resilience && latencySettlingRequests > 0 && isSettling("latencyTail")) {
    axes.resilience = settlingReading({ score: null });
  }
  // Every request the window saw was a route declared as waiting on purpose
  // (declaredWaits.ts): there is nothing to judge, and the reading still goes,
  // with no score and no samples, so the server can say "nothing judged"
  // beside the kept-out counts rather than showing nothing at all.
  if (!axes.resilience && requestDurations.length === 0 && declaredRoutesKeptOut() > 0) {
    axes.resilience = {
      score: null,
      rating: "pending",
      tailRatio: null,
      p50Ms: null,
      p99Ms: null,
      sampleCount: 0,
    };
  }

  if (latencyWindows > 0) {
    const score = clamp(100 - ((latencyWorst - 500) / 1000) * 100);
    axes.latencyFloor = markSettled({
      score,
      rating: latencyWorst <= 500 ? "good" : latencyWorst >= 1500 ? "poor" : "needs-work",
      worstMs: Math.round(latencyWorst),
      windowCount: latencyWindows,
    });
  } else if (latencySettlingRequests > 0 && isSettling("latencyTail")) {
    axes.latencyFloor = settlingReading({ score: null });
  }

  const bucket = (n: number): number => (n <= 1 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : 3);
  const buckets = [[], [], [], []] as number[][];
  for (const sample of loadSamples) buckets[bucket(sample.inFlight)]!.push(sample.durationMs);
  const eligible = buckets
    .map((values, index) => ({ values, index }))
    .filter((b) => b.values.length >= SETTLE_FAMILIES.latencyTail.minSamples);
  if (
    loadSamples.length >= SETTLE_FAMILIES.latencyTail.minSamples &&
    settledPeakInFlight >= 2 &&
    eligible.length >= 2
  ) {
    const low = eligible[0]!;
    const high = eligible[eligible.length - 1]!;
    const lowMs = percentile(low.values, 0.75);
    const highMs = percentile(high.values, 0.75);
    if (lowMs > 0) {
      const ratio = Math.round((highMs / lowMs) * 100) / 100;
      // Shared decision (loadDeflection): a busy-period p75 at or under the
      // absolute floor is fast whatever the ratio; the ratio still rides.
      const fastWhenBusy = highMs <= LOAD_DEFLECTION_FAST_P75_MS;
      const score = fastWhenBusy ? 100 : clamp(100 - ((ratio - 1.2) / 2.8) * 100);
      const solo = loadSamples.filter((s) => s.inFlight === 1);
      const loaded = loadSamples.filter((s) => s.inFlight >= 2);
      let deflectionMsPerReq: number | null = null;
      if (solo.length > 0 && loaded.length >= 10) {
        const n = loadSamples.length;
        const sx = loadSamples.reduce((s, v) => s + v.inFlight, 0);
        const sy = loadSamples.reduce((s, v) => s + v.durationMs, 0);
        const sxy = loadSamples.reduce((s, v) => s + v.inFlight * v.durationMs, 0);
        const sx2 = loadSamples.reduce((s, v) => s + v.inFlight * v.inFlight, 0);
        const denominator = n * sx2 - sx * sx;
        if (denominator > 0) {
          deflectionMsPerReq = Math.round(Math.max(0, (n * sxy - sx * sy) / denominator));
        }
      }
      axes.loadDeflection = markSettled({
        score,
        rating: fastWhenBusy || ratio <= 1.5 ? "good" : ratio >= 3 ? "poor" : "needs-work",
        peakInFlight: settledPeakInFlight,
        meanInFlight:
          Math.round(
            (loadSamples.reduce((sum, sample) => sum + sample.inFlight, 0) /
              loadSamples.length) *
              10,
          ) / 10,
        samples: loadSamples.length,
        lowMs,
        highMs,
        soloMeanMs:
          solo.length === 0
            ? null
            : Math.round(solo.reduce((sum, sample) => sum + sample.durationMs, 0) / solo.length),
        deflectionMsPerReq,
        ratio,
        strainAtInFlight: highMs > 1500 ? high.index === 0 ? 1 : 2 ** high.index : null,
      });
    }
  }
  if (!axes.loadDeflection && peakInFlight >= 2 && latencySettlingRequests > 0 && isSettling("latencyTail")) {
    axes.loadDeflection = settlingReading({ score: null });
  }

  // Shared decision (repeatedWork): identical work repeated within SETTLED
  // requests (the identity carries the query and a body fingerprint, so two
  // different operations are never one), scored as every kit scores it — the
  // worse of the redundant time share and the worst repeat burst.
  if (outbound.watchedRequests >= REPEATED_WORK_MIN_REQUESTS) {
    const pct =
      outbound.watchedRequestMs > 0
        ? (outbound.redundantMs / outbound.watchedRequestMs) * 100
        : 0;
    const repeatTimePct = Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
    const worst = Math.max(1, Math.round(outbound.worstRepeats));
    const score = Math.min(
      linearScore(repeatTimePct, REPEATED_WORK_TIME_PCT_THRESHOLDS.good, REPEATED_WORK_TIME_PCT_THRESHOLDS.poor),
      linearScore(worst, REPEATED_WORK_BURST_THRESHOLDS.good, REPEATED_WORK_BURST_THRESHOLDS.poor),
    );
    // The four fields the server kit sends and ingest keeps; the two
    // millisecond totals behind the share stay in-kit (sent, they were
    // deleted at ingest on every upload).
    axes.repeatedWork = markSettled({
      score,
      rating: sharedRatingFor(score),
      watchedRequests: outbound.watchedRequests,
      requestsWithRepeat: outbound.requestsWithRepeat,
      worstRepeats: worst,
      repeatTimePct,
    });
  } else if ((outbound.repeatSettlingRequests ?? 0) > 0 && isSettling("startupEvent")) {
    axes.repeatedWork = settlingReading({ score: null });
  } else if (outbound.watchedRequests > 0) {
    axes.repeatedWork = markSettled({
      score: null,
      rating: "pending",
      worstRepeats: null,
      requestsWithRepeat: outbound.requestsWithRepeat,
      watchedRequests: outbound.watchedRequests,
      repeatTimePct: 0,
    });
  }

  if (outbound.containment.watchedRequests > 0) {
    const denominator = outbound.containment.collapsed + outbound.containment.contained;
    const collapsePct =
      denominator >= 3
        ? Math.round((outbound.containment.collapsed / denominator) * 1000) / 10
        : null;
    const score =
      collapsePct === null ? null : clamp(100 - (collapsePct / 50) * 100);
    axes.failureContainment = {
      measurable: 1,
      collapsedCount: outbound.containment.collapsed,
      containedCount: outbound.containment.contained,
      allFailedCount: outbound.containment.allFailed,
      unattributedCount: outbound.containment.unattributed,
      watchedRequests: outbound.containment.watchedRequests,
      collapsePct,
      score,
      rating: score === null ? "pending" : ratingFor(score),
      ...(score === null ? { reasonCode: NOTHING_TO_COMPARE } : {}),
    };
  }

  // Start-up rule (startupEvent): the counters hold only verdicts given after
  // the settle period — every first request misses — and a share is judged
  // from the family's floor of verdicts, never from five.
  if (
    outbound.cache &&
    outbound.cache.hits + outbound.cache.misses + outbound.cache.stale >= UPSTREAM_CACHE_MIN_VERDICTS
  ) {
    const cacheable = outbound.cache.hits + outbound.cache.misses + outbound.cache.stale;
    const hitPct = Math.round(((outbound.cache.hits + outbound.cache.stale) / cacheable) * 100);
    const score = clamp(((hitPct - 40) / 50) * 100);
    axes.upstreamCache = markSettled({
      score,
      rating: hitPct >= 90 ? "good" : hitPct <= 40 ? "poor" : "needs-work",
      hitPct,
      checked: cacheable + outbound.cache.bypass,
      ...outbound.cache,
    });
  } else if ((outbound.cacheSettling ?? 0) > 0 && isSettling("startupEvent")) {
    axes.upstreamCache = settlingReading({ score: null });
  }

  return axes;
}

export function _resetRequestMetersForTests(): void {
  clearRequestMeters();
  if (consoleInstalled && rawConsoleError) {
    console.error = rawConsoleError as typeof console.error;
  }
  consoleInstalled = false;
  originalConsoleError = null;
  rawConsoleError = null;
  consoleWrapper = null;
  consoleStandingDown = false;
}