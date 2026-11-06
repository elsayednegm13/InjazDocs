/** Outbound-call sampler — the input for the Network reliability axis.
 *
 * TWO OBSERVATION POINTS, ONE AT A TIME
 *
 * 1. CALL WATCH (preferred, callWatch.ts). The kit wraps the app's own `fetch`
 *    and `XMLHttpRequest`, so a call is recorded when it STARTS. That is the
 *    only way a browser can see a call that never comes back: Resource Timing
 *    fires on completion, so a hang is invisible to it by construction.
 *    Outcomes are told apart — completed, failed, aborted, timed out, and
 *    still hanging at the end of the window.
 *
 * 2. RESOURCE TIMING (fallback, vitals.ts). Where wrapping is impossible —
 *    `fetch` is missing or frozen, an exotic embedding, a browser that refuses
 *    the assignment — the passive resource observer keeps feeding this module
 *    exactly as it always has. In that mode the readings are byte-for-byte the
 *    ones this kit produced before call watching existed: durations plus a
 *    coarse ok/failed outcome, and honest ZEROES for hangs and timeouts,
 *    because that runtime genuinely cannot see them.
 *
 * The two never run together. Once the wrapper attaches, the resource path is
 * suppressed, or every call would be counted twice.
 *
 * HONESTY RULES
 * - A call still in flight for less than HUNG_AFTER_MS is neither good nor bad:
 *   it is excluded from BOTH the numerator and the denominator, so a busy page
 *   never scores itself down for calls that simply have not finished yet.
 * - "Hung" is recomputed from the live in-flight set on every read, never
 *   accumulated. A slow call that eventually returns stops being a hang.
 * - An aborted call has no verdict — the app cancelled it — so it is counted
 *   and shown but kept out of the score's denominator.
 * - A call the developer DECLARED as waiting on purpose (declaredCalls.ts) is
 *   never in flight, never hung and never timed: its duration stays out of
 *   every reading here, and only its failures count. A STREAM is timed to its
 *   headers, never for its whole life.
 *
 * PRIVACY: counts, durations, and group labels drawn from a closed
 * code-defined vocabulary (callGroups.ts). The URL, host, path, query, headers
 * and payload are never read into anything that leaves the browser.
 */

import {
  computeNetworkScore,
  percentileOf,
  type NetworkStatsLike,
  type NetworkResult,
  type DependencyDistanceStatsLike,
} from "./meterAxes";
import { DEP_KIND_OWN_BACKEND } from "./depKinds";
import { SampleRing, firstOfRoute } from "./settle";
import {
  CALL_GROUP_DESTINATIONS,
  CALL_GROUP_OVERFLOW_KEY,
  CALL_GROUP_UNNAMED_KEY,
  MAX_TRACKED_GROUPS,
  isSafeCallGroupKey,
  type CallGroupDestination,
} from "./callGroups";
import {
  noteDeclaredKeptOut,
  noteDeclaredMatched,
  resetDeclaredCallCounts,
} from "./declaredCalls";
import {
  CAUSE_FAILURE_KINDS,
  CAUSE_MAX_DESTINATIONS,
  CAUSE_MAX_PAGES,
  CAUSE_SLOW_CALL_MS,
  failureKindFor,
  putFailureCounts,
  type CauseCallDestination,
  type CauseCallPage,
  type CauseCalls,
  type CauseFailureKind,
} from "./problemCause";
import { screenLabelNow } from "./screenLabel";

/** Re-exported so callers that think in terms of the sampler keep working; the
 *  constant itself lives with the group vocabulary the server mirrors. */
export { MAX_TRACKED_GROUPS };

/** Fixed-size ring of attempt durations (ms) for the p75/worst computation. */
const MAX_DURATIONS = 500;
/** Per-group ring — smaller, since a group only needs a stable p75. */
const MAX_GROUP_DURATIONS = 120;
/** How long a call must have been in flight before we are willing to call it
 *  hung. Well past the axis's own "poor" latency budget (3s), so a merely slow
 *  call is never reported as a hang. */
export const HUNG_AFTER_MS = 15_000;
/** Safety valve on the in-flight registry so a runaway page cannot grow it
 *  without bound. Beyond this, calls are still counted when they settle; they
 *  just cannot be reported as hanging. */
const MAX_IN_FLIGHT = 1000;
/** Cap on how many distinct overflow group names we remember, purely to report
 *  how many there were. */
const MAX_OVERFLOW_NAMES = 64;

/** How a watched call ended. */
export type CallOutcome = "completed" | "failed" | "aborted" | "timed-out";

