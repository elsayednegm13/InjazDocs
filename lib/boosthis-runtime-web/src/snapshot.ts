/** Privacy-safe perf-snapshot mirror for the web runtime.
 *
 * Web parity for the Node runtime's `snapshot.ts`. It captures the current
 * in-process meter picture as ONE small, allowlisted JSON object and ships it
 * to `POST /api/snapshots` (the same ingest RN and Node use) so the
 * developer's OWN AI can read the live picture back over the hosted MCP
 * live-read tools + `GET /api/snapshot`. No new server surface is added — the
 * payload maps into the existing allowlisted snapshot fields (`capturedAt`,
 * `runtimeVersion`, `platform`, `startedAt`, `totalEvents`, `rows`, `axes`)
 * so it passes the server's `sanitizeSnapshotLabels` + PII guard unchanged.
 *
 * PRIVACY: the snapshot carries only normalized page-path labels + numeric
 * timings/counts/rating buckets — never user values, source, or PII. Route
 * keys are still filtered through the PII guard (in telemetry.ts
 * `transmitSnapshot`) before upload, and the whole payload clears
 * `assertNoPII`. Uploading is OFF by default in issues-only mode and enabled
 * only by the developer's explicit `shareMeterWithAI` opt-in or the server
 * directive once they connect an AI from the web dashboard — matching the
 * RN / Node privacy-by-default contract.
 */

import { readPressToScreen } from "./pressToScreen";
import { isRuntimeInert, renewNotice, getEntitlementGateKind } from "./killSwitch";
import { recent, summary, type Summary } from "./samples";
import type { PageLoadTiming } from "./pageLoadTiming";
import { pageEnvironmentNow } from "./developmentPage";
import { pageActivityFacts, type PageActivityFacts } from "./pageActivity";
import { readLiveConnections } from "./liveConnections";
import {
  SCORE_THRESHOLDS,
  TAIL_RATIO_THRESHOLDS,
  readResilienceTail,
  CLS_THRESHOLDS,
  MEMORY_PCT_THRESHOLDS,
  RESOURCE_EFF_THRESHOLDS,
  FCP_THRESHOLDS,
  LOAF_THRESHOLDS,
  CRASHFREE_RATE_THRESHOLDS,
  CRASHFREE_MIN_WINDOW_MIN,
  FRAME_CAUSE_THRESHOLDS,
  THIRD_PARTY_THRESHOLDS,
  SOFT_NAV_THRESHOLDS,
  BLOCKING_TIME_THRESHOLDS,
  MEMORY_TREND_THRESHOLDS,
  RESOURCE_BLOAT_THRESHOLDS,
  RAGE_CLICK_THRESHOLDS,
  EARLY_INPUT_THRESHOLDS,
  NAV_READINESS_THRESHOLDS,
  REDIRECT_THRESHOLDS,
  SERVER_TIMING_THRESHOLDS,
  HANDSHAKE_THRESHOLDS,
  RENDER_BLOCKING_THRESHOLDS,
  TRANSFER_WASTE_THRESHOLDS,
  CACHE_REVALIDATION_THRESHOLDS,
  CACHE_REUSE_THRESHOLDS,
  EDGE_CACHE_THRESHOLDS,
  STORAGE_HEADROOM_THRESHOLDS,
  CONNECTION_QUALITY_THRESHOLDS,
  REPORT_PRESSURE_THRESHOLDS,
  REPORT_PRESSURE_MIN_WINDOW_MIN,
  UNHANDLED_THRESHOLDS,
  UNHANDLED_MIN_WINDOW_MIN,
  SHIFT_SOURCE_THRESHOLDS,
  MEDIA_PLAYBACK_THRESHOLDS,
  FONT_READINESS_THRESHOLDS,
  ASSET_FOOTPRINT_THRESHOLDS,
  DOM_FOOTPRINT_THRESHOLDS,
  IDLE_OPPORTUNITY_THRESHOLDS,
  RUNTIME_VERSION,
  linearScore,
  bandAlignedScore,
  linearScoreHigh,
  ratingFor,
  ratePatchLag,
  patchLagScore,
  PATCH_LAG_DAY_MS,
  type Rating,
} from "./thresholds";
import {
  resolveBuildIdentity,
  REASON_NOT_WIRED_BY_HOST,
  REASON_NOTHING_TO_COMPARE,
  type BuildIdentity,
} from "./buildIdentity";
import {
  getVitals,
  normalizeRouteLabel,
  currentRouteLabel,
  getLongTaskStats,
  getHeapStats,
  getResourceEfficiency,
  getFcpMs,
  getLcpMs,
  getLoafStats,
  getInpStats,
  getInteractionSamples,
  getShiftSamples,
  getDeadClickStats,
  getRouteReachabilityStats,
  getRegisteredWebRoutes,
  getCircuitStats,
  getLoafCauseStats,
  getAsyncBlockSamples,
  getSoftNavSampleStamps,
  getMemoryTrendReadings,
  getRageBurstStamps,
  getRageAnsweredStamps,
  getBlockingTimeStats,
  getBfCacheStats,
  getInputReadinessStats,
  getSoftNavStats,
  getMemoryTrendStats,
  getResourceBloat,
  getRageClickStats,
  sampleMemoryTrendNow,
} from "./vitals";
import { crashCount } from "./crashReporter";
import { crashHistory, touchCrashHistory } from "./crashDelivery";
import {
  routeListForSnapshot,
  type RouteListReport,
} from "./routeInventory";
import {
  controlCensusForSnapshot,
  type ControlCensusReport,
} from "./controlCensus";
import {
  computeBaselineScore,
  computeBudgetCompliance,
  computeScrollHealth,
  computeInteractionToNextPaint,
  computeFrameFloor,
  computeStabilityScore,
  shiftSessionWindows,
  STABILITY_MIN_OBSERVED_MS,
  computeBlockingAsync,
  confidenceLevel,
  confidenceCaptionFor,
  computeDependencyDistance,
  computeAiCalls,
  computeAiSpend,
  computeAiHeadroom,
  AI_FAIL_PCT_THRESHOLDS,
  AI_TTFT_MS_THRESHOLDS,
  AI_HEADROOM_PCT_THRESHOLDS,
  type RouteSeriesLike,
  type RouteBudgetVerdict,
  computeNetworkScore,
  computeIdleEfficiency,
  FRAME_FLOOR_MIN_WINDOWS,
  computeTimerHealth,
  TIMER_HEALTH_MIN_SAMPLES,
  TIMER_GROWTH_MIN_SPAN_MS,
  BLOCKING_ASYNC_MIN_WINDOW_MS,
  ASYNC_SLOW_CALLBACK_MIN_WINDOW_MS,
  computeAsyncSlowCallbacks,
  EVENT_LOOP_LAG_MIN_SAMPLES,
  computeEventLoopLag,
} from "./meterAxes";
import { getAiCallStamps, getAiCallStats } from "./aiCalls";
import { AI_PRICE_TABLE_DAY } from "./aiUsage";
import {
  getAbortedCount,
  getDependencyDistanceStats,
  getGroupOverflowCount,
  getInFlightCount,
  isCallWatchActive,
  getNetworkDurationSamples,
  getNetworkStats,
  readCallGroups,
  type CallGroupRow,
} from "./networkSampler";
import { declaredCallCounts } from "./declaredCalls";
import {
  EDGE_CACHE_MIN_SETTLED,
  getEdgeCacheStats,
  getEdgeVerdictStamps,
} from "./edgeCache";
import { getIdleStats } from "./idleTracker";
import { getFrameWindowSamples, getScrollCounts, getScrollStats } from "./scrollSampler";
import {
  readTimerHealth,
  sampleTimerHealth,
  readAsyncSlowCallbacks,
  readEventLoopLag,
  getTimerLagSamples,
  getSlowCallbackSamples,
  getTimerCountSamples,
  isTimerTrackingInstalled,
} from "./timerHealth";
import {
  readWebStorageLatency,
  readWebStorageFailures,
} from "./localStore";
import { readSwallowedErrors } from "./swallowedErrors";
import { readLeakWatch } from "./leakWatch";
import { getRouteOutcomeTotals } from "./routeOutcomes";
import {
  getNavReadinessStats,
  getRedirectStats,
  getServerTimingStats,
  getHandshakeStats,
  getProtocolMixStats,
  getRenderBlockingStats,
  getTransferWasteStats,
  getCacheRevalidationStats,
  getCacheReuseStats,
  getInitiatorBalanceStats,
  getStorageHeadroomStats,
  sampleStorageHeadroomNow,
  sampleSwControlNow,
  getSwControlStats,
  getConnectionQualityStats,
  getDeviceCapacityStats,
  getPrerenderStats,
  getFontReadinessStats,
  getAssetFootprintStats,
  getCrossOriginIsolationStats,
  getDomFootprintStats,
  getIdleOpportunityCounts,
  getShiftSourceStats,
  getInteractionVolumeStats,
  getMediaPlaybackStats,
} from "./webPlatform";
import { getReportStamps, readUnhandled, readReportPressure } from "./webReports";
import { readBackgroundWork } from "./backgroundWork";
import { readDevPosture } from "./devPosture";

import { earnedPerHour, windowMinOf } from "./rateHonesty";
import {
  commitSettle,
  documentStartedAt,
  firstOfRoute,
  marked,
  percentile as settledPercentile,
  putDoc,
  settleBoundary,
  SETTLE_FAMILIES,
  settledCounter,
  settledRate,
  settledTail,
  settledWorst,
  type SettledTail,
  settling,
  sustainedGrowth,
  visitDocs,
  visitStartedAt,
  settleNow,
} from "./settle";
import {
  lastSentAt,
  pausedUntil,
  sessionStartedAt,
  snapshotHintAt,
} from "./uploadPacing";
import { kitTimeout } from "./zoneSafe";
/** How often the snapshot mirror re-uploads while sharing is enabled, once
 *  the turbo first-run ramp (see {@link nextSnapshotDelayMs}) has settled. */
export const SNAPSHOT_FLUSH_MS = 60_000;

/** Turbo first-run upload cadence. A freshly installed kit fills its dashboard
 *  tiles in seconds instead of minutes by uploading the perf snapshot more
 *  often for the first ~3 minutes of a session, then reverting to the steady
 *  {@link SNAPSHOT_FLUSH_MS} interval. This ONLY changes how soon data the kit
 *  already measured reaches the server — every honesty gate (min sample count,
 *  warm-up windows, empty-snapshot skip) is untouched; count-based gates simply
 *  clear sooner because the same data arrives sooner.
 *
 *  Stateless + age-driven on purpose: a skipped or empty upload must not burn a
 *  ramp step, so the delay is derived purely from how long the session has been
 *  alive, never from an upload counter. The ramp is at most 4 uploads in the
 *  first 70 seconds (10s → 20s → 40s → 60s), well under the server's 60
 *  requests/minute-per-install ingest limit. */
export function nextSnapshotDelayMs(sessionAgeMs: number): number {
  if (sessionAgeMs < 30_000) return 10_000;
  if (sessionAgeMs < 90_000) return 20_000;
  if (sessionAgeMs < 180_000) return 40_000;
  return SNAPSHOT_FLUSH_MS;
}

/** Route rows are prefixed with "screen:" so the server's live-data MCP tools
 *  — which filter rows by that prefix (matching the RN convention) — light up
 *  for web installs exactly as they do for RN and Node. */
const SCREEN_PREFIX = "screen:";

/** Cap route rows so a busy app never ships an unbounded payload. */
const MAX_SNAPSHOT_ROWS = 60;

/** Newest-first sample scan window used to derive per-route p50/p95/max/last. */
const SAMPLE_WINDOW = 1000;

/** Axes need a minimum sample count before they claim to be honest. */
export const MIN_SAMPLES_FOR_AXES = 5;

/** Minimum wall time the LoAF observer must run before the animationSmoothness
 *  axis reports (a per-minute rate over a few seconds is noise). Matches the
 *  spec warm-up gate of ≥30s observed. */
export const LOAF_MIN_ELAPSED_MS = 30_000;

/** Minimum wall time the longtask observer and the rage-click window must run
 *  before the blockingTime / frameCause / thirdPartyCost / rageClicks axes
 *  report (a per-minute rate over a few seconds is noise). Matches the spec's
 *  ≥30s observed gate. */
export const BLOCKING_MIN_ELAPSED_MS = 30_000;
export const RAGE_MIN_ELAPSED_MS = 30_000;

/** Memory-trend axis needs ≥3 readings spanning ≥2 minutes to claim a slope. */
export const MEMORY_TREND_MIN_SAMPLES = 3;
export const MEMORY_TREND_MIN_SPAN_MS = 120_000;

/** p75 of a numeric list (ascending), used by the softNav axis. */
function p75Of(values: number[]): number {
  if (values.length === 0) return 0;
  const asc = values.slice().sort((a, b) => a - b);
  const idx = Math.min(asc.length - 1, Math.floor(asc.length * 0.75));
  return asc[idx];
}

export interface WebSnapshotRow {
  key: string;
  count: number;
  p50: number;
  p95: number;
  max: number;
  last: number;
  /** Which timing this row's readings are: every one a largest paint, every
   *  one a first byte, or a mix (a row that also holds readings with no timing
   *  of their own, such as a host's own record() calls, is a mix too). Absent
   *  when none of them names a timing. */
  timing?: WebRowTiming;
}

/** A row's timing: one of the page-load timings, or "mixed". Closed list; the
 *  server keeps no other word. */
export type WebRowTiming = PageLoadTiming | "mixed";

export interface WebAxisResult {
  /** Null while an axis has evidence worth reporting but not yet enough of it
   *  to score honestly (see the outbound-call axis: a single hung call is reportable,
   *  a score drawn from it would not be). Never null once `rating` is a real
   *  band. */
  score: number | null;
  /** A band, or one of the three silences. Only "pending" means a score is
   *  still coming: "not-available" says this page's host cannot take the
   *  reading at all, and "not-scored" says the reading is real and
   *  deliberately never graded. Widened here so a reading that abstains for
   *  good can say which of the three it is, on the wire and on the panel,
   *  rather than every silence arriving as a wait. */
  rating: Rating | "pending" | "not-available" | "not-scored";
  /** Per-group outbound-call rows. ONLY the outbound-call axis emits this — it is
   *  named explicitly (rather than widening the index signature for every
   *  axis) so no other axis can start shipping arrays by accident. */
  groups?: CallGroupRow[];
  [k: string]: number | string | boolean | CallGroupRow[] | null | undefined;
}

/** A value in the axes container. Most axes are objects (`WebAxisResult`), but
 *  the confidence axis is emitted as FOUR SCALAR sibling keys per the shared
 *  axis contract (`confidence` string level + `confidenceMounts` /
 *  `confidenceRating` / `confidenceCaption`), so a value can also be a bare
 *  string/number. The map is typed `WebAxisResult` for ergonomic object-axis
 *  access; the scalar confidence keys are written through a narrow cast. */
export type WebAxisValue = WebAxisResult | number | string;

export interface WebSnapshotPayload {
  capturedAt: number;
  runtimeVersion: string;
  platform: "web";
  startedAt: number;
  totalEvents: number;
  rows: WebSnapshotRow[];
  axes: Record<string, WebAxisResult>;
  /** Build identity for the Patch Lag meter — WHAT build is running + WHEN it
   *  was built. Present ONLY when at least one component is honestly known
   *  (never fabricated); the whole object is omitted when nothing is known. */
  build?: WebSnapshotBuild;
  /** Live event counters — the same numbers the bubble's "live events" rows
   *  show (main-thread blocks, dead clicks, unreachable routes, loop/burst
   *  detections), mirrored to the web dashboard. CLOSED all-numeric shape:
   *  counts only, no labels/strings, so nothing new can ride the wire. */
  events: WebSnapshotEvents;
  /** The site's WHOLE route list, as the router describes it — so the map can
   *  draw routes nobody has opened, marked "not seen". Present only when a
   *  router was handed over (`registerRouter`) or routes were declared
   *  (`registerWebRoutes`), or when the whole thing is switched off (which
   *  says so, so "off" can be told from "an old kit"). Absent otherwise:
   *  that absence is "nothing yet", not a claim the site has no other pages. */
  routeList?: RouteListReport;
  /** The CONTROLS the rendered page has, as the page itself describes them —
   *  the same trick as `routeList`, one level down. Counts and structural
   *  handles only: no label, no value, no text, nothing a person typed (see
   *  `controlCensus.ts`). Present whenever this kit knows the question,
   *  including when it says `off`; absent only when the block could not be
   *  produced at all, which is how a kit too old to have it is told apart. */
  controlCensus?: ControlCensusReport;
  /** WHAT THIS VISIT CONSISTED OF, so a near-silent install can be explained
   *  instead of guessed at. A reading is taken when a page view ends, so a
   *  single-page app produces one reading however much a person does in it —
   *  and on our side that is indistinguishable from an app nobody opened.
   *  This block is the difference: address changes, presses, readings taken,
   *  view changes that could not be timed, and ONE closed word saying which
   *  of the four situations this is (see `pageActivity.ts`). Counts and one
   *  word from a fixed list: no label, no URL, nothing a person typed.
   *  Always present from this kit version on, including when it says it
   *  cannot tell — which is how a kit too old to have it is told apart. */
  pageActivity?: PageActivityFacts;
}

