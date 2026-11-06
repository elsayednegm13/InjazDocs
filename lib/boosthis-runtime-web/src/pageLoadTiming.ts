/**
 * WHAT A PAGE-LOAD READING MAY COUNT: only time a visitor spent waiting.
 *
 * A browser reading rates a page by its load: the latest "largest paint" the
 * browser reported, or the first byte when there was none. Both are timed from
 * when the DOCUMENT opened, and that clock has no idea whether anybody was
 * looking. A new customer's very first reading said their home page took more
 * than a minute to load; the next load of the same page took a fraction of a
 * second. The kit had been added to a dev page that was already open (a hot
 * update put it there), and it graded a paint from late in that page's life.
 * The stored reading could not even say which timing it was.
 *
 * The cuts below are the ones Google's web-vitals library makes:
 *   - a prerendered page's wait starts when the visitor opened it
 *     (`activationStart`), never when the browser began rendering it unseen;
 *   - a paint after the page was first hidden, after the visitor's first
 *     input, or after a restore from the back-forward cache is not part of the
 *     load.
 * And two of our own, for cases web-vitals leaves to its caller:
 *   - a dev server's hot update re-renders without navigating, so no paint
 *     after the first hot-update download belongs to the page's load;
 *   - once one paint has been accepted, a paint long after the page opened is
 *     a re-render, not the load.
 *
 * A kit that JOINS a page long after it finished loading has watched none of
 * the load, and cannot tell which of its paints anybody waited for. It does
 * not grade that page, and says so once on the console.
 *
 * Every reading also names the timing it used and how the page was opened,
 * from the two closed lists below, which the server keeps beside the number.
 *
 * Everything here is read on the page's own clock (`performance.now()`), and
 * the subtraction of `activationStart` happens only when a value is read, so a
 * prerendered page that activates later is still measured from activation.
 */

/** Which timing a page-load reading is. Closed list: the server refuses any
 *  other word (`artifacts/api-server/src/routes/samples.ts`). */
import { outsideAngular } from "./zoneSafe";

export type PageLoadTiming = "lcp" | "ttfb";
export const PAGE_LOAD_TIMINGS: readonly PageLoadTiming[] = ["lcp", "ttfb"];

/** How the page behind a reading was opened. Closed list, same server check.
 *  `in-page` is a view the page opened itself (an address change in a
 *  single-page app), which has no load of its own. */
export type PageOpened =
  | "navigate"
  | "reload"
  | "back-forward"
  | "prerender"
  | "hidden"
  | "in-page";
export const PAGE_OPENED_WORDS: readonly PageOpened[] = [
  "navigate",
  "reload",
  "back-forward",
  "prerender",
  "hidden",
  "in-page",
];

/** How long after the page finished loading the kit may start and still be
 *  said to have watched the load. A kit started from a load handler, or by a
 *  tag manager a moment later, is on time; one a hot update dropped into a page
 *  that has been open for a minute is not. Anything still loading is on time. */
export const LATE_JOIN_MS = 5_000;

/** Once a paint has been accepted, a paint this long after the page opened is
 *  a re-render, not the load. Only cuts paints AFTER an accepted one: a page
 *  whose first paint really took this long is slow, and is graded as slow. */
export const LATE_PAINT_MS = 30_000;

/** Paint candidates kept per document. The browser stops reporting them at
 *  the first input, so a real page reports a handful; the cap only bounds a
 *  page nobody touches that keeps growing its largest element. */
const MAX_CANDIDATES = 64;

/** The one line a late kit says. Kept as ONE contiguous literal, like the
 *  other kit-owned console lines, so a guard can grep the shipped source. */
export const LATE_JOIN_LINE =
  "[boosthis] Boosthis started after this page had finished loading, so this page's load is not graded: the kit cannot tell which of its paints a visitor waited for. The next page opened is measured from its start.";

type NavTiming = PerformanceNavigationTiming & { activationStart?: number };

interface Clock {
  /** Paint candidates (raw `startTime`, page clock), in arrival order. */
  candidates: number[];
  /** When the page was first hidden, from the events this module saw. */
  hiddenEventAt: number;
  /** The first trusted input. */
  firstInputAt: number;
  /** The first restore from the back-forward cache. */
  restoredAt: number;
  /** The first hot-update download after the page had loaded. */
  hotUpdateAt: number;
  /** Was the document hidden (and not prerendering) when the kit started? */
  hiddenAtStart: boolean;
  /** Was the document prerendering when the kit started? */
  prerenderingAtStart: boolean;
  /** Did the kit start long after the page finished loading? */
  joinedLate: boolean;
  /** Has the late-join line been said in this document? */
  lateLineSaid: boolean;
  armed: boolean;
}