/** Handle returned by noteCallStart and handed back on settle. */
export interface CallHandle {
  readonly id: number;
  readonly group: string;
  readonly startedAt: number;
  /** Position of the declared name this call matched, or -1 for an ordinary
   *  call. Only a position: the name and the address stay where they were. */
  readonly declared: number;
  /** The closed destination kind, read off the UNFOLDED group key — a call
   *  whose group folded into the overflow row still knows where it went. */
  readonly to?: CallGroupDestination;
  /** The page the call started on; null when none could be named. */
  readonly page?: string | null;
}

/** How a settlement was observed, when it was not simply "now, in full". */
export interface SettleHow {
  /** When the answer was seen (the sampler's clock), if earlier than now. */
  at?: number;
  /** The answer is a STREAM, settled at its headers: timed to them, and never
   *  kept out as a declared wait — a stream is counted once, as a stream. */
  stream?: boolean;
  /** The answer's HTTP status when one arrived. Only the number: it decides
   *  whether a failure was the other side turning the call away or its own
   *  error (problemCause.ts). */
  status?: number | null;
}

interface GroupAgg {
  completed: number;
  failed: number;
  aborted: number;
  timedOut: number;
  durations: number[];
  worstMs: number;
}

/** One per-group row as it rides the wire. Counts and durations only; `key`
 *  comes from the closed vocabulary in callGroups.ts. */
export interface CallGroupRow {
  key: string;
  attempts: number;
  completed: number;
  failed: number;
  aborted: number;
  timedOut: number;
  hung: number;
  p75Ms: number;
  worstMs: number;
}

let durations: number[] = [];
/** The same durations stamped for the settle rule (src/settle.ts): epoch ms
 *  at the call's start; a call group's first call of the visit is cold. */
const stampedDurations = new SampleRing(MAX_DURATIONS);
const seenGroups = new Set<string>();
let completedCount = 0;
let failedCount = 0;
let abortedCount = 0;
let timedOutCount = 0;
let worstMs = 0;

let watching = false;
let nextCallId = 1;
let inFlight = new Map<number, CallHandle>();
let groups = new Map<string, GroupAgg>();
let overflowNames = new Set<string>();
/** Ids already accounted for, so a client that reports two endings for one
 *  call (XHR fires `abort` after `error` in some engines) cannot count twice. */
let settled = new Set<number>();

/* ── What the calls behind a call problem were (problemCause.ts) ──────────
 *
 * Kept beside the totals above and moved by the SAME events, so the failure
 * kinds always add up to the failures the score counts and the per-destination
 * calls to the attempts. A call kept out of the reading (a declared wait that
 * answered, a cancel, a stream whose headers never arrived) is kept out here
 * too. Counts only, keyed by a closed destination token or a page label the
 * one part-name rule produced. */
interface CauseTally {
  calls: number;
  slow: number;
  kinds: Record<CauseFailureKind, number>;
}
/** Pages remembered by name; the rest are counted, never named. */
const MAX_CAUSE_PAGES_TRACKED = 32;
const MAX_CAUSE_PAGE_OVERFLOW_NAMES = 64;
let causeByTo = new Map<CallGroupDestination, CauseTally>();
let causeByPage = new Map<string, CauseTally>();
let causePageOverflow: CauseTally = emptyTally();
let causePageOverflowNames = new Set<string>();
let causeNoPage: CauseTally = emptyTally();
/** Handles whose call has settled as completed, remembered (bounded) so a
 *  later body-error check moves the right destination and page. */
let completedHandles = new Map<number, CallHandle>();

const DESTINATION_TOKENS: ReadonlySet<string> = new Set(CALL_GROUP_DESTINATIONS);

function emptyTally(): CauseTally {
  return {
    calls: 0,
    slow: 0,
    kinds: {
      "no-answer": 0,
      "turned-away": 0,
      "server-error": 0,
      "timed-out": 0,
      "never-answered": 0,
    },
  };
}

/** The destination half of a group key, or `unnamed`. */
function destinationOfKey(key: string): CallGroupDestination {
  const dot = key.indexOf(".");
  const head = dot > 0 ? key.slice(0, dot) : "";
  return DESTINATION_TOKENS.has(head) ? (head as CallGroupDestination) : "unnamed";
}

/** The page a call is starting on, by the one resolver (screenLabel.ts). */
function pageNow(): string | null {
  try {
    return screenLabelNow();
  } catch {
    return null;
  }
}

function tallyForTo(to: CallGroupDestination): CauseTally {
  let t = causeByTo.get(to);
  if (!t) {
    t = emptyTally();
    causeByTo.set(to, t);
  }
  return t;
}

