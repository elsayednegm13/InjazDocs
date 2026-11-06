/** The picture this isolate can honestly paint of the function it is inside.
 *
 * Built from what the collector saw during this isolate's life: per-route rows
 * with real percentiles, the four meters an isolate can genuinely take, and the
 * platform it is running on. Meters that cannot exist here are NOT in this
 * payload at all — the dashboard names them and says why, in one place, rather
 * than each kit inventing a zero.
 */

import {
  computeAccessPressure,
  computeColdStart,
  computeCookieExposure,
  computeCorsExposure,
  computeReliability,
  notMeasurableFor,
  type AxisValue,
  type SettledStatusCounts,
} from "./axes";
import type { CollectorState } from "./collector";
import { declaredWaitsBlock } from "./declaredWaits";
import type {
  EdgeAiStats,
  EdgeDbStats,
  EdgeDependencyStats,
} from "./outbound";
import { getOutboundRequestStats } from "./outbound";
import { isolateStartedAtMs } from "./settleRule";
import {
  computeAiCalls,
  computeAiHeadroom,
  computeAiSpend,
  computeDbWork,
  computeDbSequencing,
  computeDependencies,
} from "./outboundAxes";
import type { EdgePlatform } from "./platform";
import { RUNTIME_VERSION } from "./version";
import { readRequestAxes } from "./requestMeters";

export interface SnapshotRow {
  key: string;
  count: number;
  p50: number;
  p95: number;
  max: number;
  last: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx]!;
}

export interface StatusCounts {
  unauthorized: number;
  forbidden: number;
  notFound: number;
  rateLimited: number;
  serverErrors: number;
}

export interface CookieCounts {
  cookiesSet: number;
  /** Responses that set at least one cookie — the denominator the server kits
   *  also send, so one dashboard row means the same thing on both. */
  responses: number;
  noSecure: number;
  noHttpOnly: number;
  noSameSite: number;
  noneWithoutSecure: number;
}

/** The shape of the cross-origin answers served (corsExposure). Counts, plus
 *  when the first of them was counted — never an origin, a host or a route. */
export interface CorsCounts {
  /** Finished responses whose headers were read. */
  responses: number;
  /** …of which the request carried an Origin header at all. */
  originRequests: number;
  /** Answered `Access-Control-Allow-Origin: *`. */
  anyOrigin: number;
  /** Answered with the very origin the request carried. */
  reflected: number;
  /** `*` paired with `Access-Control-Allow-Credentials: true`. */
  wildcardCredentials: number;
  /** Wall-clock ms of the first counted response, or null before one. */
  firstAtMs: number | null;
}

export interface BuildSnapshotArgs {
  collector: CollectorState;
  status: StatusCounts;
  /** Responses counted after the isolate settled (start-up rule, peakRate). */
  settledStatus?: SettledStatusCounts;
  cookies: CookieCounts;
  /** Omitted by a caller that never counted a response, which reads exactly
   *  as an isolate that has served none: the reading is absent, never zero. */
  cors?: CorsCounts;
  coldStartMs: number | null;
  platform: EdgePlatform;
  capturedAt: number;
  /** What the outbound watch saw. Omitted only by a caller that never armed
   *  the watch, which is the same thing as an app that made no such calls:
   *  the readings are then absent, never zero. */
  ai?: EdgeAiStats;
  db?: EdgeDbStats;
  dependencies?: EdgeDependencyStats;
  /** What this isolate observed about its hosting PLATFORM (see
   *  `hostFacts.ts`) — a closed, all-numeric set about the platform, never
   *  about the app. Left out of the payload entirely when empty. */
  hostFacts?: Record<string, number>;
}

export function buildSnapshot(args: BuildSnapshotArgs): Record<string, unknown> {
  const rows: SnapshotRow[] = args.collector.rows.map((r) => {
    const sorted = [...r.durations].sort((a, b) => a - b);
    return {
      key: r.label,
      count: r.count,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      max: r.maxMs,
      last: sorted.length > 0 ? sorted[sorted.length - 1]! : 0,
    };
  });

  const axes: Record<string, AxisValue> = {};
  const reliability = computeReliability({
    requests: args.collector.requests,
    errors: args.status.serverErrors,
  });
  if (reliability) axes.reliability = reliability;
  const access = computeAccessPressure({
    requests: args.collector.requests,
    unauthorized: args.status.unauthorized,
    forbidden: args.status.forbidden,
    notFound: args.status.notFound,
    rateLimited: args.status.rateLimited,
    serverErrors: args.status.serverErrors,
    ...(args.settledStatus ? { settled: args.settledStatus, nowMs: args.capturedAt } : {}),
  });
  if (access) axes.accessPressure = access;
  const cookies = computeCookieExposure(args.cookies);
  if (cookies) axes.cookieExposure = cookies;
  const cors = args.cors ? computeCorsExposure(args.cors, args.capturedAt) : null;
  if (cors) axes.corsExposure = cors;
  // Skipped outright where the platform itself makes the reading impossible
  // (Cloudflare's frozen startup clock) — never sent as a zero or a guess.
  const coldBlocked = "coldStart" in notMeasurableFor(args.platform);
  const cold = coldBlocked ? null : computeColdStart(args.coldStartMs);
  if (cold) axes.coldStart = cold;

  // The readings that come from watching the isolate's one way out. Each
  // returns null when the app made no such calls, and a null axis is simply
  // not in this payload — an app with no AI in it and an app the kit cannot
  // read look the same here, which is the point: neither is a zero.
  if (args.db) {
    const db = computeDbWork(args.db);
    if (db) axes.dbWork = db;
    const sequencing = computeDbSequencing(args.db);
    if (sequencing) axes.dbSequencing = sequencing;
  }
  if (args.ai) {
    const aiCalls = computeAiCalls(args.ai);
    if (aiCalls) axes.aiCalls = aiCalls;
    const aiSpend = computeAiSpend(args.ai);
    if (aiSpend) axes.aiSpend = aiSpend;
    const aiHeadroom = computeAiHeadroom(args.ai);
    if (aiHeadroom) axes.aiHeadroom = aiHeadroom;
  }
  if (args.dependencies) {
    const dependencies = computeDependencies(args.dependencies);
    if (dependencies) axes.dependencies = dependencies;
  }

  Object.assign(
    axes,
    readRequestAxes(args.collector, getOutboundRequestStats(), args.platform),
  );

  return {
    capturedAt: args.capturedAt,
    runtimeVersion: RUNTIME_VERSION,
    // The platform, carried to the dashboard so an isolate is shown as what it
    // is. Never "node".
    platform: args.platform,
    // The isolate's first instant, the SAME one every meter's settle period
    // counts from (settleRule.ts), so the server's "still settling" reads the
    // age the kit judged by.
    startedAt: isolateStartedAtMs() ?? args.collector.firstSeenAtMs ?? args.capturedAt,
    totalEvents: args.collector.requests,
    rows,
    crossCutting: [],
    axes,
    // The routes declared as waiting on purpose (declaredWaits.ts), each with
    // the requests kept out and the longest wait — an empty list when nothing
    // is declared, so "declared nothing" and "an older kit" never read alike.
    // This kit runs on hosted isolates with no operating system of their own,
    // so, by design, it sends no system family beside its platform.
    declaredWaits: declaredWaitsBlock(),
    ...(args.hostFacts && Object.keys(args.hostFacts).length > 0
      ? { hostFacts: args.hostFacts }
      : {}),
  };
}