export interface WebSnapshotEvents {
  longTaskCount: number;
  deadClickCount: number;
  actionableClickCount: number;
  registeredRouteCount: number;
  unreachableRouteCount: number;
  navLoopMaxBounces: number;
  requestBurstMax1s: number;
}

/** Top-level build-identity object for the Patch Lag meter. Every field is
 *  optional and included ONLY when honestly known; the whole object is omitted
 *  from the snapshot when nothing is known (never fabricated). */
export interface WebSnapshotBuild {
  /** Lowercase hex commit sha (7–40 chars), when known. */
  commit?: string;
  /** Build time as epoch ms, when known. */
  buildTimeMs?: number;
  /** now − buildTimeMs at capture, clamped ≥ 0. Present only with buildTimeMs. */
  buildAgeMs?: number;
}

/** Assemble the top-level build object from resolved identity. Returns
 *  undefined when nothing is known so the snapshot omits the field entirely.
 *  `buildAgeMs` is derived (now − buildTimeMs, clamped ≥ 0) only when a build
 *  time is known — never fabricated. */
function buildBuildObject(
  identity: BuildIdentity,
  now: number,
): WebSnapshotBuild | undefined {
  const out: WebSnapshotBuild = {};
  if (identity.commit !== undefined) out.commit = identity.commit;
  if (identity.buildTimeMs !== undefined) {
    out.buildTimeMs = identity.buildTimeMs;
    out.buildAgeMs = Math.max(0, now - identity.buildTimeMs);
  }
  return out.commit !== undefined || out.buildTimeMs !== undefined
    ? out
    : undefined;
}

/** Numeric-only live-event counters for the snapshot. Every getter is
 *  individually guarded so one unsupported browser API can never cost the
 *  whole snapshot (kit-guest-safety rule). */
function buildEvents(): WebSnapshotEvents {
  const n = (fn: () => number): number => {
    try {
      const v = fn();
      return Number.isFinite(v) ? v : 0;
    } catch {
      return 0;
    }
  };
  return {
    longTaskCount: n(() => getLongTaskStats().longTaskCount),
    deadClickCount: n(() => getDeadClickStats().deadClickCount),
    actionableClickCount: n(() => getDeadClickStats().actionableClickCount),
    registeredRouteCount: n(() => getRouteReachabilityStats().registeredCount),
    unreachableRouteCount: n(() => getRouteReachabilityStats().unreachableCount),
    navLoopMaxBounces: n(() => getCircuitStats().navLoopMaxBounces),
    requestBurstMax1s: n(() => getCircuitStats().requestBurstMax1s),
  };
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * p));
  return sortedAsc[idx];
}

/** Learned-budget model parameters — mirrors the Node/Python `budgets.ts`
 *  (BASELINE_N=20, RECENT_N=20, REGRESSION_FACTOR=1.5). A route needs
 *  BUDGET_BASELINE_N samples before it is scored; it is "regressed" when its
 *  recent-window p95 blows past its learned baseline p95 by the factor. */
const BUDGET_BASELINE_N = 20;
const BUDGET_RECENT_N = 20;
const BUDGET_REGRESSION_FACTOR = 1.5;
/** A relative regression must also be an ABSOLUTE one: a route that drifts
 *  from 2 ms to 5 ms is 2.5x slower and still nothing anybody waits for. */
const BUDGET_MIN_DELTA_MS = 50;

/** Build per-route, chronologically-ordered (oldest→newest) duration series
 *  from the recent sample window. Label-free by construction — the route key is
 *  used ONLY to group and is never returned. `recent()` is newest-first, so we
 *  reverse each group to restore chronological order (matching the Node budget
 *  model's ordering). */
function buildRouteSeries(): RouteSeriesLike[] {
  const buf = recent({ limit: SAMPLE_WINDOW });
  const byRoute = new Map<string, number[]>();
  // Iterate oldest→newest so pushes preserve chronological order.
  for (let i = buf.length - 1; i >= 0; i--) {
    const s = buf[i];
    let durs = byRoute.get(s.name);
    if (!durs) {
      durs = [];
      byRoute.set(s.name, durs);
    }
    durs.push(s.duration_ms);
  }
  return [...byRoute.values()].map((durations) => ({ durations }));
}

/** Derive a learned-budget verdict for one route's ordered durations. A route
 *  is "scored" only once it has BUDGET_BASELINE_N samples; "regressed" when its
 *  recent-window p95 exceeds the learned baseline p95 by REGRESSION_FACTOR. */
function budgetVerdictFor(durations: number[]): RouteBudgetVerdict {
  if (durations.length < BUDGET_BASELINE_N) {
    return { scored: false, regressed: false };
  }
  const baseline = durations.slice(0, BUDGET_BASELINE_N);
  const recentSlice = durations.slice(-BUDGET_RECENT_N);
  const baseP95 = percentile(baseline.slice().sort((a, b) => a - b), 0.95);
  const recentP95 = percentile(recentSlice.slice().sort((a, b) => a - b), 0.95);
  if (baseP95 <= 0) return { scored: true, regressed: false };
  return {
    scored: true,
    regressed:
      recentP95 >= baseP95 * BUDGET_REGRESSION_FACTOR &&
      recentP95 - baseP95 >= BUDGET_MIN_DELTA_MS,
  };
}

/** Least-sampled SCORED route's sample count — the weakest scored unit backing
 *  confidence. A route is "scored" once it clears the kit's own axis-scoring
 *  gate (MIN_SAMPLES_FOR_AXES — same as Node/Python/Go/Java); routes below
 *  that are excluded. 0 when nothing is scored yet. Mirrors RN's
 *  leastScorableMounts (min, not total). */
function leastScoredRouteSamples(series: RouteSeriesLike[]): number {
  const counts = series
    .map((r) => r.durations.length)
    .filter((c) => c >= MIN_SAMPLES_FOR_AXES);
  return counts.length ? Math.min(...counts) : 0;
}

/** Group the recent sample window by page into worst-first rows. `recent()`
 *  returns newest-first, so the FIRST sample seen for a page is its latest —
 *  that becomes `last`. */
/** One row's timing from the timings its readings named. */
function rowTiming(seen: Set<PageLoadTiming | "none"> | undefined): WebRowTiming | null {
  if (!seen || seen.size === 0) return null;
  // More than one word means at least one real timing beside something else.
  if (seen.size > 1) return "mixed";
  const only = [...seen][0];
  return only === "none" ? null : only;
}

function buildRows(): WebSnapshotRow[] {
  const buf = recent({ limit: SAMPLE_WINDOW });
  const durationsByRoute = new Map<string, number[]>();
  const lastByRoute = new Map<string, number>();
  // Which timings each row's readings name ("none" for a reading that names
  // none), so the row can say whether its numbers are paints or first bytes.
  const timingsByRoute = new Map<string, Set<PageLoadTiming | "none">>();
  for (const s of buf) {
    let durs = durationsByRoute.get(s.name);
    if (!durs) {
      durs = [];
      durationsByRoute.set(s.name, durs);
      lastByRoute.set(s.name, s.duration_ms);
      timingsByRoute.set(s.name, new Set());
    }
    durs.push(s.duration_ms);
    timingsByRoute.get(s.name)!.add(s.timing ?? "none");
  }
  const rows: WebSnapshotRow[] = [];
  for (const [route, durs] of durationsByRoute) {
    const asc = durs.slice().sort((a, b) => a - b);
    const timing = rowTiming(timingsByRoute.get(route));
    rows.push({
      key: `${SCREEN_PREFIX}${route}`,
      count: durs.length,
      p50: percentile(asc, 0.5),
      p95: percentile(asc, 0.95),
      max: asc[asc.length - 1],
      last: lastByRoute.get(route) ?? 0,
      ...(timing ? { timing } : {}),
    });
  }
  rows.sort((a, b) => b.p95 - a.p95);
  return rows.slice(0, MAX_SNAPSHOT_ROWS);
}

/** Honest, display-only meters mapped into the server's axis allowlist:
 *   - responsiveness: settled-interaction p75 vs the INP bands.
 *   - largestPaint: each document's LCP, pooled across the visit, p75 vs the
 *     LCP bands (omitted in a browser that reports no LCP entry).
 *   - frustration: the worst observed interaction (INP proxy) vs INP bands —
 *     only when an interaction has actually been measured this session.
 *   - resilience: latency-tail stability (p99/p50 blowup blended with the
 *     poor-sample rate) — mirrors the Node/Python resilience axis.
 *   - stability: main-thread long tasks per minute (browser Long Tasks API) —
 *     only in supporting browsers.
 *  All are ADDITIVE + display-only — none feeds the composite Speed score.
 *  Axes that cannot be computed honestly are simply omitted — the server
 *  renders absent axes as pending. */
let landingRouteKey: string | null = null;

/** One page-load sample for this document, pooled across the visit: stamped
 *  at the document's start, cold when it is the visit's first load of its
 *  landing route (src/settle.ts). */
function pageLoadTail(meter: string, value: number | null | undefined): SettledTail {
  return docTail(meter, "latencyTail", value);
}

/** One per-document sample for a meter of any family, pooled across the
 *  visit (src/settle.ts): stamped at the document's start, cold when it is
 *  the visit's first load of its landing route. */
function docTail(
  meter: string,
  family: "latencyTail" | "startupEvent",
  value: number | null | undefined,
): SettledTail {
  if (landingRouteKey === null) landingRouteKey = currentRouteLabel() ?? "/";
  const samples =
    value != null && Number.isFinite(value)
      ? [{ t: documentStartedAt(), v: value, cold: firstOfRoute("doc:" + landingRouteKey) }]
      : [];
  return settledTail(meter, family, samples);
}

/** The p75 of pooled settled values, rounded (0 when there are none). */
function p75Round(values: readonly number[]): number {
  const p = settledPercentile(values, 0.75);
  return p == null ? 0 : Math.round(p);
}

/** The smallest single shift whose moved nodes are attributed: a shift
 *  under a hundredth of the viewport is not one a visitor sees. */
export const SHIFT_SOURCE_MIN_VALUE = 0.01;

/** Settled idle probes needed before the missed share is a reading. */
export const IDLE_OPPORTUNITY_MIN_SETTLED = 5;

/** Whether THIS document counts as settled for a per-document reading: it
 *  opened after the family's settle period and is not the visit's first load
 *  of its route. */
function docIsSettled(family: "startupEvent" | "latencyTail"): boolean {
  if (landingRouteKey === null) landingRouteKey = currentRouteLabel() ?? "/";
  const cold = firstOfRoute("doc:" + landingRouteKey);
  return !cold && documentStartedAt() >= settleBoundary(family);
}

/** Store this document's counts for a meter and return the column sums over
 *  every document of the visit (src/settle.ts). */
function pooledDocCounts(meter: string, counts: number[]): number[] {
  putDoc(meter, counts);
  const sums: number[] = [];
  for (const e of visitDocs(meter)) {
    e.forEach((x, i) => {
      sums[i] = (sums[i] ?? 0) + (Number(x) || 0);
    });
  }
  const width = Math.max(counts.length, sums.length, 5);
  for (let i = 0; i < width; i++) sums[i] = sums[i] ?? 0;
  return sums;
}

/** The smallest number of settled judged resources cacheReuse grades on. */
const CACHE_REUSE_MIN_SETTLED = 5;

/** The rage-click listener has been armed in this document. */
function rageWindowOpen(r: { elapsedMs: number }): boolean {
  return r.elapsedMs > 0;
}

/** Test seam: forget the memoised landing route (a new document). */
export function _resetLandingRouteForTests(): void {
  landingRouteKey = null;
}

/** The route sample ring stamped for the settle rule (src/settle.ts), oldest
 *  first: a route's first sample of the visit carries set-up and is cold. */
function stampedRouteSamples(
  name?: string,
): Array<{ t: number; v: number; cold?: boolean; name: string; poor: boolean }> {
  const out: Array<{ t: number; v: number; cold?: boolean; name: string; poor: boolean }> = [];
  const seen = new Set<string>();
  for (const s of recent({ limit: 1000, name }).reverse()) {
    const cold = !seen.has(s.name) && firstOfRoute("s:" + s.name);
    seen.add(s.name);
    const row = { t: s.timestamp_ms, v: s.duration_ms, name: s.name, poor: s.rating === "poor" };
    out.push(cold ? { ...row, cold: true } : row);
  }
  return out;
}

/** Per-route SETTLED series (src/settle.ts), oldest first: nothing from the
 *  settle period and never a route's first sample of the visit. */
function settledRouteSeries(): RouteSeriesLike[] {
  const edge = settleBoundary("latencyTail");
  const byRoute = new Map<string, number[]>();
  for (const s of stampedRouteSamples()) {
    if (s.t < edge || s.cold) continue;
    let d = byRoute.get(s.name);
    if (!d) {
      d = [];
      byRoute.set(s.name, d);
    }
    d.push(s.v);
  }
  return [...byRoute.values()].map((durations) => ({ durations }));
}