function tallyForPage(page: string | null | undefined): CauseTally {
  if (page === null || page === undefined) return causeNoPage;
  let t = causeByPage.get(page);
  if (t) return t;
  if (causeByPage.size >= MAX_CAUSE_PAGES_TRACKED) {
    if (causePageOverflowNames.size < MAX_CAUSE_PAGE_OVERFLOW_NAMES) {
      causePageOverflowNames.add(page);
    }
    return causePageOverflow;
  }
  t = emptyTally();
  causeByPage.set(page, t);
  return t;
}

/** Count one ATTEMPT (a call that completed, failed or timed out) against
 *  its destination and page. */
function tallyAttempt(
  to: CallGroupDestination,
  page: string | null | undefined,
  kind: CauseFailureKind | null,
  slow: boolean,
): void {
  for (const t of [tallyForTo(to), tallyForPage(page)]) {
    t.calls++;
    if (slow) t.slow++;
    if (kind !== null) t.kinds[kind]++;
  }
}

/** Clock seam so tests can drive the hang threshold deterministically. */
let nowFn: () => number = () => Date.now();

function emptyAgg(): GroupAgg {
  return {
    completed: 0,
    failed: 0,
    aborted: 0,
    timedOut: 0,
    durations: [],
    worstMs: 0,
  };
}

/** Resolve the STORAGE key a call's group lands under, applying the group cap,
 *  and make sure that row exists. A key that arrives once the cap is full folds
 *  into the visible overflow row and its name is remembered so the row can say
 *  how many groups it stands for.
 *
 *  Called when a call STARTS, not when it settles: a group whose only calls are
 *  still hanging must have a row, or the one thing this feature exists to show
 *  would be missing from the very table meant to show it. */
function foldKey(rawKey: string): string {
  const key = isSafeCallGroupKey(rawKey) ? rawKey : CALL_GROUP_UNNAMED_KEY;
  if (groups.has(key)) return key;
  if (groups.size >= MAX_TRACKED_GROUPS && key !== CALL_GROUP_OVERFLOW_KEY) {
    if (overflowNames.size < MAX_OVERFLOW_NAMES) overflowNames.add(key);
    if (!groups.has(CALL_GROUP_OVERFLOW_KEY)) {
      groups.set(CALL_GROUP_OVERFLOW_KEY, emptyAgg());
    }
    return CALL_GROUP_OVERFLOW_KEY;
  }
  groups.set(key, emptyAgg());
  return key;
}

/** The aggregate behind an ALREADY-FOLDED key (the one carried on a handle). */
function aggFor(key: string): GroupAgg {
  return groups.get(key) ?? groups.get(foldKey(key))!;
}

function pushDuration(list: number[], cap: number, ms: number): void {
  list.push(ms);
  if (list.length > cap) list.splice(0, list.length - cap);
}

/** Called by callWatch once it has successfully wrapped at least one client.
 *  Switches this module from the resource-timing fallback to watched calls. */
export function setCallWatchActive(active: boolean): void {
  watching = active;
}

/** Whether calls are being watched where they START (so hangs are visible). */
export function isCallWatchActive(): boolean {
  return watching;
}

/** The sampler's clock, for a caller that must remember WHEN it saw an answer
 *  and settle it later (a declared call whose body is still being checked). */
export function networkNow(): number {
  return nowFn();
}

/** Record the START of an outbound call. Guarded; never throws. Returns null
 *  when the call could not be registered, in which case the caller simply does
 *  not report a settle.
 *
 *  `declared` is the position of the name the call matched (declaredCalls.ts),
 *  or -1. A declared call is not put in flight — a call that waits on purpose
 *  is never hung — and takes no call-group row unless it ever needs one (a
 *  failure, a cancel, a stream): a call kept out of every reading must not
 *  spend one of the capped group slots. */
import { isRuntimeInert, entitlementGeneration } from "./lockGate";
const callGenerations = new WeakMap<CallHandle, number>();
export function noteCallStart(group: string, declared = -1): CallHandle | null {
  if (isRuntimeInert()) return null;
  try {
    const isDeclared = Number.isInteger(declared) && declared >= 0;
    const handle: CallHandle = {
      id: nextCallId++,
      // Folded once, here, so the handle always names a row that exists — the
      // settle path and the hang recount can never disagree about where a call
      // belongs, even if the cap filled up while it was in flight.
      group: isDeclared ? group : foldKey(group),
      startedAt: nowFn(),
      declared: isDeclared ? declared : -1,
      to: destinationOfKey(group),
      page: pageNow(),
    };
    callGenerations.set(handle, entitlementGeneration());
    if (isDeclared) noteDeclaredMatched(declared);
    else {
      // The page's row is made when the call STARTS, like the group's: a page
      // whose only calls are still hanging must be named, not folded away. A
      // declared call is never in flight, so it takes no page slot until it
      // has something to count there.
      tallyForPage(handle.page);
      if (inFlight.size < MAX_IN_FLIGHT) inFlight.set(handle.id, handle);
    }
    return handle;
  } catch {
    return null;
  }
}

