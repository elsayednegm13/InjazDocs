/** WHAT HELD A PAGE VIEW UP — split from what the browser already reports.
 *
 * A slow page view used to arrive as a route, a duration and a count. The kit
 * was already measuring, for the whole visit, how much long-script time came
 * from the site's own code and how much from other addresses — and none of it
 * reached the slow page. This module keeps those facts on the page clock long
 * enough to answer for ONE view: of the time the visitor waited, how much went
 * to long scripts from the site's own address, how much to long scripts from
 * other addresses (and whose, when the service is one we recognise), how much
 * to waiting on calls while no long script ran, and the rest.
 *
 * WHERE THE BROWSER DOES NOT REPORT SCRIPTS (no long-animation-frame entries:
 * Safari and Firefox today) the split says so in its own word,
 * `not-reported`, and the script time stays inside "the rest". A zero would
 * read as "no script held this page up", which nobody measured.
 *
 * Every number is a duration in milliseconds. A script's address is read on
 * the observer's stack for two decisions — own address or not, and which
 * closed destination token it belongs to — and dropped; a call contributes
 * only its start and end on the page clock.
 */

import { callGroupDestination, type CallGroupDestination } from "./callGroups";
import type { CausePageWait } from "./problemCause";

/** Bounded memory: a page that runs for hours keeps only the most recent
 *  slices. A view is closed long before these fill on any ordinary page. */
const MAX_SCRIPT_SLICES = 600;
const MAX_CALL_SPANS = 600;
/** Routes remembered, and views remembered per route. */
const MAX_ROUTES = 64;
const MAX_VIEWS_PER_ROUTE = 8;

interface ScriptSlice {
  start: number;
  end: number;
  own: boolean;
  /** The destination token of an other-address script; null for own. */
  to: CallGroupDestination | null;
}

interface Span {
  start: number;
  end: number;
}

let scriptSlices: ScriptSlice[] = [];
let callSpans: Span[] = [];
let scriptsReported = false;

/** One measured view's split, remembered by route and by its rounded
 *  duration so the reporter can find the view its problem names. */
interface ViewWait {
  ms: number;
  at: number;
  wait: CausePageWait;
}
const waitsByRoute = new Map<string, ViewWait[]>();

/** Tell this module the browser reports long scripts (the long-animation-
 *  frame observer attached). Idempotent. */
export function notePageScriptsReported(): void {
  scriptsReported = true;
}

/** Same-origin test, string read once and dropped. Relative or unparseable
 *  addresses are the site's own (never over-blame another address). The
 *  PARSED origins are compared, never a prefix of the address: a prefix test
 *  files https://shop.example.evil.com, or the same host on another port, as
 *  https://shop.example's own code. */
function isOtherAddress(url: unknown): boolean {
  try {
    if (typeof url !== "string" || url.length === 0) return false;
    const loc = (globalThis as { location?: { origin?: string } }).location;
    const own = loc && typeof loc.origin === "string" ? loc.origin : "";
    if (!/^[a-z]+:\/\//i.test(url)) return false;
    return new URL(url).origin !== own;
  } catch {
    return false;
  }
}

/** Record one long script on the page clock. Guarded; never throws. */
export function notePageScript(
  startPerf: number,
  durationMs: number,
  sourceUrl: unknown,
): void {
  try {
    if (!Number.isFinite(startPerf) || !Number.isFinite(durationMs)) return;
    if (durationMs <= 0) return;
    const other = isOtherAddress(sourceUrl);
    scriptSlices.push({
      start: startPerf,
      end: startPerf + durationMs,
      own: !other,
      to: other ? callGroupDestination(sourceUrl) : null,
    });
    if (scriptSlices.length > MAX_SCRIPT_SLICES) {
      scriptSlices.splice(0, scriptSlices.length - MAX_SCRIPT_SLICES);
    }
  } catch {
    // attribution must never break the page
  }
}

/** Record one finished call on the page clock. Guarded; never throws. */
export function notePageCall(startPerf: number, endPerf: number): void {
  try {
    if (!Number.isFinite(startPerf) || !Number.isFinite(endPerf)) return;
    if (endPerf <= startPerf) return;
    callSpans.push({ start: startPerf, end: endPerf });
    if (callSpans.length > MAX_CALL_SPANS) {
      callSpans.splice(0, callSpans.length - MAX_CALL_SPANS);
    }
  } catch {
    // attribution must never break the page
  }
}

/** Merge overlapping spans already clipped to a window. */
function mergeSpans(spans: Span[]): Span[] {
  const sorted = spans.slice().sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) {
      if (s.end > last.end) last.end = s.end;
    } else {
      out.push({ start: s.start, end: s.end });
    }
  }
  return out;
}

function totalOf(spans: Span[]): number {
  let t = 0;
  for (const s of spans) t += s.end - s.start;
  return t;
}

/** Length of the overlap between two merged span lists. */
function overlapOf(a: Span[], b: Span[]): number {
  let i = 0;
  let j = 0;
  let t = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i].start, b[j].start);
    const hi = Math.min(a[i].end, b[j].end);
    if (hi > lo) t += hi - lo;
    if (a[i].end < b[j].end) i++;
    else j++;
  }
  return t;
}

