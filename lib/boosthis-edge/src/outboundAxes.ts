/** Scoring the readings an isolate can only get by watching its fetch.
 *
 * Ports of the server kit's `computeAiCalls`, `computeAiSpend`,
 * `computeAiHeadroom` and `computeDbWork` — same thresholds, same field names,
 * same three outcomes (absent / measurable 0 / measurable 1), so one dashboard
 * renders an edge project's AI and database readings with no special case and
 * one number means the same thing wherever the app runs. A guard compares the
 * numbers in this file against the server kit's.
 *
 * This kit carries its own copy for the reason every other table here is
 * copied: it declares no dependencies and must load inside an isolate.
 *
 * ADDITIVE + DISPLAY-ONLY, exactly as on the server kits: none of these
 * readings feeds the composite Speed score.
 */

import type { AxisRating, AxisValue } from "./axes";
import { AI_PRICE_TABLE_DAY } from "./aiUsage";
import type { EdgeAiStats, EdgeDbStats, EdgeDependencyStats } from "./outbound";
import { SETTLE_RULE, isSettling, markSettled, settlingReading } from "./settleRule";

/** Watched requests needed before a reading leaves "pending". Below this a
 *  single unlucky request would define the whole thing. Mirrors the shared
 *  MIN_SAMPLES_FOR_AXES gate on every other kit. */
export const MIN_REQUESTS_FOR_OUTBOUND_AXES = 5;

/* Start-up rule floors and the shared decisions' absolute floors
 * (docs/settle-rule-decisions.md). Copies of the server kit's own constants,
 * held to them by the edge parity guard. */
/** Settled requests a database share (and its sequencing) is judged from. */
export const DB_WORK_MIN_REQUESTS = 20;
/** Settled requests a dependency share is judged from. */
export const DEPENDENCY_MIN_REQUESTS = 20;
/** Database wait per settled request at or under which the share is not a
 *  fault: a fast database-backed endpoint is mostly database by design. */
export const DB_WAIT_MS_PER_REQUEST_FLOOR = 100;
/** The same absolute floor for waiting on outside services. */
export const DEP_WAIT_MS_PER_REQUEST_FLOOR = 100;
/** Settled streams (never a provider's first) before first words are judged. */
export const AI_TTFT_MIN_STREAMS = 5;
/** Settled headroom reads before the typical headroom is graded. */
export const AI_HEADROOM_MIN_READS = 3;

/** Share of watched request time spent waiting on the database. */
export const DB_WAIT_PCT_THRESHOLDS = { good: 20, poor: 70 } as const;
/** Identical statements inside ONE request. 1 is the honest floor. */
export const DB_REPEAT_BURST_THRESHOLDS = { good: 1, poor: 10 } as const;
/** Round-trip waves in one request. */
export const DB_WAVE_BURST_THRESHOLDS = { good: 2, poor: 10 } as const;
/** The point a single query's result set is called unbounded. */
export const DB_LARGE_RESULT_ROWS = 1000;
/** Share of AI calls that delivered nothing. Good at none, poor at 1 in 10. */
export const AI_FAIL_PCT_THRESHOLDS = { good: 0, poor: 10 } as const;
/** Time to the first words of a streamed answer. */
export const AI_TTFT_MS_THRESHOLDS = { good: 1000, poor: 8000 } as const;
/** Share of AI calls whose usage was never reported. */
export const AI_USAGE_MISSING_PCT_THRESHOLDS = { good: 0, poor: 50 } as const;
/** Identical prompts inside ONE request. 1 is the honest floor. */
export const AI_PROMPT_REPEAT_THRESHOLDS = { good: 1, poor: 4 } as const;
/** Remaining share of the provider's window. Good with 40% left, poor at 5%. */
export const AI_HEADROOM_PCT_THRESHOLDS = { good: 40, poor: 5 } as const;