/** Mark a call as accounted for. False when it already was. */
function claimSettlement(handle: CallHandle): boolean {
  if (settled.has(handle.id)) return false;
  settled.add(handle.id);
  if (settled.size > MAX_IN_FLIGHT * 2) {
    // Bounded memory: the set only exists to reject a double settle, and a
    // double settle always arrives close behind the first.
    settled = new Set<number>();
  }
  inFlight.delete(handle.id);
  return true;
}

/** Record how a watched call ended. Guarded; never throws. `how.status` is
 *  the answer's HTTP status when one arrived — it decides whether a failure
 *  was the other side turning the call away or its own error. */
export function noteCallSettled(
  handle: CallHandle | null,
  outcome: CallOutcome,
  how?: SettleHow,
): void {
  try {
    if (isRuntimeInert() || (handle !== null && callGenerations.get(handle) !== entitlementGeneration())) return;
    if (handle === null) return;
    if (!claimSettlement(handle)) return;
    const at = typeof how?.at === "number" && Number.isFinite(how.at) ? how.at : nowFn();
    const status =
      typeof how?.status === "number" && Number.isFinite(how.status) ? how.status : null;
    if (handle.declared >= 0 && how?.stream !== true && outcome === "completed") {
      // WAITING ON PURPOSE. An answer is kept out of every reading — no
      // attempt, no duration, no group row — and only counted as kept out.
      noteDeclaredKeptOut(handle.declared, at - handle.startedAt);
      return;
    }
    // A declared call's group was left unfolded at its start; it takes its row
    // only now that it has something to show there.
    const key = handle.declared >= 0 ? foldKey(handle.group) : handle.group;
    if (handle.declared >= 0 && how?.stream !== true) {
      // A declared call's failure is still a failure, and a cancel still a
      // cancel; neither brings a duration with it.
      const agg = aggFor(key);
      if (outcome === "failed") {
        failedCount++;
        agg.failed++;
      } else if (outcome === "aborted") {
        abortedCount++;
        agg.aborted++;
      } else {
        timedOutCount++;
        agg.timedOut++;
      }
      // The cause tallies move with the counts above: a failure or a time-out
      // is an attempt (never slow — it brings no duration), a cancel is not.
      if (outcome !== "aborted") {
        tallyAttempt(handle.to ?? "unnamed", handle.page, failureKindFor(outcome, status), false);
      }
      return;
    }
    const agg = aggFor(key);
    if (outcome !== "aborted") {
      const answered = outcome === "completed" || outcome === "failed";
      const dur = answered ? Math.max(0, Math.round(at - handle.startedAt)) : 0;
      tallyAttempt(
        handle.to ?? "unnamed",
        handle.page,
        failureKindFor(outcome, status),
        answered && dur >= CAUSE_SLOW_CALL_MS,
      );
      if (outcome === "completed") {
        completedHandles.set(handle.id, handle);
        if (completedHandles.size > MAX_IN_FLIGHT) {
          const oldest = completedHandles.keys().next().value;
          if (oldest !== undefined) completedHandles.delete(oldest);
        }
      }
    }
    if (outcome === "completed" || outcome === "failed") {
      const dur = Math.max(0, Math.round(at - handle.startedAt));
      pushDuration(durations, MAX_DURATIONS, dur);
      const cold = !seenGroups.has(key) && firstOfRoute("net:" + key);
      seenGroups.add(key);
      stampedDurations.push(handle.startedAt, dur, cold);
      pushDuration(agg.durations, MAX_GROUP_DURATIONS, dur);
      if (dur > worstMs) worstMs = dur;
      if (dur > agg.worstMs) agg.worstMs = dur;
    }
    if (outcome === "completed") {
      completedCount++;
      agg.completed++;
    } else if (outcome === "failed") {
      failedCount++;
      agg.failed++;
    } else if (outcome === "aborted") {
      abortedCount++;
      agg.aborted++;
    } else {
      timedOutCount++;
      agg.timedOut++;
    }
  } catch {
    // observation must never break the page
  }
}

/** Let a call go without a verdict: a stream whose headers the kit never saw
 *  arrive. It is neither timed nor counted — never one long call, never hung —
 *  and it is no longer in flight. Guarded; never throws. */