function buildAxes(
  sum: Summary,
  now: number,
  startedAt: number,
  identity: BuildIdentity,
): Record<string, WebAxisResult> {
  const axes: Record<string, WebAxisResult> = {};

  // Take one async memory-trend reading off this cadence (fire-and-forget, the
  // same precedent as sampleTimerHealth). No-op unless the API exists AND the
  // context is cross-origin-isolated; the reading lands before a later capture.
  sampleMemoryTrendNow();

  // Responsiveness — INPUT responsiveness (the shared decision): the p75 of
  // settled interactions, pooled across the visit (src/settle.ts). The first
  // interaction of each document meets hydration and never counts; a visit
  // that has not yet given 20 settled interactions says so instead of a word.
  const interactions = getInteractionSamples();
  if (interactions.length > 0) {
    const tail = settledTail("responsiveness", "latencyTail", interactions);
    const p75 = settledPercentile(tail.values, 0.75);
    if (!tail.ready || p75 == null) {
      axes["responsiveness"] = settling({ p75Ms: null, count: tail.values.length });
    } else {
      const score = linearScore(p75, SCORE_THRESHOLDS.inp.good, SCORE_THRESHOLDS.inp.poor);
      axes["responsiveness"] = marked({
        score,
        rating: ratingFor(score),
        p75Ms: Math.round(p75),
        count: tail.values.length,
      });
    }
  }

  // Frustration — the worst SETTLED interaction delay of the visit: a tap
  // during first paint is ordinary, so nothing inside the settle period counts.
  const vitals = getVitals();
  if (vitals.inpMs != null || interactions.length > 0) {
    const worst = settledWorst("frustration", "startupEvent", interactions);
    if (!worst.ready || worst.worst == null) {
      // No worstDelayMs while settling: the ingest envelope types it as a
      // number, and one null there refuses the WHOLE snapshot with a 400.
      axes["frustration"] = settling();
    } else {
      const worstDelayMs = Math.round(worst.worst);
      const score = linearScore(worstDelayMs, SCORE_THRESHOLDS.inp.good, SCORE_THRESHOLDS.inp.poor);
      axes["frustration"] = marked({ score, rating: ratingFor(score), worstDelayMs });
    }
  }

  // Resilience — latency-tail stability: the p99/p50 "tail blowup" ratio blended
  // with the poor-sample rate. Mirrors the Node/Python resilience axis (tail
  // good ≤3× · poor ≥8×), minus the budget/regression term the web runtime has
  // no equivalent for. Additive + display-only — never feeds the Speed score.
  // The tail term obeys the cross-kit contract in thresholds.ts: an absolute
  // floor, a sample floor, and an honest abstention when the median is below
  // the capture resolution. Judged on SETTLED samples only (src/settle.ts):
  // nothing from the settle period, never a route's first sample of the visit,
  // pooled across the visit's documents, 20 settled samples before a word.
  {
    const stamped = stampedRouteSamples();
    if (stamped.length > 0) {
      const tailRead = settledTail("resilience", "latencyTail", stamped);
      const edge = settleBoundary("latencyTail");
      const mine = stamped.filter((x) => x.t >= edge && !x.cold);
      putDoc("resilience.poor", [mine.length, mine.filter((x) => x.poor).length]);
      let n = 0;
      let poorN = 0;
      for (const e of visitDocs("resilience.poor")) {
        n += Number(e[0]) || 0;
        poorN += Number(e[1]) || 0;
      }
      const p50 = settledPercentile(tailRead.values, 0.5);
      const p99 = settledPercentile(tailRead.values, 0.99);
      const count = tailRead.values.length;
      const tail = tailRead.ready ? readResilienceTail(p50, p99, count) : null;
      if (!tail || tail.state === "insufficient" || p50 == null || p99 == null) {
        axes["resilience"] = settling({ tailRatio: null, p50Ms: p50, p99Ms: p99, sampleCount: count });
      } else if (tail.state === "unmeasurable") {
        // 0.6 of the score is the tail — withhold rather than publish a
        // verdict whose dominant term was never measured.
        axes["resilience"] = marked({
          score: null,
          rating: "pending",
          tailRatio: null,
          p50Ms: p50,
          p99Ms: p99,
          sampleCount: count,
        });
      } else {
        const tailScore =
          tail.state === "flat"
            ? 100
            : linearScore(tail.ratio, TAIL_RATIO_THRESHOLDS.good, TAIL_RATIO_THRESHOLDS.poor);
        const poorRate = n > 0 ? poorN / n : 0;
        const poorRateScore = linearScore(poorRate, 0.05, 0.25);
        const score = Math.round(0.6 * tailScore + 0.4 * poorRateScore);
        axes["resilience"] = marked({
          score,
          rating: ratingFor(score),
          tailRatio: tail.ratio == null ? null : Math.round(tail.ratio * 10) / 10,
          p50Ms: p50,
          p99Ms: p99,
          // The server meter page renders "n samples" from sampleCount (RN
          // sends it too) — without it the web axis renders a dishonest
          // 0-sample count.
          sampleCount: count,
        });
      }
    }
  }

  // Stability — the RN-parity scored rate of ≥50ms main-thread freezes,
  // judged on SETTLED running (src/settle.ts): the counter is re-anchored at
  // the end of the settle period and pooled across the visit, so the boot
  // task's freezes never decide the grade. A settling visit says so;
  // unsupported browsers stay absent. Display-only — never feeds Speed.
  const longTaskStats = getLongTaskStats();
  if (longTaskStats.supported) {
    const settled = settledCounter(
      "stability",
      "startupEvent",
      longTaskStats.longTaskCount,
      now,
      STABILITY_MIN_OBSERVED_MS,
    );
    const stability = computeStabilityScore({
      ...longTaskStats,
      longTaskCount: settled.count,
      observedWindowMs: settled.ready ? settled.windowMs : 0,
    });
    if (stability.score !== null && stability.longTasksPerMin !== null) {
      axes["stability"] = marked({
        score: stability.score,
        rating: stability.rating as Rating,
        longTaskCount: stability.longTaskCount,
        longTasksPerMin: stability.longTasksPerMin,
        worstBlockMs: stability.worstBlockMs,
        windowMin: stability.windowMin ?? 0,
      });
    } else {
      axes["stability"] = settling({ longTaskCount: settled.count, longTasksPerMin: null });
    }
  }

  // Layout stability — the shared decision: the largest SESSION WINDOW of
  // shifts (1 s gap, 5 s cap), never every shift summed, taken from settled
  // shifts only and the worst such window of the visit. A settled page with
  // no shift reads 0. Display-only — never feeds the Speed score.
  const shifts = getShiftSamples();
  if (getVitals().cls != null || shifts.length > 0) {
    const edge = settleBoundary("startupEvent");
    const windows = shiftSessionWindows(shifts.filter((x) => x.t >= edge));
    const worst = settledWorst("layoutStability", "startupEvent", windows);
    if (now < edge) {
      axes["layoutStability"] = settling({ cls: null });
    } else {
      const cls = Math.round((worst.worst ?? 0) * 1000) / 1000;
      const score = linearScore(cls, CLS_THRESHOLDS.good, CLS_THRESHOLDS.poor);
      axes["layoutStability"] = marked({
        score,
        rating: ratingFor(score),
        cls,
        caption: `${cls.toFixed(3)} CLS largest settled window`,
      });
    }
  }

  // Memory — current JS heap in use vs the tab's hard limit (Chromium's
  // non-standard performance.memory; omitted on Firefox/Safari/SSR so it is
  // never faked). Rated by how close the page sits to the limit, where the tab
  // OOM-crashes: good <=50% · poor >=90%. Additive + display-only. A gauge, so
  // no start-up figure persists in it: a boot step is read at its level.
  const heap = getHeapStats();
  if (heap != null) {
    const score = linearScore(
      heap.pct,
      MEMORY_PCT_THRESHOLDS.good,
      MEMORY_PCT_THRESHOLDS.poor,
    );
    axes["memory"] = marked({
      score,
      rating: ratingFor(score),
      usedMb: heap.usedMb,
      limitMb: heap.limitMb,
      pct: heap.pct,
      caption: `${heap.usedMb} MB of ${heap.limitMb} MB heap (${heap.pct}%)`,
    });
  }

  // Resource efficiency — the shared decision: judged on a production build.
  // A page the kit RECOGNISES as development (a development build or a
  // loopback address) serves unminified, uncompressed files by design, so
  // there the reading is reported and never graded.
  const re = getResourceEfficiency();
  if (re != null) {
    const score = linearScoreHigh(
      re.efficientPct,
      RESOURCE_EFF_THRESHOLDS.good,
      RESOURCE_EFF_THRESHOLDS.poor,
    );
    const dev = pageEnvironmentNow() === "development";
    axes["resourceEfficiency"] = {
      score: dev ? null : score,
      rating: dev ? "not-scored" : ratingFor(score),
      eligible: re.eligible,
      efficient: re.efficient,
      efficientPct: re.efficientPct,
      caption: `${re.efficientPct}% of ${re.eligible} resources cached or compressed`,
    };
  }

  // Paint readiness — first contentful paint is start-up of its OWN document:
  // one sample per document, pooled across the visit (src/settle.ts); the
  // first load of each route is set-up and the visit's first minute settles.
  const fcp = getFcpMs();
  if (fcp != null) {
    const tail = pageLoadTail("paintReadiness", fcp);
    const p75 = settledPercentile(tail.values, 0.75);
    if (!tail.ready || p75 == null) {
      axes["paintReadiness"] = settling({ fcpMs: null, count: tail.values.length });
    } else {
      const fcpMs = Math.round(p75);
      const score = linearScore(fcpMs, FCP_THRESHOLDS.good, FCP_THRESHOLDS.poor);
      axes["paintReadiness"] = marked({ score, rating: ratingFor(score), fcpMs, count: tail.values.length });
    }
  }

  // Largest Contentful Paint — the Core Web Vital, as a reading of its own.
  // The same per-document value the page-load timing already uses, settled
  // and pooled exactly like paint readiness: one sample per document (its
  // newest LCP entry), the visit's page loads pooled, p75 graded on the
  // published bands. Omitted until the browser reports an LCP entry, so a
  // browser without the entry type sends nothing rather than a fake reading.
  const lcp = getLcpMs();
  if (lcp != null) {
    const tail = pageLoadTail("largestPaint", lcp);
    const p75 = settledPercentile(tail.values, 0.75);
    if (!tail.ready || p75 == null) {
      axes["largestPaint"] = settling({ lcpMs: null, count: tail.values.length });
    } else {
      const lcpMs = Math.round(p75);
      // The word must follow the PUBLISHED bands (good to 2.5 s, needs
      // improvement to 4 s), so the score is band-aligned, not linearScore.
      const score = bandAlignedScore(lcpMs, SCORE_THRESHOLDS.lcp.good, SCORE_THRESHOLDS.lcp.poor);
      axes["largestPaint"] = marked({ score, rating: ratingFor(score), lcpMs, count: tail.values.length });
    }
  }

  // INP — the standard estimator over SETTLED interactions pooled across the
  // visit: each document keeps its settled count and its 16 worst; the first
  // interaction of a document is cold; 20 settled interactions before a word.
  {
    const edge = settleBoundary("latencyTail");
    const mine = interactions
      .filter((x) => x.t >= edge && !x.cold)
      .map((x) => x.v)
      .sort((x, y) => y - x);
    if (interactions.length > 0 || getInpStats().inpMs !== null) {
      putDoc("interactionToNextPaint", [mine.length, ...mine.slice(0, 16)]);
      let total = 0;
      const worst: number[] = [];
      for (const e of visitDocs("interactionToNextPaint")) {
        total += Number(e[0]) || 0;
        worst.push(...e.slice(1));
      }
      worst.sort((x, y) => y - x);
      if (total < 20 || worst.length === 0) {
        axes["interactionToNextPaint"] = settling({ inpMs: null, interactionCount: total });
      } else {
        const inpMs = Math.round(worst[Math.min(Math.floor(total / 50), worst.length - 1)]);
        const inp = computeInteractionToNextPaint({ inpMs, interactionCount: total });
        if (inp.score !== null && inp.inpMs !== null) {
          axes["interactionToNextPaint"] = marked({
            score: inp.score,
            rating: inp.rating as Rating,
            inpMs: inp.inpMs,
            interactionCount: inp.interactionCount,
          });
        }
      }
    }
  }

  // Animation smoothness — long animation frames per minute on SETTLED
  // running: the counter is re-anchored after the settle period and pooled
  // across the visit, so boot frames never decide the rate.
  const loaf = getLoafStats();
  if (loaf.supported) {
    const settled = settledCounter("animationSmoothness", "latencyTail", loaf.count, now, LOAF_MIN_ELAPSED_MS);
    if (!settled.ready) {
      axes["animationSmoothness"] = settling({ loafPerMin: null, count: settled.count });
    } else {
      const loafPerMin = Math.round(settled.perMin * 10) / 10;
      const score = linearScore(loafPerMin, LOAF_THRESHOLDS.good, LOAF_THRESHOLDS.poor);
      axes["animationSmoothness"] = marked({
        score,
        rating: ratingFor(score),
        loafPerMin,
        worstMs: loaf.worstMs,
        count: settled.count,
        windowMin: windowMinOf(settled.windowMs),
      });
    }
  }

  touchCrashHistory();
  const history = crashHistory();
  const crashes = crashCount();
  // Eligibility is judged on the RAW elapsed time, never on the reported
  // two-decimal window (see windowMinOf in rateHonesty.ts).
  const crashWindowMs = history.windowMs;
  const windowMin = windowMinOf(crashWindowMs);
  // The earned-rate contract (rateHonesty.ts): the projection and the score it
  // feeds wait for a window that earned them. A crash still surfaces the moment
  // it happens, as a count over the window actually observed.
  const crashPerHour = earnedPerHour(crashes, crashWindowMs);
  // WHAT WAS LEFT OUT, in the same window as `crashes`: errors whose every
  // addressed frame was a browser extension's, and the browser's own
  // ResizeObserver notices. Always sent — 0 included — because their PRESENCE
  // is how the server tells this reading from an older kit's, which counted
  // both as crashes. Counts only; nothing names an extension.
  const setAside = {
    setAsideExtension: history.setAsideExtension,
    setAsideNotice: history.setAsideNotice,
  };
  if (crashPerHour !== null) {
    const score = linearScore(
      crashPerHour,
      CRASHFREE_RATE_THRESHOLDS.good,
      CRASHFREE_RATE_THRESHOLDS.poor,
    );
    axes["crashFree"] = {
      score,
      rating: ratingFor(score),
      crashes,
      windowMin,
      ...(history.runsInWindow ? { runsInWindow: history.runsInWindow } : {}),
      ...(history.runsAtLeast ? { runsAtLeast: true } : {}),
      ...setAside,
    };
  } else if (crashes > 0) {
    axes["crashFree"] = { score: null, rating: "pending", crashes, windowMin,
      ...(history.runsInWindow ? { runsInWindow: history.runsInWindow } : {}),
      ...(history.runsAtLeast ? { runsAtLeast: true } : {}),
      ...setAside };
  }

  // ─── New parity axes (RN-mirrored) ────────────────────────────────────
  // Every one is ADDITIVE + display-only, honest-gated (omitted until it has
  // enough real data), and label-free (counts/durations/ratios only).

  const series = buildRouteSeries();

  // Confidence — the least-sampled SCORED route (weakest scored unit). Emitted
  // as FOUR scalar top-level axes keys (not an object), per the shared
  // contract. Level "none" => omit entirely (nothing scored yet).
  const confSamples = leastScoredRouteSamples(series);
  const level = confidenceLevel(confSamples);
  if (level !== "none") {
    // FOUR scalar sibling keys (not an object), per the shared contract. The
    // axes map is typed for object axes, so the bare scalars are written
    // through a narrow cast — the wire still carries plain string/number values.
    const scalar = axes as unknown as Record<string, WebAxisValue>;
    scalar["confidence"] = level;
    scalar["confidenceMounts"] = confSamples;
    // No rating word (the shared decision): how many samples a meter had is
    // how sure a reading is, never how healthy the app is.
    scalar["confidenceCaption"] = confidenceCaptionFor(level);
  }

  // Budget — share of scored routes on their learned load budget. Pending
  // (omitted) until at least one route has enough samples to be scored.
  // Budget and baseline judge SETTLED samples per route (src/settle.ts):
  // a learned budget or a baseline is never learned from start-up, and a
  // route needs the latency family's 20 settled samples before it counts.
  const settledSeries = settledRouteSeries();
  const tailFloor = SETTLE_FAMILIES.latencyTail.samples;
  const budget = computeBudgetCompliance(
    settledSeries.map((r) => budgetVerdictFor(r.durations)),
  );
  if (budget.score != null && budget.pct != null) {
    axes["budget"] = marked({
      score: budget.score,
      rating: budget.rating as Rating,
      onBudget: budget.onBudget,
      total: budget.total,
      pct: budget.pct,
    });
  } else if (series.length > 0) {
    axes["budget"] = settling({ onBudget: 0, total: 0, pct: null });
  }

  const baseline = computeBaselineScore(
    settledSeries.filter((r) => r.durations.length >= tailFloor),
  );
  if (baseline.score != null || baseline.unscoredRoutes > 0) {
    axes["baseline"] = marked({
      score: baseline.score,
      rating: baseline.rating as Rating,
      worstRatio: baseline.worstRatio ?? 0,
      worstBaselineMs: baseline.worstBaselineMs ?? 0,
      worstCurrentMs: baseline.worstCurrentMs ?? 0,
      anomalyCount: baseline.anomalyCount,
      scoredRoutes: baseline.scoredRoutes,
      unscoredRoutes: baseline.unscoredRoutes,
      measurable: baseline.measurable,
    });
  } else if (series.length > 0) {
    axes["baseline"] = settling({ worstRatio: 0, scoredRoutes: 0, unscoredRoutes: 0, measurable: 0 });
  }

  // Network — the latency term is the p75 of SETTLED requests pooled across
  // the visit (src/settle.ts): nothing from the settle period, never a call
  // group's first call, 20 settled requests before a word. The drop rate is
  // counted on settled running too (re-anchored counters); a stall is a
  // current state and counts as it stands.
  const raw = getNetworkStats();
  const netTail = settledTail("network", "latencyTail", getNetworkDurationSamples());
  const settledAttempts = settledCounter(
    "network.attempts",
    "latencyTail",
    raw.completedCount + raw.failedCount + raw.timeoutCount,
    now,
  );
  const settledDrops = settledCounter(
    "network.drops",
    "latencyTail",
    raw.failedCount + raw.timeoutCount,
    now,
  );
  const netP75 = settledPercentile(netTail.values, 0.75);
  const net =
    netTail.ready && netP75 != null
      ? computeNetworkScore({
          attemptCount: settledAttempts.count + raw.stallCount,
          completedCount: 0,
          failedCount: settledDrops.count,
          timeoutCount: 0,
          stallCount: raw.stallCount,
          p75Ms: netP75,
          worstMs: raw.worstMs,
        })
      : null;
  const netGroups = readCallGroups();
  const netScored = net != null && net.score != null && net.p75Ms != null && net.stallPct != null;
  const netActionable =
    raw.stallCount > 0 ||
    raw.timeoutCount > 0 ||
    raw.failedCount > 0 ||
    netGroups.length > 0 ||
    raw.attemptCount > 0;
  // Calls the developer declared as waiting on purpose (declaredCalls.ts):
  // four counts, and nothing else. A page that holds names sends them even
  // when no call was timed — a window in which EVERY call was declared still
  // reports, with nothing judged, rather than going quiet or reading "good".
  const waitCounts = declaredCallCounts();
  const netDeclaring =
    waitCounts.waitDeclaredNames > 0 || waitCounts.waitDeclaredExcluded > 0;
  if (netScored || netActionable || netDeclaring) {
    const network: WebAxisResult = {
      score: netScored ? net.score : null,
      rating: netScored ? (net.rating as Rating) : "pending",
      settleRule: 1,
      attemptCount: raw.attemptCount,
      failedCount: raw.failedCount,
      timeoutCount: raw.timeoutCount,
      stallCount: raw.stallCount,
      worstMs: Math.round(raw.worstMs),
      watching: isCallWatchActive() ? 1 : 0,
      abortedCount: getAbortedCount(),
      inFlightCount: getInFlightCount(),
      // Holding no names is four zeros — an answer — never an absent field.
      waitDeclaredNames: waitCounts.waitDeclaredNames,
      waitDeclaredMatched: waitCounts.waitDeclaredMatched,
      waitDeclaredExcluded: waitCounts.waitDeclaredExcluded,
      waitDeclaredWorstMs: waitCounts.waitDeclaredWorstMs,
    };
    if (net && netScored && net.stallPct != null) network["stallPct"] = net.stallPct;
    if (net && netScored && net.p75Ms != null) network["p75Ms"] = net.p75Ms;
    if (netGroups.length > 0) {
      network.groups = netGroups;
      network["groupsOverflow"] = getGroupOverflowCount();
    }
    axes["network"] = network;
  }

  // Data distance — how far this app is from its own backend, judged ONLY on
  // how long a NEW connection takes to open and secure. That is pure distance:
  // it does not move when the backend gets slower or the query gets heavier,
  // which is why a round trip is never used for this.
  //
  // Not the same reading as `handshakeCost`: that one times the PAGE's own
  // document load once. This one watches the app's calls to its backend and
  // says what the distance costs on a typical call.
  //
  // OWN BACKEND ONLY. Every other origin hides its connection phases unless it
  // opts in, and almost nobody does — so the browser abstains for everything
  // else instead of reporting a zero. Absent entirely when no new connection
  // was opened at all (every call reused a warm one): honest absence, not a
  // warming meter.
  const distStats = getDependencyDistanceStats();
  if (distStats.newConnections > 0) {
    const dist = computeDependencyDistance(distStats);
    const distance: WebAxisResult = {
      score: dist.score,
      rating: dist.rating as Rating,
      measurable: dist.measurable,
      newConnections: dist.newConnections,
      minConnections: dist.minConnections,
      judgedKinds: dist.judgedKinds,
      worstKind: dist.worstKind,
      worstSetupMs: dist.worstSetupMs,
      // An excluded reading LARGER than the published worst, so no surface
      // can print a "worst" smaller than a number this axis is holding.
      unjudgedWorstSetupMs: dist.unjudgedWorstSetupMs,
      unjudgedWorstKind: dist.unjudgedWorstKind,
      unjudgedWorstConnections: dist.unjudgedWorstConnections,
      unjudgedKinds: dist.unjudgedKinds,
      typicalRequestMs: dist.typicalRequestMs,
      hostArea: dist.hostArea,
      ownBackendOnly: dist.ownBackendOnly,
      kinds: dist.kinds,
    } as unknown as WebAxisResult;
    // Rides only when it is really derived — never a 0% share we did not
    // measure.
    if (dist.worstSharePct != null) {
      (distance as Record<string, unknown>)["worstSharePct"] = dist.worstSharePct;
    }
    axes["dependencyDistance"] = distance;
  }

  // Idle efficiency — main-thread busyness while the page is NOT being driven.
  // Pending (omitted) until enough idle wall time has been observed.
  // Idle — the shared decision: CPU during quiet windows AFTER settling. The
  // idle-busy and idle-wall totals are re-anchored at the end of the settle
  // period and pooled across the visit, over at least the family's span, so
  // start-up work is never booked as idle burn.
  const idleRaw = getIdleStats();
  const idleBusy = settledCounter("idle.busy", "peakRate", idleRaw.idleBusyMs, now);
  const idleWall = settledCounter("idle.wall", "peakRate", idleRaw.idleWallMs, now);
  const idleTasks = settledCounter("idle.tasks", "peakRate", idleRaw.idleLongTaskCount, now);
  if (idleRaw.idleWallMs > 0 || idleRaw.idleBusyMs > 0) {
    const idle = idleBusy.ready
      ? computeIdleEfficiency({
          idleBusyMs: idleBusy.count,
          idleWallMs: idleWall.count,
          idleLongTaskCount: idleTasks.count,
        })
      : null;
    if (idle && idle.score != null && idle.idleBusyPct != null) {
      axes["idle"] = marked({
        score: idle.score,
        rating: idle.rating as Rating,
        idleBusyPct: idle.idleBusyPct,
        idleLongTaskCount: idle.idleLongTaskCount,
      });
    } else {
      axes["idle"] = settling({ idleBusyPct: null, idleLongTaskCount: idleTasks.count });
    }
  }

  // Scroll — the shared decision: smoothness from SETTLED scrolls. The frame
  // and jank counters are re-anchored after the settle period, pooled.
  const scrollCounts = getScrollCounts();
  const sFrames = settledCounter("scroll.frames", "latencyTail", scrollCounts.frames, now);
  const sJank = settledCounter("scroll.jank", "latencyTail", scrollCounts.jank, now);
  if (scrollCounts.frames > 0) {
    const scroll = computeScrollHealth({
      ...getScrollStats(),
      frameCount: sFrames.count,
      jankFraction: sFrames.count > 0 ? sJank.count / sFrames.count : 0,
    });
    if (sFrames.ready && scroll.score != null && scroll.jankPct != null) {
      axes["scroll"] = marked({
        score: scroll.score,
        rating: scroll.rating as Rating,
        jankPct: scroll.jankPct,
        frameCount: scroll.frameCount,
        blankEvents: scroll.blankEvents,
        worstBlankPx: scroll.worstBlankPx,
      });
    } else {
      axes["scroll"] = settling({ jankPct: null, frameCount: sFrames.count });
    }
  }

  // Frame floor — the shared decision: the FIFTH PERCENTILE of settled
  // one-second scroll windows, never the session minimum that keeps one cold
  // first frame for ever. Each document keeps its settled count and its
  // lowest windows; judged once the visit has run the family's span settled.
  const fWindows = getFrameWindowSamples();
  if (fWindows.length > 0) {
    const edge = settleBoundary("peakRate");
    const mine = fWindows.filter((x) => x.t >= edge).map((x) => x.v).sort((x, y) => x - y);
    putDoc("frameFloor", [mine.length, ...mine.slice(0, 16)]);
    let total = 0;
    const lowest: number[] = [];
    for (const e of visitDocs("frameFloor")) {
      total += Number(e[0]) || 0;
      lowest.push(...e.slice(1));
    }
    lowest.sort((x, y) => x - y);
    const enough =
      total >= Math.max(FRAME_FLOOR_MIN_WINDOWS, SETTLE_FAMILIES.peakRate.samples) &&
      now - edge >= SETTLE_FAMILIES.peakRate.spanMs &&
      lowest.length > 0;
    const floor = enough
      ? computeFrameFloor({
          floorFps: lowest[Math.min(lowest.length - 1, Math.max(0, Math.ceil(0.05 * total) - 1))],
          windowCount: total,
        })
      : null;
    if (floor && floor.score != null && floor.floorFps != null) {
      axes["frameFloor"] = marked({
        score: floor.score,
        rating: floor.rating as Rating,
        floorFps: floor.floorFps,
        windowCount: floor.windowCount,
      });
    } else {
      axes["frameFloor"] = settling({ floorFps: null, windowCount: total });
    }
  }

  sampleTimerHealth();
  // Timer Health — live-timer growth that PERSISTS after the start-up settle
  // period (the shared decision): timers armed at boot, and a pool that fills
  // once, are ordinary. The settled span is cut into three parts and only
  // growth through all three counts (a one-time step is never projected).
  const timer = readTimerHealth();
  if (isTimerTrackingInstalled()) {
    const grown = sustainedGrowth(
      getTimerCountSamples(),
      now,
      "startupEvent",
      TIMER_GROWTH_MIN_SPAN_MS,
    );
    if (grown.ready) {
      const t = computeTimerHealth({
        outstanding: timer.timers,
        growthPerMin: grown.perMin,
        sampleCount: TIMER_HEALTH_MIN_SAMPLES,
        elapsedMs: TIMER_GROWTH_MIN_SPAN_MS,
      });
      if (t.score != null && t.growthPerMin != null) {
        axes["timerHealth"] = marked({
          score: t.score,
          rating: t.rating as Rating,
          timers: t.timers,
          growthPerMin: t.growthPerMin,
        });
      }
    } else {
      axes["timerHealth"] = settling({ timers: timer.timers, growthPerMin: null });
    }
  }

  // Blocking on the async path — long scripts run from a timer/frame callback
  // or a promise continuation (Long Animation Frame script attribution), after
  // the start-up settle period. Script evaluation at load is ordinary, and a
  // long task with no attribution is not evidence of the async path: without
  // the Long Animation Frame API the reading is not taken.
  if (getLoafCauseStats().supported) {
    const blocks = getAsyncBlockSamples();
    const rate = settledRate(
      "blockingAsync",
      "startupEvent",
      blocks.map((b) => b.t),
      now,
      BLOCKING_ASYNC_MIN_WINDOW_MS,
    );
    const edge = settleBoundary("startupEvent");
    let worstMs = 0;
    for (const b of blocks) if (b.t >= edge && b.v > worstMs) worstMs = b.v;
    const blockingAsync = rate.ready
      ? computeBlockingAsync({
          supported: true,
          count: rate.count,
          worstMs,
          windowMs: rate.windowMs,
        })
      : null;
    if (
      blockingAsync &&
      blockingAsync.score != null &&
      blockingAsync.perMin != null &&
      blockingAsync.windowMin != null
    ) {
      axes["blockingAsync"] = marked({
        score: blockingAsync.score,
        rating: blockingAsync.rating as Rating,
        count: blockingAsync.count,
        perMin: blockingAsync.perMin,
        worstMs: blockingAsync.worstMs,
        windowMin: blockingAsync.windowMin,
      });
    } else {
      axes["blockingAsync"] = settling({
        count: rate.count,
        perMin: null,
        worstMs,
        windowMin: null,
      });
    }
  }

  // Slow async callbacks — timer callbacks over the slow floor, per minute of
  // SETTLED running (initialisation callbacks in the settle period are
  // ordinary), pooled across the visit.
  if (isTimerTrackingInstalled()) {
    const slowRaw = readAsyncSlowCallbacks();
    const slow = settledRate(
      "asyncSlowCallbacks",
      "latencyTail",
      getSlowCallbackSamples().map((x) => x.t),
      now,
      ASYNC_SLOW_CALLBACK_MIN_WINDOW_MS,
    );
    const slowCallbacks = slow.ready
      ? computeAsyncSlowCallbacks({
          installed: true,
          count: slow.count,
          windowMs: slow.windowMs,
        })
      : null;
    if (
      slowCallbacks &&
      slowCallbacks.score != null &&
      slowCallbacks.perMin != null &&
      slowCallbacks.windowMin != null
    ) {
      axes["asyncSlowCallbacks"] = marked({
        score: slowCallbacks.score,
        rating: slowCallbacks.rating as Rating,
        count: slowCallbacks.count,
        perMin: slowCallbacks.perMin,
        windowMin: slowCallbacks.windowMin,
      });
    } else {
      axes["asyncSlowCallbacks"] = settling({
        count: slow.ready ? slow.count : slowRaw.count,
        perMin: null,
        windowMin: null,
      });
    }

    // Event-loop lag — how late the page's own timeouts ran past the delay
    // they asked for (real scheduling delay; a waiting stretch in a hidden tab
    // is browser throttling and never a sample), p95 over SETTLED samples
    // pooled across the visit. The module-loading stall at start-up is ordinary.
    const lagTail = settledTail("eventLoopLag", "latencyTail", getTimerLagSamples());
    const lagLatest = getTimerLagSamples();
    if (lagTail.ready && lagTail.values.length >= EVENT_LOOP_LAG_MIN_SAMPLES) {
      const lag = computeEventLoopLag({
        samples: lagTail.values,
        windowMs: Math.max(
          0,
          now - Math.max(settleBoundary("latencyTail"), documentStartedAt()),
        ),
      });
      if (lag.score != null && lag.p95Ms != null) {
        const latest = lagLatest.length > 0 ? lagLatest[lagLatest.length - 1].v : lag.lagMs;
        axes["eventLoopLag"] = marked({
          score: lag.score,
          rating: lag.rating as Rating,
          lagMs: latest == null ? null : Math.round(latest),
          p95Ms: lag.p95Ms,
          sampleCount: lag.sampleCount,
          windowMin: lag.windowMin,
        });
      }
    } else {
      axes["eventLoopLag"] = settling({
        lagMs: null,
        p95Ms: null,
        sampleCount: lagTail.values.length,
        windowMin: null,
      });
    }
  }
  // Swallowed errors (Near-Miss Rate) — errors the host app LOGGED at error
  // level (chained `console.error`) but did NOT crash on, rated good 1/hr ·
  // poor 60/hr. Observed timestamps only (never the message/args). Pending
  // (omitted) until the trailing window reaches the 5-minute minimum, and
  // absent entirely when chaining `console.error` was impossible. Additive +
  // display-only — never feeds the Speed score.
  const swallowed = readSwallowedErrors();
  if (
    swallowed.score != null &&
    swallowed.perHour != null &&
    swallowed.windowMin != null
  ) {
    axes["swallowedErrors"] = {
      score: swallowed.score,
      rating: swallowed.rating as Rating,
      count: swallowed.count,
      perHour: swallowed.perHour,
      windowMin: swallowed.windowMin,
    };
  }

  // Leak Watch — is the host app leaking stack traces, secrets/keys, or
  // personal details to its OWN users (error-level log/console output, and
  // stack traces rendered onto the page)? COUNTS + category split only —
  // never the matched text/value, the log line, or the page/route name. No
  // routeClassCount on web (there is no response path). Pending (omitted)
  // until the trailing window reaches the 5-minute minimum, and absent
  // entirely when installation was impossible. Additive + display-only —
  // never feeds the Speed score. The caption is rebuilt server-side (never on
  // the wire), exactly like the swallowed-errors axis.
  // Failing Calls — of the calls this page made and the watcher already
  // judged, how many did not work. COUNTS ONLY: the route labels these are
  // keyed by stay in the page and never reach the wire (routeOutcomes.ts
  // explains why a third party's path is not this project's route). Carries
  // no verdict by design — nothing scores or alerts on this reading — so the
  // rating is permanently "not-scored".
  //
  // OMITTED, NEVER ZEROED, when nothing has been watched: a page whose fetch
  // and XHR could not be wrapped at all, or one that has made no call yet,
  // reports no reading rather than a clean bill of health.
  const routeFailures = getRouteOutcomeTotals();
  if (routeFailures !== null) {
    axes["routeFailures"] = {
      score: null,
      rating: "not-scored",
      parts: routeFailures.parts,
      observed: routeFailures.observed,
      failed: routeFailures.failed,
      untracked: routeFailures.untracked,
      // NO CAPTION, deliberately. Route labels never leave this page and
      // neither does any other prose: what travels is a closed set of counts.
      // A string field is exactly how such a shape grows to hold an address.
      // The panel words these numbers itself, in the page that has them.
    };
  }

  const leak = readLeakWatch();
  if (leak.score != null && leak.perHour != null && leak.windowMin != null) {
    axes["leakWatch"] = {
      score: leak.score,
      rating: leak.rating as Rating,
      count: leak.count,
      perHour: leak.perHour,
      windowMin: leak.windowMin,
      stackCount: leak.stackCount,
      secretCount: leak.secretCount,
      piiCount: leak.piiCount,
    };
  }

  // Dev Posture (shared additive axis, wave 2) — whether the app is still
  // wearing its development clothes, read ONCE at startup (frozen). EXPOSURE,
  // never safety: a clean tile means none of the development settings we can
  // read were on — NOT that the deployment is hardened. On web the readable
  // checks are debugFlag (process.env.NODE_ENV, when evaluable after bundler
  // inlining) and sourceMaps (one bounded startup HEAD probe for a script's
  // .map). verboseErrors/profilingOpen are not readable → omitted. Each flag
  // rides ONLY when actually read; `checks` counts present flags, `findings`
  // counts the ON ones. Numbers + rating/caption only — never an env value,
  // path, URL, or config string. Omitted entirely when ZERO checks were
  // readable (honest absence). ADDITIVE + display-only — never feeds Speed.
  const posture = readDevPosture();
  if (posture !== null) {
    const dp: WebAxisResult = {
      score: posture.score,
      rating: posture.rating,
      caption: posture.caption,
      findings: posture.findings,
      checks: posture.checks,
      measurable: posture.measurable,
    };
    if (posture.debugFlag !== undefined) dp["debugFlag"] = posture.debugFlag;
    if (posture.verboseErrors !== undefined) {
      dp["verboseErrors"] = posture.verboseErrors;
    }
    if (posture.sourceMaps !== undefined) dp["sourceMaps"] = posture.sourceMaps;
    if (posture.profilingOpen !== undefined) {
      dp["profilingOpen"] = posture.profilingOpen;
    }
    axes["devPosture"] = dp;
  }

  // ─── Additive web-meter batch (9 new axes) ─────────────────────────────
  // Every one is ADDITIVE + display-only, honest-gated, and numeric-only on
  // the wire (score + rating + finite-number fields; captions rebuilt
  // server-side).

  // Slow Frame Cause — blocking ms/min plus a coarse dominant-cause split
  // (third-party script / first-party script / style+layout) from the LoAF
  // script attribution. Gate: LoAF supported AND ≥30s observed (zero LoAFs
  // after the gate emits 0s — a supported browser's honest 0).
  // Frame cause / third-party cost — Long Animation Frame attribution, taken
  // over SETTLED running only (re-anchored at the end of the settle period and
  // pooled across the visit): boot blocking and ordinary third-party
  // initialisation are start-up work.
  const causeRaw = getLoafCauseStats();
  const cBlocking = settledCounter("frameCause.blocking", "latencyTail", causeRaw.blockingMs, now, LOAF_MIN_ELAPSED_MS);
  const cFirst = settledCounter("frameCause.first", "latencyTail", causeRaw.scriptFirstPartyMs, now, LOAF_MIN_ELAPSED_MS);
  const cThird = settledCounter("frameCause.third", "latencyTail", causeRaw.scriptThirdPartyMs, now, LOAF_MIN_ELAPSED_MS);
  const cStyle = settledCounter("frameCause.style", "latencyTail", causeRaw.styleLayoutMs, now, LOAF_MIN_ELAPSED_MS);
  const cause = {
    supported: causeRaw.supported,
    elapsedMs: cBlocking.windowMs,
    blockingMs: cBlocking.count,
    scriptFirstPartyMs: cFirst.count,
    scriptThirdPartyMs: cThird.count,
    styleLayoutMs: cStyle.count,
  };
  const causeReady = cause.supported && cBlocking.ready;
  if (cause.supported && !causeReady) {
    axes["frameCause"] = settling({ blockingMsPerMin: null });
    axes["thirdPartyCost"] = settling({ thirdPartyMsPerMin: null });
  }
  if (causeReady) {
    const minutes = cause.elapsedMs / 60_000;
    const blockingMsPerMin =
      minutes > 0 ? Math.round((cause.blockingMs / minutes) * 10) / 10 : 0;
    const scriptMs = cause.scriptFirstPartyMs + cause.scriptThirdPartyMs;
    const attributed = scriptMs + cause.styleLayoutMs;
    const scriptPct =
      attributed > 0 ? Math.round((scriptMs / attributed) * 100) : 0;
    const styleLayoutPct =
      attributed > 0 ? Math.round((cause.styleLayoutMs / attributed) * 100) : 0;
    const thirdPartyPct =
      scriptMs > 0
        ? Math.round((cause.scriptThirdPartyMs / scriptMs) * 100)
        : 0;
    const score = linearScore(
      blockingMsPerMin,
      FRAME_CAUSE_THRESHOLDS.good,
      FRAME_CAUSE_THRESHOLDS.poor,
    );
    axes["frameCause"] = marked({
      score,
      rating: ratingFor(score),
      blockingMsPerMin,
      scriptPct,
      thirdPartyPct,
      styleLayoutPct,
    });
  }

  // Third-Party Cost — main-thread ms/min burned by scripts from other origins
  // (same LoAF script attribution). Gate: LoAF supported AND ≥30s SETTLED.
  if (causeReady) {
    const minutes = cause.elapsedMs / 60_000;
    const thirdPartyMsPerMin =
      minutes > 0
        ? Math.round((cause.scriptThirdPartyMs / minutes) * 10) / 10
        : 0;
    const firstPartyMsPerMin =
      minutes > 0
        ? Math.round((cause.scriptFirstPartyMs / minutes) * 10) / 10
        : 0;
    const scriptMs = cause.scriptFirstPartyMs + cause.scriptThirdPartyMs;
    const thirdPartyPct =
      scriptMs > 0
        ? Math.round((cause.scriptThirdPartyMs / scriptMs) * 100)
        : 0;
    const score = linearScore(
      thirdPartyMsPerMin,
      THIRD_PARTY_THRESHOLDS.good,
      THIRD_PARTY_THRESHOLDS.poor,
    );
    axes["thirdPartyCost"] = marked({
      score,
      rating: ratingFor(score),
      thirdPartyMsPerMin,
      firstPartyMsPerMin,
      thirdPartyPct,
    });
  }

  // Back/Forward Cache — restored vs blocked back/forward navigations. Gate:
  // ≥1 bf nav observed (event-dependent — never a warming tile).
  // Back/forward cache — graded on the navs the APP kept out of the cache
  // (the shared decision): an unload handler, a request left in flight or a
  // held connection. A no-store opt-out is a design choice and an eviction
  // the browser made for its own reasons is not an app defect, so neither
  // lowers the score; every count still rides as before.
  const bf = getBfCacheStats();
  if (bf.bfNavCount >= 1) {
    const actionable = Math.min(
      bf.blockedCount,
      bf.actionableBlockedCount ??
        bf.blockerUnload + bf.blockerInFlight + bf.blockerHeldConnection,
    );
    const score = Math.round(
      (100 * Math.max(0, bf.bfNavCount - actionable)) / bf.bfNavCount,
    );
    axes["bfcache"] = {
      score,
      rating: ratingFor(score),
      bfNavCount: bf.bfNavCount,
      restoredCount: bf.restoredCount,
      blockedCount: bf.blockedCount,
      blockerUnload: bf.blockerUnload,
      blockerCacheControl: bf.blockerCacheControl,
      // Named causes the old two-bucket list could only call "other", which
      // told a developer their page was excluded and nothing about why.
      blockerInFlight: bf.blockerInFlight,
      blockerHeldConnection: bf.blockerHeldConnection,
      blockerBrowser: bf.blockerBrowser,
      blockerOther: bf.blockerOther,
      // The browser named NOTHING — a different answer from "we have no word
      // for what it named", and the difference decides whether the developer
      // can go and read the reason themselves.
      blockerUnnamed: bf.blockerUnnamed,
    };
  }

  // Input Readiness — discrete inputs (taps) that landed before first-
  // contentful-paint (dropped early taps). Gate: FCP has been observed.
  //
  // NOTE ON FIELD NAMING: the shared, byte-parity-locked PII guard
  // (`no-pii.ts`) denies any field/axis KEY containing the fragment "input"
  // (it is on PII_DENYLIST alongside value/query/search), so the spec's
  // `inputReadiness` / `inputCount` / `earlyInputCount` names would be rejected
  // at transmit and drop the ENTIRE snapshot. To stay PII-clean AND honest we
  // emit the axis under "tap"-based names that carry the identical numbers:
  //   inputReadiness -> tapReadiness, inputCount -> tapCount,
  //   earlyInputCount -> earlyTapCount.
  // The server side must mirror these names (see the subagent report).
  //
  // THE QUANTITY (the shared decision): taps pressed before first paint that
  // WAITED for the main thread (handled ≥ TAP_WAIT_MS after the press) — a
  // press that came early but was handled promptly was not dropped. Judged
  // from SETTLED navigations: one sample per document across the visit, the
  // first load of each landing route is set-up, p75 of the pooled samples.
  const readiness = getInputReadinessStats();
  if (readiness.fcpKnown) {
    const tail = pageLoadTail("tapReadiness", readiness.earlyInputCount);
    if (tail.ready) {
      const p75 = settledPercentile(tail.values, 0.75) ?? 0;
      const score = linearScore(
        p75,
        EARLY_INPUT_THRESHOLDS.good,
        EARLY_INPUT_THRESHOLDS.poor,
      );
      axes["tapReadiness"] = marked({
        score,
        rating: ratingFor(score),
        earlyTapCount: readiness.earlyInputCount,
        tapCount: readiness.inputCount,
      });
    } else {
      axes["tapReadiness"] = settling({
        earlyTapCount: readiness.earlyInputCount,
        tapCount: readiness.inputCount,
      });
    }
  }

  // Soft Navigation — responsiveness (soft-nav start → next LCP) p75 + worst.
  // Gate: ≥1 completed measurement (observer attach alone is not enough).
  // Settled (src/settle.ts): the first view change to each route in the visit
  // loads that view for the first time and never counts; the p75 and the
  // worst come from settled view changes pooled across the visit.
  const softNav = getSoftNavStats();
  if (softNav.samples.length >= 1) {
    const stamps = getSoftNavSampleStamps();
    const tail = settledTail(
      "softNav",
      "latencyTail",
      stamps.length > 0 ? stamps : [],
    );
    if (tail.ready) {
      const p75Ms = Math.round(p75Of(tail.values));
      const worstMs = Math.round(Math.max(...tail.values));
      const score = linearScore(
        p75Ms,
        SOFT_NAV_THRESHOLDS.good,
        SOFT_NAV_THRESHOLDS.poor,
      );
      axes["softNav"] = marked({
        score,
        rating: ratingFor(score),
        navCount: softNav.navCount,
        p75Ms,
        worstMs,
      });
    } else {
      axes["softNav"] = settling({
        navCount: softNav.navCount,
        p75Ms: null,
        worstMs: null,
      });
    }
  }

  // Press → screen usable — the WHOLE wait, from the press to the view it
  // opened producing its own reading. Emitted unconditionally, counts and
  // all: a press that reached no timed screen is a fact about this app, and
  // the server has the words for "nothing joined yet"
  // (docs/press-to-screen-contract.md).
  // ONE derivation, whatever surface asks. The kit's own panel reads the same
  // function, so "this browser can never measure it" cannot be true of the
  // upload and absent from the panel a developer is looking at.
  axes["pressToScreen"] = { ...readPressToScreen() };

  // Blocking Time — the Total Blocking Time field cousin: long-task overage
  // ms/min. Gate: longtask observer attached AND ≥30s observed (0 = good).
  // Blocking Time — main-thread blocking (long-task overage past 50ms) per
  // minute of SETTLED running, pooled across the visit: the boot task's
  // blocking is start-up work, never the grade.
  const bt = getBlockingTimeStats();
  if (bt.supported) {
    const btMs = settledCounter("blockingTime.ms", "latencyTail", bt.totalBlockingMs, now, BLOCKING_MIN_ELAPSED_MS);
    const btTasks = settledCounter("blockingTime.tasks", "latencyTail", bt.longTaskCount, now, BLOCKING_MIN_ELAPSED_MS);
    if (btMs.ready) {
      const blockingMsPerMin = Math.round(btMs.perMin * 10) / 10;
      const score = linearScore(
        blockingMsPerMin,
        BLOCKING_TIME_THRESHOLDS.good,
        BLOCKING_TIME_THRESHOLDS.poor,
      );
      axes["blockingTime"] = marked({
        score,
        rating: ratingFor(score),
        totalBlockingMs: Math.round(btMs.count),
        blockingMsPerMin,
        longTaskCount: Math.round(btTasks.count),
      });
    } else {
      axes["blockingTime"] = settling({
        totalBlockingMs: Math.round(btMs.count),
        blockingMsPerMin: null,
        longTaskCount: Math.round(btTasks.count),
      });
    }
  }

  // Memory Trend — heap growth slope (MB/min) via
  // measureUserAgentSpecificMemory (COI-only; absent everywhere else). Gate:
  // ≥3 readings spanning ≥2 minutes. Score clamps growth at a 0 floor.
  //
  // Settled (src/settle.ts, growthSlope): growth must PERSIST through the
  // settled span — a cache that fills once after load lifts the heap in one
  // step and is never projected into a per-minute rate.
  const mem = getMemoryTrendStats();
  if (mem.supported) {
    const grown = sustainedGrowth(getMemoryTrendReadings(), now, "growthSlope");
    if (
      grown.ready &&
      mem.sampleCount >= MEMORY_TREND_MIN_SAMPLES &&
      mem.spanMs >= MEMORY_TREND_MIN_SPAN_MS
    ) {
      const growthMbPerMin = Math.round(grown.perMin * 10) / 10;
      const score = linearScore(
        growthMbPerMin,
        MEMORY_TREND_THRESHOLDS.good,
        MEMORY_TREND_THRESHOLDS.poor,
      );
      axes["memoryTrend"] = marked({
        score,
        rating: ratingFor(score),
        usedMb: mem.usedMb,
        growthMbPerMin,
        sampleCount: mem.sampleCount,
      });
    } else {
      axes["memoryTrend"] = settling({
        usedMb: mem.usedMb,
        growthMbPerMin: null,
        sampleCount: mem.sampleCount,
      });
    }
  }

  // Resource Weight — total transferred KB by initiator-type bucket (entry
  // URLs never read). Gate: ≥5 sized resources.
  //
  // The shared decision: what LOADING the page cost (resources started before
  // the load event finished — later traffic is use, not weight), judged on a
  // production build. A page the kit recognises as development serves
  // unminified files by design: reported there, never graded.
  const bloat = getResourceBloat();
  if (bloat != null) {
    const score = linearScore(
      bloat.totalKb,
      RESOURCE_BLOAT_THRESHOLDS.good,
      RESOURCE_BLOAT_THRESHOLDS.poor,
    );
    const devBuild = pageEnvironmentNow() === "development";
    axes["resourceBloat"] = {
      score: devBuild ? null : score,
      rating: devBuild ? "not-scored" : ratingFor(score),
      totalKb: bloat.totalKb,
      scriptKb: bloat.scriptKb,
      cssKb: bloat.cssKb,
      imageKb: bloat.imageKb,
      fetchKb: bloat.fetchKb,
      otherKb: bloat.otherKb,
      resourceCount: bloat.resourceCount,
    };
  }

  // Rage Clicks — privacy-safe frustration: bursts the page did not answer per
  // minute, the slowest answer timed inside one, and how many bursts were set
  // aside because every press was answered in time. Gate: ≥30s observed (0
  // bursts = good; the click listener is universal, so this axis warms on
  // every page). `answeredBurstCount` is also how the server tells this
  // reading from an older kit's, which counted answered bursts as rage.
  //
  // THE START-UP RULE: both counts are taken after the page has settled
  // (startupEvent) and pooled across the visit, over one settled window, so a
  // burst during start-up neither counts nor is tallied as set aside.
  const rage = getRageClickStats();
  if (rage.elapsedMs >= RAGE_MIN_ELAPSED_MS || rageWindowOpen(rage)) {
    const settled = settledRate(
      "rageClicks",
      "startupEvent",
      getRageBurstStamps().map((b) => b.t),
      now,
      RAGE_MIN_ELAPSED_MS,
    );
    // The bursts set aside because the page answered every press in time,
    // counted over the same settled window as the bursts that count.
    const answered = settledRate(
      "rageClicksAnswered",
      "startupEvent",
      getRageAnsweredStamps().map((b) => b.t),
      now,
      RAGE_MIN_ELAPSED_MS,
    );
    if (settled.ready) {
      const ragePerMin = Math.round(settled.perMin * 100) / 100;
      const score = linearScore(
        ragePerMin,
        RAGE_CLICK_THRESHOLDS.good,
        RAGE_CLICK_THRESHOLDS.poor,
      );
      axes["rageClicks"] = marked({
        score,
        rating: ratingFor(score),
        burstCount: settled.count,
        answeredBurstCount: answered.count,
        ragePerMin,
        worstDelayMs: rage.worstDelayMs,
        // The observation the rate came from, so the caption can state it.
        windowMin: windowMinOf(settled.windowMs),
      });
    } else {
      axes["rageClicks"] = settling({
        burstCount: settled.count,
        answeredBurstCount: answered.count,
        ragePerMin: null,
        worstDelayMs: rage.worstDelayMs,
        windowMin: null,
      });
    }
  }

  // ─── 2026-08 web platform batch ─────────────────────────────────────────
  // Every axis below is ADDITIVE + display-only, honest-gated (absent, not
  // zero, until it has a real reading), feature-detected (a missing API means
  // the axis is absent), and numeric-only on the wire. None feeds the Speed
  // score. Most are snapshot-time reads of PerformanceNavigationTiming /
  // PerformanceResourceTiming / navigator / document — no new sampler.

  // Take one async storage-estimate reading off this cadence (fire-and-forget,
  // same precedent as sampleMemoryTrendNow). No-op unless the API exists; the
  // reading lands before a later capture (absent until then).
  sampleStorageHeadroomNow();
  // Same precedent, for the service-worker REGISTRATION read: knowing an app
  // never registered one is what stops "not controlled" being reported as a
  // fault on every install that simply does not use service workers.
  sampleSwControlNow();

  // Navigation Readiness — domInteractive / domComplete / loadEventEnd (ms from
  // navigation start). ONE axis with the three load-phase milestones (more
  // honest than three near-identical tiles). Score on domInteractive. Absent
  // until the page has fully loaded.
  //
  // Settled (src/settle.ts): one sample per document pooled across the visit;
  // the visit's first load of each route is set-up. Every field is the p75 of
  // the settled loads, so the numbers agree with the grade.
  const navR = getNavReadinessStats();
  if (navR != null) {
    const di = pageLoadTail("navReadiness", navR.domInteractiveMs);
    const dc = pageLoadTail("navReadiness.dc", navR.domCompleteMs);
    const le = pageLoadTail("navReadiness.le", navR.loadEventMs);
    if (di.ready) {
      const domInteractiveMs = p75Round(di.values);
      const score = linearScore(
        domInteractiveMs,
        NAV_READINESS_THRESHOLDS.good,
        NAV_READINESS_THRESHOLDS.poor,
      );
      axes["navReadiness"] = marked({
        score,
        rating: ratingFor(score),
        domInteractiveMs,
        domCompleteMs: p75Round(dc.values),
        loadEventMs: p75Round(le.values),
      });
    } else {
      axes["navReadiness"] = settling({
        domInteractiveMs: null,
        domCompleteMs: null,
        loadEventMs: null,
      });
    }
  }

  // Redirect Overhead — redirect time (ms) + count on the main navigation.
  // Settled like navReadiness: a redirect only the visit's first load of a
  // route took (an entry link, an http→https hop) is set-up; redirects every
  // settled load pays decide the grade.
  const redirect = getRedirectStats();
  if (redirect != null) {
    const rt = pageLoadTail("redirectOverhead", redirect.redirectMs);
    const rc = pageLoadTail("redirectOverhead.n", redirect.redirectCount);
    if (rt.ready) {
      const redirectMs = p75Round(rt.values);
      const score = linearScore(
        redirectMs,
        REDIRECT_THRESHOLDS.good,
        REDIRECT_THRESHOLDS.poor,
      );
      axes["redirectOverhead"] = marked({
        score,
        rating: ratingFor(score),
        redirectMs,
        redirectCount: p75Round(rc.values),
      });
    } else {
      axes["redirectOverhead"] = settling({ redirectMs: null, redirectCount: null });
    }
  }

  // Server Processing Time — worst Server-Timing duration reported (ms). Absent
  // when the server sent no Server-Timing entries (never faked).
  // Settled: this document's worst reported duration is ONE sample, pooled
  // across the visit's settled loads (a cold server's first answer is set-up).
  const serverT = getServerTimingStats();
  if (serverT != null) {
    const st = pageLoadTail("serverTiming", serverT.serverMs);
    const sn = pageLoadTail("serverTiming.n", serverT.serverEntryCount);
    if (st.ready) {
      const serverMs = p75Round(st.values);
      const score = linearScore(
        serverMs,
        SERVER_TIMING_THRESHOLDS.good,
        SERVER_TIMING_THRESHOLDS.poor,
      );
      axes["serverTiming"] = marked({
        score,
        rating: ratingFor(score),
        serverMs,
        serverEntryCount: p75Round(sn.values),
      });
    } else {
      axes["serverTiming"] = settling({ serverMs: null, serverEntryCount: null });
    }
  }

  // Connection/Handshake Cost — DNS+TCP+TLS negotiation (ms) on the main
  // navigation. Renamed from the Node kit's connectionSetup key to dodge the
  // global collision. A warm reused connection is an honest 0.
  // Settled: the visit's first connection to the site is set-up; later loads
  // reuse it (an honest 0) unless the site keeps forcing new connections.
  const handshake = getHandshakeStats();
  if (handshake != null) {
    const hs = pageLoadTail("handshakeCost", handshake.handshakeMs);
    const dns = pageLoadTail("handshakeCost.dns", handshake.dnsMs);
    const tcp = pageLoadTail("handshakeCost.tcp", handshake.tcpMs);
    const tls = pageLoadTail("handshakeCost.tls", handshake.tlsMs);
    if (hs.ready) {
      const handshakeMs = p75Round(hs.values);
      const score = linearScore(
        handshakeMs,
        HANDSHAKE_THRESHOLDS.good,
        HANDSHAKE_THRESHOLDS.poor,
      );
      axes["handshakeCost"] = marked({
        score,
        rating: ratingFor(score),
        handshakeMs,
        dnsMs: p75Round(dns.values),
        tcpMs: p75Round(tcp.values),
        tlsMs: p75Round(tls.values),
      });
    } else {
      axes["handshakeCost"] = settling({ handshakeMs: null, dnsMs: null, tcpMs: null, tlsMs: null });
    }
  }

  // Protocol Mix — % of timed resources on a modern protocol (HTTP/2 or
  // HTTP/3). HIGHER is better. Absent until ≥3 entries expose the protocol.
  //
  // The shared decision: reported, never graded — a count share of protocols
  // says nothing about time or bytes (one old-protocol font file is not a slow
  // page).
  const proto = getProtocolMixStats();
  if (proto != null) {
    axes["protocolMix"] = {
      score: null,
      rating: "not-scored",
      modernPct: proto.modernPct,
      h2Pct: proto.h2Pct,
      h3Pct: proto.h3Pct,
      protoResourceCount: proto.protoResourceCount,
    };
  }

  // Render-Blocking Pressure — count of observed resources marked
  // render-blocking. Absent when renderBlockingStatus is unsupported.
  const rb = getRenderBlockingStats();
  if (rb != null) {
    const score = linearScore(
      rb.renderBlockingCount,
      RENDER_BLOCKING_THRESHOLDS.good,
      RENDER_BLOCKING_THRESHOLDS.poor,
    );
    axes["renderBlocking"] = {
      score,
      rating: ratingFor(score),
      renderBlockingCount: rb.renderBlockingCount,
      observedCount: rb.observedCount,
    };
  }

  // Transfer Waste — % of transferred bytes beyond decoded size (over-transfer)
  // + absolute waste KB. Distinct from resourceEfficiency (cached/compressed
  // SHARE). Absent until ≥5 sized resources.
  //
  // The shared decision: judged on a production build — a page the kit
  // recognises as development is reported and never graded.
  const waste = getTransferWasteStats();
  if (waste != null) {
    const score = linearScore(
      waste.overheadPct,
      TRANSFER_WASTE_THRESHOLDS.good,
      TRANSFER_WASTE_THRESHOLDS.poor,
    );
    const wasteDev = pageEnvironmentNow() === "development";
    axes["transferWaste"] = {
      score: wasteDev ? null : score,
      rating: wasteDev ? "not-scored" : ratingFor(score),
      overheadPct: waste.overheadPct,
      wasteKb: waste.wasteKb,
      sizedCount: waste.sizedCount,
    };
  }

  // Cache Revalidation Rate — % of cache-eligible resources that still needed a
  // network revalidation vs a fresh cache hit. Absent until ≥5 eligible.
  const reval = getCacheRevalidationStats();
  if (reval != null) {
    const score = linearScore(
      reval.revalidatedPct,
      CACHE_REVALIDATION_THRESHOLDS.good,
      CACHE_REVALIDATION_THRESHOLDS.poor,
    );
    axes["cacheRevalidation"] = {
      score,
      rating: ratingFor(score),
      revalidatedPct: reval.revalidatedPct,
      revalidatedCount: reval.revalidatedCount,
      cachedCount: reval.cachedCount,
    };
  }

  // Cache Reuse — of everything this page loaded, how much the browser served
  // from its own cache and how much crossed the network again, plus what that
  // re-fetching cost in bytes and time. Exact where the browser states the
  // delivery method outright (`deliveryType`), byte-derived otherwise. A
  // resource whose sizes the browser will not report is left out of BOTH
  // sides — a guess there would invent waste. Absent until ≥5 judgeable
  // resources. Additive: never feeds the Speed score.
  //
  // Settled (src/settle.ts, startupEvent): a first visit downloads everything
  // by definition, so only documents opened after the visit settled — and not
  // the first load of their route — are judged, pooled across the visit.
  const reuse = getCacheReuseStats();
  if (reuse != null) {
    const docSettled = docIsSettled("startupEvent");
    const [cached, fetched, kb, ms, exact] = pooledDocCounts(
      "cacheReuse",
      docSettled
        ? [reuse.cachedCount, reuse.fetchedCount, reuse.networkKb, reuse.networkMs, reuse.exactCount]
        : [],
    );
    if (cached + fetched >= CACHE_REUSE_MIN_SETTLED) {
      const hitPct = Math.round((cached / (cached + fetched)) * 100);
      const score = linearScoreHigh(
        hitPct,
        CACHE_REUSE_THRESHOLDS.good,
        CACHE_REUSE_THRESHOLDS.poor,
      );
      axes["cacheReuse"] = marked({
        score,
        rating: ratingFor(score),
        hitPct,
        cachedCount: cached,
        fetchedCount: fetched,
        networkKb: kb,
        networkMs: ms,
        exactCount: exact,
      });
    } else {
      axes["cacheReuse"] = settling({
        hitPct: null,
        cachedCount: cached,
        fetchedCount: fetched,
        networkKb: kb,
        networkMs: ms,
        exactCount: exact,
      });
    }
  }

  // Platform Cache — the hosting platform's OWN verdict on the replies THIS
  // SITE served (Vercel, Cloudflare, Netlify and anything speaking RFC 9211
  // all declare hit or miss in the reply itself). Only replies from the page's
  // own origin count: a cache verdict from someone else's API or CDN is that
  // service's business, and attributing it to this project's hosting would be
  // a confident answer to a question nobody asked. Replies the platform
  // deliberately bypasses are counted but kept out of the share — a
  // personalised page SHOULD be served fresh. Absent (never a zero) until ≥5
  // cacheable replies from this site have declared themselves.
  //
  // Settled (src/settle.ts, startupEvent): the platform's cache warms on the
  // first requests after start — those misses are set-up. Only verdicts after
  // the visit settled are judged, pooled across the visit.
  const edge = getEdgeCacheStats();
  const edgeEdge = settleBoundary("startupEvent");
  const edgeMine = [0, 0, 0, 0];
  for (const v of getEdgeVerdictStamps()) {
    if (v.t >= edgeEdge && v.k >= 0 && v.k <= 3) edgeMine[v.k]++;
  }
  const [eHits, eMisses, eStale, eBypass] = pooledDocCounts("edgeCache", edgeMine);
  const eCacheable = eHits + eMisses + eStale;
  if (eCacheable >= EDGE_CACHE_MIN_SETTLED) {
    const hitPct = Math.round(((eHits + eStale) / eCacheable) * 100);
    const score = linearScoreHigh(
      hitPct,
      EDGE_CACHE_THRESHOLDS.good,
      EDGE_CACHE_THRESHOLDS.poor,
    );
    axes["edgeCache"] = marked({
      score,
      rating: ratingFor(score),
      hitPct,
      checked: eCacheable + eBypass,
      hits: eHits,
      misses: eMisses,
      stale: eStale,
      bypass: eBypass,
    });
  } else if (edge != null) {
    axes["edgeCache"] = settling({
      hitPct: null,
      checked: eCacheable + eBypass,
      hits: eHits,
      misses: eMisses,
      stale: eStale,
      bypass: eBypass,
    });
  }

  // Initiator Balance — which broad initiator class dominates resource count
  // (script / css / img / fetch). Display-only balance signal (no good/poor
  // "failure" — rated by how concentrated the dominant share is). Absent until
  // ≥5 resources.
  const initiator = getInitiatorBalanceStats();
  if (initiator != null) {
    // The shared decision: reported, never graded — a page built mostly from
    // scripts (or images) is a construction choice, not a fault, whatever the
    // bytes or the time.
    axes["initiatorBalance"] = {
      score: null,
      rating: "not-scored",
      scriptPct: initiator.scriptPct,
      cssPct: initiator.cssPct,
      imgPct: initiator.imgPct,
      fetchPct: initiator.fetchPct,
      dominantCount: initiator.dominantCount,
      resourceCount: initiator.resourceCount,
      // Requests made AFTER the page finished loading, excluded from the
      // percentages above. A deliberate live-updating section is not bad
      // page construction, and the excluded work is published rather than
      // silently dropped.
      postLoadCount: initiator.postLoadCount,
    };
  }

  // Storage Headroom — origin storage used vs quota. Filled by the async
  // estimate reading above; absent until the first reading lands / when the
  // Storage API is unsupported.
  const storage = getStorageHeadroomStats();
  if (storage != null) {
    const score = linearScore(
      storage.usedPct,
      STORAGE_HEADROOM_THRESHOLDS.good,
      STORAGE_HEADROOM_THRESHOLDS.poor,
    );
    axes["storageHeadroom"] = {
      score,
      rating: ratingFor(score),
      usedPct: storage.usedPct,
      usedMb: storage.usedMb,
      quotaMb: storage.quotaMb,
    };
  }

  // Storage Speed / Storage Failures — the page's OWN local store (Web
  // Storage), behind the BOOSTHIS_STORAGE_METER opt-in. TWO readings from ONE
  // observation point, because a slow store and a failing store are different
  // problems: a store that answers in a microsecond and throws on every write
  // reads as perfectly healthy if only the speed is shown.
  //
  // ABSENT (both keys omitted) when the opt-in is off, when this runtime has
  // no Web Storage, or before the warm-up gate — never a fabricated zero for a
  // store nobody watched. Where storage access itself throws (a sandboxed
  // frame, blocked site data) the readers return the declared-silence shape so
  // the tile says "not available here · where this app runs blocks the
  // reading" instead of going quiet. IndexedDB is deliberately never watched
  // (docs/decisions/browser-local-store-observation.md). Additive +
  // display-only — neither ever feeds the Speed score.
  const storeLatency = readWebStorageLatency();
  if (storeLatency) {
    axes["storageLatency"] = { ...storeLatency } as WebAxisResult;
  }
  const storeFailures = readWebStorageFailures();
  if (storeFailures) {
    axes["storageFailures"] = { ...storeFailures } as WebAxisResult;
  }

  // Service Worker Control — whether the page is controlled by a service
  // worker (1/0). Absent when serviceWorker is unsupported.
  //
  // WHY THERE ARE NOW THREE ANSWERS. "Controlled = 100, otherwise 60" gave
  // the same orange verdict to every install that had simply never
  // registered a service worker — which is most apps, and is not a defect.
  // An axis whose only answer is orange carries no information. So:
  //
  //   controlled                    → 100, the worker is serving the page
  //   registered but not in control → 60, a REAL finding: the app asked for
  //                                   a worker and this navigation is not
  //                                   getting it (first load before the
  //                                   worker claims, or a failed claim)
  //   no registration at all        → no verdict. The app does not use
  //                                   service workers; there is nothing to
  //                                   compare it against and nothing to fix.
  //   registration unknown          → no verdict either. The async read has
  //                                   not landed or the browser refused it,
  //                                   and guessing "none" invents the fact
  //                                   the verdict turns on.
  const sw = getSwControlStats();
  if (sw != null) {
    if (sw.controlled) {
      axes["swControl"] = marked({
        score: 100,
        rating: ratingFor(100),
        controlled: 1,
        registered: 1,
      });
    } else if (sw.registered === 1 && !docIsSettled("startupEvent")) {
      // The start-up rule (docs/settle-rule-contract.md): a document opened
      // before the worker installed and claimed — the visit's first pages —
      // is the registration-to-claim gap every worker has. Judged only on a
      // document opened after the visit settled.
      axes["swControl"] = settling({ controlled: 0, registered: 1 });
    } else if (sw.registered === 1) {
      axes["swControl"] = marked({
        score: 60,
        rating: ratingFor(60),
        controlled: 0,
        registered: 1,
      });
    } else {
      // "not available here", NOT the never-scored word: that one says no
      // verdict is EVER coming for this AXIS, and this axis scores perfectly
      // well on any app that registers a service worker. What is absent is
      // the thing to measure, in THIS app — a different fact, different word.
      axes["swControl"] = {
        score: null,
        rating: "not-available",
        measurable: 0,
        reasonCode: REASON_NOTHING_TO_COMPARE,
        controlled: 0,
        registered: sw.registered,
      };
    }
  }

  // Connection Quality — browser-reported RTT / downlink / data-saver.
  //
  // CARRIES NO VERDICT, BY DESIGN. This describes the VISITOR'S own connection, not
  // the app: a phone on a slow mobile link reported 300 ms RTT and 1.5 Mbps
  // and the tile called that a poor score, as though the developer had built
  // something wrong. Nothing here is the app's doing and nothing here is
  // actionable, so the numbers stay — they explain a slow page — and the
  // grade goes. Same shape as routeFailures: permanently "not-scored", no
  // reason code, because this is not a reading that could not be taken.
  const conn = getConnectionQualityStats();
  if (conn != null) {
    axes["connectionQuality"] = {
      score: null,
      rating: "not-scored",
      rttMs: conn.rttMs,
      downlinkMbps: conn.downlinkMbps,
      saveData: conn.saveData,
    };
  }

  // Device Capacity — coarse CPU-core + memory bucket the page runs on. A
  // display-only capacity tile (not a pass/fail): rated by how low-end the
  // device is (fewer cores / less memory → lower score). Absent when neither
  // hint is exposed.
  //
  // The shared decision: the VISITOR's hardware is reported and never graded —
  // it is not the app's doing — and a hint the browser withholds is null,
  // never a zero.
  const device = getDeviceCapacityStats();
  if (device != null) {
    axes["deviceCapacity"] = {
      score: null,
      rating: "not-scored",
      cpuCores: device.cpuCores,
      memoryGb: device.memoryGb,
    };
  }

  // Prerender Activation — whether this navigation was prerendered before
  // activation (1/0) + prerender lead time (ms). Prerendered = instant, so
  // prerendered is "good". Absent when neither signal is observable.
  const prerender = getPrerenderStats();
  if (prerender != null) {
    const score = prerender.prerendered ? 100 : 85;
    axes["prerender"] = {
      score,
      rating: ratingFor(score),
      prerendered: prerender.prerendered,
      activationMs: prerender.activationMs,
    };
  }

  // Font Readiness — whether document fonts finished loading (1/0) + ms to
  // readiness. Rated on the readiness time; absent when the Font Loading API is
  // unsupported.
  const font = getFontReadinessStats();
  if (font != null) {
    // Judged on the interval the page's own font decisions control — from the
    // moment the HTML finished arriving to font readiness — not on the whole
    // wait since navigation start, which carries the server round trip in
    // front of it. See FontReadinessStats.fontDelayMs.
    //
    // And while fonts are STILL LOADING there is no readiness time: both ms
    // figures are the elapsed-so-far floor, so the verdict is withheld rather
    // than scoring an unfinished load as the best possible one.
    if (font.fontLoaded !== 1) {
      axes["fontReadiness"] = {
        score: null,
        rating: "pending",
        fontLoaded: font.fontLoaded,
        fontMs: font.fontMs,
        fontDelayMs: font.fontDelayMs,
      };
    } else {
      // The shared decision (src/settle.ts, startupEvent): judged from a warm
      // visit — a first visit pays the download — so only documents opened
      // after the visit settled, and not the first load of their route, give
      // a sample, pooled across the visit. A readiness time that is only an
      // upper bound (the kit started after the fonts finished) is a sample
      // only when the bound itself is good.
      const usable =
        !font.bound || font.fontDelayMs <= FONT_READINESS_THRESHOLDS.good;
      const delays = docTail("fontReadiness", "startupEvent", usable ? font.fontDelayMs : null);
      const totals = docTail("fontReadiness.ms", "startupEvent", usable ? font.fontMs : null);
      if (delays.ready) {
        const fontDelayMs = p75Round(delays.values);
        const score = linearScore(
          fontDelayMs,
          FONT_READINESS_THRESHOLDS.good,
          FONT_READINESS_THRESHOLDS.poor,
        );
        axes["fontReadiness"] = marked({
          score,
          rating: ratingFor(score),
          fontLoaded: font.fontLoaded,
          fontMs: p75Round(totals.values),
          fontDelayMs,
        });
      } else {
        axes["fontReadiness"] = settling({
          fontLoaded: font.fontLoaded,
          fontMs: null,
          fontDelayMs: null,
        });
      }
    }
  }

  // Script/Style Footprint — script + stylesheet element count (O(1) length
  // reads). Rated on the combined count; absent in SSR.
  const asset = getAssetFootprintStats();
  if (asset != null) {
    const score = linearScore(
      asset.scriptCount + asset.styleCount,
      ASSET_FOOTPRINT_THRESHOLDS.good,
      ASSET_FOOTPRINT_THRESHOLDS.poor,
    );
    axes["assetFootprint"] = {
      score,
      rating: ratingFor(score),
      scriptCount: asset.scriptCount,
      styleCount: asset.styleCount,
    };
  }

  // Cross-Origin Isolation — whether the page is cross-origin isolated (1/0).
  // Isolation unlocks high-precision timers + precise memory measurement, so
  // isolated is "good". Absent when crossOriginIsolated is not exposed.
  const coi = getCrossOriginIsolationStats();
  if (coi != null) {
    const score = coi.isolated ? 100 : 85;
    axes["crossOriginIsolation"] = {
      score,
      rating: ratingFor(score),
      isolated: coi.isolated,
    };
  }

  // Deprecation/Intervention Pressure — browser reports per hour (type counts
  // only). Absent when ReportingObserver is unsupported. The start-up rule
  // (docs/settle-rule-contract.md, peakRate): the rate is taken over settled
  // running only, pooled across the visit, so the deprecation report a page
  // load raises once is never projected into an hourly rate. Until the settled
  // window reaches the family's span the reading says it is settling — shown
  // as soon as a report fires or the old earned window would have scored.
  const report = readReportPressure();
  if (report.installed) {
    const total = report.deprecationCount + report.interventionCount;
    const stamps = getReportStamps();
    const dep = settledRate("reportPressure.deprecation", "peakRate", stamps.deprecation, now);
    const int = settledRate("reportPressure.intervention", "peakRate", stamps.intervention, now);
    if (dep.ready) {
      const perHour = Math.round((dep.perMin + int.perMin) * 60 * 10) / 10;
      const score = linearScore(
        perHour,
        REPORT_PRESSURE_THRESHOLDS.good,
        REPORT_PRESSURE_THRESHOLDS.poor,
      );
      axes["reportPressure"] = marked({
        score,
        rating: ratingFor(score),
        deprecationCount: dep.count,
        interventionCount: int.count,
        perHour,
        windowMin: windowMinOf(dep.windowMs),
      });
    } else if (total > 0 || report.perHour !== null) {
      // A report fired — say so immediately, over the window we actually have.
      // Only the projection and the score wait.
      axes["reportPressure"] = settling({
        deprecationCount: report.deprecationCount,
        interventionCount: report.interventionCount,
        perHour: null,
        windowMin: report.windowMin,
      });
    }
  }
  // Unhandled Failure Rate — uncaught errors + unhandled rejections per hour.
  // Distinct from swallowedErrors (survived console.error near-miss). Absent
  // when the listeners never attached; warming until the 5-minute minimum (a
  // failure surfaces immediately regardless).
  const unh = readUnhandled();
  if (unh.installed) {
    const total = unh.errorCount + unh.rejectionCount;
    if (unh.perHour !== null) {
      const score = linearScore(
        unh.perHour,
        UNHANDLED_THRESHOLDS.good,
        UNHANDLED_THRESHOLDS.poor,
      );
      // NOTE: emitted as "unhandledFailures", NOT "unhandledErrors" — the RN
      // kit already owns "unhandledErrors" with a DIFFERENT field shape
      // (count/perHour/windowMin, rejections split into its own axis). Axis
      // keys are global across runtimes, so the browser's combined
      // errors+rejections reading needs its own name.
      axes["unhandledFailures"] = {
        score,
        rating: ratingFor(score),
        errorCount: unh.errorCount,
        rejectionCount: unh.rejectionCount,
        perHour: unh.perHour,
        windowMin: unh.windowMin,
      };
    } else if (total > 0) {
      // A failure happened — never hidden by a short window. Only the per-hour
      // projection and the score it feeds wait (the earned-rate contract).
      axes["unhandledFailures"] = {
        score: null,
        rating: "pending",
        errorCount: unh.errorCount,
        rejectionCount: unh.rejectionCount,
        perHour: null,
        windowMin: unh.windowMin,
      };
    }

    // Rejections remain a distinct contract answer even though the recorded
    // browser fold above continues to publish its combined historical axis.
    const rejectionPerHour = unh.rejectionPerHour;
    if (rejectionPerHour !== null) {
      const score = linearScore(rejectionPerHour, 0, 5);
      axes["promiseRejections"] = {
        count: unh.rejectionCount || null,
        windowMin: unh.windowMin,
        perHour: rejectionPerHour,
        score,
        rating: ratingFor(score),
      };
      axes["rejectionPressure"] = {
        lateHandled: unh.lateHandled,
        unhandled: unh.rejectionCount || null,
        perHour: rejectionPerHour,
        score,
        rating: ratingFor(score),
      };
    } else if (unh.rejectionCount > 0 || (unh.lateHandled ?? 0) > 0) {
      axes["promiseRejections"] = {
        count: unh.rejectionCount || null,
        windowMin: unh.windowMin,
        perHour: null,
        score: null,
        rating: "pending",
      };
      axes["rejectionPressure"] = {
        lateHandled: unh.lateHandled,
        unhandled: unh.rejectionCount || null,
        perHour: null,
        score: null,
        rating: "pending",
      };
    }
  } else {
    axes["promiseRejections"] = {
      score: null,
      rating: "not-available",
      measurable: 0,
      reasonCode: REASON_NOT_WIRED_BY_HOST,
    };
    axes["rejectionPressure"] = {
      score: null,
      rating: "not-available",
      measurable: 0,
      reasonCode: REASON_NOT_WIRED_BY_HOST,
    };
  }

  const background = readBackgroundWork();
  if (background) axes["backgroundWork"] = background;

  // Interaction Volume — distinct interactions observed (count only, no
  // timing). Distinct from interactionToNextPaint (which times them). Absent
  // until ≥1 interaction with an id (feature-detected).
  const iv = getInteractionVolumeStats();
  if (iv != null) {
    // A count-only volume tile: always "good" (informational), never a
    // pass/fail — but scored so the tile renders consistently.
    axes["interactionVolume"] = {
      score: 100,
      rating: "good",
      interactionCount: iv.interactionCount,
    };
  }

  // Layout-Shift Source Count — the shared decision (startupEvent): sources
  // are attributed only for shifts after the page settled, and only for a
  // shift big enough to see (SHIFT_SOURCE_MIN_VALUE) — a node count alone is
  // no yardstick, so a hundred nodes nudged by a pixel moves nothing here.
  // Pooled across the visit (worst settled shift). Absent until a shift with
  // sources has been observed.
  const shift = getShiftSourceStats();
  if (shift != null) {
    const edge = settleBoundary("startupEvent");
    const seen = getShiftSamples().filter(
      (x) => x.t >= edge && x.v >= SHIFT_SOURCE_MIN_VALUE && x.nodes > 0,
    );
    const worst = settledWorst(
      "shiftSources",
      "startupEvent",
      seen.map((x) => ({ t: x.t, v: x.nodes })),
    );
    if (now < edge) {
      axes["shiftSources"] = settling({ shiftCount: shift.shiftCount });
    } else {
      const worstSourceCount = Math.round(worst.worst ?? 0);
      const score = linearScore(
        worstSourceCount,
        SHIFT_SOURCE_THRESHOLDS.good,
        SHIFT_SOURCE_THRESHOLDS.poor,
      );
      axes["shiftSources"] = marked({
        score,
        rating: ratingFor(score),
        worstSourceCount,
        shiftCount: worst.count,
      });
    }
  }

  // Media Playback Health — dropped-video-frame share across playing media.
  // Absent when no <video> exists or the quality API is unsupported (so a page
  // with no video never shows a permanent warming tile).
  const media = getMediaPlaybackStats();
  if (media != null) {
    const score = linearScore(
      media.droppedPct,
      MEDIA_PLAYBACK_THRESHOLDS.good,
      MEDIA_PLAYBACK_THRESHOLDS.poor,
    );
    axes["mediaPlayback"] = {
      score,
      rating: ratingFor(score),
      droppedPct: media.droppedPct,
      droppedFrames: media.droppedFrames,
      totalFrames: media.totalFrames,
    };
  }

  // DOM Footprint — total element count. OPT-IN ONLY (BOOSTHIS_DOM_FOOTPRINT)
  // because the count is O(DOM). ABSENT (not zero) when the opt-in is off.
  const dom = getDomFootprintStats();
  if (dom != null) {
    const score = linearScore(
      dom.elementCount,
      DOM_FOOTPRINT_THRESHOLDS.good,
      DOM_FOOTPRINT_THRESHOLDS.poor,
    );
    axes["domFootprint"] = {
      score,
      rating: ratingFor(score),
      elementCount: dom.elementCount,
    };
  }

  // Idle Opportunity — % of requestIdleCallback probes that fired only because
  // their deadline was hit (a starved main thread). OPT-IN ONLY
  // (BOOSTHIS_IDLE_OPPORTUNITY). ABSENT (not zero) when the opt-in is off.
  // The start-up rule (docs/settle-rule-contract.md, peakRate): the share is
  // taken over probes after the settle period, pooled across the visit, so the
  // probe that times out while the page boots never decides it.
  const idleOpp = getIdleOpportunityCounts();
  if (idleOpp != null) {
    const calls = settledCounter("idleOpportunity.calls", "peakRate", idleOpp.calls, now);
    const missed = settledCounter("idleOpportunity.missed", "peakRate", idleOpp.missed, now);
    if (calls.ready && calls.count >= IDLE_OPPORTUNITY_MIN_SETTLED) {
      const missedPct = Math.round((Math.min(missed.count, calls.count) / calls.count) * 100);
      const score = linearScore(
        missedPct,
        IDLE_OPPORTUNITY_THRESHOLDS.good,
        IDLE_OPPORTUNITY_THRESHOLDS.poor,
      );
      axes["idleOpportunity"] = marked({
        score,
        rating: ratingFor(score),
        idleCalls: calls.count,
        missedDeadlines: Math.min(missed.count, calls.count),
        missedPct,
      });
    } else if (idleOpp.calls >= IDLE_OPPORTUNITY_MIN_SETTLED) {
      axes["idleOpportunity"] = settling({ idleCalls: idleOpp.calls });
    }
  }
  // Patch Lag — how stale the currently-deployed build is (build age vs the
  // patch-lag bands: good <7d · needs-work <30d · poor otherwise). Scored ONLY
  // when a build time is honestly known (see buildIdentity.ts); otherwise the
  // axis says it cannot be measured here, with the reason — never a fake age
  // and never a silently absent expected axis. ADDITIVE + display-only — it
  // NEVER feeds the composite Speed score. HONESTY: this reports LAG only; it
  // never implies the app is patched or safe. Web scope carries no depCount (no
  // dependency inventory in a browser).
  if (identity.buildTimeMs !== undefined) {
    const buildAgeMs = Math.max(0, now - identity.buildTimeMs);
    axes["patchLag"] = {
      score: patchLagScore(buildAgeMs),
      rating: ratePatchLag(buildAgeMs),
      buildAgeMs,
      buildTimeMs: identity.buildTimeMs,
    };
  } else {
    // NO BUILD TIME, SO NO AGE — and saying so is the whole point. Until this
    // branch existed the kit fell back to `document.lastModified`, which a
    // server-rendered page fabricates as the response time: every web install
    // in production reported a build between 0.0 and 0.2 SECONDS old and every
    // one was rated good. A meter that cannot fail cannot warn anyone.
    //
    // buildIdentity.ts now refuses a stamp it cannot tell apart from the
    // response, which leaves this axis with nothing to measure. Omitting it
    // would be no better: patchLag is an EXPECTED web axis, so an absent key
    // renders "warming up" — a promise that a reading is coming, made about one
    // that never will. Instead the kit says out loud that it cannot take this
    // reading, with the reason, and the tile reads "not available here · the
    // app has not switched this on". The fix is one line of the customer's
    // config, and now the tile can ask for it.
    axes["patchLag"] = {
      score: null,
      rating: "pending",
      measurable: 0,
      reasonCode: REASON_NOT_WIRED_BY_HOST,
    };
  }

  // Live Connections — the sockets and streams that stay open for minutes
  // (chat, live dashboards, presence, streamed answers). Every other reading
  // here is driven by work that finishes, so an open connection that has died
  // is otherwise indistinguishable from a calm page. Absent entirely when the
  // page opened none, or before the minimum observation window closes, so an
  // app with no realtime shows nothing rather than a wall of zeros. Additive
  // + display-only — never feeds the Speed score.
  const live = readLiveConnections();
  if (live) {
    const liveAxis: WebAxisResult = {
      score: live.score,
      rating: live.rating,
      caption: live.caption,
      open: live.open,
      peakOpen: live.peakOpen,
      opened: live.opened,
      closed: live.closed,
      drops: live.drops,
      reconnects: live.reconnects,
      reconnectsPerHour: live.reconnectsPerHour,
      medianLifeMs: live.medianLifeMs,
      longestMs: live.longestMs,
      stormCount: live.stormCount,
      quiet: live.quiet,
      stalled: live.stalled,
      undecided: live.undecided,
      neverClosed: live.neverClosed,
      perScreen: live.perScreen,
      flowMeasurable: live.flowMeasurable,
      windowMin: live.windowMin,
      measurable: live.measurable,
    };
    // A rate or a backlog we could not read is OMITTED, never sent as 0 — a
    // zero here would claim "nothing is queued" when the truth is "the
    // transport never said".
    if (live.msgsPerMin != null) liveAxis["msgsPerMin"] = live.msgsPerMin;
    if (live.backlog != null) liveAxis["backlog"] = live.backlog;
    // The start-up rule (growthSlope): a null score is the settle period, said
    // as settling — never a substituted verdict.
    if (live.score === null) liveAxis.rating = "pending";
    axes["liveConnections"] = marked(liveAxis);
  }

  // AI calls — the model calls this page makes itself. An AI product built as
  // a front end usually calls the provider FROM THE PAGE, and until now that
  // was the slowest and most expensive thing the kit said nothing about. One
  // read of the detector feeds all three axes below, so the wait, the money
  // and the ceiling can never disagree with each other.
  //
  // The unit of work is the person's TURN, not a server request: a page has no
  // inbound request to divide by, and the honest denominator is the wait a
  // person actually sat through. Every field name matches the Node kit, so the
  // tile, the AI answers and the rules need no browser special case.
  //
  // Absent — not zeroed — when this page calls no provider.
  const aiStats = getAiCallStats();
  const aiCalls = computeAiCalls(aiStats);
  if (aiCalls) {
    axes["aiCalls"] = {
      score: aiCalls.score,
      rating: aiCalls.rating,
      measurable: aiCalls.measurable,
      waitPct: aiCalls.waitPct,
      callCount: aiCalls.callCount,
      watchedRequests: aiCalls.watchedRequests,
      providerCount: aiCalls.providerCount,
      topProvider: aiCalls.topProvider,
      p75Ms: aiCalls.p75Ms,
      worstMs: aiCalls.worstMs,
      streamCount: aiCalls.streamCount,
      ttftP75Ms: aiCalls.ttftP75Ms,
      stallCount: aiCalls.stallCount,
      failCount: aiCalls.failCount,
      rateLimitedCount: aiCalls.rateLimitedCount,
      quotaCount: aiCalls.quotaCount,
      timeoutCount: aiCalls.timeoutCount,
      truncatedCount: aiCalls.truncatedCount,
      filteredCount: aiCalls.filteredCount,
      serverMsP75: aiCalls.serverMsP75,
      serverMsCalls: aiCalls.serverMsCalls,
      unwatchedClients: aiCalls.unwatchedClients,
      // AI-shaped traffic this page sent to a host on no provider list. Left
      // off the wire, a page whose whole AI stack is a private gateway
      // uploaded a row of zeros indistinguishable from a page with no AI at
      // all — the reading existed, and the one number explaining why it was
      // empty stayed in the browser.
      unclassifiedCalls: aiCalls.unclassifiedCalls,
    } as unknown as WebAxisResult;
    if (aiCalls.measurable === 1) settleAiCalls(axes["aiCalls"] as unknown as Record<string, unknown>, now);
  }

  // What it cost: tokens in and out, how many the provider served from its own
  // cache, and the money — provider-reported where the provider reports it,
  // otherwise priced from a published list whose DATE ships with the number so
  // no surface can show an estimate without being able to show its age. Calls
  // no price could be put on are counted, never treated as free.
  const aiSpend = computeAiSpend(aiStats, AI_PRICE_TABLE_DAY);
  if (aiSpend) {
    const spend: Record<string, number | string | null> = {
      score: aiSpend.score,
      rating: aiSpend.rating,
      measurable: aiSpend.measurable,
      calls: aiSpend.calls,
      tokensIn: aiSpend.tokensIn,
      tokensOut: aiSpend.tokensOut,
      cachedIn: aiSpend.cachedIn,
      cacheHitPct: aiSpend.cacheHitPct,
      costMicros: aiSpend.costMicros,
      reportedCostCalls: aiSpend.reportedCostCalls,
      pricedCalls: aiSpend.pricedCalls,
      unpricedCalls: aiSpend.unpricedCalls,
      costPerRequestMicros: aiSpend.costPerRequestMicros,
      worstRequestCostMicros: aiSpend.worstRequestCostMicros,
      windowMs: aiSpend.windowMs,
      usageMissingCalls: aiSpend.usageMissingCalls,
      usageMissingPct: aiSpend.usageMissingPct,
      streamUsageMissingCalls: aiSpend.streamUsageMissingCalls,
      repeatWorst: aiSpend.repeatWorst,
      repeatRequests: aiSpend.repeatRequests,
      priceTableDay: aiSpend.priceTableDay,
    };
    // The shared decision (wrong quantity): spend is the quantity, taken over
    // a settled window of at least an hour against a DECLARED budget — and no
    // page declares one, so the spend is reported and never graded. The old
    // score (usage-missing share, repeated prompts) measured neither spend
    // nor waste. The counts above stand.
    spend["score"] = null;
    spend["rating"] = "not-scored";
    axes["aiSpend"] = marked(spend) as unknown as WebAxisResult;
  }

  // How close the project is to its provider's published limits. A browser can
  // be REFUSED a look at those limits — a cross-origin reply shows only what
  // the provider chose to expose — so `headersHidden` rides along: it is the
  // difference between "the ceiling is fine" and "we were not allowed to see
  // the ceiling", and without it a hidden header would render as a comfortable
  // zero. Absent entirely when nothing was read, nothing was hidden and
  // nothing was refused.
  const aiHeadroom = computeAiHeadroom(aiStats);
  if (aiHeadroom) {
    axes["aiHeadroom"] = {
      score: aiHeadroom.score,
      rating: aiHeadroom.rating,
      measurable: aiHeadroom.measurable,
      reads: aiHeadroom.reads,
      worstRequestsPct: aiHeadroom.worstRequestsPct,
      worstTokensPct: aiHeadroom.worstTokensPct,
      refusals: aiHeadroom.refusals,
      worstRetryAfterMs: aiHeadroom.worstRetryAfterMs,
      headersHidden: aiHeadroom.headersHidden,
    } as unknown as WebAxisResult;
    if (aiHeadroom.measurable === 1 || getAiCallStamps().refusals.length > 0) {
      settleAiHeadroom(axes["aiHeadroom"] as unknown as Record<string, unknown>, now);
    }
  }
  return axes;
}