function freshClock(): Clock {
  return {
    candidates: [],
    hiddenEventAt: Infinity,
    firstInputAt: Infinity,
    restoredAt: Infinity,
    hotUpdateAt: Infinity,
    hiddenAtStart: false,
    prerenderingAtStart: false,
    joinedLate: false,
    lateLineSaid: false,
    armed: false,
  };
}

let clock: Clock = freshClock();
let detach: Array<() => void> = [];

function perf(): Performance | null {
  return typeof performance !== "undefined" ? performance : null;
}

function navEntry(): NavTiming | null {
  try {
    const p = perf();
    if (!p || typeof p.getEntriesByType !== "function") return null;
    const nav = p.getEntriesByType("navigation")[0] as NavTiming | undefined;
    return nav ?? null;
  } catch {
    return null;
  }
}

function isPrerendering(): boolean {
  try {
    return (
      typeof document !== "undefined" &&
      (document as Document & { prerendering?: boolean }).prerendering === true
    );
  } catch {
    return false;
  }
}

/** When the visitor opened the page, on the page clock. Zero for any page
 *  that was not prerendered (and, until activation, for one that was). */
export function activationStart(): number {
  const a = navEntry()?.activationStart;
  return typeof a === "number" && Number.isFinite(a) && a > 0 ? a : 0;
}

function nowMs(): number {
  try {
    const p = perf();
    if (p && typeof p.now === "function") return p.now();
  } catch {
    // fall through
  }
  return 0;
}

/** The browser's own record of visibility changes (`visibility-state`
 *  entries), oldest first, or null where the engine keeps none. */
function visibilityEntries(): PerformanceEntry[] | null {
  try {
    const p = perf();
    if (!p || typeof p.getEntriesByType !== "function") return null;
    const supported =
      typeof PerformanceObserver !== "undefined" &&
      Array.isArray(PerformanceObserver.supportedEntryTypes) &&
      PerformanceObserver.supportedEntryTypes.includes("visibility-state");
    if (!supported) return null;
    return p
      .getEntriesByType("visibility-state")
      .slice()
      .sort((x, y) => x.startTime - y.startTime);
  } catch {
    return null;
  }
}

/** Was the page opened in the background — hidden from its very first moment
 *  and not because it was prerendering? */
function openedHidden(): boolean {
  if (clock.prerenderingAtStart || activationStart() > 0) return false;
  const entries = visibilityEntries();
  if (entries && entries.length > 0) {
    const first = entries[0];
    return first.name === "hidden" && first.startTime <= 1;
  }
  return clock.hiddenAtStart;
}

/** When the page was first hidden after the visitor opened it, on the page
 *  clock; Infinity while it has not been. */
function firstHiddenAt(): number {
  if (openedHidden()) return 0;
  let at = clock.hiddenEventAt;
  const a = activationStart();
  const entries = visibilityEntries();
  if (entries) {
    for (const e of entries) {
      if (e.name !== "hidden") continue;
      // A prerendered page is hidden until it is opened; only a hide after
      // activation counts.
      if (a > 0 ? e.startTime > a : e.startTime >= 0) {
        if (e.startTime < at) at = e.startTime;
        break;
      }
    }
  }
  return at;
}

/** The earliest moment after which no paint belongs to the page's load. */
function hardStop(): number {
  return Math.min(firstHiddenAt(), clock.firstInputAt, clock.restoredAt, clock.hotUpdateAt);
}

/** One paint candidate (a `largest-contentful-paint` entry's `startTime`). */
import { isRuntimeInert } from "./lockGate";
export function noteLcpCandidate(startTime: number): void {
  if (isRuntimeInert()) return;
  if (!Number.isFinite(startTime) || startTime < 0) return;
  if (clock.candidates.length >= MAX_CANDIDATES) {
    // Keep the earliest ones: a load is decided early, and nothing past the
    // cap can be accepted under the late-paint rule anyway.
    return;
  }
  clock.candidates.push(startTime);
}

/** The first trusted input, from an event or the browser's `first-input`
 *  entry (which also covers an input made before the kit started). */
export function noteFirstInput(at: number): void {
  if (isRuntimeInert()) return;
  if (Number.isFinite(at) && at >= 0 && at < clock.firstInputAt) clock.firstInputAt = at;
}