export function noteCallUntimed(handle: CallHandle | null): void {
  if (isRuntimeInert() || (handle !== null && callGenerations.get(handle) !== entitlementGeneration())) return;
  try {
    if (handle === null) return;
    claimSettlement(handle);
  } catch {
    // observation must never break the page
  }
}

/** Move an already-completed call into the failed bucket. Used ONLY by the
 *  opt-in body-error check: a 200 response whose payload carries an error is a
 *  failure the transport never reported. Guarded; never throws.
 *
 *  Never for a declared call: its answer was never counted as completed (the
 *  caller settles it once the body check has its verdict). */
export function noteBodyFailure(handle: CallHandle | null): void {
  if (isRuntimeInert() || (handle !== null && callGenerations.get(handle) !== entitlementGeneration())) return;
  try {
    if (handle === null) return;
    if (handle.declared >= 0) return;
    if (completedCount <= 0) return;
    const agg = groups.get(handle.group);
    if (!agg || agg.completed <= 0) return;
    completedCount--;
    failedCount++;
    agg.completed--;
    agg.failed++;
    // The same call, moved in the cause tallies too: it was counted as an
    // attempt when it settled, and it is now the other side's error.
    const settledHandle = completedHandles.get(handle.id) ?? handle;
    completedHandles.delete(handle.id);
    for (const t of [
      tallyForTo(settledHandle.to ?? "unnamed"),
      tallyForPage(settledHandle.page),
    ]) {
      t.kinds["server-error"]++;
    }
  } catch {
    // observation must never break the page
  }
}

/** Minimal numeric view of a resource-timing entry — the ONLY fields ever read
 *  (no URL/name). The destination token and the page are decided by the
 *  caller, which reads the address once for that and drops it. */
export interface ResourceEntryLike {
  duration: number;
  responseStatus?: number;
  responseEnd?: number;
  transferSize?: number;
  to?: CallGroupDestination;
  page?: string | null;
  /** Position of the declared name the entry's address matched, or -1/absent.
   *  Decided by the caller, which reads the address and drops it. */
  declared?: number;
  /** Present when the entry is a STREAM: the time to its headers, or null
   *  when the browser did not expose it (the entry is then kept out). */
  streamHeaderMs?: number | null;
}

/** Record one completed outbound attempt from a resource-timing entry.
 *
 *  FALLBACK PATH ONLY. Once callWatch has attached, this returns immediately —
 *  the same call would otherwise be counted twice, once at start and once at
 *  completion. Guarded; never throws. */
export function recordResourceEntry(e: ResourceEntryLike): void {
  if (isRuntimeInert()) return;
  try {
    if (watching) return;
    const whole = e.duration;
    if (!Number.isFinite(whole) || whole < 0) return;
    // Loud failure: an HTTP error status, OR a request that produced no
    // response at all (aborted/network error the browser still logged as a
    // zero-timing entry). Cross-origin opaque entries report status 0 with a
    // real duration — those are NOT failures, so we require BOTH a zero
    // responseEnd AND a zero duration before calling it failed.
    const status = e.responseStatus;
    const httpError = typeof status === "number" && status >= 400;
    const noResponse =
      (e.responseEnd === 0 || e.responseEnd == null) && Math.round(whole) === 0;
    let dur = whole;
    let declared =
      typeof e.declared === "number" && Number.isInteger(e.declared) ? e.declared : -1;
    if (e.streamHeaderMs !== undefined) {
      // A STREAM is timed to its headers, never for its whole life — and
      // where the browser hid that moment, it is kept out entirely. Counted
      // once, as a stream, even when its address was declared.
      if (e.streamHeaderMs === null || !Number.isFinite(e.streamHeaderMs)) return;
      dur = Math.max(0, e.streamHeaderMs);
      declared = -1;
    }
    const rounded = Math.round(dur);
    // How it failed, if it did: the other side's answer, or none at all.
    const failure: CauseFailureKind | null = httpError
      ? failureKindFor("failed", status)
      : noResponse
        ? "no-answer"
        : null;
    if (declared >= 0) {
      // WAITING ON PURPOSE: no attempt and no duration. A failure still
      // counts, with no duration — in the cause tallies too, never as slow.
      noteDeclaredMatched(declared);
      if (httpError || noResponse) {
        failedCount++;
        tallyAttempt(e.to ?? "unnamed", e.page ?? null, failure, false);
      } else noteDeclaredKeptOut(declared, rounded);
      return;
    }
    pushDuration(durations, MAX_DURATIONS, rounded);
    stampedDurations.push(nowFn(), rounded);
    if (rounded > worstMs) worstMs = rounded;
    if (httpError || noResponse) failedCount++;
    else completedCount++;
    tallyAttempt(e.to ?? "unnamed", e.page ?? null, failure, rounded >= CAUSE_SLOW_CALL_MS);
  } catch {
    // observation must never break the page
  }
}