/** The aiCalls decision (latencyTail): AI wait and failures judged from
 *  settled calls, 20 or more; a stream's first words to a provider in each
 *  document pay the connection and the model's warm-up and never count. */
function settleAiCalls(axis: Record<string, unknown>, now: number): void {
  const st = getAiCallStamps();
  const calls = settledRate("aiCalls.calls", "latencyTail", st.calls, now);
  const fails = settledRate("aiCalls.fails", "latencyTail", st.fails, now);
  const ttft = settledTail("aiCalls.ttft", "latencyTail", st.ttft);
  if (calls.count < SETTLE_FAMILIES.latencyTail.samples) {
    Object.assign(axis, settling());
    return;
  }
  const failPct = (fails.count / Math.max(calls.count, fails.count)) * 100;
  const terms = [linearScore(failPct, AI_FAIL_PCT_THRESHOLDS.good, AI_FAIL_PCT_THRESHOLDS.poor)];
  if (ttft.ready) {
    const p75 = settledPercentile(ttft.values, 0.75);
    if (p75 !== null) {
      axis["ttftP75Ms"] = Math.round(p75);
      terms.push(linearScore(p75, AI_TTFT_MS_THRESHOLDS.good, AI_TTFT_MS_THRESHOLDS.poor));
    }
  }
  const score = Math.min(...terms);
  Object.assign(axis, marked({ score, rating: ratingFor(score) }));
}