export const DEP_WAIT_PCT_THRESHOLDS = { good: 25, poor: 75 } as const;
/**
 * An axis band whose two constants are the wrong way round.
 *
 * A band is a pair of CONSTANTS in our own source: `good` is the value at or
 * below which a reading scores 100, `poor` the value at or above which it
 * scores 0. `good` below `poor` is what makes the interpolation mean
 * anything, so a pair that is equal or reversed is a typo in the kit — never
 * something a customer's worker did.
 *
 * This used to answer 100, so a meter wired backwards reported perfect health
 * on every install for ever and nothing complained. Every runtime refuses
 * now, with the same words.
 *
 * The throw is the BACKSTOP, not the guard. scripts' axis-band-inversion gate
 * reads the declared constants out of every shipped kit and fails the release
 * before an inverted pair can reach anybody.
 */
export class InvertedAxisBandError extends Error {
  readonly good: number;
  readonly poor: number;
  constructor(good: number, poor: number) {
    super(`${INVERTED_BAND_MESSAGE} (good=${good}, poor=${poor})`);
    this.name = "InvertedAxisBandError";
    this.good = good;
    this.poor = poor;
  }
}

/** The leading words every runtime uses when it refuses an inverted band, so
 *  the same mistake is recognisable whichever kit reported it. */
export const INVERTED_BAND_MESSAGE =
  "boosthis: inverted axis band, good must be below poor";

/** Linear 0..100 score for a "lower is better" metric. Byte-for-byte the
 *  server kits' `linearScore`, so an identical reading scores identically —
 *  including the refusal on a misconfigured band (poor <= good, or either end
 *  not a finite number). See {@link InvertedAxisBandError}. */
export function linearScore(value: number, good: number, poor: number): number {
  if (!Number.isFinite(good) || !Number.isFinite(poor) || poor <= good) {
    throw new InvertedAxisBandError(good, poor);
  }
  if (value <= good) return 100;
  if (value >= poor) return 0;
  return Math.round((100 * (poor - value)) / (poor - good));
}

/** The shared score bands. Same numbers as every other kit. */
export function ratingFor(score: number): AxisRating {
  if (score >= 85) return "good";
  if (score >= 60) return "needs-work";
  return "poor";
}

function pctOf(ms: number, ofMs: number): number {
  const raw = ofMs > 0 ? (ms / ofMs) * 100 : 0;
  return Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
}

/** Outside services, over the wall time of requests that called one.
 *
 * Isolates cannot inspect a module cache, so inAppSignin is deliberately
 * absent from both pending and measured output: absence is the contract's
 * "cannot tell" state for that specific slot, never a fabricated zero.
 */