/** How many in-flight calls have been running long enough to call hung, and
 *  how many are simply still going. Recomputed on every read. */
function inFlightSplit(): { hung: number; young: number } {
  let hung = 0;
  let young = 0;
  const cutoff = nowFn() - HUNG_AFTER_MS;
  for (const handle of inFlight.values()) {
    if (handle.startedAt <= cutoff) hung++;
    else young++;
  }
  return { hung, young };
}

function hungByGroup(): Map<string, number> {
  const out = new Map<string, number>();
  const cutoff = nowFn() - HUNG_AFTER_MS;
  for (const handle of inFlight.values()) {
    if (handle.startedAt > cutoff) continue;
    // handle.group was folded at start, so it always names an existing row.
    out.set(handle.group, (out.get(handle.group) ?? 0) + 1);
  }
  return out;
}

/** Current network stats (label-free).
 *
 *  In the fallback (resource-timing) mode there are no in-flight calls to read,
 *  so `timeoutCount`/`stallCount` are the honest zeroes this kit has always
 *  reported and `attemptCount` is exactly the old completed+failed total. */
export function getNetworkStats(): NetworkStatsLike {
  const p75 = percentileOf(durations, 0.75);
  const { hung } = inFlightSplit();
  return {
    attemptCount: completedCount + failedCount + timedOutCount + hung,
    completedCount,
    failedCount,
    timeoutCount: timedOutCount,
    stallCount: hung,
    p75Ms: p75,
    worstMs,
  };
}

/** Calls the app cancelled itself. Counted and shown, never scored. */
/** Stamped request durations for the settle rule, oldest first. */
export function getNetworkDurationSamples(): ReadonlyArray<{ t: number; v: number; cold?: boolean }> {
  return stampedDurations.all();
}

export function getAbortedCount(): number {
  return abortedCount;
}

/** Calls still running but not yet old enough to be called hung. Reported so a
 *  quiet-looking window is never mistaken for an idle one. */
export function getInFlightCount(): number {
  return inFlightSplit().young;
}

/** How many distinct groups folded into the "everything else" row. */
export function getGroupOverflowCount(): number {
  return overflowNames.size;
}

/** Per-group rows, busiest first, with the overflow row last. Empty in the
 *  fallback mode — resource timing never reads a destination, so a group
 *  cannot be derived and we say nothing rather than guess. */
export function readCallGroups(): CallGroupRow[] {
  const hung = hungByGroup();
  const rows: CallGroupRow[] = [];
  for (const [key, agg] of groups) {
    const h = hung.get(key) ?? 0;
    const attempts = agg.completed + agg.failed + agg.timedOut + h;
    if (attempts === 0 && agg.aborted === 0) continue;
    rows.push({
      key,
      attempts,
      completed: agg.completed,
      failed: agg.failed,
      aborted: agg.aborted,
      timedOut: agg.timedOut,
      hung: h,
      p75Ms: Math.round(percentileOf(agg.durations, 0.75)),
      worstMs: agg.worstMs,
    });
  }
  rows.sort((a, b) => {
    const aOver = a.key === CALL_GROUP_OVERFLOW_KEY ? 1 : 0;
    const bOver = b.key === CALL_GROUP_OVERFLOW_KEY ? 1 : 0;
    if (aOver !== bOver) return aOver - bOver;
    return b.attempts - a.attempts || a.key.localeCompare(b.key);
  });
  return rows;
}

/** The trouble a row stands for: its failures plus its slow calls. Rows are
 *  listed by this first, so the destinations and pages behind the problem
 *  are the ones named. */
function troubleOf(t: CauseTally): number {
  let n = t.slow;
  for (const k of CAUSE_FAILURE_KINDS) n += t.kinds[k];
  return n;
}

function failuresOf(t: CauseTally): number {
  let n = 0;
  for (const k of CAUSE_FAILURE_KINDS) n += t.kinds[k];
  return n;
}

/** A copy of a tally with the calls still hanging at `cutoff` added. */
function withHung(t: CauseTally, hung: number): CauseTally {
  const c: CauseTally = { calls: t.calls + hung, slow: t.slow, kinds: { ...t.kinds } };
  c.kinds["never-answered"] += hung;
  return c;
}