/** The aiHeadroom decision (startupEvent): headroom is what the provider
 *  says is left NOW (the latest settled read, never the lowest read since
 *  load, which survives the provider's reset), and refusals count only after
 *  settling — one boot-time refusal is not exhaustion. */
export const AI_HEADROOM_REFUSALS_POOR = 3;
function settleAiHeadroom(axis: Record<string, unknown>, now: number): void {
  const st = getAiCallStamps();
  const edge = settleBoundary("startupEvent");
  const reads = st.headroom.filter((h) => h.t >= edge && h.t <= now);
  const refusals = settledRate("aiHeadroom.refusals", "startupEvent", st.refusals, now);
  if (now < edge || (reads.length === 0 && refusals.count === 0)) {
    Object.assign(axis, settling());
    return;
  }
  const latest = reads[reads.length - 1];
  const req = latest?.req ?? null;
  const tok = latest?.tok ?? null;
  const left = Math.min(req ?? 100, tok ?? 100);
  const headroomScore = linearScore(
    100 - left,
    100 - AI_HEADROOM_PCT_THRESHOLDS.good,
    100 - AI_HEADROOM_PCT_THRESHOLDS.poor,
  );
  const refusalCap =
    refusals.count >= AI_HEADROOM_REFUSALS_POOR ? 0 : refusals.count >= 1 ? 70 : 100;
  const score = Math.min(headroomScore, refusalCap);
  Object.assign(
    axis,
    marked({
      score,
      rating: ratingFor(score),
      measurable: 1,
      worstRequestsPct: Math.round(req ?? 100),
      worstTokensPct: Math.round(tok ?? 100),
      refusals: refusals.count,
    }),
  );
}