export function computeDependencies(stats: EdgeDependencyStats): AxisValue | null {
  if (!stats) return null;
  // The calls declared as waiting on purpose (declaredWaits.ts): four counts
  // on every reading this sends — zeros when nothing is declared, never absent.
  const declared = stats.declared ?? null;
  if (stats.callCount <= 0) {
    // Every call this window made was declared, so none was judged. The
    // reading still goes, with its counts and no verdict, so the page can say
    // "nothing judged" rather than nothing at all — and never "good".
    if (declared === null || declared.waitDeclaredExcluded <= 0) return null;
    return {
      score: null,
      rating: "pending",
      measurable: 0,
      waitPct: null,
      dbPct: null,
      aiPct: null,
      selfPct: null,
      failPct: null,
      callCount: 0,
      watchedRequests: Math.max(0, Math.round(stats.watchedRequests)),
      failCount: 0,
      timeoutCount: 0,
      p75Ms: 0,
      worstMs: 0,
      kindCount: 0,
      flakyKinds: 0,
      unknownCalls: 0,
      signinCalls: 0,
      signinP75Ms: null,
      signinFailed: 0,
      groups: [],
      ...declared,
    };
  }
  // The same eight per-kind fields every other kit's groups carry, and exactly
  // the eight ingest keeps. `ok` stays in-kit, where it has already decided
  // `flaky`; sent, it was deleted at ingest on every upload.
  const groups = stats.groups.map((group) => ({
    kind: group.kind,
    calls: group.calls,
    failed: group.failed,
    timedOut: group.timedOut,
    couldNotConnect: group.couldNotConnect,
    noAnswer: group.noAnswer,
    turnedAway: group.turnedAway,
    tooManyRequests: group.tooManyRequests,
    serverError: group.serverError,
    cancelled: group.cancelled,
    ...(group.services?.length ? { services: group.services } : {}),
    requests: group.requests,
    p75Ms: group.p75Ms,
    worstMs: group.worstMs,
    flaky: group.flaky,
  }));
  let failCount = 0;
  let timeoutCount = 0;
  let p75Ms = 0;
  let worstMs = 0;
  let flakyKinds = 0;
  let unknownCalls = 0;
  let signinCalls = 0;
  let signinP75Ms: number | null = null;
  let signinFailed = 0;
  for (const group of groups) {
    failCount += group.failed;
    timeoutCount += group.timedOut;
    p75Ms = Math.max(p75Ms, group.p75Ms);
    worstMs = Math.max(worstMs, group.worstMs);
    if (group.flaky === 1) flakyKinds += 1;
    if (group.kind === "other") unknownCalls += group.calls;
    if (group.kind === "signin") {
      signinCalls = group.calls;
      signinP75Ms = group.p75Ms;
      signinFailed = group.failed + group.timedOut;
    }
  }
  const counts = {
    callCount: Math.max(0, Math.round(stats.callCount)),
    watchedRequests: Math.max(0, Math.round(stats.watchedRequests)),
    failCount,
    timeoutCount,
    p75Ms: Math.round(p75Ms),
    worstMs: Math.round(worstMs),
    kindCount: groups.length,
    flakyKinds,
    unknownCalls,
    signinCalls,
    signinP75Ms,
    signinFailed,
    groups,
    ...(declared ?? {}),
  };
  if (stats.watchedRequests < DEPENDENCY_MIN_REQUESTS) {
    // Start-up rule (latencyTail): while the isolate settles, the requests
    // set aside are why there is no verdict yet, and the reading says so.
    if ((stats.settlingRequests ?? 0) > 0 && isSettling("latencyTail")) {
      return settlingReading({ score: null, ...counts });
    }
    return {
      score: null,
      rating: "pending",
      measurable: 0,
      waitPct: null,
      dbPct: null,
      aiPct: null,
      selfPct: null,
      failPct: null,
      ...counts,
    };
  }
  const waitPct = pctOf(stats.depMs, stats.watchedRequestMs);
  const dbPct = pctOf(stats.dbMs, stats.watchedRequestMs);
  const aiPct = pctOf(stats.aiMs, stats.watchedRequestMs);
  const selfPct = Math.max(
    0,
    Math.round((100 - waitPct - dbPct - aiPct) * 10) / 10,
  );
  const failPct =
    counts.callCount > 0
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round(((failCount + timeoutCount) / counts.callCount) * 1000) /
              10,
          ),
        )
      : 0;
  // Shared decision (dependencies): a settled request that waits no more than
  // the absolute floor is fast, whatever share of it the waiting is.
  const waitMsPerRequest =
    Math.round((stats.depMs / Math.max(1, stats.watchedRequests)) * 10) / 10;
  const score = Math.min(
    waitMsPerRequest <= DEP_WAIT_MS_PER_REQUEST_FLOOR
      ? 100
      : linearScore(waitPct, DEP_WAIT_PCT_THRESHOLDS.good, DEP_WAIT_PCT_THRESHOLDS.poor),
    linearScore(failPct, DEP_FAIL_PCT_THRESHOLDS.good, DEP_FAIL_PCT_THRESHOLDS.poor),
  );
  return markSettled({
    score,
    rating: ratingFor(score),
    measurable: 1,
    waitMsPerRequest,
    waitPct,
    dbPct,
    aiPct,
    selfPct,
    failPct,
    ...counts,
  });
}
/**
 * How much of a request goes on database work, and how much of that was the
 * same statement run twice.
 *
 * THREE OUTCOMES, the same three every kit uses:
 *   • null — too few watched requests, or none at all. The axis is absent from
 *     the snapshot, which every surface reads as "cannot tell". An app with no
 *     database and a runtime with no reading look the same, and neither looks
 *     like a measured zero.
 *   • measurable 0 — too few watched requests to score, but a blind spot the
 *     reader must be told about. An isolate has no such blind spot: there is
 *     no driver here to load and no socket to miss, so this outcome cannot
 *     arise from an isolate and is kept only so the shape stays one shape.
 *   • measurable 1 — a real reading.
 *
 * WHAT THIS READING IS NOT. It is every database call the app made OVER HTTP,
 * which in an isolate is every database call it could possibly make — but a
 * project that also talks to a database from somewhere else is not covered by
 * it. The dashboard says that in words beside the number rather than letting a
 * partial view read as the whole.
 */