/**
 * What the calls behind a slow-call or failing-call problem were: how many
 * went to each KIND of destination and how each failed, and which pages
 * started them. Built from the same counters the network reading scores, so
 * `calls` is its attempt count and the failure kinds add up to its drops.
 * Null when no attempt has been counted.
 */
export function readCallCause(): CauseCalls | null {
  try {
    const cutoff = nowFn() - HUNG_AFTER_MS;
    const hungTo = new Map<CallGroupDestination, number>();
    const hungPage = new Map<string | null, number>();
    for (const h of inFlight.values()) {
      if (h.startedAt > cutoff) continue;
      const to = h.to ?? "unnamed";
      hungTo.set(to, (hungTo.get(to) ?? 0) + 1);
      const page = h.page ?? null;
      hungPage.set(page, (hungPage.get(page) ?? 0) + 1);
    }

    // Destinations.
    const toRows: { to: CallGroupDestination; t: CauseTally }[] = [];
    const seenTo = new Set<CallGroupDestination>([...causeByTo.keys(), ...hungTo.keys()]);
    for (const to of seenTo) {
      const t = withHung(causeByTo.get(to) ?? emptyTally(), hungTo.get(to) ?? 0);
      if (t.calls > 0) toRows.push({ to, t });
    }
    if (toRows.length === 0) return null;
    toRows.sort(
      (a, b) =>
        troubleOf(b.t) - troubleOf(a.t) ||
        b.t.calls - a.t.calls ||
        a.to.localeCompare(b.to),
    );
    const total = emptyTally();
    for (const { t } of toRows) {
      total.calls += t.calls;
      total.slow += t.slow;
      for (const k of CAUSE_FAILURE_KINDS) total.kinds[k] += t.kinds[k];
    }
    const destinations: CauseCallDestination[] = toRows
      .slice(0, CAUSE_MAX_DESTINATIONS)
      .map(({ to, t }) => {
        const row: CauseCallDestination = { to, calls: t.calls };
        if (t.slow > 0) row.slow = t.slow;
        putFailureCounts(row, t.kinds);
        return row;
      });
    const out: CauseCalls = { calls: total.calls, destinations, pages: [] };
    if (total.slow > 0) out.slow = total.slow;
    putFailureCounts(out, total.kinds);
    const restTo = toRows.slice(CAUSE_MAX_DESTINATIONS);
    if (restTo.length > 0) {
      out.destinationsNotListed = {
        destinations: restTo.length,
        calls: restTo.reduce((n, r) => n + r.t.calls, 0),
      };
    }

    // Pages.
    const pageRows: { page: string; t: CauseTally }[] = [];
    for (const page of causeByPage.keys()) {
      const t = withHung(causeByPage.get(page) ?? emptyTally(), hungPage.get(page) ?? 0);
      if (t.calls > 0) pageRows.push({ page, t });
    }
    // A hanging call that started on a page no longer tracked by name joins
    // the counted-not-named remainder, exactly as its settle would have.
    let overflowHung = 0;
    for (const [page, n] of hungPage) {
      if (page !== null && !causeByPage.has(page)) overflowHung += n;
    }
    pageRows.sort(
      (a, b) =>
        troubleOf(b.t) - troubleOf(a.t) ||
        b.t.calls - a.t.calls ||
        a.page.localeCompare(b.page),
    );
    out.pages = pageRows.slice(0, CAUSE_MAX_PAGES).map(({ page, t }) => {
      const row: CauseCallPage = { page, calls: t.calls };
      if (t.slow > 0) row.slow = t.slow;
      const failed = failuresOf(t);
      if (failed > 0) row.failed = failed;
      return row;
    });
    const restPages = pageRows.slice(CAUSE_MAX_PAGES);
    const overflowCalls = causePageOverflow.calls + overflowHung;
    const notListedPages = restPages.length + causePageOverflowNames.size;
    const notListedCalls = restPages.reduce((n, r) => n + r.t.calls, 0) + overflowCalls;
    if (notListedCalls > 0) {
      out.pagesNotListed = { pages: Math.max(1, notListedPages), calls: notListedCalls };
    }
    const noPage = causeNoPage.calls + (hungPage.get(null) ?? 0);
    if (noPage > 0) out.callsWithNoPage = noPage;
    return out;
  } catch {
    return null;
  }
}

/** Current Network axis reading (pending until >=3 attempts observed). */
export function readNetwork(): NetworkResult {
  return computeNetworkScore(getNetworkStats());
}

/** @internal test hook — seed attempts deterministically without live resource
 *  timing. Each entry mirrors a resource-timing outcome. */
export function _setNetworkSamplesForTests(
  entries: ResourceEntryLike[],
): void {
  _resetNetworkSamplerForTests();
  for (const e of entries) recordResourceEntry(e);
}