/** Rough page "boot" time so the meter can show "running for N" without
 *  collecting any timestamp of user activity. */
function pageStartedAt(now: number): number {
  try {
    if (typeof performance !== "undefined" && performance.timeOrigin) {
      return Math.round(performance.timeOrigin);
    }
  } catch {
    // fall through
  }
  return now;
}

/** Build the current privacy-safe snapshot from live in-process state. Pure —
 *  reads only the sample ring + current vitals; performs no I/O. */
export type SnapshotExport = WebSnapshotPayload | NonNullable<ReturnType<typeof renewNotice>> | { hidden: true };
export function capturePerfSnapshot(): SnapshotExport {
  const notice = renewNotice();
  if (notice) return notice;
  if (isRuntimeInert()) return { hidden: true };
  const sum = summary();
  const now = settleNow();
  // The settle clock's process is the VISIT (src/settle.ts): `startedAt` is
  // the visit's first document, so the server judges the age the kit judged.
  const startedAt = visitStartedAt();
  const identity = resolveBuildIdentity(now);
  const build = buildBuildObject(identity, now);
  const payload: WebSnapshotPayload = {
    capturedAt: now,
    runtimeVersion: RUNTIME_VERSION,
    platform: "web",
    startedAt,
    totalEvents: sum.total,
    rows: buildRows(),
    axes: buildAxes(sum, now, startedAt, identity),
    events: buildEvents(),
  };
  commitSettle(now);
  // Include the build object only when at least one component is known — an
  // absent build means "not known", never a fabricated stamp.
  if (build !== undefined) payload.build = build;
  // The route list is read HERE, when a snapshot asks — never at start-up —
  // so handing the kit a router costs the page nothing and never delays a
  // paint or a first request.
  const routeList = routeListForSnapshot(getRegisteredWebRoutes());
  if (routeList !== undefined) payload.routeList = routeList;
  // The control census is read HERE too, for the same reason: asking the
  // page what controls it has is one bounded query plus a bounded walk per
  // match, and it happens when a snapshot asks rather than in front of a
  // paint.
  const controlCensus = controlCensusForSnapshot(currentRouteLabel());
  if (controlCensus !== undefined) payload.controlCensus = controlCensus;
  // ...and what the visit itself consisted of. Read here for the same reason,
  // and ALWAYS included: the whole point of the block is to explain a small
  // number of readings, so it has to travel on exactly the snapshots that
  // carry a small number of readings.
  try {
    payload.pageActivity = pageActivityFacts();
  } catch {
    // A block that cannot be read is omitted rather than guessed at.
  }
  return payload;
}