export function computeDbWork(stats: EdgeDbStats): AxisValue | null {
  if (!stats) return null;
  const unwatchedClients = Math.max(0, Math.round(stats.unwatchedClients ?? 0));
  if (stats.watchedRequests < DB_WORK_MIN_REQUESTS) {
    // Start-up rule (latencyTail): the first database request pays for the
    // connection; while the isolate settles the reading says so.
    if ((stats.settlingRequests ?? 0) > 0 && isSettling("latencyTail")) {
      return settlingReading({
        score: null,
        waitPct: 0,
        callCount: stats.callCount ?? 0,
        watchedRequests: stats.watchedRequests ?? 0,
        hostedCalls: stats.hostedCalls ?? 0,
        unwatchedClients,
      });
    }
    if (unwatchedClients === 0) return null;
    return {
      score: null,
      rating: "pending",
      measurable: 0,
      waitPct: 0,
      callCount: stats.callCount ?? 0,
      watchedRequests: stats.watchedRequests ?? 0,
      hostedCalls: stats.hostedCalls ?? 0,
      repeatWorst: null,
      repeatRequests: stats.repeatRequests ?? 0,
      repeatWastePct: 0,
      rowsWorst: null,
      unwatchedClients,
    };
  }
  const waitPct = pctOf(stats.dbMs, stats.watchedRequestMs);
  const repeatWastePct = pctOf(stats.repeatMs, stats.watchedRequestMs);
  // A watched request always made at least one database call, so the worst
  // repeat is at least 1 — "1" is the honest reading for an app that never ran
  // the same statement twice.
  const repeatWorst = Math.max(1, Math.round(stats.repeatWorst));
  // Shared decision (dbWork): database time per settled request at or under
  // the absolute floor is a fast database-backed endpoint, never a fault.
  const waitMsPerRequest =
    Math.round((stats.dbMs / Math.max(1, stats.watchedRequests)) * 10) / 10;
  const score = Math.min(
    waitMsPerRequest <= DB_WAIT_MS_PER_REQUEST_FLOOR
      ? 100
      : linearScore(
          waitPct,
          DB_WAIT_PCT_THRESHOLDS.good,
          DB_WAIT_PCT_THRESHOLDS.poor,
        ),
    linearScore(
      repeatWorst,
      DB_REPEAT_BURST_THRESHOLDS.good,
      DB_REPEAT_BURST_THRESHOLDS.poor,
    ),
  );
  return markSettled({
    score,
    rating: ratingFor(score),
    measurable: 1,
    waitMsPerRequest,
    waitPct,
    callCount: stats.callCount,
    watchedRequests: stats.watchedRequests,
    hostedCalls: stats.hostedCalls,
    dbFailed: stats.dbFailed ?? 0,
    dbCouldNotConnect: stats.dbCouldNotConnect ?? 0,
    dbNoAnswer: stats.dbNoAnswer ?? 0,
    dbTurnedAway: stats.dbTurnedAway ?? 0,
    dbTooManyRequests: stats.dbTooManyRequests ?? 0,
    dbServerError: stats.dbServerError ?? 0,
    dbTimedOut: stats.dbTimedOut ?? 0,
    dbCancelled: stats.dbCancelled ?? 0,
    repeatWorst,
    repeatRequests: stats.repeatRequests,
    repeatWastePct,
    // Deliberately outside the score, and absent unless a query really did
    // return an unbounded result. An isolate reads no database body at all, so
    // it never reports one.
    rowsWorst:
      typeof stats.rowsWorst === "number" &&
      stats.rowsWorst >= DB_LARGE_RESULT_ROWS
        ? Math.floor(stats.rowsWorst)
        : null,
    unwatchedClients,
  });
}