/** @internal test hook — drive the sampler's clock. */
export function _setNetworkClockForTests(fn: (() => number) | null): void {
  nowFn = fn ?? (() => Date.now());
}

/* ─── Dependency distance: how long a NEW connection takes to OPEN ───────
 *
 * Distance is judged on connection SETUP only — connect + secure, before a
 * single byte of the request is sent. A round trip would fold in however long
 * the backend spent thinking, and a slow backend would then be reported as a
 * distant one.
 *
 * BROWSER LIMIT, STATED NOT HIDDEN: these phases are only readable for the
 * app's OWN origin unless the other side opts in (Timing-Allow-Origin), and
 * almost nobody does. So this kit measures the app's own backend and says
 * nothing at all about anything else — never a zero standing in for a reading
 * it cannot take.
 *
 * Nothing but numbers is kept: the entry's address is examined by the caller
 * to answer "is this our own origin?" and is never passed in here.
 */

/** Retained setup samples / own-backend call durations (bounded). */
const MAX_SETUP_SAMPLES = 200;
/** A setup longer than this is a hung socket, not a distance reading. */
const MAX_SETUP_MS = 60_000;

let ownBackendSetups: number[] = [];
let ownBackendDurations: number[] = [];

/** The only fields ever read from a resource-timing entry for distance. */
export interface ResourceSetupLike {
  /** Did this call go to the app's OWN origin? Decided by the caller. */
  sameOrigin: boolean;
  connectStart?: number;
  connectEnd?: number;
  duration?: number;
}

/**
 * Record one same-origin resource-timing entry's connection setup. A REUSED
 * connection reports no connect phase (connectEnd === connectStart) and is
 * skipped — nothing was set up, so there is nothing to time. Guarded; never
 * throws, and runs whether or not call-watching attached (the wrapper cannot
 * see connection phases, only this observer can).
 */
export function recordResourceSetup(e: ResourceSetupLike): void {
  if (isRuntimeInert()) return;
  try {
    if (!e || !e.sameOrigin) return;
    const dur = e.duration;
    if (typeof dur === "number" && Number.isFinite(dur) && dur > 0) {
      pushDuration(ownBackendDurations, MAX_SETUP_SAMPLES, Math.round(dur));
    }
    const cs = e.connectStart;
    const ce = e.connectEnd;
    if (typeof cs !== "number" || typeof ce !== "number") return;
    if (!(ce > cs)) return;
    const setup = ce - cs;
    if (!Number.isFinite(setup) || setup <= 0 || setup > MAX_SETUP_MS) return;
    pushDuration(
      ownBackendSetups,
      MAX_SETUP_SAMPLES,
      Math.round(setup * 10) / 10,
    );
  } catch {
    // observation must never break the page
  }
}

/** Label-free distance aggregate: the app's own backend, and nothing else. */
export function getDependencyDistanceStats(): DependencyDistanceStatsLike {
  const kinds =
    ownBackendSetups.length > 0
      ? [
          {
            kind: DEP_KIND_OWN_BACKEND,
            connections: ownBackendSetups.length,
            setupMs: percentileOf(ownBackendSetups, 0.5),
          },
        ]
      : [];
  return {
    kinds,
    newConnections: ownBackendSetups.length,
    // A typical call to this app's own backend, as felt on the page.
    typicalRequestMs:
      ownBackendDurations.length > 0
        ? percentileOf(ownBackendDurations, 0.5)
        : null,
    // A browser has no platform region to declare — honestly unknown.
    hostArea: 0,
    ownBackendOnly: 1,
  };
}

/** @internal test hook — reset all network state. */
export function _resetNetworkSamplerForTests(): void {
  durations = [];
  stampedDurations.clear();
  seenGroups.clear();
  completedCount = 0;
  failedCount = 0;
  abortedCount = 0;
  timedOutCount = 0;
  worstMs = 0;
  watching = false;
  nextCallId = 1;
  inFlight = new Map<number, CallHandle>();
  groups = new Map<string, GroupAgg>();
  overflowNames = new Set<string>();
  settled = new Set<number>();
  causeByTo = new Map<CallGroupDestination, CauseTally>();
  causeByPage = new Map<string, CauseTally>();
  causePageOverflow = emptyTally();
  causePageOverflowNames = new Set<string>();
  causeNoPage = emptyTally();
  completedHandles = new Map<number, CallHandle>();
  nowFn = () => Date.now();
  ownBackendSetups = [];
  ownBackendDurations = [];
  // The declared counts belong to the same window; the names are kept.
  resetDeclaredCallCounts();
}