/** Tokens that name no particular service. */
function isNamedService(to: CallGroupDestination | null): to is CallGroupDestination {
  return to !== null && to !== "third-party" && to !== "unnamed" && to !== "same-origin";
}

/**
 * Split one view's wait. `startPerf` is where the view's measurement starts on
 * the page clock and `totalMs` its measured duration; the parts always add up
 * to the rounded total.
 */
export function pageWaitFor(startPerf: number, totalMs: number): CausePageWait | null {
  try {
    if (!Number.isFinite(startPerf) || !Number.isFinite(totalMs) || totalMs <= 0) {
      return null;
    }
    const total = Math.round(totalMs);
    const from = startPerf;
    const to = startPerf + totalMs;

    // Long scripts inside the view, clipped to it. Script slices never truly
    // overlap (one main thread), but a slice is only ever counted once even if
    // two reports cover the same moment: time already covered goes to the
    // slice that began first.
    let ownMs = 0;
    let otherMs = 0;
    const otherByService = new Map<string, number>();
    const scriptCover: Span[] = [];
    if (scriptsReported) {
      const inView = scriptSlices
        .filter((s) => s.end > from && s.start < to)
        .sort((a, b) => a.start - b.start);
      let cursor = from;
      for (const s of inView) {
        const lo = Math.max(s.start, cursor, from);
        const hi = Math.min(s.end, to);
        if (hi <= lo) continue;
        const d = hi - lo;
        if (s.own) ownMs += d;
        else {
          otherMs += d;
          const key = s.to ?? "unnamed";
          otherByService.set(key, (otherByService.get(key) ?? 0) + d);
        }
        scriptCover.push({ start: lo, end: hi });
        cursor = hi;
      }
    }

    // Waiting on calls: the time at least one call was in flight inside the
    // view, less any of it a long script was already accounted for.
    const calls = mergeSpans(
      callSpans
        .filter((c) => c.end > from && c.start < to)
        .map((c) => ({ start: Math.max(c.start, from), end: Math.min(c.end, to) })),
    );
    const callMs = Math.max(0, totalOf(calls) - overlapOf(calls, mergeSpans(scriptCover)));

    let own = Math.round(ownMs);
    let other = Math.round(otherMs);
    let callWait = Math.round(callMs);
    // Rounding can never make the parts exceed the whole.
    if (own + other > total) {
      const scale = total / (own + other);
      own = Math.floor(own * scale);
      other = Math.floor(other * scale);
    }
    if (own + other + callWait > total) callWait = Math.max(0, total - own - other);
    const rest = total - own - other - callWait;

    if (!scriptsReported) {
      return { totalMs: total, scripts: "not-reported", callWaitMs: callWait, restMs: rest };
    }
    const out: CausePageWait = {
      totalMs: total,
      scripts: "reported",
      ownScriptMs: own,
      otherScriptMs: other,
      callWaitMs: callWait,
      restMs: rest,
    };
    // Name the service only when it is the one behind MOST of the other
    // address's script time, and only when we recognise it. "Another address"
    // stays unnamed.
    let topKey: string | null = null;
    let topMs = 0;
    for (const [key, ms] of otherByService) {
      if (ms > topMs || (ms === topMs && topKey !== null && key < topKey)) {
        topKey = key;
        topMs = ms;
      }
    }
    if (other > 0 && isNamedService(topKey as CallGroupDestination | null)) {
      out.otherScriptService = topKey as CallGroupDestination;
    }
    return out;
  } catch {
    return null;
  }
}

/** Remember one measured view's split under its route. */
export function noteViewWait(
  route: string,
  durationMs: number,
  startPerf: number | null,
): void {
  try {
    if (startPerf === null || !Number.isFinite(startPerf)) return;
    const wait = pageWaitFor(startPerf, durationMs);
    if (wait === null) return;
    let list = waitsByRoute.get(route);
    if (!list) {
      if (waitsByRoute.size >= MAX_ROUTES) {
        const oldest = waitsByRoute.keys().next().value;
        if (oldest !== undefined) waitsByRoute.delete(oldest);
      }
      list = [];
      waitsByRoute.set(route, list);
    }
    list.push({ ms: wait.totalMs, at: Date.now(), wait });
    if (list.length > MAX_VIEWS_PER_ROUTE) list.shift();
  } catch {
    // attribution must never break the page
  }
}

/** The split for the route's view that measured exactly `ms` (the view the
 *  slow-page problem names), with when it was measured. The most recent such
 *  view wins. Null when no view of that length was split here. */
export function viewWaitFor(
  route: string,
  ms: number,
): { wait: CausePageWait; at: number } | null {
  const list = waitsByRoute.get(route);
  if (!list) return null;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].ms === ms) return { wait: list[i].wait, at: list[i].at };
  }
  return null;
}

/** Test-only: drop every remembered slice, span and split. */
export function _resetPageWaitForTests(): void {
  scriptSlices = [];
  callSpans = [];
  scriptsReported = false;
  waitsByRoute.clear();
}