/** Whether database round trips ran together or waited in single file. */
export function computeDbSequencing(stats: EdgeDbStats): AxisValue | null {
  if (!stats) return null;
  const unwatchedClients = Math.max(0, Math.round(stats.unwatchedClients ?? 0));
  const judged = Math.max(0, Math.round(stats.waveRequests ?? 0));
  if (judged < DB_WORK_MIN_REQUESTS) {
    // Start-up rule (latencyTail): first-request schema and migration checks
    // run in single file by design; while the isolate settles, it says so.
    if ((stats.settlingRequests ?? 0) > 0 && isSettling("latencyTail")) {
      return settlingReading({ score: null, watchedRequests: judged, unwatchedClients });
    }
    if (unwatchedClients === 0) return null;
    return {
      score: null,
      rating: "pending",
      measurable: 0,
      wavesWorst: null,
      wavesAvg: 0,
      seriesPct: 0,
      watchedRequests: judged,
      unwatchedClients,
    };
  }
  const wavesWorst = Math.max(1, Math.round(stats.wavesWorst ?? 0));
  const wavesAvg = Math.round(((stats.wavesTotal ?? 0) / judged) * 10) / 10;
  const sumMs = stats.sumMs ?? 0;
  const spanMs = stats.spanMs ?? 0;
  const seriesPct =
    sumMs > 0
      ? Math.max(
          0,
          Math.min(100, Math.round((spanMs / sumMs) * 100)),
        )
      : 100;
  const score = linearScore(
    wavesWorst,
    DB_WAVE_BURST_THRESHOLDS.good,
    DB_WAVE_BURST_THRESHOLDS.poor,
  );
  return markSettled({
    score,
    rating: ratingFor(score),
    measurable: 1,
    wavesWorst,
    wavesAvg,
    seriesPct,
    watchedRequests: judged,
    unwatchedClients,
  });
}

/**
 * The shape of the AI wait: how long calls took, how long before the first
 * words of a streamed answer, and which of the failures that actually happen
 * to AI calls happened here.
 *
 * The share of a request spent on AI is REPORTED and never scored — waiting
 * for a model is the work the app exists to do. Failures are scored, and time
 * to first words is scored for streamed answers only.
 */
export function computeAiCalls(stats: EdgeAiStats): AxisValue | null {
  if (!stats) return null;
  const unwatchedClients = Math.max(0, Math.round(stats.unwatchedClients ?? 0));
  const ttftP75Ms =
    (stats.ttftSettledCount ?? 1) > 0
      ? Math.max(0, Math.round(stats.ttftP75Ms ?? 0))
      : 0;
  const base = {
    callCount: Math.max(0, Math.round(stats.callCount ?? 0)),
    watchedRequests: Math.max(0, Math.round(stats.watchedRequests ?? 0)),
    providerCount: Math.max(0, Math.round(stats.providerCount ?? 0)),
    topProvider: Math.max(0, Math.round(stats.topProvider ?? 0)),
    p75Ms: Math.max(0, Math.round(stats.p75Ms ?? 0)),
    worstMs: Math.max(0, Math.round(stats.worstMs ?? 0)),
    streamCount: Math.max(0, Math.round(stats.streamCount ?? 0)),
    // Only a first-words wait that was really timed: a settled stream. None
    // yet is no figure at all, never 0ms.
    ...(ttftP75Ms > 0 ? { ttftP75Ms } : {}),
    stallCount: Math.max(0, Math.round(stats.stallCount ?? 0)),
    failCount: Math.max(0, Math.round(stats.failCount ?? 0)),
    rateLimitedCount: Math.max(0, Math.round(stats.rateLimitedCount ?? 0)),
    quotaCount: Math.max(0, Math.round(stats.quotaCount ?? 0)),
    timeoutCount: Math.max(0, Math.round(stats.timeoutCount ?? 0)),
    truncatedCount: Math.max(0, Math.round(stats.truncatedCount ?? 0)),
    filteredCount: Math.max(0, Math.round(stats.filteredCount ?? 0)),
    serverMsP75: Math.max(0, Math.round(stats.serverMsP75 ?? 0)),
    serverMsCalls: Math.max(0, Math.round(stats.serverMsCalls ?? 0)),
    unwatchedClients,
    unclassifiedCalls: Math.max(0, Math.round(stats.unclassifiedCalls ?? 0)),
  };
  // No AI call has EVER been seen: this is not an app with a slow AI layer, it
  // is an app with no AI layer, and the honest answer is silence — UNLESS
  // AI-shaped traffic went somewhere this kit could not classify, which is the
  // one case where silence would be the wrong answer for the right reason.
  if (base.callCount === 0) {
    if (base.unclassifiedCalls === 0) return null;
    return markSettled({
      score: null,
      rating: "pending" as AxisRating,
      measurable: 0,
      waitPct: 0,
      ...base,
    });
  }
  if (base.watchedRequests < MIN_REQUESTS_FOR_OUTBOUND_AXES) {
    if (unwatchedClients === 0 && base.unclassifiedCalls === 0) return null;
    return markSettled({
      score: null,
      rating: "pending" as AxisRating,
      measurable: 0,
      waitPct: 0,
      ...base,
    });
  }
  const waitPct = pctOf(stats.aiMs, stats.watchedRequestMs);
  const failPct = base.callCount > 0 ? (base.failCount / base.callCount) * 100 : 0;
  const terms = [
    linearScore(
      failPct,
      AI_FAIL_PCT_THRESHOLDS.good,
      AI_FAIL_PCT_THRESHOLDS.poor,
    ),
  ];
  // Only judge the first-words wait where there were streamed answers to
  // judge. An app that never streams is not slow at streaming. Start-up rule
  // (latencyTail): only from AI_TTFT_MIN_STREAMS settled streams, never a
  // provider's first, which pays the handshake and the model's warm-up.
  if ((stats.ttftSettledCount ?? 0) >= AI_TTFT_MIN_STREAMS && ttftP75Ms > 0) {
    terms.push(
      linearScore(
        ttftP75Ms,
        AI_TTFT_MS_THRESHOLDS.good,
        AI_TTFT_MS_THRESHOLDS.poor,
      ),
    );
  }
  const score = Math.min(...terms);
  return markSettled({ score, rating: ratingFor(score), measurable: 1, waitPct, ...base });
}