/** A restore from the back-forward cache (`pageshow` with `persisted`). */
export function notePageRestored(at: number): void {
  if (isRuntimeInert()) return;
  if (Number.isFinite(at) && at >= 0 && at < clock.restoredAt) clock.restoredAt = at;
}

/** Does this address look like a dev server's hot-update download?
 *  webpack names them `*.hot-update.js|json`; Vite re-imports a changed
 *  module with a `t=<13-digit time>` query. Vite also stamps that query on a
 *  full reload of a module that was hot-updated before, which is why a Vite
 *  shape only counts after the page has finished loading (see below).
 *  Other dev servers (Turbopack among them) are not recognised; the late-paint
 *  rule is what covers them. */
export function isHotUpdateAddress(address: string): "webpack" | "vite" | null {
  if (typeof address !== "string" || address === "") return null;
  if (/\.hot-update\.(?:js|json|mjs)(?:[?#]|$)/.test(address)) return "webpack";
  if (/[?&]t=\d{13}(?:[&#]|$)/.test(address)) return "vite";
  return null;
}

/** One resource download seen by the kit's resource observer. The address is
 *  read on this stack for one decision ("is this a hot update?") and dropped;
 *  only the time survives. */
export function noteResourceForPageLoad(address: string | undefined, startTime: number): void {
  try {
    if (typeof address !== "string" || !Number.isFinite(startTime)) return;
    const kind = isHotUpdateAddress(address);
    if (kind === null) return;
    if (kind === "vite") {
      const loaded = navEntry()?.loadEventEnd;
      if (!(typeof loaded === "number" && loaded > 0 && startTime > loaded)) return;
    }
    if (startTime < clock.hotUpdateAt) clock.hotUpdateAt = startTime;
  } catch {
    // never break the observer
  }
}

/** The page's largest paint as the visitor waited for it, in ms from when they
 *  opened the page, or null when no paint qualifies. */
export function acceptedLcpMs(): number | null {
  if (isPrerendering()) return null;
  const a = activationStart();
  const stop = hardStop();
  let accepted: number | null = null;
  for (const t of clock.candidates) {
    if (t >= stop) continue;
    const waited = Math.max(t - a, 0);
    if (accepted !== null && waited > LATE_PAINT_MS) continue;
    accepted = waited;
  }
  return accepted === null ? null : Math.round(accepted);
}

/** The first byte as the visitor waited for it, in ms from when they opened
 *  the page, or null when the browser gave no navigation timing. */
export function acceptedTtfbMs(): number | null {
  if (isPrerendering()) return null;
  const nav = navEntry();
  if (!nav || !Number.isFinite(nav.responseStart) || nav.responseStart <= 0) return null;
  return Math.round(Math.max(nav.responseStart - activationStart(), 0));
}

/** Did the kit join this page long after it had finished loading? */
export function joinedLate(): boolean {
  return clock.joinedLate;
}

/** Has the browser recorded the page's first contentful paint? Read from the
 *  timeline, which has it the moment it happens — an observer hears of it a
 *  task later. */
function contentfulPaintRecorded(): boolean {
  const p = perf();
  if (!p || typeof p.getEntriesByType !== "function") return false;
  return p
    .getEntriesByType("paint")
    .some((e) => e.name === "first-contentful-paint");
}

/** HAS ANYBODY SEEN THIS PAGE YET?
 *
 *  True while it is still prerendering (nobody has opened it), or while the
 *  kit has watched it from the start and nothing on it has been painted and
 *  no one has touched it. An address change inside that window is the app
 *  settling where it starts — a router sending / on to /home — not a person
 *  leaving one screen for another: there was no screen to leave, so the
 *  document's timing belongs to the screen at the new address.
 *
 *  A page the kit joined late was seen long ago, whatever this module heard.
 *  `paintedElsewhere` carries a paint this module does not observe itself
 *  (the kit's first-contentful-paint meter). Anything unreadable answers
 *  "seen", which keeps an address change the boundary it always was. */
export function pageStillUnseen(paintedElsewhere: boolean): boolean {
  try {
    if (isPrerendering()) return true;
    if (clock.joinedLate) return false;
    if (paintedElsewhere) return false;
    if (clock.candidates.length > 0) return false;
    if (Number.isFinite(clock.firstInputAt)) return false;
    return !contentfulPaintRecorded();
  } catch {
    return false;
  }
}

/** The FIRST view's reading: the accepted largest paint, or the first byte when
 *  no paint qualifies — and no reading at all for a page the kit joined late or
 *  one still prerendering (nobody has opened it). */
export function firstViewReading(): { duration: number | null; timing: PageLoadTiming } {
  if (clock.joinedLate || isPrerendering()) return { duration: null, timing: "lcp" };
  const lcp = acceptedLcpMs();
  if (lcp !== null) return { duration: lcp, timing: "lcp" };
  return { duration: acceptedTtfbMs(), timing: "ttfb" };
}

/** How the page behind the first view was opened. Precedence: prerendered
 *  outranks opened hidden, which outranks the navigation type. */
export function pageOpenedHow(): PageOpened {
  const nav = navEntry();
  const type = typeof nav?.type === "string" ? (nav.type as string) : "";
  if (clock.prerenderingAtStart || activationStart() > 0 || type === "prerender") {
    return "prerender";
  }
  if (openedHidden()) return "hidden";
  if (type === "back_forward") return "back-forward";
  if (type === "reload") return "reload";
  return "navigate";
}

/** Decide, once, whether the kit joined late: the page finished loading more
 *  than LATE_JOIN_MS before now. A page still loading, one with no navigation
 *  timing, or one still prerendering is on time. */
function decideLateJoin(): boolean {
  if (clock.prerenderingAtStart) return false;
  const nav = navEntry();
  if (!nav) return false;
  const loaded = nav.loadEventEnd;
  if (!(typeof loaded === "number" && Number.isFinite(loaded) && loaded > 0)) return false;
  return nowMs() - Math.max(loaded, activationStart()) > LATE_JOIN_MS;
}

/** Listen on the global (the window, in a browser), in the CAPTURE phase:
 *  `visibilitychange` and `prerenderingchange` are fired at the document, and
 *  a capturing window listener sees both before any handler of the page's own
 *  can stop them. The same global the rest of the kit listens on. */
function listen(type: string, fn: (e: Event) => void): void {
  try {
    if (typeof addEventListener !== "function") return;
    const opts = { capture: true, passive: true };
    outsideAngular(() => addEventListener(type, fn, opts));
    detach.push(() => {
      try {
        removeEventListener(type, fn, opts);
      } catch {
        // ignore
      }
    });
  } catch {
    // no events of this kind: that stop is simply not available here
  }
}

/** An event's own time, on the page clock, or now when it carries none. */
function eventTime(e: Event): number {
  const t = e?.timeStamp;
  return typeof t === "number" && Number.isFinite(t) && t > 0 ? t : nowMs();
}

/** Start watching. Called once from the vitals start path, before any
 *  observer, so the late-join decision is made on the kit's real start time. */
export function armPageLoadTiming(): void {
  if (isRuntimeInert()) return;
  if (clock.armed) return;
  clock.armed = true;
  clock.prerenderingAtStart = isPrerendering();
  try {
    clock.hiddenAtStart =
      !clock.prerenderingAtStart &&
      typeof document !== "undefined" &&
      document.visibilityState === "hidden";
  } catch {
    clock.hiddenAtStart = false;
  }
  clock.joinedLate = decideLateJoin();
  if (clock.joinedLate && !clock.lateLineSaid) {
    clock.lateLineSaid = true;
    try {
      // console.info, not warn: nothing is broken, one page is just not timed.
      console.info(LATE_JOIN_LINE);
    } catch {
      // no console
    }
  }

  listen("visibilitychange", (e) => {
    try {
      if (document.visibilityState === "hidden" && !isPrerendering()) {
        const at = eventTime(e);
        if (at < clock.hiddenEventAt) clock.hiddenEventAt = at;
      }
    } catch {
      // ignore
    }
  });
  listen("pagehide", (e) => {
    const at = eventTime(e);
    if (at < clock.hiddenEventAt) clock.hiddenEventAt = at;
  });
  // Activated from prerendering straight into a background tab: hidden from
  // the moment the visitor opened it.
  listen("prerenderingchange", () => {
    try {
      if (document.visibilityState === "hidden") {
        const a = activationStart();
        if (a < clock.hiddenEventAt) clock.hiddenEventAt = a;
      }
    } catch {
      // ignore
    }
  });
  for (const type of ["keydown", "pointerdown", "click"]) {
    listen(type, (e) => {
      // A script's synthetic click is not a visitor touching the page.
      if (e?.isTrusted === false) return;
      noteFirstInput(eventTime(e));
    });
  }
}

/** @internal test hook. */
export function _resetPageLoadTimingForTests(): void {
  for (const off of detach) off();
  detach = [];
  clock = freshClock();
}