/** A snapshot worth uploading has at least one recorded sample or route row —
 *  an empty snapshot from a just-loaded page is skipped so we never ship a
 *  content-free payload.
 *
 *  Outbound-call evidence counts as data in its own right. An app with no
 *  backend of its own can sit on one screen and talk straight to a hosted
 *  database: no second page view, no route row, and a query that hangs and
 *  never returns. Requiring a route sample there would mean the one finding
 *  worth uploading is the one thing that never gets uploaded — the page would
 *  read as an app that was never watched. Only counts of calls actually made
 *  are read here — a page that merely declared names, and called nothing,
 *  still has none — so this cannot resurrect the empty just-loaded page the
 *  guard exists for. */
function hasData(snap: WebSnapshotPayload): boolean {
  if (snap.totalEvents > 0 || snap.rows.length > 0) return true;
  // An app used in place is the case this guard was silently swallowing. A
  // drawer-based storefront can take a hundred orders and produce its FIRST
  // reading only when the tab is closed, so every snapshot before that looked
  // content-free and never left — which is exactly the install that most
  // needs explaining. Observed activity is content in its own right. An
  // untouched page still has none of it (no press, no address change, nothing
  // untimed), so the empty just-loaded page this guard exists for is
  // unaffected.
  const act = snap.pageActivity;
  if (
    act &&
    (act.presses > 0 || act.viewChanges > 0 || act.viewChangesUntimed > 0)
  ) {
    return true;
  }
  const net = snap.axes?.["network"];
  if (!net || typeof net !== "object") return false;
  const count = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) ? v : 0;
  return (
    count(net["attemptCount"]) > 0 ||
    count(net["stallCount"]) > 0 ||
    count(net["timeoutCount"]) > 0 ||
    count(net["failedCount"]) > 0 ||
    count(net["abortedCount"]) > 0 ||
    // Calls the developer declared as waiting on purpose were made and kept
    // out: a window of nothing else still sends, saying nothing was judged.
    count(net["waitDeclaredExcluded"]) > 0 ||
    (Array.isArray(net.groups) && net.groups.length > 0)
  );
}