/**
 * Tokens, cache and money.
 *
 * Scored on two things a developer can fix — usage the app was never told, and
 * the same prompt sent twice inside one request. Money is reported, never
 * graded: a big bill can be exactly right.
 */
export function computeAiSpend(stats: EdgeAiStats): AxisValue | null {
  if (!stats) return null;
  const calls = Math.max(0, Math.round(stats.callCount ?? 0));
  if (calls === 0) return null;
  const tokensIn = Math.max(0, Math.round(stats.tokensIn ?? 0));
  const tokensOut = Math.max(0, Math.round(stats.tokensOut ?? 0));
  const cachedIn = Math.max(0, Math.round(stats.cachedIn ?? 0));
  const usageMissingCalls = Math.max(0, Math.round(stats.usageMissingCalls ?? 0));
  const watchedRequests = Math.max(0, Math.round(stats.watchedRequests ?? 0));
  const costMicros = Math.max(0, Math.round(stats.costMicros ?? 0));
  const usageMissingPct = Math.round((usageMissingCalls / calls) * 100 * 10) / 10;
  const shape = {
    calls,
    tokensIn,
    tokensOut,
    cachedIn,
    // Never 0% for an app whose provider simply reported no input tokens —
    // that is "cannot tell", and a 0% cache hit rate is a very different (and
    // actionable) statement.
    cacheHitPct:
      tokensIn > 0
        ? Math.max(0, Math.min(100, Math.round((cachedIn / tokensIn) * 1000) / 10))
        : null,
    costMicros,
    reportedCostCalls: Math.max(0, Math.round(stats.reportedCostCalls ?? 0)),
    pricedCalls: Math.max(0, Math.round(stats.pricedCalls ?? 0)),
    unpricedCalls: Math.max(0, Math.round(stats.unpricedCalls ?? 0)),
    declaredCalls: Math.max(0, Math.round(stats.declaredCalls ?? 0)),
    // A subset of `unpricedCalls`, and the surfaces subtract one from the
    // other to tell a gap from an abstention. Sanitised independently the two
    // can contradict each other and the subtraction goes negative, so the
    // invariant is enforced where the numbers leave.
    declaredUnpricedCalls: Math.min(
      Math.max(0, Math.round(stats.unpricedCalls ?? 0)),
      Math.max(0, Math.round(stats.declaredUnpricedCalls ?? 0)),
    ),
    costPerRequestMicros:
      watchedRequests > 0 ? Math.round(costMicros / watchedRequests) : 0,
    worstRequestCostMicros: Math.max(
      0,
      Math.round(stats.worstRequestCostMicros ?? 0),
    ),
    windowMs: Math.max(0, Math.round(stats.windowMs ?? 0)),
    usageMissingCalls,
    usageMissingPct,
    streamUsageMissingCalls: Math.max(
      0,
      Math.round(stats.streamUsageMissingCalls ?? 0),
    ),
    repeatRequests: Math.max(0, Math.round(stats.promptRepeatRequests ?? 0)),
    // The price table's publication date, so no surface can show an estimate
    // without being able to show its age.
    priceTableDay: Math.round(AI_PRICE_TABLE_DAY),
  };
  if (watchedRequests < MIN_REQUESTS_FOR_OUTBOUND_AXES) {
    return markSettled({
      score: null,
      rating: "pending" as AxisRating,
      measurable: 0,
      repeatWorst: null,
      ...shape,
    });
  }
  const repeatWorst = Math.max(1, Math.round(stats.promptRepeatWorst ?? 0));
  // The shared decision (docs/settle-rule-decisions.md, aiSpend): spend has no
  // universal yardstick (a price is right or wrong only against the owner's
  // own budget), and a repeated prompt is not spend. Every number rides;
  // nothing is graded, in every kit that carries the meter.
  return markSettled({
    score: null,
    rating: "not-scored" as AxisRating,
    measurable: 1,
    repeatWorst,
    ...shape,
  });
}

/**
 * How close this project is to its provider's published limits.
 *
 * Free to collect — the providers publish it on every reply — and honest by
 * omission: a project whose provider publishes nothing gets no axis at all
 * rather than a comforting 100%. A refusal with no headroom headers still
 * ships the axis with measurable 0: being refused is the strongest possible
 * evidence that a ceiling exists.
 */
export function computeAiHeadroom(stats: EdgeAiStats): AxisValue | null {
  if (!stats) return null;
  const reads = Math.max(0, Math.round(stats.headroomReads ?? 0));
  const refusals = Math.max(0, Math.round(stats.rateLimitedCount ?? 0));
  if (reads === 0 && refusals === 0) return null;
  const worstRetryAfterMs = Math.max(0, Math.round(stats.worstRetryAfterMs ?? 0));
  const pct = (v: number | null): number | null =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.max(0, Math.min(100, Math.round(v * 10) / 10))
      : null;
  const req = pct(stats.worstRequestsPct ?? null);
  const tok = pct(stats.worstTokensPct ?? null);
  if (req === null && tok === null) {
    return {
      score: null,
      rating: "pending",
      measurable: 0,
      reads,
      // Not "full" — unknown. The tile reads measurable 0 first and says so.
      worstRequestsPct: 0,
      worstTokensPct: 0,
      refusals,
      worstRetryAfterMs,
    };
  }
  const context = {
    reads,
    worstRequestsPct: req ?? 100,
    worstTokensPct: tok ?? 100,
    refusals,
    worstRetryAfterMs,
  };
  // Start-up rule (startupEvent): graded on the TYPICAL settled headroom of
  // the newest window, never the lifetime low — a boot-time burst that the
  // provider's window has long since reset is not exhaustion.
  const settledReads = Math.max(0, Math.round(stats.headroomSettledReads ?? 0));
  const typReq = pct(stats.typicalRequestsPct ?? null);
  const typTok = pct(stats.typicalTokensPct ?? null);
  if (settledReads < AI_HEADROOM_MIN_READS || (typReq === null && typTok === null)) {
    return { score: null, rating: "pending", measurable: 1, settleRule: SETTLE_RULE, ...context };
  }
  // The tighter of the two ceilings decides.
  const typical = Math.min(typReq ?? 100, typTok ?? 100);
  const score = linearScore(
    // linearScore rises as the value falls, and headroom is the other way
    // round, so it is scored on how much of the window is USED.
    100 - typical,
    100 - AI_HEADROOM_PCT_THRESHOLDS.good,
    100 - AI_HEADROOM_PCT_THRESHOLDS.poor,
  );
  return {
    score,
    rating: ratingFor(score),
    measurable: 1,
    settleRule: SETTLE_RULE,
    typicalHeadroomPct: typical,
    ...context,
  };
}

export const DEP_FAIL_PCT_THRESHOLDS = { good: 0.5, poor: 10 } as const;