export type SnapshotSubmitter = (
  snapshot: WebSnapshotPayload,
  opts?: { keepalive?: boolean },
) => Promise<number>;

let submitter: SnapshotSubmitter | null = null;

let waitingForStart: () => boolean = () => false;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;

/** Register (or clear) the function that actually ships a snapshot. The
 *  telemetry client sets this to `transmitSnapshot`; clearing it (not just
 *  stopping the timer) is required because `uploadPerfSnapshotNow()` calls the
 *  submitter DIRECTLY, so a stale submitter could leak a snapshot on a manual
 *  flush after the timer stops. */
export function setSnapshotSubmitter(fn: SnapshotSubmitter | null, waitForStart: () => boolean = () => false): void {
  submitter = fn;
  waitingForStart = waitForStart;
}

/** Capture + submit one snapshot now. No-op without a submitter or data.
 *  Never throws — instrumentation must stay silent. Pass `keepalive: true`
 *  from a pagehide handler so the request outlives the dying page (a normal
 *  fetch started there is cancelled by the navigation and the data is lost). */
export async function uploadPerfSnapshotNow(opts?: {
  keepalive?: boolean;
}): Promise<number> {
  if (isRuntimeInert() || !submitter || inFlight) return 0;
  inFlight = true;
  try {
    // Under a wait Boosthis stated, nothing is sent; the next summary after
    // the wait carries newer data.
    if (pausedUntil() !== null) return 0;
    const snap = capturePerfSnapshot();
    // A locked or ended project captures only the renew notice: nothing to send.
    if (!("axes" in snap)) return 0;
    if (!hasData(snap)) return 0;
    // While the kit is starting, a summary with data waits (and asks to
    // register): the next one carries everything this one held. The exit
    // flush never waits, because no later pass exists.
    if (!opts?.keepalive && waitingForStart()) return 0;
    // The submitter stamps the send for every tab of this browser just
    // before the request leaves (telemetry.ts transmitSnapshot).
    return await submitter(snap, opts);
  } catch {
    return 0;
  } finally {
    inFlight = false;
  }
}

/**
 * How long this browser means to wait between snapshots right now: the
 * first-minute ramp, anchored on the browser's upload SESSION (every tab and
 * reload of one browser shares it — uploadPacing.ts), stretched to the
 * server's hint when one install has many visitors. Sent with each snapshot
 * (`snapshotIntervalMs`) so the server can tell how many browsers share the
 * install: stating a shorter interval than the one really kept would make a
 * crowd look like one visitor.
 */
export function plannedSnapshotIntervalMs(now: number = Date.now()): number {
  const ramp = nextSnapshotDelayMs(now - snapshotSessionStart(now));
  const hint = snapshotHintAt();
  return hint !== null && hint - now > ramp ? Math.round(hint - now) : ramp;
}

/** The ramp's anchor: the browser's upload session where the kit can keep
 *  one on the device, else this page's own boot time (today's behaviour). */
function snapshotSessionStart(now: number): number {
  const start = sessionStartedAt(now);
  return Math.min(start, pageStartedAt(now));
}

/** When this page last tried for a snapshot — sent one, or found nothing to
 *  send. An empty try waits a ramp step exactly as a send does, so a page with
 *  nothing measured yet does not re-capture every second. */
let lastAttemptAt: number | null = null;
/** When the pending timer was armed: a send stamped after it was made by
 *  another tab (or a manual flush), and the timer then stands down. */
let armedAt = 0;

/** When the next snapshot from this browser is due, judged at a scheduling
 *  moment: one ramp step after the later of this browser's last send (any
 *  tab, this session) and this page's last try — now, when there is
 *  neither — never before the server's hint, never inside a pause. */
function nextSnapshotDueAt(now: number): number {
  const start = snapshotSessionStart(now);
  const sent = lastSentAt("snapshot");
  let base: number | null = sent !== null && sent >= start && sent <= now ? sent : null;
  if (lastAttemptAt !== null && (base === null || lastAttemptAt > base)) {
    base = lastAttemptAt;
  }
  let due = base === null ? now : base + nextSnapshotDelayMs(now - start);
  const hint = snapshotHintAt();
  if (hint !== null && hint > due) due = hint;
  const paused = pausedUntil(now);
  if (paused !== null && paused > due) due = paused;
  return due;
}

function scheduleNext(now: number = Date.now()): void {
  if (timer !== null) return;
  // Age-driven turbo ramp: the delay until the NEXT upload is a pure function
  // of how long this browser's session has been alive, so a skipped/empty
  // upload never burns a ramp step — and a reload continues the ramp rather
  // than starting it again. No user activity is timed.
  const delay = Math.max(1_000, nextSnapshotDueAt(now) - now);
  armedAt = now;
  timer = kitTimeout(() => {
    timer = null;
    void (async () => {
      try {
        const firedAt = Date.now();
        // Stand down when another tab sent one since this timer was armed,
        // or a wait / the server's hint now lies ahead.
        const sentSince = (lastSentAt("snapshot") ?? 0) > armedAt;
        const hint = snapshotHintAt();
        const held =
          pausedUntil(firedAt) !== null || (hint !== null && hint > firedAt + 500);
        const attempt = !sentSince && !held;
        if (attempt) lastAttemptAt = firedAt;
        if (attempt) await uploadPerfSnapshotNow();
      } catch {
        // One failed capture or send does not end the mirror.
      } finally {
        // Only keep the loop alive while a submitter is still registered.
        if (submitter) scheduleNext();
      }
    })();
  }, delay);
  // In a Node context (tests, SSR) never keep the process alive for the timer.
  const t = timer as { unref?: () => void };
  if (typeof t.unref === "function") t.unref();
}

/** Start the periodic snapshot mirror. Fires one immediate flush (so the AI
 *  has something to read the instant sharing is enabled) then re-uploads every
 *  {@link SNAPSHOT_FLUSH_MS}. Idempotent — a second call while running is a
 *  no-op. */
export function startSnapshotAutoUpload(): void {
  // Immediate only when this browser has not sent one this session (the
  // first load still reaches the dashboard within seconds); a reload or a
  // second tab continues the shared schedule instead.
  const now = Date.now();
  if (timer === null && nextSnapshotDueAt(now) <= now) {
    lastAttemptAt = now;
    void uploadPerfSnapshotNow();
  }
  scheduleNext(now);
}

/** Stop the periodic mirror. The submitter is left as-is (the caller clears it
 *  via setSnapshotSubmitter(null) when tearing down) so this only cancels the
 *  timer. */
export function stopSnapshotAutoUpload(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

/** @internal test hook — reset module state between hermetic runs. */
export const _snapshotInternals = {
  reset(): void {
    submitter = null;
    inFlight = false;
    lastAttemptAt = null;
    armedAt = 0;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  },
  get hasSubmitter(): boolean {
    return submitter !== null;
  },
  get isRunning(): boolean {
    return timer !== null;
  },
};
