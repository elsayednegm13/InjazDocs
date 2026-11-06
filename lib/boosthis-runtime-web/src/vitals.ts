/** Web-vitals collector — the web runtime's measurement engine.
 *
 * Observes the browser's own performance entries (no polling, no wrappers):
 *
 *   - TTFB  — navigation timing `responseStart`
 *   - LCP   — `largest-contentful-paint` entries (buffered)
 *   - CLS   — `layout-shift` entries without recent input, summed
 *   - INP-proxy — worst `event` entry duration ≥40ms (v1 uses the worst
 *     observed interaction rather than the full p98 INP calculation; honest
 *     but slightly stricter)
 *
 * Every observer is wrapped in try/catch and the whole module no-ops when
 * `PerformanceObserver` is missing (SSR, old browsers, tests) — measuring
 * must never crash the host page.
 *
 * PRIVACY: the only label ever attached to a sample is the page's OWN
 * pathname, normalized so volatile/identifying segments (numbers, UUIDs, long
 * hex ids, anything with an @) collapse to ":id" — the query string and hash
 * are never read. The label then still passes the shared PII guard at
 * transmit time like every other runtime.
 */

import { mountBubbleIfEnabled, resolveBubbleAudience } from "./bubble";
import { isRuntimeInert, registerLockLifecycle, entitlementGeneration, isDissolvedThisRun } from "./killSwitch";
import {
  announceKitStart,
  beginStartAnnouncement,
  flushHeldRefusals,
  sayAfterStartupLine,
  type BadgeState,
} from "./startAnnounce";
import { announceUnreadableSources } from "./sourceNotice";
import { watchFirstActivation } from "./activationNotice";
import { watchFirstMeasurement } from "./measuringNotice";
import { resolveProjectKey } from "./projectKey";
import { record } from "./samples";
import { setBuildIdentityOptions } from "./buildIdentity";
import { rateDuration, type Rating } from "./thresholds";
import {
  acceptedLcpMs,
  acceptedTtfbMs,
  activationStart,
  armPageLoadTiming,
  firstViewReading,
  joinedLate,
  noteFirstInput,
  noteLcpCandidate,
  notePageRestored,
  noteResourceForPageLoad,
  pageOpenedHow,
  pageStillUnseen,
  _resetPageLoadTimingForTests,
  type PageLoadTiming,
  type PageOpened,
} from "./pageLoadTiming";
import { recordResourceEntry, recordResourceSetup, _resetNetworkSamplerForTests } from "./networkSampler";
import {
  declareWaitsOnPurpose,
  isStreamMediaType,
  matchWaitName,
  takeStreamAddress,
} from "./declaredCalls";
import { callGroupDestination, type CallGroupDestination } from "./callGroups";
import {
  notePageCall,
  notePageScript,
  notePageScriptsReported,
  noteViewWait,
  _resetPageWaitForTests,
} from "./pageWait";
import { CAUSE_MAX_DESTINATIONS, type CauseBurst } from "./problemCause";
import { isOwnEndpointReply } from "./edgeCache";
import {
  startIdleTracking,
  noteUserInput,
  noteBusyBlock,
  _resetIdleTrackerForTests,
} from "./idleTracker";
import {
  installScrollSampler,
  uninstallScrollSampler,
} from "./scrollSampler";
import {
  installTimerTracking,
  uninstallTimerTracking,
} from "./timerHealth";
import {
  installLocalStoreTracking,
  uninstallLocalStoreTracking,
} from "./localStore";
import { installCallWatch, uninstallCallWatch } from "./callWatch";
import { noteAiResourceEntry, noteAiTurnBoundary } from "./aiCalls";
import { setDeclaredAiEndpoints } from "./aiProviders";
import {
  installSwallowedErrors,
  uninstallSwallowedErrors,
} from "./swallowedErrors";
import { installLeakWatch, uninstallLeakWatch } from "./leakWatch";
import {
  installLiveConnections,
  uninstallLiveConnections,
  noteLiveConnectionNavigation,
} from "./liveConnections";
import { startDevPosture } from "./devPosture";
import {
  noteLayoutShiftSources,
  noteInteractionId,
  armFontReadiness,
  armIdleOpportunity,
  _resetWebPlatformForTests,
} from "./webPlatform";
import {
  installUnhandledTracking,
  uninstallUnhandledTracking,
  installReportTracking,
  uninstallReportTracking,
  _resetWebReportsForTests,
} from "./webReports";
import {
  installBackgroundWorkTracking,
  uninstallBackgroundWorkTracking,
} from "./backgroundWork";
import {
  readControlId,
  recordControlPress,
  setControlWatchInstalled,
  CONTROL_JOIN_MAX_LATE_MS,
  _resetControlMapForTests,
} from "./controlMap";
import { controlHandle } from "./controlHandle";
import { recordControlExercised } from "./controlCensus";
import { notePressControl, notePressPaint } from "./pressTrace";
import {
  notePress as notePressToScreen,
  noteViewOpened as notePressViewOpened,
  noteViewMeasured as notePressViewMeasured,
  noteViewMeasuredFromPress as notePressViewMeasuredFromPress,
  noteViewUntimedForPress,
  notePressViewTimingSupport,
} from "./pressToScreen";
import {
  addressChangeFrom,
  noteAddress,
  noteReadingTaken,
  rebaseAddress,
  noteUntimedViewChange,
  setInteractionSource,
  _resetPageActivityForTests,
} from "./pageActivity";
import {
  noteViewMeasured,
  noteViewUntimed,
  savePageViewTally,
  setOpenViewMeasuredSource,
  _resetPageViewTallyForTests,
} from "./pageViewTally";
import {
  loadPageMap,
  noteMapVisit,
  pageMapHas,
  relabelMapVisit,
  savePageMap,
  _resetPageMapForTests,
} from "./pageMap";
import {
  routerNamesScreens,
  screenLabelFromRouter,
  screenLabelForHref,
  screenLabelForUrl,
  screenLabelForView,
  screenLabelNow,
} from "./screenLabel";
import { angularRouterPath, onRouterNavigation, type RouterNavigation } from "./angularRouter";
import { MAX_PART_NAME, normalizeRouteLabel } from "./partName";
import { SampleRing, epochOf, firstOfRoute } from "./settle";
import { kitObserver, kitTimeout, outsideAngular } from "./zoneSafe";
import { inServerRender } from "./browserPage";

/**
 * The one rule for what a part of the app is called lives in a LEAF module
 * (`partName.ts`). It used to live here, in the module that also ASSEMBLES
 * the kit, so anything needing the rule had to import the assembler — which
 * is how the page map's wire module was drawn into this kit's module cycle.
 * Re-exported so nothing that already took it from `vitals` had to change.
 */
export { MAX_PART_NAME, normalizeRouteLabel };

/**
 * The page the kit is on right now, as a route label — or null where there
 * is no document to ask.
 *
 * ONE source, because a census joins a press to the route it happened on:
 * a caller that derived the label its own way could ask about `/basket`
 * while the presses are filed under `/basket/` and report a pressed control
 * as never pressed.
 */
export function currentRouteLabel(): string | null {
  // The one resolver (screenLabel.ts): the handed-over router's pattern when
  // there is one, the address otherwise.
  return screenLabelNow();
}

export interface WebVitals {
  ttfbMs: number | null;
  lcpMs: number | null;
  cls: number | null;
  /** Worst qualifying interaction duration seen so far (INP proxy). */
  inpMs: number | null;
}

let started = false;
let finalized = false;
/** Is a page view currently open — i.e. is there a view left to close?
 *
 *  A view is opened by the document starting and by every address change the
 *  kit sees; it is closed by the finalizer. Without this, two closes in a row
 *  (the kit's own close on a route change, then a host app calling
 *  flushPageSample() for the same route change, as the guide has always told
 *  it to) would each count a view change that only happened once. */
let viewOpen = true;
/** Did the KIT close a view for an address change that a host app has not yet
 *  called flushPageSample() for? The guide told host apps to make that call on
 *  every client-side route change, and the kit now makes it itself — so the
 *  first manual call after an automatic boundary is the same navigation, not a
 *  second one. */
let autoClosedPending = false;
/** Has ANY page view of this document been recorded yet? The document's TTFB
 *  belongs to the first view and to no other, so it may only answer for that
 *  one — see finalizePageSample. */
let firstViewRecorded = false;
/** The accepted largest paint in hand when the CURRENT view opened. A paint
 *  belongs to this view only if a DIFFERENT one has been accepted since —
 *  which is how a later view is stopped from recording the previous view's
 *  number WITHOUT wiping the document's own paint record, which the LCP meter
 *  reads (pageLoadTiming.ts keeps it). */
let lcpAtViewStart: number | null = null;
/** How many completed soft-navigation measurements the browser had produced
 *  when the previous view was flushed. Anything past it was measured for the
 *  view now ending, and is the one honest duration a later SPA view can have.
 *
 *  A RUNNING TOTAL, never the length of the sample ring. That ring is capped,
 *  and in a tab that outlives the cap its length stops moving — so a length
 *  comparison would file every view after the cap as untimed while the
 *  browser was still measuring them. */
let softNavSamplesAtFlush = 0;
/** Has ANY view of this document been finalized yet?
 *
 *  Distinct from `firstViewRecorded`, which says whether a view was RECORDED.
 *  A first view that produced no reading at all leaves that one false for
 *  ever, and the document's TTFB would then be handed to the second view, and
 *  the third, as each one's own number. */
let anyViewFinalized = false;
/** The page-clock moment of the press that opened the CURRENT view, or null
 *  when no press opened it. A soft-navigation measurement starts at the
 *  interaction that began its view, so this is what tells this view's own
 *  measurement apart from one delivered late for a view already closed. */
let viewPressPerfAt: number | null = null;
/** The page-clock moment of the most recent press, waiting for a view. */
let lastPressPerfAt: number | null = null;
/** WHICH ROUTE the current view is filed under, taken when the view OPENED.
 *
 *  The kit closes a view from its address-change hook, and that hook runs
 *  AFTER the address has moved. A label read at close was therefore the NEXT
 *  screen's, and every reading a single-page app produced by navigating was
 *  filed one screen late — the first view's, which carries the document's own
 *  paint, on the second screen's route. Taken at open, it is the screen the
 *  view measured, whichever path closes it (an address change, a host's
 *  flushPageSample(), the page going away).
 *
 *  `undefined` until the kit has started: a view closed before then has no
 *  open to have been labelled at, and falls back to the address in hand. */
let viewLabel: string | null | undefined = undefined;
/** Whether `viewLabel` came from a handed-over router (the matched route's
 *  pattern) rather than the address. The reading carries it (`naming:
 *  "router"`), so the server can tell a screen RENAMED by the switch to
 *  router labels from a screen whose readings changed (screenLabel.ts). */
let viewNamedByRouter = false;
/** What opened the current view: the document loading, an address change the
 *  kit saw, or a host app calling flushPageSample(). */
let viewOpenedBy: "document" | "address" | "flush" = "document";
/** When (wall clock) a host flushPageSample() opened the current view. */
let viewFlushedAt = 0;
/** `personPressSeq` when a host flushPageSample() opened the current view. */
let viewFlushPressSeq = 0;
/** Presses and key presses a person has made (pointerdown, keydown). Counted
 *  so a navigation boundary can tell a host's own call for the SAME navigation
 *  apart from one for a screen the person asked for since. Nothing about the
 *  input is read. */
let personPressSeq = 0;
/** `personPressSeq` when the kit handled the address change that armed
 *  `autoClosedPending`. A press since then means a later flushPageSample() is
 *  for a new screen (a drawer, a wizard step), never the same navigation. */
let autoClosedPressSeq = 0;
/** How long a host flushPageSample() may run AHEAD of the address change it
 *  was made for and still be the same navigation. A router that calls it as
 *  navigation starts and moves the address once the next screen's data has
 *  arrived is seconds apart, not minutes; a press in between always breaks
 *  the pair, however soon. */
export const FLUSH_JOINS_ADDRESS_MS = 10_000;
let clsScore: number | null = null;
let inpMs: number | null = null;
let observers: Array<{ disconnect: () => void }> = [];

// Long tasks (main-thread blocks ≥50ms) are session-cumulative — like the RN
// stability axis — so they are NOT reset by flushPageSample (per-page-view
// vitals), only by _resetVitalsForTests. `longTaskWindowStart` anchors the
// per-minute rate to when observation began.
let longTaskCount = 0;
let worstBlockMs = 0;
let totalLongTaskMs = 0;
let longTaskWindowStart = 0;

// First contentful paint — a single `paint` PerformanceObserver entry
// (`first-contentful-paint`). Recorded once; null until the browser reports it.
// Feeds the paintReadiness axis (omitted until an FCP entry is seen).
let fcpMs: number | null = null;

// Long-animation-frames (LoAF) — the browser's `long-animation-frame` entries
// (blocks ≥50ms attributed to animation frames). Session-cumulative, like the
// long-task counters: count + worst duration + a window anchor for the per-min
// rate. `loafSupported` records whether the observer ever attached, so the
// animationSmoothness axis can stay OMITTED (not faked to 0) on browsers that
// don't expose LoAF.
/** Script invokers that are the page's async path (see blockingAsync). */
const ASYNC_PATH_INVOKERS = new Set(["user-callback", "resolve-promise", "reject-promise"]);
/** A script run this long or longer blocks (the long-task floor). */
const ASYNC_BLOCK_MIN_MS = 50;
/** Stamped async-path blocks (epoch ms at frame start, ms the script ran). */
const asyncBlockRing = new SampleRing(256);
let loafCount = 0;
let worstLoafMs = 0;
let loafWindowStart = 0;
let loafSupported = false;

// Dead clicks — a click on an actionable-looking target that produces NO
// navigation, no DOM mutation, and no scroll within a short window. These are
// session-cumulative and count-only: never the target, its text, its selector,
// or any URL leaves the page — exactly the privacy contract of every axis.
let deadClickCount = 0;
/** Presses inside an element marked RAPID_PRESS_ATTRIBUTE: kept out of the
 *  dead-click tally, counted only so the page still reads as used. */
let rapidPressCount = 0;
/** Monotonic press counter. Only the LATEST actionable press may claim the
 *  page change that follows: while two windows overlap, either press could
 *  have caused it, and crediting both would draw arrows from controls that
 *  opened nothing. The earlier press is still counted — as unjoined. */
let controlPressSeq = 0;
let actionableClickCount = 0;
let deadClickHandler: ((e: Event) => void) | null = null;

// Idle-efficiency input listener — stamps the last-input time so the idle
// tracker knows when the page is being driven. Removed in _resetVitalsForTests.
let idleInputHandler: ((e?: Event) => void) | null = null;

// Route reachability — the developer's optionally-declared route list plus the
// set of routes actually reached this session (see the Route reachability
// section below). Both hold only normalized labels and are read ONLY by the
// detector + dev bubble; neither is ever uploaded.
let registeredRoutes: string[] | null = null;
const warnedRouteRefusals = new Set<string>();

export function warnPartNameRefusal(reason: "too-long" | "invalid"): void {
  if (warnedRouteRefusals.has(reason)) return;
  warnedRouteRefusals.add(reason);
  try {
    console.warn(
      reason === "too-long"
        ? `Boosthis refused a route because its length exceeds ${MAX_PART_NAME} characters. Use a route pattern of at most ${MAX_PART_NAME} characters, with volatile segments written as :id.`
        : "Boosthis refused a route because it is empty or not a valid route pattern. Use a path such as /users/:id.",
    );
  } catch {
    /* a host console must never break registration */
  }
}
let visitedRoutes = new Set<string>();
// Bound the visited set so a long-lived, slug-heavy SPA session (routes whose
// segments don't collapse to ":id", e.g. /blog/my-post-title) can never grow it
// without limit. The set exists ONLY to answer "was this registered route
// reached?", so once full we evict the oldest distinct label (insertion order)
// — memory stays flat and reachability answers for the app's real routes, which
// are visited early and often, are unaffected.
const MAX_VISITED_ROUTES = 500;
let routeChangeHandler: (() => void) | null = null;
let origPushState: History["pushState"] | null = null;
let origReplaceState: History["replaceState"] | null = null;
let ownedPushState: History["pushState"] | null = null;
let ownedReplaceState: History["replaceState"] | null = null;

// Circuit-lens counters — the web analogue of the RN circuit map's nav-loop +
// fan-out detectors. COUNT-ONLY module state (never a URL, never a label in
// the exposed stats): nav loops are tracked incrementally from the same
// normalized route labels the reachability hooks already produce, and request
// bursts from a bounded ring of resource-timing START timestamps (fetch/xhr
// initiators only — the URL on the entry is never read or stored). Read ONLY
// by getCircuitStats() (dev bubble); never uploaded.
/** ≥ this many CONSECUTIVE alternating A⇄B navigations = a loop (RN parity). */
const NAV_LOOP_MIN_BOUNCES = 4;
/** The whole alternating streak must fit inside this window to count. */
const NAV_LOOP_WINDOW_MS = 30_000;
/** ≥ this many request starts inside one window = a fan-out burst
 *  (byte-parity with the server runtimes' circuit summary: 6 in 1s).
 *  Exported so the problem-reporting collector states the same window it
 *  measured rather than re-deciding the threshold on its own. */
export const FANOUT_WINDOW_MS = 1_000;
export const FANOUT_MIN_STARTS = 6;
/** Bound on the request-start timestamp ring (memory stays flat). */
const MAX_REQUEST_STARTS = 200;
let navPrevLabel: string | null = null; // last route label seen
let navPrevPrevLabel: string | null = null; // the one before it
let navRunLen = 0; // current alternating-edge streak
let navRunStartTs = 0; // when the current streak began
let navLoopMaxBounces = 0; // session max qualifying streak
/** One fetch/xhr start: when, which closed destination kind it went to, and
 *  the page it started on. The address is read once, upstream, to decide the
 *  token and dropped. */
interface RequestStart {
  t: number;
  to: CallGroupDestination;
  page: string | null;
}
let requestStarts: RequestStart[] = []; // bounded ring of fetch/xhr starts
let requestBurstMax1s = 0; // session max starts in any 1s window
/** What the WORST burst was made of: taken at the moment the session maximum
 *  rose, from the very starts that set it, so the count it carries is always
 *  the count the burst problem reports. */
let worstBurst: CauseBurst | null = null;

/** Feed one navigation into the incremental nav-loop tracker. Consecutive
 *  duplicate labels are ignored (replaceState refreshes are not navigations,
 *  and A⇄A can never be a loop). Guarded by callers. */
function recordNavForCircuit(label: string): void {
  if (label === navPrevLabel) return;
  const ts = nowMs();
  const isEdge = navPrevLabel !== null;
  // An edge "reverses" when we bounce straight back to where we just were.
  const reverses = isEdge && navPrevPrevLabel !== null && label === navPrevPrevLabel;
  if (!isEdge) {
    navRunLen = 0;
  } else if (reverses && navRunLen > 0 && ts - navRunStartTs <= NAV_LOOP_WINDOW_MS) {
    navRunLen++;
  } else {
    // Streak broken (or first edge, or window exceeded): this edge starts a
    // fresh potential streak of length 1.
    navRunLen = 1;
    navRunStartTs = ts;
  }
  if (navRunLen >= NAV_LOOP_MIN_BOUNCES && navRunLen > navLoopMaxBounces) {
    navLoopMaxBounces = navRunLen;
  }
  navPrevPrevLabel = navPrevLabel;
  navPrevLabel = label;
}

/** Feed one fetch/xhr start into the bounded ring and refresh the
 *  session-max densest-1s-window count. Guarded by callers. */
function recordRequestStartForCircuit(
  startTs: number,
  to: CallGroupDestination = "unnamed",
  page: string | null = null,
): void {
  if (!Number.isFinite(startTs)) return;
  requestStarts.push({ t: startTs, to, page });
  if (requestStarts.length > MAX_REQUEST_STARTS) {
    requestStarts.splice(0, requestStarts.length - MAX_REQUEST_STARTS);
  }
  // Resource entries can land slightly out of order; sort a copy then run the
  // standard two-pointer densest-window scan (ring is ≤200 — cheap).
  const sorted = requestStarts.slice().sort((a, b) => a.t - b.t);
  let lo = 0;
  for (let hi = 0; hi < sorted.length; hi++) {
    while (sorted[hi].t - sorted[lo].t > FANOUT_WINDOW_MS) lo++;
    const count = hi - lo + 1;
    if (count > requestBurstMax1s) {
      requestBurstMax1s = count;
      worstBurst = describeBurst(sorted.slice(lo, hi + 1));
    }
  }
}

/** The destinations and page of the starts inside one burst window. Counts
 *  and closed tokens; the page only when every start in it was on the same
 *  named page. */
function describeBurst(starts: RequestStart[]): CauseBurst {
  const byTo = new Map<CallGroupDestination, number>();
  const pages = new Set<string>();
  let unnamedPage = false;
  for (const s of starts) {
    byTo.set(s.to, (byTo.get(s.to) ?? 0) + 1);
    if (s.page === null) unnamedPage = true;
    else pages.add(s.page);
  }
  const rows = [...byTo.entries()]
    .map(([to, calls]) => ({ to, calls }))
    .sort((a, b) => b.calls - a.calls || a.to.localeCompare(b.to));
  const listed = rows.slice(0, CAUSE_MAX_DESTINATIONS);
  const rest = rows.slice(CAUSE_MAX_DESTINATIONS);
  const out: CauseBurst = {
    calls: starts.length,
    windowMs: FANOUT_WINDOW_MS,
    destinations: listed,
    pages: pages.size,
  };
  if (rest.length > 0) {
    out.destinationsNotListed = {
      destinations: rest.length,
      calls: rest.reduce((n, r) => n + r.calls, 0),
    };
  }
  if (pages.size === 1 && !unnamedPage) out.page = [...pages][0];
  return out;
}

/** The worst burst's make-up, or null when no burst has been seen. Read only
 *  beside `getCircuitStats()`, whose count it always matches. */
export function getWorstBurstCause(): CauseBurst | null {
  if (requestBurstMax1s < FANOUT_MIN_STARTS || worstBurst === null) return null;
  if (worstBurst.calls !== requestBurstMax1s) return null;
  return {
    ...worstBurst,
    destinations: worstBurst.destinations.map((d) => ({ ...d })),
  };
}

/** Which page each moment of the document belonged to, on the page clock:
 *  one entry per view, the label it was filed under. Lets a reading that
 *  arrives late (a resource entry lands after its call ended) be filed under
 *  the page its call STARTED on, never the page the visitor has moved to. */
const MAX_VIEW_TIMELINE = 32;
let viewTimeline: { at: number; label: string | null }[] = [];

function noteViewTimeline(opensView: boolean, label: string | null): void {
  const last = viewTimeline[viewTimeline.length - 1];
  if (!opensView && last) {
    last.label = label;
    return;
  }
  // The document's first view began at its own start, before the kit could
  // look; every later one at the moment it opened.
  viewTimeline.push({ at: viewTimeline.length === 0 ? 0 : nowMs(), label });
  if (viewTimeline.length > MAX_VIEW_TIMELINE) {
    viewTimeline.splice(0, viewTimeline.length - MAX_VIEW_TIMELINE);
  }
}

/** The page a moment on the page clock belonged to. */
function pageAtPerf(t: number): string | null {
  if (viewTimeline.length === 0) return viewLabel ?? null;
  let label = viewTimeline[0].label;
  for (const v of viewTimeline) {
    if (v.at <= t) label = v.label;
    else break;
  }
  return label;
}

/** Current vitals picture. Safe to call anywhere (nulls when unmeasured).
 *
 *  Both load timings are the ones a visitor WAITED for (pageLoadTiming.ts):
 *  measured from when the page was opened, so a prerendered page is timed from
 *  the visitor's click, and no paint after the page was first hidden, first
 *  touched or restored counts. A kit that joined the page long after it had
 *  loaded reports no paint at all, because it cannot tell which of the paints
 *  it finds anybody waited for. */
export function getVitals(): WebVitals {
  return { ttfbMs: acceptedTtfbMs(), lcpMs: getLcpMs(), cls: clsScore, inpMs };
}

/** Monotonic-ish clock in ms; falls back to Date.now() when performance.now
 *  is unavailable (SSR / old runtimes). */
function nowMs(): number {
  try {
    if (
      typeof performance !== "undefined" &&
      typeof performance.now === "function"
    ) {
      return performance.now();
    }
  } catch {
    // fall through
  }
  return Date.now();
}

export interface LongTaskStats {
  /** Whether a `longtask` PerformanceObserver actually attached. */
  supported: boolean;
  /** Session-cumulative count of main-thread long tasks (≥50ms). */
  longTaskCount: number;
  /** Sum of the full durations of all observed long tasks (ms). */
  totalBlockedMs: number;
  /** Long tasks per minute since observation began (0 until ≥1s elapsed). */
  longTasksPerMin: number;
  /** Worst single long-task duration (ms) seen this session. */
  worstBlockMs: number;
  /** Wall-clock observation window since the long-task observer was started. */
  observedWindowMs: number;
}

/** Current long-task picture. Safe to call anywhere. `supported` deliberately
 *  distinguishes an unsupported browser from a supported, honestly quiet page. */
export function getLongTaskStats(): LongTaskStats {
  let observedWindowMs = 0;
  let perMin = 0;
  if (longTaskWindowStart > 0) {
    observedWindowMs = Math.max(0, nowMs() - longTaskWindowStart);
    if (observedWindowMs >= 1000) {
      perMin =
        Math.round((longTaskCount / (observedWindowMs / 60_000)) * 10) / 10;
    }
  }
  return {
    supported: longTaskSupported,
    longTaskCount,
    totalBlockedMs: Math.round(totalLongTaskMs),
    longTasksPerMin: perMin,
    worstBlockMs,
    observedWindowMs,
  };
}

// INP (Interaction to Next Paint) — the Core Web Vital estimate, distinct from
// the single-worst-interaction proxy above (which feeds the frustration axis).
// Mirrors the standard web-vitals estimator: keep the N longest interactions
// (deduped by `interactionId` — the browser groups all events of one physical
// interaction under one id), estimate the total interaction count from the id
// range (ids advance by 7 per interaction, per spec), and report the
// (count/50)th-from-worst duration so one outlier in a long session is not the
// headline. Entries without an interactionId (unsupported browsers) are
// ignored, so the axis honestly stays absent there — never faked.
// Session-cumulative (like the long-task counters), reset only in tests.
const INP_LONGEST_MAX = 10;
/** Ids advance by 7 per user interaction (spec constant, same as web-vitals). */
const INP_ID_STRIDE = 7;
let inpLongest: Array<{ id: number; duration: number }> = [];
let inpMinId = Infinity;
let inpMaxId = 0;

/** Feed one `event` performance entry into the INP estimator. Only entries
 *  carrying a positive interactionId participate. Guarded by the caller. */
function recordInteractionForInp(id: unknown, duration: number): void {
  if (typeof id !== "number" || !Number.isFinite(id) || id <= 0) return;
  if (!Number.isFinite(duration) || duration <= 0) return;
  if (id < inpMinId) inpMinId = id;
  if (id > inpMaxId) inpMaxId = id;
  const existing = inpLongest.find((e) => e.id === id);
  if (existing) {
    if (duration > existing.duration) existing.duration = duration;
  } else {
    inpLongest.push({ id, duration });
  }
  inpLongest.sort((a, b) => b.duration - a.duration);
  if (inpLongest.length > INP_LONGEST_MAX) inpLongest.length = INP_LONGEST_MAX;
}

/** Stamped interaction latencies for the settle rule (src/settle.ts): one per
 *  interactionId (its longest event), stamped on the epoch clock. The first
 *  interaction of a document meets that document's hydration and is marked
 *  cold, so it never counts toward a tail. Capped; reset only in tests. */
const INTERACTION_SAMPLES_MAX = 256;
let interactionSamples: Array<{ id: number; t: number; v: number; cold?: boolean }> = [];
let interactionSamplesOverride: Array<{ t: number; v: number; cold?: boolean }> | null = null;
let sawFirstInteraction = false;

function recordInteractionSample(id: unknown, startTime: number, duration: number): void {
  if (typeof id !== "number" || !Number.isFinite(id) || id <= 0) return;
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(startTime)) return;
  for (let i = interactionSamples.length - 1; i >= 0 && i >= interactionSamples.length - 16; i--) {
    const s = interactionSamples[i];
    if (s.id === id) {
      if (duration > s.v) s.v = duration;
      return;
    }
  }
  const cold = !sawFirstInteraction;
  sawFirstInteraction = true;
  interactionSamples.push(
    cold ? { id, t: epochOf(startTime), v: duration, cold } : { id, t: epochOf(startTime), v: duration },
  );
  if (interactionSamples.length > INTERACTION_SAMPLES_MAX) {
    interactionSamples.splice(0, interactionSamples.length - INTERACTION_SAMPLES_MAX);
  }
}

/** This document's stamped interaction latencies (see above). */
export function getInteractionSamples(): ReadonlyArray<{ t: number; v: number; cold?: boolean }> {
  return interactionSamplesOverride ?? interactionSamples;
}

/** Test-only: seed (or clear with null) the stamped interaction latencies. */
export function _setInteractionSamplesForTests(
  s: Array<{ t: number; v: number; cold?: boolean }> | null,
): void {
  interactionSamplesOverride = s;
}

/** Stamped layout shifts (epoch ms, value, how many nodes moved) for the
 *  settle rule: session windows and source attribution are taken from
 *  settled shifts only. Capped; reset only in tests. */
const SHIFT_SAMPLES_MAX = 256;
let shiftSamples: Array<{ t: number; v: number; nodes: number }> = [];
let shiftSamplesOverride: Array<{ t: number; v: number; nodes: number }> | null = null;

function recordShiftSample(startTime: number, value: number, nodes: number): void {
  if (!Number.isFinite(startTime) || !Number.isFinite(value) || value <= 0) return;
  shiftSamples.push({ t: epochOf(startTime), v: value, nodes: Math.max(0, Math.round(nodes)) });
  if (shiftSamples.length > SHIFT_SAMPLES_MAX) {
    shiftSamples.splice(0, shiftSamples.length - SHIFT_SAMPLES_MAX);
  }
}

/** This document's stamped layout shifts (see above). */
export function getShiftSamples(): ReadonlyArray<{ t: number; v: number; nodes: number }> {
  return shiftSamplesOverride ?? shiftSamples;
}

/** Test-only: seed (or clear with null) the stamped layout shifts. */
export function _setShiftSamplesForTests(
  s: Array<{ t: number; v: number; nodes: number }> | null,
): void {
  shiftSamplesOverride = s;
}

export interface InpStats {
  /** Current INP estimate (ms), or null before any interaction was measured. */
  inpMs: number | null;
  /** Estimated distinct interactions this session (from the id range). */
  interactionCount: number;
}

let inpOverride: InpStats | null = null;

/** Current INP picture. Safe to call anywhere (nulls/zeros when unmeasured or
 *  when the Event Timing interactionId field is unsupported). */
export function getInpStats(): InpStats {
  if (inpOverride) return inpOverride;
  if (inpLongest.length === 0 || inpMaxId === 0) {
    return { inpMs: null, interactionCount: 0 };
  }
  const interactionCount =
    Math.floor((inpMaxId - inpMinId) / INP_ID_STRIDE) + 1;
  const idx = Math.min(Math.floor(interactionCount / 50), inpLongest.length - 1);
  return { inpMs: Math.round(inpLongest[idx].duration), interactionCount };
}

/** Test-only: seed (or clear with null) the INP reading so the axis can be
 *  exercised deterministically without live event-timing entries. */
export function _setInpStatsForTests(s: InpStats | null): void {
  inpOverride = s;
}

let fcpOverride: number | null = null;

/** First-contentful-paint (ms) observed this page view, or null until the
 *  browser reports the `first-contentful-paint` entry (so the paintReadiness
 *  axis is OMITTED rather than faked while warming). Safe to call anywhere. */
export function getFcpMs(): number | null {
  if (fcpOverride != null) return fcpOverride;
  return fcpMs;
}

/** Test-only: seed (or clear with null) the FCP reading so the paintReadiness
 *  axis can be exercised without a live `paint` observer. */
export function _setFcpForTests(ms: number | null): void {
  fcpOverride = ms;
}

let lcpOverride: number | null = null;

/** This document's Largest Contentful Paint (ms) — the newest
 *  `largest-contentful-paint` entry the visitor waited for (pageLoadTiming.ts)
 *  — or null until one arrives, so the largestPaint axis is OMITTED rather than
 *  faked while warming, and stays omitted in a browser that never reports the
 *  entry. Null too in a document the kit joined long after it had loaded: none
 *  of the paints it finds there can be said to be the load.
 *  Document-scoped: a later SPA view never clears it. Safe to call anywhere. */
export function getLcpMs(): number | null {
  if (lcpOverride != null) return lcpOverride;
  return joinedLate() ? null : acceptedLcpMs();
}

/** Test-only: seed (or clear with null) the LCP reading so the largestPaint
 *  axis can be exercised without a live `largest-contentful-paint` observer. */
export function _setLcpForTests(ms: number | null): void {
  lcpOverride = ms;
}

export interface LoafStats {
  /** Whether the browser exposes the Long Animation Frame API (LoAF). When
   *  false the animationSmoothness axis is OMITTED, never faked to 0. */
  supported: boolean;
  /** Session-cumulative count of long animation frames observed. */
  count: number;
  /** Long animation frames per minute since observation began (0 until ≥1s). */
  loafPerMin: number;
  /** Worst single long-animation-frame duration (ms) seen this session. */
  worstMs: number;
  /** Wall time (ms) observed since the LoAF window began. */
  elapsedMs: number;
}

/** Current long-animation-frame picture. Safe to call anywhere (reports
 *  unsupported when the LoAF API is absent). */
export function getLoafStats(): LoafStats {
  let perMin = 0;
  let elapsedMs = 0;
  if (loafWindowStart > 0) {
    elapsedMs = nowMs() - loafWindowStart;
    if (elapsedMs >= 1000) {
      perMin = Math.round((loafCount / (elapsedMs / 60_000)) * 10) / 10;
    }
  }
  return {
    supported: loafSupported,
    count: loafCount,
    loafPerMin: perMin,
    worstMs: worstLoafMs,
    elapsedMs,
  };
}

/** Stamped async-path blocks (epoch ms, ms the script ran), oldest first. */
export function getAsyncBlockSamples(): ReadonlyArray<{ t: number; v: number }> {
  return asyncBlockRing.all();
}

/** Test-only: seed the stamped async-path blocks (epoch ms). */
export function _setAsyncBlockSamplesForTests(
  samples: ReadonlyArray<{ t: number; v: number }>,
): void {
  asyncBlockRing.clear();
  for (const x of samples) asyncBlockRing.push(x.t, x.v);
}

/** Test-only: seed the LoAF counters so the animationSmoothness axis can be
 *  exercised deterministically without a live `long-animation-frame` observer.
 *  `windowStartMsAgo` <= 0 marks the window unopened (elapsed 0). */
export function _setLoafStatsForTests(s: {
  supported: boolean;
  count: number;
  worstMs: number;
  windowStartMsAgo: number;
}): void {
  loafSupported = s.supported;
  loafCount = s.count;
  worstLoafMs = s.worstMs;
  loafWindowStart = s.windowStartMsAgo > 0 ? nowMs() - s.windowStartMsAgo : 0;
}

export interface DeadClickStats {
  /** Clicks on actionable-looking targets that produced a visible effect. */
  actionableClickCount: number;
  /** Actionable clicks that produced no navigation, DOM change, or scroll. */
  deadClickCount: number;
  /** Dead clicks as a fraction of all actionable clicks (0 when none seen). */
  deadClickRate: number;
}

/** Current dead-click picture. Safe to call anywhere (zeros when unmeasured or
 *  when MutationObserver is unsupported — the detector then never runs). */
export function getDeadClickStats(): DeadClickStats {
  const total = actionableClickCount + deadClickCount;
  const rate = total > 0 ? Math.round((deadClickCount / total) * 100) / 100 : 0;
  return { actionableClickCount, deadClickCount, deadClickRate: rate };
}

// ─── Memory + resource efficiency (browser-native, additive) ───────────
// Two more honest, display-only signals for the snapshot's meter axes. Both read
// ONLY the browser's own numeric performance data (heap sizes; resource byte
// counts + initiator type) — never a URL, value, or PII — and return null where
// the data is unavailable so the axis is OMITTED rather than faked.

export interface HeapStats {
  /** JS heap currently in use, rounded to MB. */
  usedMb: number;
  /** The tab's hard JS-heap limit, rounded to MB. */
  limitMb: number;
  /** used/limit as a 0-100 percentage (proximity to the OOM crash point). */
  pct: number;
}

let heapOverride: HeapStats | null = null;

/** Current JS-heap usage vs the tab's hard limit, from Chromium's non-standard
 *  `performance.memory`. Returns null on engines that don't expose it
 *  (Firefox/Safari) or outside a browser (SSR/tests) so the Memory axis is
 *  omitted rather than fabricated. Guarded; never throws. */
export function getHeapStats(): HeapStats | null {
  if (heapOverride) return heapOverride;
  try {
    if (typeof performance === "undefined") return null;
    const mem = (performance as unknown as {
      memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number };
    }).memory;
    if (!mem) return null;
    const used = mem.usedJSHeapSize;
    const limit = mem.jsHeapSizeLimit;
    if (
      typeof used !== "number" ||
      typeof limit !== "number" ||
      !Number.isFinite(used) ||
      !Number.isFinite(limit) ||
      limit <= 0
    ) {
      return null;
    }
    const MB = 1024 * 1024;
    return {
      usedMb: Math.round(used / MB),
      limitMb: Math.round(limit / MB),
      pct: Math.round((used / limit) * 100),
    };
  } catch {
    return null;
  }
}

/** Test-only: seed (or clear with null) the heap reading so the Memory axis can
 *  be exercised deterministically without a live `performance.memory`. */
export function _setHeapStatsForTests(s: HeapStats | null): void {
  heapOverride = s;
}

export interface ResourceEfficiency {
  /** Sizable text-ish subresources considered (>=1KB decoded). */
  eligible: number;
  /** Of those, how many were served cached or compressed. */
  efficient: number;
  /** efficient/eligible as a 0-100 percentage (HIGHER is better). */
  efficientPct: number;
}

/** Eligible-resource floor below which the axis stays pending (a near-empty page
 *  cannot honestly claim an efficiency score). */
const RESOURCE_EFF_MIN = 5;

let resourceEffOverride: ResourceEfficiency | null = null;

/** Share of sizable subresources delivered efficiently — served from cache
 *  (transferSize 0) OR a compressed body (encoded < 90% of decoded). Reads
 *  the browser's Resource Timing entries: only the numeric sizes + initiator
 *  type are inspected — the entry URL is NEVER read. Opaque cross-origin
 *  resources (no decoded size) are excluded. Returns null until at least
 *  RESOURCE_EFF_MIN eligible resources exist. Guarded; never throws. */
export function getResourceEfficiency(): ResourceEfficiency | null {
  if (resourceEffOverride) return resourceEffOverride;
  try {
    if (
      typeof performance === "undefined" ||
      typeof performance.getEntriesByType !== "function"
    ) {
      return null;
    }
    const entries = performance.getEntriesByType(
      "resource",
    ) as PerformanceResourceTiming[];
    let eligible = 0;
    let efficient = 0;
    for (const e of entries) {
      const it = e.initiatorType;
      if (
        it !== "script" &&
        it !== "css" &&
        it !== "link" &&
        it !== "fetch" &&
        it !== "xmlhttprequest"
      ) {
        continue;
      }
      const decoded = e.decodedBodySize;
      // Skip tiny or opaque (decoded 0) resources — nothing to judge.
      if (typeof decoded !== "number" || decoded < 1024) continue;
      const transfer = e.transferSize;
      if (typeof transfer !== "number") continue;
      // Compression is judged on the BODY (encodedBodySize), never on the
      // header-inclusive transfer size: a small, genuinely compressed body
      // plus its unavoidable headers can outweigh 90% of the decoded size.
      const encoded = e.encodedBodySize;
      eligible++;
      if (
        transfer === 0 ||
        (typeof encoded === "number" && encoded > 0 && encoded < decoded * 0.9)
      ) {
        efficient++;
      }
    }
    if (eligible < RESOURCE_EFF_MIN) return null;
    return {
      eligible,
      efficient,
      efficientPct: Math.round((efficient / eligible) * 100),
    };
  } catch {
    return null;
  }
}

/** Test-only: seed (or clear with null) the resource-efficiency reading so the
 *  axis can be exercised deterministically without live Resource Timing. */
export function _setResourceEfficiencyForTests(
  s: ResourceEfficiency | null,
): void {
  resourceEffOverride = s;
}

// ─── Additive web-meter batch collectors (9 new axes) ─────────────────────
// Every collector below is session-cumulative module state (like the long-task
// counters), populated from EXISTING observers where possible, torn down +
// zeroed in _resetVitalsForTests, and exposed through a guarded getter plus a
// `_set*ForTests` seed hook. PRIVACY: no URL, selector, coordinate, or reason
// string is ever stored — where an origin must be inspected (LoAF script
// attribution) it is classified immediately and the string discarded; only
// numeric counters/durations survive.

// LoAF cause attribution — accumulated inside the SAME
// `long-animation-frame` observer as the animationSmoothness counters.
// Blocking ms + per-bucket attributed ms (first-party script / third-party
// script / style+layout). The script's sourceURL/invoker is read ONLY to
// compare origin vs location.origin, then discarded.
let loafBlockingMs = 0;
let loafScriptFirstPartyMs = 0;
let loafScriptThirdPartyMs = 0;
let loafStyleLayoutMs = 0;

export interface LoafCauseStats {
  /** Whether the LoAF API is supported (mirrors getLoafStats().supported). */
  supported: boolean;
  /** Wall time (ms) observed since the LoAF window began. */
  elapsedMs: number;
  /** Session-cumulative LoAF blocking time (ms). */
  blockingMs: number;
  /** Attributed script ms from the page's OWN origin. */
  scriptFirstPartyMs: number;
  /** Attributed script ms from OTHER origins. */
  scriptThirdPartyMs: number;
  /** Attributed style + layout ms. */
  styleLayoutMs: number;
}

let loafCauseOverride: LoafCauseStats | null = null;

/** Current LoAF cause-attribution picture. Safe to call anywhere. */
export function getLoafCauseStats(): LoafCauseStats {
  if (loafCauseOverride) return loafCauseOverride;
  let elapsedMs = 0;
  if (loafWindowStart > 0) elapsedMs = nowMs() - loafWindowStart;
  return {
    supported: loafSupported,
    elapsedMs,
    blockingMs: Math.round(loafBlockingMs),
    scriptFirstPartyMs: Math.round(loafScriptFirstPartyMs),
    scriptThirdPartyMs: Math.round(loafScriptThirdPartyMs),
    styleLayoutMs: Math.round(loafStyleLayoutMs),
  };
}

/** Test-only: seed the LoAF cause-attribution counters (frameCause +
 *  thirdPartyCost axes) without a live `long-animation-frame` observer.
 *  `windowStartMsAgo` <= 0 marks the window unopened (elapsed 0). */
export function _setLoafCauseStatsForTests(s: {
  supported: boolean;
  blockingMs: number;
  scriptFirstPartyMs: number;
  scriptThirdPartyMs: number;
  styleLayoutMs: number;
  windowStartMsAgo: number;
}): void {
  loafSupported = s.supported;
  loafBlockingMs = s.blockingMs;
  loafScriptFirstPartyMs = s.scriptFirstPartyMs;
  loafScriptThirdPartyMs = s.scriptThirdPartyMs;
  loafStyleLayoutMs = s.styleLayoutMs;
  loafWindowStart = s.windowStartMsAgo > 0 ? nowMs() - s.windowStartMsAgo : 0;
  loafCauseOverride = null;
}

/** Compare a script's origin to the page's own origin. Reads the string ONLY
 *  to classify; nothing is stored. Returns true for third-party. Guarded. */
function isThirdPartyOrigin(url: unknown): boolean {
  try {
    if (typeof url !== "string" || url.length === 0) return false;
    if (typeof location === "undefined") return false;
    const own = location.origin;
    // Same-origin fast path (most first-party scripts): url starts with own.
    if (url.startsWith(own)) return false;
    // Relative URLs (no scheme) are always first-party.
    if (/^[a-z]+:\/\//i.test(url) === false) return false;
    const u = new URL(url, own);
    return u.origin !== own;
  } catch {
    // Un-parseable → treat as first-party (never over-blame third parties).
    return false;
  }
}

// Blocking time — the Total Blocking Time field cousin. Accumulated inside the
// SAME `longtask` observer as the stability counters: overage max(0,dur-50).
// `longTaskSupported` records whether the longtask observer attached (like
// loafSupported) so the blockingTime axis stays absent on unsupported engines.
let totalBlockingMs = 0;
let longTaskSupported = false;

export interface BlockingTimeStats {
  /** Whether the Long Tasks API attached (false => blockingTime axis absent). */
  supported: boolean;
  /** Wall time (ms) observed since the long-task window began. */
  elapsedMs: number;
  /** Session-cumulative blocking overage (sum of max(0,dur-50)) in ms. */
  totalBlockingMs: number;
  /** Blocking overage per minute since observation began (0 until ≥1s). */
  blockingMsPerMin: number;
  /** Session-cumulative long-task count (mirrors getLongTaskStats). */
  longTaskCount: number;
}

let blockingTimeOverride: BlockingTimeStats | null = null;

/** Current blocking-time picture. Safe to call anywhere. */
export function getBlockingTimeStats(): BlockingTimeStats {
  if (blockingTimeOverride) return blockingTimeOverride;
  let elapsedMs = 0;
  let perMin = 0;
  if (longTaskWindowStart > 0) {
    elapsedMs = nowMs() - longTaskWindowStart;
    if (elapsedMs >= 1000) {
      perMin = Math.round((totalBlockingMs / (elapsedMs / 60_000)) * 10) / 10;
    }
  }
  return {
    supported: longTaskSupported,
    elapsedMs,
    totalBlockingMs: Math.round(totalBlockingMs),
    blockingMsPerMin: perMin,
    longTaskCount,
  };
}

/** Test-only: seed the blocking-time counters without a live `longtask`
 *  observer. `windowStartMsAgo` <= 0 marks the window unopened (elapsed 0). */
export function _setBlockingTimeStatsForTests(s: {
  supported: boolean;
  totalBlockingMs: number;
  longTaskCount: number;
  windowStartMsAgo: number;
}): void {
  longTaskSupported = s.supported;
  totalBlockingMs = s.totalBlockingMs;
  longTaskCount = s.longTaskCount;
  longTaskWindowStart = s.windowStartMsAgo > 0 ? nowMs() - s.windowStartMsAgo : 0;
  blockingTimeOverride = null;
}

// bfcache — back/forward cache eligibility. Populated by a `pageshow` listener
// (persisted => a restore) plus inspection of the navigation entry
// (type back_forward + coarse notRestoredReasons bucketing). Reason strings
// are NEVER stored — only counters are bumped.
let bfNavCount = 0;
let bfRestoredCount = 0;
let bfBlockedCount = 0;
let bfBlockerUnload = 0;
let bfBlockerCacheControl = 0;
let bfBlockerOther = 0;

let bfBlockerInFlight = 0;
let bfInitialCounted = false;
/** Blocked bf navs with at least one reason the APP can act on (an unload
 *  handler, a request in flight, a held connection). A no-store opt-out is a
 *  design choice and a browser-side eviction is not the app's defect. */
let bfActionableBlockedCount = 0;
let pageShowHandler: ((e: Event) => void) | null = null;

export interface BfCacheStats {
  bfNavCount: number;
  restoredCount: number;
  blockedCount: number;
  blockerUnload: number;
  blockerCacheControl: number;
  /**
   * WORK THE PAGE STILL HAD IN FLIGHT. A request that had not finished when
   * the page was navigated away from — the commonest blocker on a page with
   * a live-updating section, and the one our own site hits. It was landing
   * in "other" before, which told a developer their page was excluded from
   * the back/forward cache and nothing whatever about why.
   */
  blockerInFlight: number;
  /**
   * A CONNECTION THE PAGE WAS HOLDING OPEN. A socket, an event stream, a
   * channel between tabs: the browser will not freeze a page still attached
   * to one. Distinct from the above because the fix is different — a
   * request finishes on its own, a held-open connection has to be closed.
   */
  blockerHeldConnection: number;
  /**
   * THE BROWSER'S OWN DECISION, not the page's doing. Low memory, a browser
   * setting, an extension, a cache too full. Nothing in the page's code can
   * change it, and telling a developer to go and fix it wastes their time.
   */
  blockerBrowser: number;
  /** The browser named a reason and our list has no word for it yet. */
  blockerOther: number;
  /**
   * THE BROWSER GAVE NO REASON AT ALL — masked for privacy (cross-origin
   * frames), or an engine that reports no reasons. Not the same answer as
   * "we do not recognise the reason", and the difference decides whether a
   * developer can go and look it up.
   */
  blockerUnnamed: number;
  /** Internal (never sent): blocked navs with an app-actionable reason. */
  actionableBlockedCount?: number;
}

let bfCacheOverride: BfCacheStats | null = null;

/** Current bfcache picture. Safe to call anywhere. */
export function getBfCacheStats(): BfCacheStats {
  if (bfCacheOverride) return bfCacheOverride;
  return {
    bfNavCount,
    restoredCount: bfRestoredCount,
    blockedCount: bfBlockedCount,
    actionableBlockedCount: bfActionableBlockedCount,
    blockerUnload: bfBlockerUnload,
    blockerCacheControl: bfBlockerCacheControl,
    blockerInFlight: bfBlockerInFlight,
    blockerHeldConnection: bfBlockerHeldConnection,
    blockerBrowser: bfBlockerBrowser,
    blockerOther: bfBlockerOther,
    blockerUnnamed: bfBlockerUnnamed,
  };
}

/**
 * Coarsely bucket ONE notRestoredReason string, bumping the right counter.
 * The string is inspected then discarded — never stored.
 *
 * WHY THE LIST GREW. Two buckets and a catch-all meant a page whose real
 * blocker was neither an unload handler nor a no-store header could only be
 * told "other" — which says the page is excluded from the back/forward cache
 * and nothing at all about why, so there is nothing to act on. Our own site
 * hit exactly that: one blocked navigation, one "other".
 *
 * The strings matched here are the BROWSER's closed vocabulary (the
 * `notRestoredReasons` reason codes), not anything the page or its visitors
 * wrote, so recognising them by name carries nothing of the customer's. The
 * counters are still counts — no reason string is ever kept or uploaded.
 */
function bucketBfBlockerReason(reason: unknown): void {
  try {
    if (typeof reason !== "string" || reason.length === 0) {
      // The browser named NO reason — masked, or an engine that reports
      // none. Distinct from a reason we failed to recognise.
      bfBlockerUnnamed++;
      return;
    }
    const r = reason.toLowerCase();
    if (r.includes("unload")) {
      bfBlockerUnload++;
    } else if (r.includes("cache-control") || r.includes("no-store")) {
      bfBlockerCacheControl++;
    } else if (
      // Work still in flight at navigation: fetch/XHR that had not finished,
      // a response body still draining, a keepalive request in the air.
      r.includes("networkrequest") ||
      r.includes("network_request") ||
      r.includes("fetch") ||
      r.includes("xhr") ||
      r.includes("datapipe") ||
      r.includes("requestedbytestream") ||
      r.includes("loading") ||
      r.includes("subframeisnavigating") ||
      r.includes("navigating")
    ) {
      bfBlockerInFlight++;
    } else if (
      // A connection the page was holding open.
      r.includes("websocket") ||
      r.includes("webtransport") ||
      r.includes("webrtc") ||
      r.includes("rtc") ||
      r.includes("broadcastchannel") ||
      r.includes("eventsource") ||
      r.includes("sse") ||
      r.includes("indexeddb") ||
      r.includes("websql") ||
      r.includes("sharedworker") ||
      r.includes("keepalive")
    ) {
      bfBlockerHeldConnection++;
    } else if (
      // The browser's own decision, which no page code can change.
      r.includes("memory") ||
      r.includes("cachelimit") ||
      r.includes("cache_limit") ||
      r.includes("extension") ||
      r.includes("browsing_instance") ||
      r.includes("browsinginstance") ||
      r.includes("disabled") ||
      r.includes("notmostrecent") ||
      r.includes("timeout") ||
      r.includes("unknown") ||
      r.includes("internalerror") ||
      r.includes("rendererprocess")
    ) {
      bfBlockerBrowser++;
    } else {
      bfBlockerOther++;
    }
  } catch {
    bfBlockerOther++;
  }
}

/** Walk the (possibly nested) notRestoredReasons tree, bucketing every named
 *  reason. Never stores a reason string. Guarded. */
function collectBfBlockerReasons(node: unknown): void {
  try {
    if (!node || typeof node !== "object") return;
    const n = node as {
      reasons?: Array<{ reason?: string } | string> | null;
      children?: unknown[] | null;
    };
    if (Array.isArray(n.reasons)) {
      for (const item of n.reasons) {
        if (typeof item === "string") bucketBfBlockerReason(item);
        else if (item && typeof item === "object")
          bucketBfBlockerReason((item as { reason?: string }).reason);
      }
    }
    if (Array.isArray(n.children)) {
      for (const child of n.children) collectBfBlockerReasons(child);
    }
  } catch {
    // reason inspection must never break the page
  }
}

/** Inspect the initial navigation entry once: a `back_forward` navigation is
 *  one bf nav; if it was NOT restored (no persisted pageshow yet) bucket its
 *  blocker reasons. Guarded. */
function countInitialBfNav(): void {
  if (bfInitialCounted) return;
  bfInitialCounted = true;
  try {
    if (
      typeof performance === "undefined" ||
      typeof performance.getEntriesByType !== "function"
    ) {
      return;
    }
    const nav = performance.getEntriesByType("navigation")[0] as
      | (PerformanceNavigationTiming & {
          notRestoredReasons?: unknown;
        })
      | undefined;
    if (!nav || nav.type !== "back_forward") return;
    bfNavCount++;
    bfBlockedCount++;
    const reasons = nav.notRestoredReasons;
    const before = bfBlockerUnload + bfBlockerInFlight + bfBlockerHeldConnection;
    if (reasons) collectBfBlockerReasons(reasons);
    if (bfBlockerUnload + bfBlockerInFlight + bfBlockerHeldConnection > before) {
      bfActionableBlockedCount++;
    }
  } catch {
    // navigation inspection must never break the page
  }
}

/** `pageshow` handler: a persisted event is a bfcache restore (one bf nav,
 *  restored). Guarded. */
function onPageShow(e: Event): void {
  try {
    const persisted = (e as PageTransitionEvent).persisted === true;
    if (!persisted) return;
    bfNavCount++;
    bfRestoredCount++;
    // A restore is not a load: no paint after it is part of the page's load.
    notePageRestored(e.timeStamp);
  } catch {
    // pageshow inspection must never break the page
  }
}

/** Test-only: seed the bfcache counters without live pageshow/navigation. */
export function _setBfCacheStatsForTests(s: BfCacheStats | null): void {
  bfCacheOverride = s;
}

// Input readiness — count discrete inputs (pointerdown+keydown) and how many
// landed BEFORE first-contentful-paint. Timestamps are buffered (ring-capped)
// ONLY until FCP is known, then collapsed to counts and dropped.
const INPUT_TS_CAP = 100;
let inputCount = 0;
let earlyInputCount = 0;
let inputTsBuffer: number[] = [];
let inputReadinessHandler: ((e: Event) => void) | null = null;

export interface InputReadinessStats {
  /** Whether FCP has been observed (gate for the inputReadiness axis). */
  fcpKnown: boolean;
  /** Discrete inputs (pointerdown + keydown) counted this session. */
  inputCount: number;
  /** Of those, how many landed before first-contentful-paint. */
  earlyInputCount: number;
}

let inputReadinessOverride: InputReadinessStats | null = null;

/** Collapse the buffered pre-FCP input timestamps to a count once FCP is known,
 *  then drop the buffer. Idempotent + guarded. */
function collapseInputBufferIfReady(): void {
  try {
    const fcp = getFcpMs();
    if (fcp == null) return;
    if (inputTsBuffer.length === 0) return;
    for (const t of inputTsBuffer) {
      if (t < fcp) earlyInputCount++;
    }
    inputTsBuffer = [];
  } catch {
    inputTsBuffer = [];
  }
}

/** A tap counts against readiness only when it WAITED for the main thread —
 *  delivered, then handled this late after the press. A press before first
 *  paint that the page handled promptly was not dropped and is not counted. */
export const TAP_WAIT_MS = 100;
/** Press times (page clock) of discrete taps that waited ≥ TAP_WAIT_MS. */
let waitingTapStarts: number[] = [];

function noteTapWait(name: unknown, startTime: unknown, processingStart: unknown): void {
  try {
    if (name !== "pointerdown" && name !== "keydown") return;
    if (typeof startTime !== "number" || typeof processingStart !== "number") return;
    if (!Number.isFinite(startTime) || !Number.isFinite(processingStart)) return;
    if (processingStart - startTime < TAP_WAIT_MS) return;
    if (waitingTapStarts.includes(startTime)) return;
    waitingTapStarts.push(startTime);
    if (waitingTapStarts.length > INPUT_TS_CAP) {
      waitingTapStarts.splice(0, waitingTapStarts.length - INPUT_TS_CAP);
    }
  } catch {
    // input readiness must never break the page
  }
}

/** Current input-readiness picture. Safe to call anywhere. `earlyInputCount`
 *  counts taps pressed before first paint that WAITED for the main thread
 *  (see TAP_WAIT_MS) — never a press merely because it came early. */
export function getInputReadinessStats(): InputReadinessStats {
  if (inputReadinessOverride) return inputReadinessOverride;
  collapseInputBufferIfReady();
  const fcp = getFcpMs();
  return {
    fcpKnown: fcp != null,
    inputCount,
    earlyInputCount:
      fcp == null ? 0 : waitingTapStarts.filter((t) => t < fcp).length,
  };
}

/** Feed one discrete input's timeStamp into the readiness counters. Guarded. */
function recordInputForReadiness(ts: unknown): void {
  try {
    inputCount++;
    if (typeof ts !== "number" || !Number.isFinite(ts)) return;
    const fcp = getFcpMs();
    if (fcp != null) {
      if (ts < fcp) earlyInputCount++;
      return;
    }
    // FCP not known yet — buffer (ring-capped) so we can classify once it is.
    inputTsBuffer.push(ts);
    if (inputTsBuffer.length > INPUT_TS_CAP) {
      inputTsBuffer.splice(0, inputTsBuffer.length - INPUT_TS_CAP);
    }
  } catch {
    // input readiness must never break the page
  }
}

/** Test-only: seed the input-readiness counters without live input events. */
export function _setInputReadinessStatsForTests(
  s: InputReadinessStats | null,
): void {
  inputReadinessOverride = s;
}

// Soft navigation — one responsiveness sample per view change the browser
// announces. Two ways in, because engines differ: an entry that carries its
// own duration has already been measured end to end (the interaction, through
// to the paint that made the new view contentful), and one that does not is
// paired with the NEXT LCP entry whose startTime exceeds it. Feature-detected
// (observeSupported-style); the axis stays absent until ≥1 completed
// measurement.
const SOFT_NAV_SAMPLE_CAP = 50;
let softNavSupported = false;
let softNavCount = 0;
let softNavPendingStart: number | null = null; // awaiting the next LCP
/** The route the pending soft navigation went to, from its entry's address. */
let softNavPendingLabel: string | null = null;
let softNavSamples: number[] = [];
/** The same samples stamped (epoch ms) for the settle rule, cold = the first
 *  view change to its route in the visit. */
const softNavRing = new SampleRing(SOFT_NAV_SAMPLE_CAP);
const softNavSeenRoutes = new Set<string>();
let softNavRingOverride: ReadonlyArray<{ t: number; v: number; cold?: boolean }> | null = null;

/** Stamped soft-navigation samples, oldest first. */
export function getSoftNavSampleStamps(): ReadonlyArray<{ t: number; v: number; cold?: boolean }> {
  return softNavRingOverride ?? softNavRing.all();
}

/** Test-only: seed the stamped soft-navigation samples. */
export function _setSoftNavSampleStampsForTests(
  s: ReadonlyArray<{ t: number; v: number; cold?: boolean }> | null,
): void {
  softNavRingOverride = s;
}
/** Samples EVER recorded, past the ring cap. The ring is what the axis
 *  reports from; this is what answers "has a new one arrived since this view
 *  opened?", which a capped length stops being able to answer the moment the
 *  cap is reached. */
let softNavSampleTotal = 0;
/** The interaction the most recent sample was measured from, on the page
 *  clock, so a view can refuse a measurement belonging to a view already
 *  closed. Null when nothing recorded it (a test override). */
let lastSoftNavSampleStart: number | null = null;

export interface SoftNavStats {
  /** Soft navigations observed this session. */
  navCount: number;
  /** Completed responsiveness samples (soft-nav → next LCP delta, ms). */
  samples: number[];
}

let softNavOverride: SoftNavStats | null = null;

/** Has this kit looked for per-view timing in this browser yet? Before the
 *  kit starts, "no soft navigations" says nothing about the browser. */
let softNavProbed = false;

/** WHAT THE BROWSER ANSWERED when it was asked, in the same three states the
 *  join is derived from: `false` only for a published entry-type list with
 *  the view-change type absent, `true` for a list that carries it AND an
 *  observer that attached, `null` for everything else — no published list at
 *  all, or an attach that threw.
 *
 *  Held once, here, because the answer has two readers: this module's export
 *  and the join in pressToScreen.ts. Derived separately they disagreed — a
 *  failed attach had the export saying "this browser cannot" while the join
 *  said "we do not know yet", which is the whole distinction this reading
 *  exists to keep (docs/press-to-screen-contract.md). */
let softNavAnswer: boolean | null = null;

/** Current soft-navigation picture. Safe to call anywhere. */
export function getSoftNavStats(): SoftNavStats {
  if (softNavOverride) return softNavOverride;
  return { navCount: softNavCount, samples: softNavSamples.slice() };
}

/**
 * DOES THIS BROWSER MEASURE A VIEW OTHER THAN THE FIRST?
 *
 * The press→screen join needs a measurement for the view a press opened, and
 * in a single-page app only the browser can supply one: the document's own
 * paint metrics stop at the first interaction, by their own rule. A browser
 * that does not report view changes to an app can therefore never produce
 * this reading, however long it runs — and saying so is the difference
 * between an answer and a "pending" that never resolves.
 *
 * `false` here is a LOOK THAT FOUND NOTHING: the browser was asked for the
 * entry type and did not list it. `null` means the kit has not looked yet,
 * which is never evidence of anything (permanent silence needs positive
 * evidence — docs/press-to-screen-contract.md).
 */
export function pressViewTimingSupported(): boolean | null {
  return softNavProbed ? softNavAnswer : null;
}

/** How many measurements the browser has produced, and where the last one
 *  started.
 *
 *  Separate from `getSoftNavStats` because attribution needs the UNCAPPED
 *  count: the ring holds the last fifty, and its length stops growing long
 *  before a busy tab stops navigating. */
function softNavSampleProgress(): { total: number; lastStart: number | null } {
  if (softNavOverride) {
    // Seeded by a test: the list IS the count, and no interaction time was
    // recorded, so there is nothing for attribution to refuse.
    return { total: softNavOverride.samples.length, lastStart: null };
  }
  return { total: softNavSampleTotal, lastStart: lastSoftNavSampleStart };
}

/** Bank one completed measurement: ring-capped for reporting, counted in full
 *  for attribution, and stamped with the interaction it was measured from. */
function pushSoftNavSample(
  deltaMs: number,
  startTime: number | null,
  routeLabel: string | null = null,
): void {
  try {
    // Stamped for the settle rule: the first view change to each route in the
    // visit fetches that view's code and data for the first time (set-up).
    //
    // WHICH route is the one the navigation WENT TO, read off the entry's own
    // address. The browser can hand the entry over after a later navigation
    // has already moved the address on, and the address in hand would then
    // stamp the wrong route as first-visited. The address in hand is only the
    // fallback for an entry that named none.
    const label = routeLabel ?? currentRouteLabel() ?? "/";
    const cold = !softNavSeenRoutes.has(label) && firstOfRoute("soft:" + label);
    softNavSeenRoutes.add(label);
    const at =
      startTime != null && Number.isFinite(startTime)
        ? startTime
        : typeof performance !== "undefined" ? performance.now() : 0;
    softNavRing.push(epochOf(at), deltaMs, cold);
  } catch {
    // never break the observer
  }
  softNavSamples.push(deltaMs);
  if (softNavSamples.length > SOFT_NAV_SAMPLE_CAP) {
    softNavSamples.splice(0, softNavSamples.length - SOFT_NAV_SAMPLE_CAP);
  }
  softNavSampleTotal++;
  lastSoftNavSampleStart = startTime;
}

/** Record one soft-navigation start. The next qualifying LCP closes it into a
 *  sample. Guarded by the caller. */
function recordSoftNavStart(startTime: number, routeLabel: string | null = null): void {
  if (!Number.isFinite(startTime)) return;
  softNavCount++;
  softNavPendingStart = startTime;
  softNavPendingLabel = routeLabel;
}

/** The route a soft-navigation entry went to, from the entry's OWN address
 *  (`name` is the URL the navigation reached), or null when it names none
 *  that makes a route. Read here and nowhere else; the address is never kept. */
function softNavRouteOf(name: unknown): string | null {
  // The same resolver every other screen label comes from (screenLabel.ts).
  return screenLabelForUrl(name);
}

/** A view change the browser measured for itself: `startTime` is the
 *  interaction it began at and `durationMs` runs to the paint, so it is one
 *  sample with nothing to pair. Returns whether it was taken.
 *
 *  A duration of exactly zero is NOT a measurement. `duration` is a field
 *  every performance entry carries and it sits at 0 when the engine does not
 *  fill it in, while no press reaches a painted view in 0.0ms — so zero falls
 *  through to the pairing path rather than publishing an instant nobody
 *  experienced. */
function recordSoftNavMeasured(
  startTime: number,
  durationMs: number,
  routeLabel: string | null = null,
): boolean {
  if (!Number.isFinite(startTime) || !Number.isFinite(durationMs)) return false;
  if (durationMs <= 0) return false;
  softNavCount++;
  softNavPendingStart = null;
  softNavPendingLabel = null;
  pushSoftNavSample(Math.round(durationMs), startTime, routeLabel);
  return true;
}

/** An LCP entry arrived — if a soft-nav is pending and this LCP is later, the
 *  delta is one responsiveness sample. Guarded by the caller. */
function noteLcpForSoftNav(lcpStart: number): void {
  if (softNavPendingStart == null) return;
  if (!Number.isFinite(lcpStart)) return;
  if (lcpStart <= softNavPendingStart) return;
  const startedAt = softNavPendingStart;
  const delta = Math.round(lcpStart - startedAt);
  const route = softNavPendingLabel;
  softNavPendingStart = null;
  softNavPendingLabel = null;
  pushSoftNavSample(delta, startedAt, route);
}

/** Test-only: seed the soft-navigation samples without live observers. */
/** Test-only: the answer this browser gave when the kit asked it for per-view
 *  timing. `null` restores "never asked", which is what a kit that has not
 *  started yet is, and which is never evidence about the browser. */
export function _setPressViewTimingProbeForTests(
  supported: boolean | null,
): void {
  softNavProbed = supported !== null;
  softNavSupported = supported === true;
  softNavAnswer = supported;
  // The join derives the reading, so it has to hear the same answer the live
  // probe would have given it.
  notePressViewTimingSupport(supported);
}

/** Test-only: put ONE view-change entry through the real store, exactly as
 *  the observer would — the ring, the running total and the stamp of the
 *  interaction it was measured from. `_setSoftNavStatsForTests` replaces all
 *  three with a fixed answer, so it cannot exercise any of them. */
export function _recordSoftNavEntryForTests(
  startTime: number,
  durationMs: number,
  /** The entry's own address (its `name`), as the browser reports it. */
  url?: string,
): void {
  const route = url === undefined ? null : softNavRouteOf(url);
  if (!recordSoftNavMeasured(startTime, durationMs, route)) {
    recordSoftNavStart(startTime, route);
  }
}

export function _setSoftNavStatsForTests(s: SoftNavStats | null): void {
  softNavOverride = s;
}

// Memory trend — periodic (async, guarded) readings of
// performance.measureUserAgentSpecificMemory(), ONLY when the function exists
// AND self.crossOriginIsolated === true. Stores (tMs, usedMb) readings (capped)
// so the snapshot cadence can derive a first-vs-last MB/min slope.
const MEMORY_TREND_CAP = 30;
let memoryReadings: Array<{ tMs: number; usedMb: number }> = [];
let memorySampleInFlight = false;

export interface MemoryTrendStats {
  /** Whether the measurement API is available AND the context is COI. */
  supported: boolean;
  /** Readings collected so far. */
  sampleCount: number;
  /** Wall span (ms) between the first and last reading. */
  spanMs: number;
  /** Latest usedMb reading (0 when none). */
  usedMb: number;
  /** First-vs-last heap slope in MB/min (0 until ≥2 readings span time). */
  growthMbPerMin: number;
}

let memoryTrendOverride: MemoryTrendStats | null = null;

/** Whether measureUserAgentSpecificMemory is available in a COI context. */
function memoryTrendSupported(): boolean {
  try {
    if (typeof performance === "undefined") return false;
    const fn = (performance as unknown as {
      measureUserAgentSpecificMemory?: unknown;
    }).measureUserAgentSpecificMemory;
    if (typeof fn !== "function") return false;
    if (typeof self === "undefined") return false;
    return self.crossOriginIsolated === true;
  } catch {
    return false;
  }
}

let memoryReadingsOverride: ReadonlyArray<{ t: number; v: number }> | null = null;

/** The heap readings stamped (epoch ms, MB), oldest first, for the settle
 *  rule's sustained-growth test (src/settle.ts). */
export function getMemoryTrendReadings(): ReadonlyArray<{ t: number; v: number }> {
  if (memoryReadingsOverride) return memoryReadingsOverride;
  return memoryReadings.map((r) => ({ t: epochOf(r.tMs), v: r.usedMb }));
}

/** Test-only: seed the stamped heap readings (epoch ms, MB). */
export function _setMemoryTrendStampsForTests(
  r: ReadonlyArray<{ t: number; v: number }> | null,
): void {
  memoryReadingsOverride = r;
}

/** Current memory-trend picture. Safe to call anywhere. */
export function getMemoryTrendStats(): MemoryTrendStats {
  if (memoryTrendOverride) return memoryTrendOverride;
  const supported = memoryTrendSupported();
  const n = memoryReadings.length;
  if (n === 0) {
    return { supported, sampleCount: 0, spanMs: 0, usedMb: 0, growthMbPerMin: 0 };
  }
  const first = memoryReadings[0];
  const last = memoryReadings[n - 1];
  const spanMs = last.tMs - first.tMs;
  let growth = 0;
  if (spanMs > 0) {
    growth =
      Math.round(((last.usedMb - first.usedMb) / (spanMs / 60_000)) * 10) / 10;
  }
  return {
    supported,
    sampleCount: n,
    spanMs: Math.round(spanMs),
    usedMb: Math.round(last.usedMb),
    growthMbPerMin: growth,
  };
}

/** Take ONE async memory reading (fire-and-forget) from the snapshot cadence.
 *  No-op unless the API exists AND the context is cross-origin-isolated. Never
 *  throws; a rejected promise is swallowed. */
export function sampleMemoryTrendNow(): void {
  if (isRuntimeInert()) return;
  const epoch = entitlementGeneration();
  try {
    if (memorySampleInFlight) return;
    if (!memoryTrendSupported()) return;
    const fn = (performance as unknown as {
      measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
    }).measureUserAgentSpecificMemory;
    if (typeof fn !== "function") return;
    memorySampleInFlight = true;
    const t = nowMs();
    Promise.resolve(fn.call(performance))
      .then((result) => {
        try {
          if (isRuntimeInert() || epoch !== entitlementGeneration()) return;
          const bytes = result && typeof result.bytes === "number"
            ? result.bytes
            : NaN;
          if (Number.isFinite(bytes)) {
            memoryReadings.push({ tMs: t, usedMb: bytes / (1024 * 1024) });
            if (memoryReadings.length > MEMORY_TREND_CAP) {
              memoryReadings.splice(0, memoryReadings.length - MEMORY_TREND_CAP);
            }
          }
        } catch {
          // ignore malformed result
        }
      })
      .catch(() => {
        // measurement rejected — the axis simply stays warming
      })
      .finally(() => {
        memorySampleInFlight = false;
      });
  } catch {
    memorySampleInFlight = false;
  }
}

/** Test-only: seed the memory-trend readings without a live async sampler.
 *  Each entry is (tMsAgo, usedMb) so callers can control the span/slope. */
export function _setMemoryTrendReadingsForTests(
  readings: Array<{ tMsAgo: number; usedMb: number }> | null,
): void {
  if (readings == null) {
    memoryReadings = [];
    memoryTrendOverride = null;
    memoryReadingsOverride = null;
    return;
  }
  const now = nowMs();
  memoryReadings = readings
    .map((r) => ({ tMs: now - r.tMsAgo, usedMb: r.usedMb }))
    .sort((a, b) => a.tMs - b.tMs);
  memoryTrendOverride = null;
}

/** Test-only: force the memory-trend supported flag + latest stats directly. */
export function _setMemoryTrendStatsForTests(s: MemoryTrendStats | null): void {
  memoryTrendOverride = s;
}

// Resource bloat — counts + bytes by initiator-type bucket, from Resource
// Timing. Entry URLs are NEVER read; only transferSize (fallback
// encodedBodySize) + initiatorType are inspected. Buckets: script / css+link /
// image (img|image|input) / fetch+xhr / other.
const RESOURCE_BLOAT_MIN = 5;

export interface ResourceBloatStats {
  totalKb: number;
  scriptKb: number;
  cssKb: number;
  imageKb: number;
  fetchKb: number;
  otherKb: number;
  resourceCount: number;
}

let resourceBloatOverride: ResourceBloatStats | null = null;

/** Aggregate resource weight by initiator-type bucket. Returns null until at
 *  least RESOURCE_BLOAT_MIN sized resources exist. URLs are never read.
 *  Guarded; never throws. */
export function getResourceBloat(): ResourceBloatStats | null {
  if (resourceBloatOverride) return resourceBloatOverride;
  try {
    if (
      typeof performance === "undefined" ||
      typeof performance.getEntriesByType !== "function"
    ) {
      return null;
    }
    const entries = performance.getEntriesByType(
      "resource",
    ) as PerformanceResourceTiming[];
    // PAGE weight is what loading the page cost: resources that started
    // before the load event finished. Traffic the page makes afterwards
    // (polling, uploads, later views' data) is ongoing use, not weight.
    let loadEnd = Infinity;
    try {
      const nav = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      if (nav && Number.isFinite(nav.loadEventEnd) && nav.loadEventEnd > 0) {
        loadEnd = nav.loadEventEnd;
      }
    } catch {
      // no navigation entry: the page is still loading, everything so far counts
    }
    let scriptBytes = 0;
    let cssBytes = 0;
    let imageBytes = 0;
    let fetchBytes = 0;
    let otherBytes = 0;
    let resourceCount = 0;
    for (const e of entries) {
      if (Number.isFinite(e.startTime) && e.startTime > loadEnd) continue;
      let bytes = e.transferSize;
      if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) {
        bytes = e.encodedBodySize;
      }
      if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) {
        continue;
      }
      resourceCount++;
      const it = e.initiatorType;
      if (it === "script") scriptBytes += bytes;
      else if (it === "css" || it === "link") cssBytes += bytes;
      else if (it === "img" || it === "image" || it === "input")
        imageBytes += bytes;
      else if (it === "fetch" || it === "xmlhttprequest") fetchBytes += bytes;
      else otherBytes += bytes;
    }
    if (resourceCount < RESOURCE_BLOAT_MIN) return null;
    const kb = (b: number): number => Math.round(b / 1024);
    return {
      totalKb: kb(scriptBytes + cssBytes + imageBytes + fetchBytes + otherBytes),
      scriptKb: kb(scriptBytes),
      cssKb: kb(cssBytes),
      imageKb: kb(imageBytes),
      fetchKb: kb(fetchBytes),
      otherKb: kb(otherBytes),
      resourceCount,
    };
  } catch {
    return null;
  }
}

/** Test-only: seed (or clear with null) the resource-bloat aggregate. */
export function _setResourceBloatForTests(s: ResourceBloatStats | null): void {
  resourceBloatOverride = s;
}

// Rage clicks — a privacy-safe frustration signal: the same spot pressed
// several times in quick succession while the page was not answering.
//
// The numbers are the shared definition's, not this kit's own: the `rage-tap`
// entry of lib/problem-kinds.json, where the React Native kit's confirmed-burst
// values are the reference and each number carries its reason. A parity test
// (scripts/src/__tests__/rageBurstDefinition.test.ts) holds these copies to
// that file, so a change starts there.
//
// A burst is COUNTED only when its presses went unanswered: some press saw no
// change on the page — no DOM change, no address change, no scroll — before
// the slow-answer bar, or the browser's own event timing put a press of the
// burst at the bar or over. A burst whose every press got an answer in time is
// SET ASIDE and tallied on its own: a keypad answering each press is a person
// typing, not a person mashing a control that has stopped working. Background
// changes on a busy page can only make a press look answered, so the error
// this allows is a missed burst, never an invented one.
//
// Coordinates live only in the small ring below and never leave the detector;
// the snapshot carries counts.
export const RAGE_BURST_PRESSES = 3;
export const RAGE_BURST_SPOT_PX = 64;
export const RAGE_BURST_WINDOW_MS = 700;
export const RAGE_SLOW_ANSWER_MS = 300;
/** How long a press is watched for an answer: the dead-click reading's own
 *  settle window, so the two readings agree about what an answer is. */
export const PRESS_ANSWER_WINDOW_MS = 700;
/** The attribute a developer puts on an element whose presses answer in a way
 *  this kit cannot see — a keypad drawn on a canvas, feedback that is only a
 *  sound. A press on it, or on anything inside it, never joins a rage burst
 *  and never counts as a dead click. Read on the device as present or absent:
 *  its value is never read, and nothing about the element leaves the page. */
export const RAPID_PRESS_ATTRIBUTE = "data-boosthis-rapid-press";
const RAGE_RING_CAP = 6;
const RAGE_EVENT_TIMING_CAP = 32;

interface RagePress {
  /** The press's own moment (the event's stamp where it has one). */
  t: number;
  x: number;
  y: number;
  /** Milliseconds from the press to the first DOM change seen; null if none. */
  firstChangeMs: number | null;
  /** The address or the scroll position moved with no DOM change seen. The
   *  moment is unknown, so the page is given the benefit: answered. */
  moved: boolean;
  /** Its answer window has closed. */
  settled: boolean;
}

interface RageWatch {
  press: RagePress;
  mo: MutationObserver | null;
  timer: ReturnType<typeof setTimeout> | null;
}

let rageWindowStart = 0;
let rageBurstCount = 0;
let rageAnsweredBurstCount = 0;
let rageWorstDelayMs = 0;
let rageClickRing: RagePress[] = [];
let ragePendingBursts: RagePress[][] = [];
let rageWatches: Set<RageWatch> = new Set();
/** Recent browser event-timing entries: start and duration, nothing else. */
let rageEventTimings: Array<{ start: number; duration: number }> = [];
/** Stamped (epoch ms) moments of the bursts judged as rage — the page did
 *  not answer in time — oldest first, so the snapshot can count only the
 *  bursts that came after the page settled (the start-up rule). */
let rageBurstStamps: Array<{ t: number; v: number }> = [];
let rageBurstsOverride: ReadonlyArray<{ t: number; v: number }> | null = null;

/** Stamped (epoch ms) bursts the page did not answer in time, oldest first. */
export function getRageBurstStamps(): ReadonlyArray<{ t: number; v: number }> {
  if (rageBurstsOverride) return rageBurstsOverride;
  return rageBurstStamps;
}

/** Test-only: seed the stamped rage bursts (epoch ms). */
export function _setRageBurstStampsForTests(
  s: ReadonlyArray<{ t: number; v: number }> | null,
): void {
  rageBurstsOverride = s;
}

/** Stamped (epoch ms) moments of the bursts set aside because the page
 *  answered every press in time, oldest first: the reading counts them over
 *  the same settled window as the bursts that count. */
let rageAnsweredStamps: Array<{ t: number; v: number }> = [];

/** Stamped (epoch ms) bursts the page answered in time, oldest first. */
export function getRageAnsweredStamps(): ReadonlyArray<{ t: number; v: number }> {
  return rageAnsweredStamps;
}
let rageClickHandler: ((e: Event) => void) | null = null;

export interface RageClickStats {
  /** Wall time (ms) observed since the rage-click window began. */
  elapsedMs: number;
  /** Bursts the page did not answer, or answered only after the slow bar. */
  burstCount: number;
  /** Bursts whose every press got an answer in time — set aside, not rage. */
  answeredBurstCount: number;
  /** Counted bursts per minute since observation began (0 until ≥1s). */
  ragePerMin: number;
  /** Slowest wait at or over the slow-answer bar timed inside a counted
   *  burst: the browser's own event timing of a press, or the first change
   *  after it. 0 when every counted burst counted because a press got no
   *  answer at all. */
  worstDelayMs: number;
}

let rageClickOverride: RageClickStats | null = null;

/** Current rage-click picture. Safe to call anywhere. */
export function getRageClickStats(): RageClickStats {
  if (rageClickOverride) return rageClickOverride;
  let elapsedMs = 0;
  let perMin = 0;
  if (rageWindowStart > 0) {
    elapsedMs = nowMs() - rageWindowStart;
    if (elapsedMs >= 1000) {
      perMin = Math.round((rageBurstCount / (elapsedMs / 60_000)) * 100) / 100;
    }
  }
  return {
    elapsedMs,
    burstCount: rageBurstCount,
    answeredBurstCount: rageAnsweredBurstCount,
    ragePerMin: perMin,
    worstDelayMs: Math.round(rageWorstDelayMs),
  };
}

/** True when the press landed on, or inside, an element carrying the
 *  rapid-press marker. Shadow DOM is crossed through the event's own path. */
function isRapidPressArea(e: Event): boolean {
  try {
    const path =
      typeof (e as Event).composedPath === "function" ? e.composedPath() : null;
    if (path && path.length > 0) {
      for (const n of path) {
        const el = n as Element;
        if (
          el &&
          (el as unknown as Node).nodeType === 1 &&
          typeof el.hasAttribute === "function" &&
          el.hasAttribute(RAPID_PRESS_ATTRIBUTE)
        ) {
          return true;
        }
      }
      return false;
    }
    let node = e.target as Node | null;
    let hops = 0;
    while (node && hops < 64) {
      if (node.nodeType === 1) {
        const el = node as Element;
        if (
          typeof el.hasAttribute === "function" &&
          el.hasAttribute(RAPID_PRESS_ATTRIBUTE)
        ) {
          return true;
        }
      }
      node = node.parentNode;
      hops++;
    }
  } catch {
    // unreadable — treat the press as unmarked
  }
  return false;
}

/** A text field, where a second and third click select text by design. */
function isEditableText(target: EventTarget | null): boolean {
  try {
    const el = target as HTMLElement | null;
    if (!el || (el as unknown as Node).nodeType !== 1) return false;
    if (el.isContentEditable === true) return true;
    const tag = el.tagName ? el.tagName.toUpperCase() : "";
    if (tag === "TEXTAREA") return true;
    if (tag !== "INPUT") return false;
    const type = (el.getAttribute("type") || "text").toLowerCase();
    return [
      "text", "search", "email", "url", "tel", "password", "number",
    ].includes(type);
  } catch {
    return false;
  }
}

/** A double- or triple-click selecting text: a repeat click (the browser's
 *  own click count is 2 or more) inside a text field, or one that leaves
 *  text selected on something that is not a control. Only whether a
 *  selection exists is read — never what it holds. */
function isTextSelectionClick(e: Event): boolean {
  try {
    const detail = (e as MouseEvent).detail;
    if (typeof detail !== "number" || detail < 2) return false;
    if (isEditableText(e.target)) return true;
    if (findActionableControl(e.target)) return false;
    const getSel =
      typeof window !== "undefined" && typeof window.getSelection === "function"
        ? () => window.getSelection()
        : typeof document !== "undefined" &&
            typeof document.getSelection === "function"
          ? () => document.getSelection()
          : null;
    if (!getSel) return false;
    const sel = getSel();
    return !!sel && sel.rangeCount > 0 && sel.isCollapsed === false;
  } catch {
    return false;
  }
}

function readHref(): string {
  try {
    return typeof location !== "undefined" ? location.href : "";
  } catch {
    return "";
  }
}

function readScrollY(): number {
  try {
    return typeof window !== "undefined" && typeof window.scrollY === "number"
      ? window.scrollY
      : 0;
  } catch {
    return 0;
  }
}

/** Watch one press for an answer for PRESS_ANSWER_WINDOW_MS, on the same
 *  three kinds of evidence the dead-click reading uses. */
function watchPressAnswer(press: RagePress): void {
  const urlBefore = readHref();
  const scrollBefore = readScrollY();
  const watch: RageWatch = { press, mo: null, timer: null };
  try {
    watch.mo = kitObserver(() => new MutationObserver(() => {
      if (press.firstChangeMs === null) {
        press.firstChangeMs = Math.max(0, nowMs() - press.t);
      }
    }));
    const root =
      (typeof document !== "undefined" &&
        (document.documentElement || document.body)) ||
      (document as unknown as Node);
    watch.mo.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
  } catch {
    watch.mo = null;
  }
  const close = (): void => {
    if (!rageWatches.has(watch)) return;
    rageWatches.delete(watch);
    try {
      if (watch.mo) watch.mo.disconnect();
    } catch {
      // ignore
    }
    if (press.firstChangeMs === null) {
      press.moved =
        readHref() !== urlBefore ||
        Math.abs(readScrollY() - scrollBefore) > 4;
    }
    press.settled = true;
    settleRageBursts();
  };
  rageWatches.add(watch);
  try {
    watch.timer = kitTimeout(close, PRESS_ANSWER_WINDOW_MS);
  } catch {
    close();
  }
}

/** Feed one press into the burst detector. A burst is RAGE_BURST_PRESSES
 *  consecutive presses inside RAGE_BURST_WINDOW_MS that all fit one
 *  RAGE_BURST_SPOT_PX square. The ring is emptied after a burst, so one long
 *  mash is judged three presses at a time rather than re-counted per press. */
function recordPressForRage(press: RagePress): void {
  rageClickRing = rageClickRing.filter(
    (c) => press.t - c.t <= RAGE_BURST_WINDOW_MS,
  );
  rageClickRing.push(press);
  if (rageClickRing.length > RAGE_RING_CAP) {
    rageClickRing.splice(0, rageClickRing.length - RAGE_RING_CAP);
  }
  let minX = press.x;
  let maxX = press.x;
  let minY = press.y;
  let maxY = press.y;
  let run = 1;
  for (let i = rageClickRing.length - 2; i >= 0; i--) {
    const c = rageClickRing[i];
    const nMinX = Math.min(minX, c.x);
    const nMaxX = Math.max(maxX, c.x);
    const nMinY = Math.min(minY, c.y);
    const nMaxY = Math.max(maxY, c.y);
    if (nMaxX - nMinX > RAGE_BURST_SPOT_PX || nMaxY - nMinY > RAGE_BURST_SPOT_PX) {
      break;
    }
    minX = nMinX;
    maxX = nMaxX;
    minY = nMinY;
    maxY = nMaxY;
    run++;
  }
  if (run >= RAGE_BURST_PRESSES) {
    ragePendingBursts.push(rageClickRing.slice(rageClickRing.length - run));
    rageClickRing = [];
    settleRageBursts();
  }
}

/** Judge every burst whose presses have all finished their answer window. */
function settleRageBursts(): void {
  if (ragePendingBursts.length === 0) return;
  const waiting: RagePress[][] = [];
  for (const burst of ragePendingBursts) {
    if (burst.every((p) => p.settled)) judgeRageBurst(burst);
    else waiting.push(burst);
  }
  ragePendingBursts = waiting;
}

function judgeRageBurst(burst: RagePress[]): void {
  const first = burst[0].t;
  const last = burst[burst.length - 1].t;
  let browserMs = 0;
  for (const ev of rageEventTimings) {
    if (ev.start >= first - 1 && ev.start <= last + 1 && ev.duration > browserMs) {
      browserMs = ev.duration;
    }
  }
  let slowestAnswerMs = 0;
  let everyAnsweredInTime = true;
  for (const p of burst) {
    if (p.firstChangeMs !== null) {
      if (p.firstChangeMs > slowestAnswerMs) slowestAnswerMs = p.firstChangeMs;
      if (p.firstChangeMs >= RAGE_SLOW_ANSWER_MS) everyAnsweredInTime = false;
    } else if (!p.moved) {
      everyAnsweredInTime = false;
    }
  }
  if (everyAnsweredInTime && browserMs < RAGE_SLOW_ANSWER_MS) {
    rageAnsweredBurstCount++;
    rageAnsweredStamps.push({ t: epochOf(first), v: 1 });
    if (rageAnsweredStamps.length > 50) {
      rageAnsweredStamps.splice(0, rageAnsweredStamps.length - 50);
    }
    return;
  }
  rageBurstCount++;
  rageBurstStamps.push({ t: epochOf(first), v: 1 });
  if (rageBurstStamps.length > 50) rageBurstStamps.splice(0, rageBurstStamps.length - 50);
  // Only a wait at the slow bar or over is a reason a burst counted. A shorter
  // timing sat beside a press that got no answer at all, and printing it as
  // the slowest answer would describe an answer that never came.
  const worst = Math.max(browserMs, slowestAnswerMs);
  if (worst >= RAGE_SLOW_ANSWER_MS && worst > rageWorstDelayMs) {
    rageWorstDelayMs = Math.round(worst);
  }
}

/** Document-level click handler. Reads the press's coordinates and moment,
 *  whether it sits inside a marked element, and — for a repeat click only —
 *  whether text ended up selected. Never the target's text or a selector. */
function onRageClick(e: Event): void {
  try {
    if (isRapidPressArea(e)) return;
    if (isTextSelectionClick(e)) return;
    const me = e as MouseEvent;
    const stamp = pressEventTime(e);
    const t = Number.isFinite(stamp) ? stamp : nowMs();
    const x = typeof me.clientX === "number" ? me.clientX : 0;
    const y = typeof me.clientY === "number" ? me.clientY : 0;
    const press: RagePress = {
      t,
      x,
      y,
      firstChangeMs: null,
      moved: false,
      settled: false,
    };
    watchPressAnswer(press);
    recordPressForRage(press);
  } catch {
    // rage-click tracking must never break the page
  }
}

/** Called from the `event` observer: keep the entry's start and duration so a
 *  burst can be judged against the browser's own timing of its presses.
 *  Guarded by the caller. */
function noteEventForRage(duration: number, startTime: number): void {
  if (!Number.isFinite(duration) || duration <= 0) return;
  if (!Number.isFinite(startTime)) return;
  rageEventTimings.push({ start: startTime, duration });
  if (rageEventTimings.length > RAGE_EVENT_TIMING_CAP) {
    rageEventTimings.splice(0, rageEventTimings.length - RAGE_EVENT_TIMING_CAP);
  }
}

/** Close every open answer watch and forget unjudged presses (teardown). */
function resetRageDetector(): void {
  for (const w of rageWatches) {
    try {
      if (w.mo) w.mo.disconnect();
    } catch {
      // ignore
    }
    try {
      if (w.timer !== null) clearTimeout(w.timer);
    } catch {
      // ignore
    }
  }
  rageWatches = new Set();
  rageClickRing = [];
  ragePendingBursts = [];
  rageEventTimings = [];
}

/** Test-only: seed the rage-click counters without live clicks.
 *  `windowStartMsAgo` <= 0 marks the window unopened (elapsed 0). */
export function _setRageClickStatsForTests(s: {
  burstCount: number;
  worstDelayMs: number;
  windowStartMsAgo: number;
  answeredBurstCount?: number;
}): void {
  rageBurstCount = s.burstCount;
  rageAnsweredBurstCount = s.answeredBurstCount ?? 0;
  rageWorstDelayMs = s.worstDelayMs;
  rageWindowStart = s.windowStartMsAgo > 0 ? nowMs() - s.windowStartMsAgo : 0;
  rageClickOverride = null;
}

// ─── Route reachability ──────────────────────────────────────────────────
// The web analogue of the RN circuit map's "unreachable registered screen"
// note. The developer OPTIONALLY declares the site's known routes via
// registerWebRoutes(); the runtime then records which of them are actually
// reached this session (initial load + every SPA navigation) and can name the
// ones never visited. Router-agnostic + guest-safe: we record the first page,
// listen for popstate + hashchange, and wrap history.pushState/replaceState
// (originals preserved and always called first) so ANY client router is
// covered without a framework hook — mirroring the fail-safe posture of the
// dead-click detector above.
//
// PRIVACY: both the registry and the visited set hold ONLY normalized,
// non-identifying route labels (normalizeRouteLabel strips ids/uuids/hex and
// never reads the query string or hash).
//
// The VISITED set stays on-device — it is read only by getUnreachableRoutes /
// getRouteReachabilityStats (the detector + the dev bubble).
//
// The REGISTRY does travel, under the route-list switch: the declared routes
// merge with anything a handed-over router reports and ride the snapshot's
// `routeList` block, so the map can draw the site's whole skeleton rather
// than only the pages this session happened to open. That means route
// patterns traffic would never have revealed do leave the page, which is why
// it is switchable off and why it is written into the collection document.
// Every label is re-screened by the transmit guard on the way out.

/** Declare the site's known routes so the runtime can name routes that were
 *  registered but never reached this session, and so the map can draw them.
 *  Purely optional — without it (and without registerRouter) the map shows
 *  observed pages only, and getUnreachableRoutes() returns [] (a session
 *  simply not visiting a page is never a defect). Labels are normalized +
 *  de-duplicated. They travel with the snapshot's route list unless the route
 *  list is switched off. */
export function registerWebRoutes(routes: string[]): void {
  try {
    if (!Array.isArray(routes)) return;
    const cleaned: string[] = [];
    for (const raw of routes) {
      if (typeof raw !== "string") continue;
      const label = normalizeRouteLabel(raw.trim());
      if (label !== null) cleaned.push(label);
      else warnPartNameRefusal(raw.trim().length > MAX_PART_NAME ? "too-long" : "invalid");
    }
    registeredRoutes = cleaned.length > 0 ? Array.from(new Set(cleaned)) : null;
  } catch {
    // registration must never break the host page
  }
}

/** Record that a page path was reached this session, normalized to the same
 *  non-identifying label the registry uses so a visit can match a registered
 *  route. Safe to call anywhere; guarded. Exposed so apps with an exotic
 *  router can mark visits manually, but the built-in history/popstate hooks
 *  cover the common case automatically. */
export function recordVisit(pathname: string): void {
  if (isRuntimeInert()) return;
  try {
    if (typeof pathname !== "string") return;
    const label = normalizeRouteLabel(pathname);
    if (label === null) {
      warnPartNameRefusal(
        pathname.trim().length > MAX_PART_NAME ? "too-long" : "invalid",
      );
      return;
    }
    // Every navigation (including revisits) feeds the nav-loop tracker; the
    // distinct-set dedup below only applies to reachability.
    recordNavForCircuit(label);
    // Same observation, kept rather than discarded: the page map accumulates
    // the nodes and the EDGES between them across reloads. In-memory only
    // here — the write is coalesced onto the kit's existing page-lifecycle
    // flush, so navigation never pays for a storage round-trip.
    noteMapVisit(label);
    if (visitedRoutes.has(label)) return;
    // Keep memory flat on very long-lived sessions: once the cap is reached,
    // evict the oldest distinct label (Sets iterate in insertion order) before
    // adding the new one. The app's real registered routes are visited early,
    // so this only ever sheds stale slug labels.
    if (visitedRoutes.size >= MAX_VISITED_ROUTES) {
      const oldest = visitedRoutes.values().next().value;
      if (oldest !== undefined) visitedRoutes.delete(oldest);
    }
    visitedRoutes.add(label);
  } catch {
    // visit tracking must never break the host page
  }
}

/** The hand-declared registry, for the route list to merge with what a
 *  handed-over router reports. Empty when nothing was declared. */
export function getRegisteredWebRoutes(): string[] {
  return registeredRoutes ? [...registeredRoutes] : [];
}
/** Registered routes that were never reached this session. Returns [] when no
 *  routes were registered — parity with the RN circuit map's unreachable-screen
 *  note (informational, never a defect claim). */
export function getUnreachableRoutes(): string[] {
  if (!registeredRoutes || registeredRoutes.length === 0) return [];
  return registeredRoutes.filter((r) => !visitedRoutes.has(r));
}

export interface RouteReachabilityStats {
  /** Routes the developer declared via registerWebRoutes (0 when none). */
  registeredCount: number;
  /** Distinct normalized routes actually reached this session. */
  visitedCount: number;
  /** Registered routes never reached this session (0 when none registered). */
  unreachableCount: number;
}

/** Current route-reachability picture for the dev badge. CLOSED, all-numeric
 *  shape — never a route label — so the bubble can show a count without any
 *  label leaving the detector. */
export function getRouteReachabilityStats(): RouteReachabilityStats {
  return {
    registeredCount: registeredRoutes ? registeredRoutes.length : 0,
    visitedCount: visitedRoutes.size,
    unreachableCount: getUnreachableRoutes().length,
  };
}

/**
 * How many declared routes the ACCUMULATED page map has never recorded.
 *
 * Deliberately a DIFFERENT question from `getUnreachableRoutes()`: that one
 * answers for this session, while the map spans earlier visits kept on this
 * device, so a page opened last week is not "not yet reached" on the map. The
 * two windows must never be mixed in one sentence — the dev bubble shows this
 * one beside the map's own counts and the session one on its own row.
 *
 * Count only (never a label), and 0 when no routes were declared — the caller
 * shows the count only once `registeredCount > 0`, so "no routes declared" is
 * never rendered as a measured zero.
 */
export function getRoutesMissingFromPageMapCount(): number {
  try {
    if (!registeredRoutes || registeredRoutes.length === 0) return 0;
    return registeredRoutes.filter(
      (r) => !visitedRoutes.has(r) && !pageMapHas(r),
    ).length;
  } catch {
    return 0;
  }
}
export interface CircuitStats {
  /** Longest qualifying A⇄B alternating-navigation streak this session
   *  (0 until a streak reaches the loop threshold). */
  navLoopMaxBounces: number;
  /** True when a navigation loop was detected this session. */
  navLoopDetected: boolean;
  /** Most fetch/XHR request starts observed inside any 1-second window. */
  requestBurstMax1s: number;
  /** True when a fan-out burst (≥6 starts in 1s) was detected this session. */
  requestBurstDetected: boolean;
}

/** Current circuit-lens picture for the dev badge. CLOSED, all-numeric shape —
 *  never a route label or URL — so the bubble can show the finding without any
 *  identifying detail leaving the detector (parity with the count-only
 *  dead-click and reachability stats). */
export function getCircuitStats(): CircuitStats {
  return {
    navLoopMaxBounces: navLoopMaxBounces,
    navLoopDetected: navLoopMaxBounces >= NAV_LOOP_MIN_BOUNCES,
    requestBurstMax1s: requestBurstMax1s,
    requestBurstDetected: requestBurstMax1s >= FANOUT_MIN_STARTS,
  };
}

/** Record the current page path as reached. Guarded; a no-op outside a browser
 *  or when location is unavailable. */
function recordCurrentLocation(): void {
  if (isRuntimeInert()) return;
  // A handed-over router performs this app's navigations and reports each
  // completed one itself (handleRouterNavigation): the address hook stands
  // down, or every router navigation would be counted twice — and, under the
  // hash strategy, never at all.
  if (routerNamesScreens()) return;
  try {
    if (
      typeof location !== "undefined" &&
      typeof location.pathname === "string"
    ) {
      recordVisit(location.pathname);
      // Same hook again, a different question: how many times did this app
      // change the address at all? That count is what separates an app the
      // kit cannot see from an app with nothing to show (pageActivity.ts).
      //
      // A real address change also ENDS a page view, so the kit closes it
      // here and opens the next one. That is exactly what the guide has always
      // told host apps to do by hand with flushPageSample() on a client-side
      // route change; doing it here means a single-page app is measured
      // without the host having to wire anything, and the two paths run the
      // same code.
      settleAddressChange(location.pathname);
    }
  } catch {
    // ignore — reachability tracking must never break the host page
  }
  // Same hook, no new listener: a socket that reopens right after a view
  // change is a different fault from one that reopens because the network
  // dropped, and only the timing tells them apart.
  noteLiveConnectionNavigation();
}

/** The finalizer's reachability backstop: the page being closed was reached.
 *
 *  It used to call the whole address hook, which could decide a view boundary
 *  from INSIDE the finalizer — opening a view in the middle of closing one, so
 *  a flushPageSample() then opened a second on top of it. It marks the page
 *  reached and nothing more: views are opened and closed by the hook's one
 *  decision (settleAddressChange), never from here. */
function markCurrentLocationReached(): void {
  try {
    if (routerNamesScreens()) {
      const label = screenLabelNow();
      if (label !== null) recordVisit(label);
    } else if (
      typeof location !== "undefined" &&
      typeof location.pathname === "string"
    ) {
      recordVisit(location.pathname);
    }
  } catch {
    // ignore — reachability tracking must never break the host page
  }
  noteLiveConnectionNavigation();
}

/** The label a view opening now is filed under: the one resolver's
 *  (screenLabel.ts). */
function labelForViewNow(): string | null {
  return screenLabelForView();
}

/** Label the open view now, remembering which family named it. `opensView`
 *  is true where a NEW view begins; otherwise the open view is renamed. */
function labelOpenView(opensView = false): void {
  viewLabel = labelForViewNow();
  viewNamedByRouter = viewLabel !== null && screenLabelFromRouter();
  try {
    noteViewTimeline(opensView, viewLabel);
  } catch {
    // the timeline is a filing aid; it must never stop a view being labelled
  }
}

/**
 * One completed navigation of a handed-over router (angularRouter.ts).
 *
 * The router, not the address bar, decides views from here on — under either
 * location strategy. The decision is the address hook's own
 * (settleAddressChange), keyed on the router's primary path with matrix
 * parameters, query and fragment left out, so a query-only or same-address
 * navigation opens nothing, exactly as an address change of that kind opens
 * nothing.
 *
 * The router's FIRST completed navigation names the screen already showing:
 * the open view is relabelled, from its address name to its pattern, and
 * never closed — the address hook's own start-up relabel. The visit filed
 * under the address name is taken back from the navigation-loop tracker and
 * the page map, so one screen is never two steps.
 */
function handleRouterNavigation(nav: RouterNavigation): void {
  try {
    const label = nav.label ?? screenLabelNow();
    if (nav.first) {
      if (label !== null) relabelVisit(label);
      rebaseAddress(nav.path);
      if (started && viewOpen && !finalized) labelOpenView();
    } else {
      if (label !== null) recordVisit(label);
      if (started) settleAddressChange(nav.path);
    }
  } catch {
    // a navigation must never break the host page
  }
  noteLiveConnectionNavigation();
}

/** The screen just visited is the same screen under the router's name. */
function relabelVisit(label: string): void {
  try {
    const normalized = normalizeRouteLabel(label);
    if (normalized === null) return;
    const addressName = navPrevLabel;
    if (navPrevLabel !== null) navPrevLabel = normalized;
    else recordNavForCircuit(normalized);
    relabelMapVisit(normalized);
    // The address name it was filed under at load is this same screen, so it
    // leaves the reached set too — or one screen would count as two reached.
    if (addressName !== null && addressName !== normalized) {
      visitedRoutes.delete(addressName);
    }
    if (visitedRoutes.size < MAX_VISITED_ROUTES) visitedRoutes.add(normalized);
  } catch {
    // visit tracking must never break the host page
  }
}

// Registered once, at load: the router module never imports this one.
onRouterNavigation(handleRouterNavigation);

/** What one address change means for the view in front of the reader.
 *
 *  - `same`        — not a change of screen (the same path again, a hash or a
 *                    query), or the first address the kit has seen.
 *  - `relabel`     — the app moved its address before anyone could see the
 *                    page (a router sending / on to /home at start-up). The
 *                    first view is the screen at the NEW address, so it is
 *                    relabelled rather than closed: the document's timing
 *                    stays with the screen the visitor actually saw.
 *  - `joins-flush` — a host app called flushPageSample() for this navigation
 *                    just BEFORE moving the address. That call already closed
 *                    the outgoing view under its own route and opened the next
 *                    one; the address change is the same boundary, so the
 *                    open view takes the new address and nothing else moves.
 *  - `boundary`    — one screen ended and another began: close and open.
 *
 *  Decided once per change, and every counter follows the decision: the
 *  reading, the untimed tally, the page-view tally and the press→screen join
 *  all move only on a boundary (or on the flush that a join completes). */
type AddressDecision = "same" | "relabel" | "joins-flush" | "boundary";

function decideAddressChange(pathname: string): AddressDecision {
  if (!addressChangeFrom(pathname)) return "same";
  const openNow = viewOpen && !finalized;
  if (
    openNow &&
    viewOpenedBy === "document" &&
    !anyViewFinalized &&
    pageStillUnseen(fcpMs !== null)
  ) {
    return "relabel";
  }
  if (
    openNow &&
    viewOpenedBy === "flush" &&
    personPressSeq === viewFlushPressSeq &&
    Date.now() - viewFlushedAt <= FLUSH_JOINS_ADDRESS_MS
  ) {
    return "joins-flush";
  }
  return "boundary";
}

/** Act on one address change, once. */
function settleAddressChange(pathname: string): void {
  switch (decideAddressChange(pathname)) {
    case "same":
      // Sets the baseline on the first address and counts nothing after it.
      noteAddress(pathname);
      return;
    case "relabel":
      // Not a view change anybody made, so it is not counted as one; the
      // baseline moves so the next real change is judged from here.
      rebaseAddress(pathname);
      labelOpenView();
      // The kit has handled this change: a host app following the old guide
      // calls flushPageSample() after it, and that call must stand down.
      autoClosedPending = true;
      autoClosedPressSeq = personPressSeq;
      return;
    case "joins-flush":
      noteAddress(pathname);
      labelOpenView();
      viewOpenedBy = "address";
      autoClosedPending = true;
      autoClosedPressSeq = personPressSeq;
      return;
    case "boundary":
      noteAddress(pathname);
      finalizePageSample();
      openNextView("address");
      return;
  }
}

/** Guest-safe wrap of history.pushState/replaceState so SPA navigations that
 *  never fire popstate are still recorded. The originals are preserved and
 *  ALWAYS invoked first; our bookkeeping runs after and can never change the
 *  navigation's behavior. Idempotent, and fully restored in
 *  _resetVitalsForTests. */
function patchHistory(): void {
  try {
    if (typeof history === "undefined") return;
    if (origPushState || origReplaceState) return; // already patched
    if (typeof history.pushState === "function") {
      origPushState = history.pushState;
      const original = origPushState;
      history.pushState = function (
        this: History,
        ...args: Parameters<History["pushState"]>
      ): void {
        original.apply(this, args);
        if (isRuntimeInert()) return;
        // The app's own call has finished, in the app's own zone; the kit's
        // bookkeeping runs outside it (zoneSafe.ts).
        outsideAngular(() => recordCurrentLocation());
      };
      ownedPushState = history.pushState;
    }
    if (typeof history.replaceState === "function") {
      origReplaceState = history.replaceState;
      const original = origReplaceState;
      history.replaceState = function (
        this: History,
        ...args: Parameters<History["replaceState"]>
      ): void {
        original.apply(this, args);
        if (isRuntimeInert()) return;
        outsideAngular(() => recordCurrentLocation());
      };
      ownedReplaceState = history.replaceState;
    }
  } catch {
    // no history API — reachability falls back to popstate/hashchange only
  }
}

/** Undo patchHistory (restore the original methods). Safe to call repeatedly. */
function unpatchHistory(): void {
  try {
    if (origPushState && typeof history !== "undefined" && history.pushState === ownedPushState) {
      history.pushState = origPushState;
    }
  } catch {
    // ignore
  }
  try {
    if (origReplaceState && typeof history !== "undefined" && history.replaceState === ownedReplaceState) {
      history.replaceState = origReplaceState;
    }
  } catch {
    // ignore
  }
  origPushState = null;
  origReplaceState = null;
}

/** The clicked node — or the first ancestor within 8 hops — that LOOKS
 *  interactive (tag, ARIA role, inline handler, tabindex, or pointer cursor),
 *  or null when nothing in reach does. Element-only walk; every inspection is
 *  guarded so it can never throw.
 *
 *  Returns the element rather than a boolean so the caller can read the ONE
 *  identity it is allowed to keep (a code-defined test id) off the element the
 *  walk already matched — no second walk, no second listener. */
function findActionableControl(start: EventTarget | null): Element | null {
  let node = start as Node | null;
  let hops = 0;
  while (node && hops < 8) {
    if (node.nodeType === 1) {
      const el = node as Element;
      const tag = el.tagName ? el.tagName.toUpperCase() : "";
      if (
        tag === "BUTTON" ||
        tag === "A" ||
        tag === "INPUT" ||
        tag === "SELECT" ||
        tag === "TEXTAREA" ||
        tag === "SUMMARY"
      ) {
        return el;
      }
      try {
        const role = el.getAttribute("role");
        if (
          role === "button" ||
          role === "link" ||
          role === "menuitem" ||
          role === "menuitemcheckbox" ||
          role === "tab"
        ) {
          return el;
        }
        if (el.getAttribute("onclick") != null) return el;
        if (el.hasAttribute("tabindex")) return el;
        if (typeof getComputedStyle === "function") {
          if (getComputedStyle(el).cursor === "pointer") return el;
        }
      } catch {
        // per-node inspection failure — keep walking
      }
    }
    node = node.parentNode;
    hops++;
  }
  return null;
}

/** The normalized route label for an already-captured URL string, or null when
 *  it cannot be read. Path only: the query string and hash are never read,
 *  exactly like every other label this kit keeps. */
function routeLabelFromHref(href: string): string | null {
  // The one resolver (screenLabel.ts): in router mode the label the router
  // recorded for that address.
  return screenLabelForHref(href);
}

/** Click handler: after an actionable click, watch a short window for any
 *  navigation, DOM mutation, or scroll; tally dead vs actionable. FAIL-SAFE —
 *  without MutationObserver we cannot see DOM changes, so we never flag (better
 *  to under-report than to falsely accuse a working control).
 *
 *  The same window answers "press this, it opens that": the control's
 *  code-defined test id (nothing else — see controlMap.ts) is kept here, and
 *  the join to whatever page followed happens inside the settle timer that
 *  already existed. The click path itself gains only the bounded attribute
 *  read on the one element the walk already matched — no layout, no text, no
 *  styles, and no bookkeeping a click has to wait for. */
function pressEventTime(e: Event): number {
  try {
    if (
      typeof performance === "undefined" ||
      typeof performance.now !== "function"
    ) {
      return Number.NaN;
    }
    const now = performance.now();
    const stamp = (e as Event & { timeStamp?: unknown }).timeStamp;
    if (typeof stamp !== "number" || !Number.isFinite(stamp)) return now;
    // Zero means the event carries no stamp; a value past `now` is not on
    // this clock at all (some very old engines stamped epoch milliseconds).
    // Either way the handler's own moment stands in, rather than a converted
    // number we cannot vouch for.
    if (stamp <= 0 || stamp > now + 1) return now;
    return stamp;
  } catch {
    return Number.NaN;
  }
}

/** How long that press waited for this handler, in milliseconds. Never
 *  negative, and never invented: zero when the page has no clock to measure
 *  it with. */
function pressHandlerDelayMs(pressPerfAt: number): number {
  try {
    if (!Number.isFinite(pressPerfAt)) return 0;
    if (
      typeof performance === "undefined" ||
      typeof performance.now !== "function"
    ) {
      return 0;
    }
    return Math.max(0, performance.now() - pressPerfAt);
  } catch {
    return 0;
  }
}

function onDocumentClick(e: Event): void {
  try {
    if (typeof MutationObserver === "undefined") return;
    const control = findActionableControl(e.target);
    if (!control) return;
    // Inside an element its developer marked as expecting rapid presses
    // (RAPID_PRESS_ATTRIBUTE): the answer may be one this window cannot see.
    const rapid = isRapidPressArea(e);
    const controlId = readControlId(control);
    // The one structural, text-free identity a control may carry off the
    // device (controlHandle.ts). Taken here, on the element the walk already
    // matched — a bounded ancestor walk reading tag names and sibling order
    // and nothing else. No layout, no styles, no attribute values, no text.
    const handle = controlHandle(control);
    // The same handle, offered to the press step an action may start at
    // (pressTrace.ts). It travels only if the press caused a call, and only
    // while the control census is on; otherwise it is dropped with the press.
    notePressControl(e, handle);
    // Claim this press's place in the order, and note when it happened, so
    // the settle timer can tell whether it is still the press that owns
    // whatever follows and whether its window ran when it should have.
    const pressSeq = ++controlPressSeq;
    const pressAt = Date.now();
    // The same press, offered to the press→screen join: held until the view
    // it opens produces its OWN reading, so the whole wait is measured and
    // not just the part before the address changed
    // (docs/press-to-screen-contract.md).
    //
    // Measured from the EVENT's own moment, never from the moment this
    // handler got to run. A busy main thread can hold a click for hundreds of
    // milliseconds, and those are the FIRST milliseconds of the wait the
    // reader is sitting through: charging them to nobody would make exactly
    // the slowest presses look faster than they were.
    const pressPerfAt = pressEventTime(e);
    lastPressPerfAt = Number.isFinite(pressPerfAt) ? pressPerfAt : null;
    notePressToScreen(pressAt - pressHandlerDelayMs(pressPerfAt));

    const urlBefore = typeof location !== "undefined" ? location.href : "";
    const scrollBefore =
      typeof window !== "undefined" && typeof window.scrollY === "number"
        ? window.scrollY
        : 0;

    let mutated = false;
    let mo: MutationObserver | null = null;
    try {
      mo = kitObserver(() => new MutationObserver(() => {
        mutated = true;
      }));
      const root =
        (typeof document !== "undefined" &&
          (document.documentElement || document.body)) ||
        (document as unknown as Node);
      mo.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    } catch {
      return; // cannot observe → fail-safe, don't flag
    }

    const settle = (): void => {
      try {
        if (mo) mo.disconnect();
      } catch {
        // ignore
      }
      let effect = mutated;
      try {
        if (
          !effect &&
          typeof location !== "undefined" &&
          location.href !== urlBefore
        ) {
          effect = true;
        }
      } catch {
        // ignore
      }
      try {
        const scrollAfter =
          typeof window !== "undefined" && typeof window.scrollY === "number"
            ? window.scrollY
            : scrollBefore;
        if (!effect && Math.abs(scrollAfter - scrollBefore) > 4) effect = true;
      } catch {
        // ignore
      }
      // A marked press is left out of the tally altogether: its developer told
      // us its answer may be one this window cannot see — a keypad drawn on a
      // canvas, a sound — so neither "dead" nor "answered" is ours to say. It
      // is still a press, so the page is not reported as unused.
      if (rapid) rapidPressCount++;
      else if (effect) actionableClickCount++;
      else deadClickCount++;
      // Join the press to what followed, AFTER the counters — the tally above
      // behaves exactly as it did before this map existed. A page change makes
      // an arrow; nothing at all makes a dead end; anything in between is
      // counted as a press and draws nothing, because nothing was observed.
      try {
        const from = routeLabelFromHref(urlBefore);
        // A marked press that changed nothing is not drawn as a dead end
        // either — the same reason as the tally above. It is still a press on
        // that control, so the map and the census count it, as not judged.
        if (from !== null) {
          // A press overtaken by a later one may not claim what followed,
          // and a window that fired far too late saw a gap it cannot
          // account for (frozen tab, back/forward-cache restore). Either
          // way the press is counted and joined to nothing.
          const superseded = pressSeq !== controlPressSeq;
          let suspended = false;
          try {
            suspended = Date.now() - pressAt > CONTROL_JOIN_MAX_LATE_MS;
          } catch {
            // no clock to judge with — treat the window as believable
          }
          const urlAfter =
            typeof location !== "undefined" ? location.href : urlBefore;
          const to = urlAfter !== urlBefore ? routeLabelFromHref(urlAfter) : null;
          recordControlPress({
            from,
            control: controlId,
            handle,
            to,
            hadEffect: effect,
            superseded,
            suspended,
            unjudged: rapid && !effect,
          });
        }
      } catch {
        // the on-device map is display-only — never let it break the tally
      }
    };

    try {
      kitTimeout(settle, PRESS_ANSWER_WINDOW_MS);
    } catch {
      settle();
    }
  } catch {
    // click tracking must never break the host page
  }
}

function observe(
  type: string,
  cb: (entries: PerformanceEntry[]) => void,
  extra?: Record<string, unknown>,
): boolean {
  if (isRuntimeInert()) return false;
  const epoch = entitlementGeneration();
  try {
    // ASK THE ENGINE BEFORE CLAIMING IT ATTACHED. Observing a type the engine
    // does not know is a DEFINED NO-OP — it warns on the console and returns,
    // it does not throw — so a call that completes says only "did not throw",
    // which is just as true on a browser that will never deliver one entry of
    // that kind. Three callers turn this return value into "supported": the
    // long-task meter, the long-animation-frame meter and the press→screen
    // reading. The first two would publish an all-clear over frames nobody
    // could count, and the third tells a developer a reading can never be
    // taken in their browser. It has to mean what it says.
    if (entryTypeRefused(type)) return false;
    const po = kitObserver(() => new PerformanceObserver((list) => {
      try {
        if (isRuntimeInert() || epoch !== entitlementGeneration()) return;
        cb(list.getEntries());
      } catch {
        // A broken callback must never break the page.
      }
    }));
    po.observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
    observers.push(po);
    return true;
  } catch {
    // Entry type unsupported — skip silently.
    return false;
  }
}

/** WHAT THE ENGINE SAID ABOUT AN ENTRY TYPE, in three answers rather than
 *  two. `omitted` is the engine PUBLISHING its list of entry types with this
 *  one absent — a look that found nothing, and the only answer that may be
 *  read as "this browser cannot". `listed` is the same list carrying it.
 *  `unknown` is an engine that publishes no list at all, or a read that
 *  threw: not evidence either way (docs/press-to-screen-contract.md).
 *
 *  Kept apart from "did the observer attach?", because an engine with no
 *  published list also returns a no-op observer that attaches happily — so
 *  attaching there says only "did not throw". */
type EntryTypeListing = "listed" | "omitted" | "unknown";

function entryTypeListing(type: string): EntryTypeListing {
  try {
    const listed = (
      PerformanceObserver as unknown as {
        supportedEntryTypes?: readonly string[];
      }
    )?.supportedEntryTypes;
    if (!Array.isArray(listed)) return "unknown";
    return listed.includes(type) ? "listed" : "omitted";
  } catch {
    return "unknown";
  }
}

/** DID THIS ENGINE LOOK AT THE ENTRY TYPE AND NOT HAVE IT?
 *
 *  True only for `omitted`. An engine that publishes no list at all answers
 *  false here: the observer is attached and the caller learns what it always
 *  learned. Absence of a list is never taken as absence of the feature. */
function entryTypeRefused(type: string): boolean {
  return entryTypeListing(type) === "omitted";
}

/** Like `observe`, but sets `loafSupported` true the instant the observer
 *  attaches (not only when an entry fires) so the animationSmoothness axis can
 *  distinguish "supported, no long frames yet" from "unsupported browser". */
function observeSupported(
  type: string,
  cb: (entries: PerformanceEntry[]) => void,
): void {
  const ok = observe(type, cb);
  if (ok) {
    loafSupported = true;
    // The same fact answers "does this browser report which scripts held a
    // page up?" for the slow-page split (pageWait.ts).
    notePageScriptsReported();
  }
}

/** Record ONE sample for this page view: the page label rated by the largest
 *  paint the visitor waited for (falling back to the first byte when no paint
 *  qualifies — e.g. a page opened in a background tab), named with the timing
 *  it used and how the page was opened. Runs once, on the page's way out, so
 *  the sample reflects final values. */
function finalizePageSample(): void {
  if (isRuntimeInert()) return;
  if (finalized) return;
  finalized = true;
  // Nothing left to close: this view was already finalized and no new one has
  // opened since. Counting it again would invent a view change.
  if (!viewOpen) return;
  viewOpen = false;
  try {
    // Mark the page being finalized as reached (route-reachability backstop).
    // Reachability only: no view is opened or closed from inside a close.
    markCurrentLocationReached();
    const { duration, metric, spansFromInteraction, opened, startPerf } =
      currentViewMeasurement();
    // This document has now closed a view, whatever came of it. The TTFB
    // fallback belongs to the FIRST view and to no other, and "first" has to
    // mean the first one closed — not the first one that produced a reading,
    // which a view that produced none leaves unclaimed for ever.
    anyViewFinalized = true;
    if (duration == null || !Number.isFinite(duration)) {
      noteUntimedViewChange();
      noteViewUntimed();
      // Whatever press opened this view reached no timed screen. Counted as
      // that, never charged to the view that completes next.
      noteViewUntimedForPress();
      return;
    }
    // Filed under the screen this view MEASURED: the label taken when it
    // opened. By the time an address change closes it the address already
    // names the next screen.
    const label = viewLabel !== undefined ? viewLabel : labelForViewNow();
    if (label === null) return;
    const byRouter =
      viewLabel !== undefined ? viewNamedByRouter : screenLabelFromRouter();
    const rating: Rating = rateDuration(duration, metric);
    // WHICH timing this is, and how the page was opened, travel with the
    // number: without them a stored reading cannot say whether it was a paint
    // or a first byte, or whether the page was prerendered or restored. A
    // label the router named says so too: the same screen under an address
    // name and under its pattern must never be compared as one route.
    record(label, duration, rating, {
      timing: metric,
      opened,
      ...(byRouter ? { naming: "router" as const } : {}),
    });
    // What held this view up, split from what the browser reported while it
    // was being waited for (pageWait.ts). Only for a view whose interval sits
    // on the page clock; anything else is never guessed at.
    try {
      noteViewWait(label, duration, startPerf ?? null);
    } catch {
      // the split is extra; the reading above already stands
    }
    // The press→usable join closes here, with whatever this view was able to
    // measure of itself. WHERE that number starts decides which way it goes
    // in: a soft-navigation measurement is taken by the browser from the
    // press, so it is the whole interval already and adding our dead leg to
    // it would publish a wait nobody sat through. Anything else is the settle
    // leg alone.
    if (spansFromInteraction) notePressViewMeasuredFromPress(duration);
    else notePressViewMeasured(duration);
    firstViewRecorded = true;
    noteReadingTaken();
    // The same event, counted for the panel: `readings` above is this
    // document's, and dies with it; the tally is what the developer reads on
    // the panel and spans this device (pageViewTally.ts).
    noteViewMeasured();
  } catch {
    // never crash the unload path
  }
}

/** WHICH measurement belongs to the view that is open RIGHT NOW?
 *
 * The document's TTFB belongs to the first view of the document and to no
 * other. Recycling it for a second, third and fourth virtual page — which is
 * what this code used to do, and what the install guide used to teach —
 * produces a row of readings that all carry the FIRST page's number: a
 * measurement nobody took, attached to a page nobody timed. A view with no
 * measurement of its own is counted as untimed instead (pageActivity.ts), so
 * the silence is reported rather than filled in.
 *
 * Read by the finalizer, and by the panel to answer "has the page being looked
 * at been measured yet?" — one derivation, so the number on the panel and the
 * reading that gets recorded can never tell different stories. */
function currentViewMeasurement(): {
  duration: number | null;
  metric: PageLoadTiming;
  /**
   * WHERE THE NUMBER STARTS. A soft-navigation measurement is taken by the
   * browser from the INTERACTION that began the view, so it already contains
   * the wait between the press and the view appearing. Everything else is
   * measured from the view itself. The press→screen join needs to know which
   * it was given, or it adds that wait a second time.
   */
  spansFromInteraction: boolean;
  /** How the page behind this view was opened (pageLoadTiming.ts). */
  opened: PageOpened;
  /** Where the measured interval STARTS on the page clock, when that is
   *  known: the page's opening for the first view, the press for a view the
   *  browser measured from one. Null where the number cannot be placed on the
   *  clock — it is then never split into what held it up. */
  startPerf?: number | null;
} {
  if (!anyViewFinalized) {
    // The FIRST view of the document, and the only one the document's load —
    // its largest paint, or failing that its first byte — can answer for.
    // Gated on a view having been closed rather than on one having been
    // recorded: a first view that produced no reading at all would otherwise
    // leave this branch open, and hand the document's first byte to the
    // second view, the third, and every view after them as their own.
    //
    // ONLY TIME A VISITOR WAITED. pageLoadTiming.ts measures from when the
    // page was opened (a prerendered page from the visitor's click), cuts at
    // the first hide, the first input, a back-forward restore and a dev
    // server's hot update, and answers nothing at all for a page the kit
    // joined long after it loaded, or one still prerendering unseen.
    const first = firstViewReading();
    let startPerf: number | null = null;
    try {
      startPerf = activationStart();
    } catch {
      startPerf = null;
    }
    return {
      duration: first.duration,
      metric: first.timing,
      spansFromInteraction: false,
      opened: pageOpenedHow(),
      startPerf,
    };
  }
  const lcp = joinedLate() ? null : acceptedLcpMs();
  if (lcp != null && lcp !== lcpAtViewStart) {
    // A paint accepted since this view opened, in a browser that re-reports
    // LCP per soft navigation. Compared against the value in hand when the
    // view opened rather than cleared, so closing a view never blanks the LCP
    // meter.
    return { duration: lcp, metric: "lcp", spansFromInteraction: false, opened: "in-page" };
  }
  // A later view: the only honest number is one the browser measured for the
  // new view itself.
  try {
    const softNav = getSoftNavStats().samples;
    const progress = softNavSampleProgress();
    if (progress.total > softNavSamplesAtFlush && softNav.length > 0) {
      // WHOSE MEASUREMENT IS IT? A soft-navigation measurement is taken from
      // the interaction that began its view, so this view's own starts at
      // this view's press. One delivered late for a view already closed
      // starts at an EARLIER press, and publishing it here would put one
      // view's number on another view — the thing this whole function exists
      // to prevent. Refused instead, which leaves the view untimed and
      // counted as such.
      //
      // The slack covers one press read twice: the browser stamps the event,
      // we stamp our handler, and with a blocked main thread those can drift
      // apart by a frame or two. A quarter of a second is far wider than that
      // drift and far narrower than any two presses a person makes.
      const SLACK_MS = 250;
      const startedAt = progress.lastStart;
      const belongsToThisView =
        startedAt == null ||
        viewPressPerfAt == null ||
        startedAt >= viewPressPerfAt - SLACK_MS;
      if (belongsToThisView) {
        return {
          duration: softNav[softNav.length - 1],
          metric: "lcp",
          spansFromInteraction: true,
          opened: "in-page",
          startPerf:
            typeof startedAt === "number" && Number.isFinite(startedAt)
              ? startedAt
              : viewPressPerfAt,
        };
      }
    }
  } catch {
    // no soft-nav timings — the view is untimed, and says so
  }
  return { duration: null, metric: "lcp", spansFromInteraction: false, opened: "in-page" };
}

/** Open the next page view: arm the finalizer again and re-anchor what counts
 *  as "measured for this view".
 *
 *  It deliberately does NOT clear `clsScore`, `inpMs` or `fcpMs`. Those are the
 *  document's own meters — FCP in particular fires once per document, so
 *  clearing it on a route change deletes the paintReadiness axis for the rest
 *  of the visit. Per-view attribution is done by comparing against
 *  `lcpAtViewStart` instead (see currentViewMeasurement).
 *
 *  `by` says who opened it. A view the KIT opened because the address changed
 *  lets a host app's own flushPageSample() for the same navigation stand down
 *  instead of closing a view that just began; a view a host's
 *  flushPageSample() opened lets the address change that follows it join the
 *  same boundary (settleAddressChange).
 *
 *  The view's route label is taken HERE, as it opens: the screen it will
 *  measure is the one at this address, whatever the address says by the time
 *  something closes it. */
function openNextView(by: "address" | "flush"): void {
  finalized = false;
  viewOpen = true;
  viewOpenedBy = by;
  labelOpenView(true);
  autoClosedPending = by === "address";
  autoClosedPressSeq = personPressSeq;
  if (by === "flush") {
    viewFlushedAt = Date.now();
    viewFlushPressSeq = personPressSeq;
  }
  lcpAtViewStart = acceptedLcpMs();
  try {
    softNavSamplesAtFlush = softNavSampleProgress().total;
  } catch {
    softNavSamplesAtFlush = 0;
  }
  // WHICH press opened this view, on the page's own clock. A soft-navigation
  // measurement has to have been measured from THIS press to be this view's
  // own, and nothing else in the document can say which press that was.
  viewPressPerfAt = lastPressPerfAt;
  lastPressPerfAt = null;
  // A new screen in front of the reader: whatever press opened it is held
  // until THIS view produces its own reading. Both paths run it — the address
  // change the kit spotted, and a host calling flushPageSample() itself —
  // because both mean the same thing to the person waiting.
  notePressViewOpened(Date.now());
}

export interface StartWebVitalsOptions {
  /**
   * Floating Boosthis bubble on the page. Defaults to VISIBLE — shown on every
   * host, live/published domains included, so an install never looks broken in
   * production. Pass `true` to always show it, `false` to never show it. The
   * `BOOSTHIS_BUBBLE` env/global ("1"/"0") overrides this option, and the
   * `BOOSTHIS_DISABLED` kill-switch always wins.
   */
  bubble?: boolean;
  /**
   * Epoch-ms time the running build was produced. Feeds the additive, display-
   * only Patch Lag meter (how stale the deployed build is). Validated before
   * use — a non-finite value or one at/below the year-2000 floor is ignored,
   * falling back to the server-reported HTML `document.lastModified`. Never
   * feeds the Speed score.
   */
  buildTimeMs?: number;
  /**
   * Commit sha of the running build, shown alongside the Patch Lag meter.
   * Validated + lowercased before use (7–40 hex chars); anything else is
   * ignored. Never uploaded as anything but the sha itself.
   */
  buildCommit?: string;
  /**
   * The project key this page will register with, when the caller already
   * holds it (the one-line `<script>` tag does). Used ONLY to name the key by
   * its last four characters on the startup line — the reporting client still
   * resolves the key it uses independently. Module installs that pass the key
   * to `enableTelemetry` instead can leave this unset: the startup line waits
   * one turn of the event loop for that call to supply it.
   */
  projectKey?: string | null;
  /**
   * Watch the app's own outbound calls where they START (`fetch` /
   * `XMLHttpRequest`), so a call that hangs and never returns is visible and
   * each outcome — completed, failed, aborted, timed out — is told apart.
   * Defaults to ON. Pass `false` to fall back to the passive completion-only
   * reading, which cannot see a hang.
   */
  watchCalls?: boolean;
  /**
   * Count an error returned INSIDE a normal-looking response (an HTTP 200
   * whose JSON body carries `error`, or a GraphQL `errors` array) as a failed
   * call. OFF by default — it costs a response clone and only the app knows
   * whether its backend answers that way. Requires `watchCalls`.
   */
  countBodyErrors?: boolean;
  /**
   * Model endpoints this page calls that are not in the maintained public
   * provider table (for example `"llm.internal"` or `"ai.example.com"`).
   * Full URLs are accepted and reduced to an exact hostname. The addresses are
   * compared only inside this page and never leave it; every match emits the
   * same fixed provider code. Tokens are counted, but our public price table is
   * never applied to them; a cost the endpoint itself reports is still used.
   */
  aiEndpoints?: readonly string[];
  /**
   * Calls this page makes that WAIT ON PURPOSE — a long-poll that holds the
   * request open until there is news, then answers. Name each one as its
   * address without the query: a path on this page's own site
   * (`"/api/poll"`) or a full address (`"https://api.example.com/v1/updates"`).
   * Text written as `:name` stands for the part of one segment that changes
   * (`"/api/rooms/:room/poll"`). At most 10. A wildcard, a prefix or a pattern
   * is refused, with a one-line reason on the console.
   *
   * A declared call is never counted as slow, stalled or hung: its duration
   * stays out of the network readings, the call groups and the call traces
   * (where it still appears, marked). Its failures still count. The addresses
   * are compared only inside this page and never leave it — the reading
   * carries four counts.
   */
  waitsOnPurpose?: readonly string[] | string;
}

/** Which of the three badge states the startup line should report. Read here,
 *  from the same resolver the badge itself uses, so the line and the badge can
 *  never tell different stories. Never throws. */
function badgeStateForStartupLine(option?: boolean): BadgeState {
  try {
    return resolveBubbleAudience(option);
  } catch {
    return "owner-only";
  }
}

/** Start observing web vitals. Idempotent; a no-op outside a browser page,
 *  including while Angular renders on the server (browserPage.ts).
 *
 *  Everything this starts — every timer, listener, observer and request — is
 *  the kit's own work, so it is started outside an Angular app's zone
 *  (zoneSafe.ts): called from main.ts or from inside the app, it can never
 *  keep the app from becoming stable. */
let releaseLockLifecycle: (() => void) | undefined;
let latestVitalsOptions: StartWebVitalsOptions = {};
export function startWebVitals(options: StartWebVitalsOptions = {}): void {
  if (isDissolvedThisRun()) return;
  latestVitalsOptions = options;
  releaseLockLifecycle?.();
  releaseLockLifecycle = registerLockLifecycle({
      uninstall: stopWebVitals,
      clear: () => {},
      reinstall: () => startWebVitals(latestVitalsOptions),
  });
  outsideAngular(() => startWebVitalsNow(options));
}

function startWebVitalsNow(options: StartWebVitalsOptions): void {
  if (started) return;
  // Take declarations before any call wrapper is installed, so the first model
  // request is classified. Bad entries are dropped and can never block startup.
  try {
    if (options.aiEndpoints !== undefined) {
      setDeclaredAiEndpoints(options.aiEndpoints);
    }
  } catch {
    /* a declaration can never stop browser measurement */
  }
  // Calls that WAIT ON PURPOSE (declaredCalls.ts) — taken here too, before
  // the wrappers, so the first long-poll is already honoured. A refused entry
  // is said after the startup line, by its position, never by its text.
  let waitLines: string[] = [];
  try {
    if (options.waitsOnPurpose !== undefined) {
      waitLines = declareWaitsOnPurpose(options.waitsOnPurpose);
    }
  } catch {
    waitLines = [];
  }
  // Record the developer's build hints even outside a browser (SSR/tests): the
  // snapshot's Patch Lag meter reads them at capture time, and validation is
  // deferred to resolve time so a bad value simply falls through.
  try {
    setBuildIdentityOptions({
      buildTimeMs: options.buildTimeMs,
      buildCommit: options.buildCommit,
    });
  } catch {
    // never block measurement on build-hint bookkeeping
  }
  if (typeof window === "undefined" || inServerRender()) return;
  // The badge state the startup line announces — reused by the activation
  // notice below so the two can never tell different stories about the badge.
  let badgeState: BadgeState = "visible";
  // Say ONE ungated line before anything else happens — before the key is
  // resolved, before any registration, ahead of the measurement APIs. It is
  // the anchor for every diagnosis: no line means this call never ran. It sits
  // immediately beside the bubble mount ON PURPOSE, so anything that stops the
  // badge appearing (the `started` latch, no window, the kill switch) stops
  // the line too and the two can never tell different stories.
  try {
    // Claim the line BEFORE a single key is read, so any refusal the resolve
    // below produces is held back and printed after it. The anchor line is
    // always the first thing a developer sees.
    beginStartAnnouncement();
    badgeState = badgeStateForStartupLine(options.bubble);
    // Resolve through the SAME function registration uses, so the key the line
    // names is the key that will actually be registered — and so a value that
    // cannot be a key is refused out loud here, at the point it was supplied,
    // rather than silently coming to nothing.
    announceKitStart(resolveProjectKey(options.projectKey).key, badgeState);
    announceUnreadableSources();
  } catch {
    // evidence is never allowed to block measurement — but never swallow a
    // refusal that was only waiting for a line that is no longer coming.
    try {
      flushHeldRefusals();
    } catch {
      /* nothing more can be said */
    }
  }
  for (const line of waitLines) {
    try {
      sayAfterStartupLine(line);
    } catch {
      /* a refusal line can never stop measurement */
    }
  }
  // The bubble only needs a DOM, not PerformanceObserver — mount it first so
  // it still appears in environments without the observer APIs.
  try {
    mountBubbleIfEnabled(options.bubble);
  } catch {
    // the bubble must never block measurement
  }
  // Say the one thing the badge cannot say for itself: on a first-ever visit
  // this install is not confirmed yet, so the corner is legitimately empty.
  // Beside the mount for the same reason the startup line is — whatever stops
  // the badge appearing stops the explanation for its absence too.
  try {
    watchFirstActivation(badgeState);
  } catch {
    // evidence is never allowed to block measurement
  }
  // …and the other half of that story: a confirmation is permission, not an
  // outcome, so something has to notice when a confirmed install goes on
  // measuring nothing at all.
  try {
    watchFirstMeasurement(badgeState);
  } catch {
    // evidence is never allowed to block measurement
  }
  // Timer Health — wrap the host's set/clear timer functions ONCE so the
  // outstanding-handle count can be sampled off the kit's existing cadence.
  // Guest-safe (originals preserved + always called; never throws). Installed
  // before the PerformanceObserver guard so it works even where PO is absent.
  try {
    if (isRuntimeInert()) return;
    installTimerTracking();
  } catch {
    // wrapping impossible → the timerHealth axis simply stays absent
  }

  // Local store — the page's OWN Web Storage (localStorage / sessionStorage),
  // wrapped ONCE so a slow or failing store shows up as the two separate
  // readings a browser app can honestly have (there is no database here to
  // wait on). OPT-IN: nothing is wrapped unless BOOSTHIS_STORAGE_METER is set,
  // because this is the page's own data path. Guest-safe (originals preserved
  // + always called through, every throw re-thrown unchanged, never throws
  // into the host). Where storage access itself throws — a sandboxed frame,
  // blocked site data — it wires nothing and the axes say "blocked here"
  // rather than going quiet. See docs/local-store-reading-contract.md.
  try {
    installLocalStoreTracking();
  } catch {
    // wrapping impossible → both local-store axes simply stay absent
  }

  // Call watch — wrap the host's `fetch`/`XMLHttpRequest` ONCE so an outbound
  // call is recorded where it STARTS. That is the only way a browser can see a
  // call that hangs and never returns; the passive resource observer below
  // fires on completion, so a hang is invisible to it by construction.
  // Guest-safe (originals preserved + always called; never throws). When
  // wrapping is impossible — or the app opted out — nothing is installed and
  // the sampler keeps the completion-only readings it has always produced.
  try {
    if (options.watchCalls !== false) {
      installCallWatch({ bodyErrors: options.countBodyErrors === true });
    }
  } catch {
    // wrapping impossible → the completion-only fallback stays in charge
  }

  // Swallowed errors (Near-Miss Rate) — CHAIN the host's `console.error` so we
  // can count error-level logs the app survived (timestamps only). Guest-safe
  // (original preserved + always called first; never throws). Chaining, not a
  // new handler, so host formatting/output is untouched.
  try {
    installSwallowedErrors();
  } catch {
    // chaining impossible → the swallowedErrors axis simply stays absent
  }

  // Leak Watch — piggyback the SAME console.error chain (installed just above)
  // with a bounded secret/pii scan, and add a passive window `error` listener
  // that schedules a deferred, throttled scan of rendered page text for stack
  // frames. Monitor-only + guest-safe (never alters host behavior, never
  // throws). Installed AFTER swallowedErrors so its log observer attaches to
  // the live wrapper. Additive + display-only — never feeds the Speed score.
  try {
    installLeakWatch();
  } catch {
    // impossible → the leakWatch axis simply stays absent
  }

  // Live Connections — wrap the page's WebSocket / EventSource constructors so
  // a chat, live feed or streamed answer stops being invisible. Everything
  // else this kit measures is driven by work that FINISHES, so an open socket
  // that has quietly died reads as a perfectly idle page. Guest-safe (real
  // constructors preserved and always called; the page gets the real object).
  // A page that opens none keeps the axis absent — never a row of zeros.
  try {
    installLiveConnections();
  } catch {
    // wrapping impossible → the liveConnections axis simply stays absent
  }

  // Dev Posture — read ONCE at startup (frozen) whether the app is still
  // wearing its development clothes: debugFlag (process.env.NODE_ENV, when
  // evaluable after bundler inlining) + a single bounded startup HEAD probe for
  // a same-origin script's source map. EXPOSURE, never safety — a clean tile
  // means none of the development settings we can read were on, NOT that the
  // deployment is hardened. Additive + display-only — never feeds the Speed
  // score. Fire-and-forget; readDevPosture() also self-starts if this is
  // skipped, so the freeze holds either way.
  try {
    startDevPosture();
  } catch {
    // impossible → the devPosture axis simply stays absent
  }

  // Unhandled failures (unhandledErrors axis) — ADDITIVE window `error` +
  // `unhandledrejection` listeners (never replace a host handler, never
  // preventDefault). Distinct from swallowedErrors (console.error near-miss).
  try {
    installUnhandledTracking();
  } catch {
    // impossible → the unhandledErrors axis simply stays absent
  }
  try {
    installBackgroundWorkTracking();
  } catch {
    // impossible → background work remains absent
  }

  // Report pressure (reportPressure axis) — a fresh ReportingObserver for
  // deprecation + intervention reports (type counts only). Feature-detected;
  // absent when ReportingObserver is unsupported.
  try {
    installReportTracking();
  } catch {
    // impossible → the reportPressure axis simply stays absent
  }

  // Font readiness (fontReadiness axis) — stamp elapsed ms when the browser's
  // OWN document.fonts.ready promise resolves (no polling loop).
  try {
    armFontReadiness();
  } catch {
    // no Font Loading API → the fontReadiness axis simply stays absent
  }

  // Idle opportunity (idleOpportunity axis) — OPT-IN only
  // (BOOSTHIS_IDLE_OPPORTUNITY). Self-chaining requestIdleCallback probes, not
  // a permanent loop; absent entirely when the opt-in is off.
  try {
    armIdleOpportunity();
  } catch {
    // no rIC / opt-in off → the idleOpportunity axis stays absent
  }

  // Idle efficiency — begin idle accounting and stamp user input off the SAME
  // passive listeners (no new sampling timer). Any input resets the idle clock
  // so post-input work is never miscounted as idle waste.
  try {
    startIdleTracking();
    const inputHandler = (e?: Event): void => {
      try {
        // A press or a key: the person asked for something. Counted so a
        // view boundary can tell a host's call for the same navigation from
        // one for a screen asked for since (flushPageSample).
        if (e && (e.type === "pointerdown" || e.type === "keydown")) {
          personPressSeq++;
        }
      } catch {
        // never break the page
      }
      try {
        noteUserInput();
      } catch {
        // idle accounting must never break the page
      }
      try {
        // The AI reading's unit of work is the person's turn, and a turn
        // begins at the input that sent the prompt. Same passive listeners,
        // one extra timestamp — nothing about the input itself is read.
        noteAiTurnBoundary();
      } catch {
        // AI accounting must never break the page either
      }
    };
    for (const evt of ["pointerdown", "keydown", "wheel", "touchstart"]) {
      outsideAngular(() => addEventListener(evt, inputHandler, { passive: true, capture: true }));
    }
    idleInputHandler = inputHandler;
    // Input readiness — reuse the SAME passive capture surface to count
    // discrete inputs (pointerdown + keydown) and flag those that landed
    // before first-contentful-paint. Only counts survive; buffered timestamps
    // are dropped once FCP is known.
    const readinessHandler = (e: Event): void => {
      try {
        recordInputForReadiness(
          (e as Event & { timeStamp?: number }).timeStamp,
        );
      } catch {
        // input readiness must never break the page
      }
    };
    for (const evt of ["pointerdown", "keydown"]) {
      outsideAngular(() => addEventListener(evt, readinessHandler, { passive: true, capture: true }));
    }
    inputReadinessHandler = readinessHandler;
  } catch {
    // no input events → idle efficiency stays pending (never faked)
  }

  // Scroll + Frame Floor — attach a passive scroll listener that samples frames
  // ONLY while a scroll is in progress (no permanent rAF loop). Both axes stay
  // absent until the user actually scrolls.
  try {
    installScrollSampler();
  } catch {
    // no scroll/rAF → the scroll + frameFloor axes stay absent
  }

  if (typeof PerformanceObserver === "undefined") return;
  started = true;
  longTaskWindowStart = nowMs();
  // Before any observer: whether the kit joined this page late is decided on
  // the kit's real start time, and the hide/input listeners must be in place
  // before the first buffered paint is read.
  armPageLoadTiming();

  // Long tasks — main-thread blocks ≥50ms (browser Long Tasks API). Only fires
  // in supporting browsers; absent elsewhere (the axis is then simply omitted).
  // The observe() return value records whether the observer actually attached
  // so the blockingTime axis can distinguish "supported, no blocks" from
  // "unsupported engine".
  longTaskSupported = observe("longtask", (entries) => {
    for (const e of entries) {
      if (Number.isFinite(e.duration) && e.duration > 0) {
        longTaskCount++;
        totalLongTaskMs += e.duration;
        const d = Math.round(e.duration);
        if (d > worstBlockMs) worstBlockMs = d;
        // Total Blocking Time cousin: accumulate the overage past the 50ms
        // long-task floor (blockingTime axis).
        totalBlockingMs += Math.max(0, e.duration - 50);
        // Idle efficiency: a long task that lands while the page is idle counts
        // as wasted main-thread work (the tracker gates on last-input time).
        try {
          noteBusyBlock(e.duration);
        } catch {
          // idle accounting must never break the page
        }
      }
    }
  });

  observe("largest-contentful-paint", (entries) => {
    // Every candidate is kept with its own time. Which of them a visitor
    // waited for is decided when the reading is taken (pageLoadTiming.ts),
    // because a hide, an input or a restore that comes later still cuts it.
    for (const e of entries) {
      if (Number.isFinite(e.startTime)) noteLcpCandidate(e.startTime);
    }
    // Soft-navigation responsiveness: every LCP entry can close a pending
    // soft-nav into one responsiveness sample (soft-nav start → next LCP).
    for (const e of entries) {
      if (Number.isFinite(e.startTime)) noteLcpForSoftNav(e.startTime);
    }
  });

  // The visitor's first input ends the page's load: the browser stops
  // reporting largest paints there itself, and an input made before the kit
  // started is known only from this buffered entry.
  observe("first-input", (entries) => {
    for (const e of entries) {
      if (Number.isFinite(e.startTime)) noteFirstInput(e.startTime);
    }
  });

  // First contentful paint — the `paint` entry named "first-contentful-paint".
  // Recorded once; buffered so a late `start` still catches the already-fired
  // entry. Feeds the paintReadiness axis (omitted until this entry is seen).
  observe("paint", (entries) => {
    for (const e of entries) {
      if (e.name === "first-contentful-paint" && Number.isFinite(e.startTime)) {
        if (fcpMs == null) fcpMs = Math.round(e.startTime);
      }
    }
  });

  // Long animation frames (LoAF) — animation-frame blocks ≥50ms. Only fires in
  // supporting browsers (Chromium); absent elsewhere, in which case the
  // animationSmoothness axis is simply omitted (loafSupported stays false).
  loafSupported = false;
  loafWindowStart = nowMs();
  observeSupported("long-animation-frame", (entries) => {
    loafSupported = true;
    for (const e of entries) {
      if (Number.isFinite(e.duration) && e.duration > 0) {
        loafCount++;
        const d = Math.round(e.duration);
        if (d > worstLoafMs) worstLoafMs = d;
      }
      // Cause attribution (frameCause + thirdPartyCost axes). Every string
      // touched below (a script's sourceURL) is read ONLY to classify its
      // origin, then discarded — nothing identifying is stored.
      try {
        const loaf = e as PerformanceEntry & {
          blockingDuration?: number;
          styleAndLayoutDuration?: number;
          scripts?: Array<{
            startTime?: number;
            duration?: number;
            sourceURL?: string;
            invoker?: string;
            invokerType?: string;
            sourceLocation?: string;
          }>;
        };
        const blocking =
          typeof loaf.blockingDuration === "number" &&
          Number.isFinite(loaf.blockingDuration)
            ? loaf.blockingDuration
            : Math.max(0, (Number.isFinite(e.duration) ? e.duration : 0) - 50);
        loafBlockingMs += Math.max(0, blocking);
        if (
          typeof loaf.styleAndLayoutDuration === "number" &&
          Number.isFinite(loaf.styleAndLayoutDuration)
        ) {
          loafStyleLayoutMs += Math.max(0, loaf.styleAndLayoutDuration);
        }
        if (Array.isArray(loaf.scripts)) {
          // Blocking on the ASYNC path (blockingAsync): the longest single
          // script this frame ran from a timer/frame callback or a promise
          // continuation. Script evaluation at load ("classic-script" /
          // "module-script") and input handlers ("event-listener", the
          // responsiveness readings' business) are not the async path.
          let asyncMs = 0;
          for (const script of loaf.scripts) {
            const dur0 =
              typeof script.duration === "number" &&
              Number.isFinite(script.duration)
                ? Math.max(0, script.duration)
                : 0;
            if (dur0 > asyncMs && ASYNC_PATH_INVOKERS.has(String(script.invokerType ?? ""))) {
              asyncMs = dur0;
            }
          }
          if (asyncMs >= ASYNC_BLOCK_MIN_MS && Number.isFinite(e.startTime)) {
            asyncBlockRing.push(epochOf(e.startTime), Math.round(asyncMs));
          }
          for (const script of loaf.scripts) {
            const dur =
              typeof script.duration === "number" &&
              Number.isFinite(script.duration)
                ? Math.max(0, script.duration)
                : 0;
            if (dur <= 0) continue;
            const url =
              script.sourceURL ?? script.invoker ?? script.sourceLocation;
            if (isThirdPartyOrigin(url)) loafScriptThirdPartyMs += dur;
            else loafScriptFirstPartyMs += dur;
            // The same script, kept on the page clock so a slow page view
            // can say how much of ITS wait this was (pageWait.ts). The
            // address is classified there and dropped.
            const at =
              typeof script.startTime === "number" && Number.isFinite(script.startTime)
                ? script.startTime
                : e.startTime;
            notePageScript(at, dur, url);
          }
        }
      } catch {
        // cause attribution must never break the page
      }
    }
  });

  // Soft navigation — `soft-navigation` entries (feature-detected). An entry
  // that carries its own duration is a finished measurement; one that does
  // not is paired with the next LCP entry. The softNav axis stays absent
  // until ≥1 completed measurement.
  //
  // The probe is recorded either way: a browser that does not list this entry
  // type is a browser that will never measure a view after the first, and
  // that is an ANSWER for the press→screen reading rather than a wait
  // (pressViewTimingSupported).
  softNavProbed = true;
  // WHICH KIND OF "NO" — asked BEFORE attaching, because the two are not the
  // same fact. An engine that PUBLISHES its entry types and leaves this one
  // out has answered: it measures no view after the first, today and every
  // day after. An observer that simply failed to attach has answered
  // nothing — a constructor that threw, a security error in a sandboxed
  // frame, an engine that publishes no list at all. Only the first may be
  // handed on as "this browser cannot"; the second leaves the press→screen
  // reading warming, which is the word for "we do not know yet".
  const softNavListing = entryTypeListing("soft-navigation");
  softNavSupported = observe("soft-navigation", (entries) => {
    for (const e of entries) {
      if (!Number.isFinite(e.startTime)) continue;
      // THE ENTRY'S OWN DURATION, where the engine reports one: the press
      // that began the view, through to the paint that made the new view
      // contentful. Read here because it is the only place it can be read —
      // `largest-contentful-paint` stops being reported at the first
      // interaction, by that metric's own rule, so the "next LCP" this used
      // to wait for never arrives after a press. Every soft navigation was
      // left pending for ever: no responsiveness sample on any real browser,
      // and a view the browser HAD measured filed as untimed.
      const reported = (e as PerformanceEntry & { duration?: unknown }).duration;
      const durationMs = typeof reported === "number" ? reported : Number.NaN;
      // Banked in one step, counted and capped exactly as a paired paint
      // would have been, and stamped with the interaction it was measured
      // from — which is what lets the view that press opened claim it, and
      // stops any other view claiming it.
      const route = softNavRouteOf(e.name);
      if (recordSoftNavMeasured(e.startTime, durationMs, route)) continue;
      // No usable duration on the entry — an engine that announces the view
      // change and times it separately, or one that leaves the field at the
      // zero every performance entry carries by default. Pair it with the
      // next paint, as before.
      recordSoftNavStart(e.startTime, route);
    }
  });
  // WHAT THE ENGINE ANSWERED, handed straight to the join. The press→screen
  // reading is the one that has to tell a developer "this browser can never
  // produce this", and it must say that on the panel and in the upload
  // alike — so the answer goes to the module that derives the reading, once,
  // rather than being re-decided at each surface.
  // ATTACHING IS NOT AN ANSWER. On an engine that publishes no entry-type
  // list, observing an unknown type is a defined no-op: it warns and
  // returns, so `observe` hands back true on exactly the browser that will
  // never deliver one of these entries. Only a published list carrying the
  // type, WITH an observer that attached, is a yes; a published list without
  // it is the no; everything else is "we do not know", which keeps the
  // reading warming instead of promising or refusing.
  softNavAnswer =
    softNavListing === "omitted"
      ? false
      : softNavListing === "listed" && softNavSupported
        ? true
        : null;
  notePressViewTimingSupport(softNavAnswer);

  observe("layout-shift", (entries) => {
    for (const e of entries) {
      const shift = e as PerformanceEntry & {
        value?: number;
        hadRecentInput?: boolean;
        sources?: unknown[];
      };
      if (shift.hadRecentInput) continue;
      if (typeof shift.value === "number" && Number.isFinite(shift.value)) {
        clsScore = (clsScore ?? 0) + shift.value;
        recordShiftSample(
          e.startTime,
          shift.value,
          Array.isArray(shift.sources) ? shift.sources.length : 0,
        );
      }
      // Layout-shift SOURCE count (shiftSources axis) — how many nodes moved
      // together. A COUNT only; the actual nodes/selectors are never read.
      try {
        if (Array.isArray(shift.sources)) {
          noteLayoutShiftSources(shift.sources.length);
        }
      } catch {
        // never break the observer
      }
    }
  });

  observe(
    "event",
    (entries) => {
      for (const e of entries) {
        if (Number.isFinite(e.duration) && e.duration > (inpMs ?? 0)) {
          inpMs = Math.round(e.duration);
        }
        // Feed the proper INP estimator too (deduped by interactionId).
        const interactionId = (e as PerformanceEntry & { interactionId?: number })
          .interactionId;
        recordInteractionForInp(interactionId, e.duration);
        recordInteractionSample(interactionId, e.startTime, e.duration);
        // Tap readiness: a discrete tap DELIVERED late because the main thread
        // was busy (the wait from the press to its handler starting).
        noteTapWait(
          e.name,
          e.startTime,
          (e as PerformanceEntry & { processingStart?: number }).processingStart,
        );
        // Interaction VOLUME (interactionVolume axis) — count distinct
        // interactions without timing them. A COUNT only.
        try {
          noteInteractionId(interactionId);
        } catch {
          // never break the observer
        }
        // Rage clicks: the entry's start and duration are kept so a burst can
        // be judged against the browser's own timing of its presses.
        noteEventForRage(e.duration, e.startTime);
        // The press step an action starts at ends no earlier than the paint
        // the browser timed after the press (pressTrace.ts).
        notePressPaint(e.name, e.startTime, e.duration);
      }
    },
    // 16 ms (the floor the API allows): an interaction tail judged on settled
    // interactions needs the ordinary fast ones too, not only the slow ones.
    { durationThreshold: 16 },
  );

  // Fan-out bursts — a PASSIVE resource-timing observer counting fetch/XHR
  // request STARTS only (nothing is intercepted or wrapped). Feeds the
  // count-only circuit stats above. The entry's address is READ on this stack
  // for exactly one decision — "did this call go to our own origin?" — and is
  // then dropped: only a yes/no leaves this callback, exactly as the call-group
  // derivation already works. It is never stored and never uploaded.
  observe("resource", (entries) => {
    for (const e of entries) {
      const res = e as PerformanceEntry & {
        initiatorType?: string;
        responseStatus?: number;
        responseStart?: number;
        responseEnd?: number;
        transferSize?: number;
        connectStart?: number;
        connectEnd?: number;
        contentType?: string;
        name?: string;
      };
      // OUR OWN UPLOADS ARE NOT THE APP'S CALLS — and this is the one
      // observation point where excluding them at the transport was not
      // enough. The kit sends through the PRE-WRAP fetch so the call watcher
      // never sees its own traffic, but Resource Timing records every request
      // the browser made regardless of which reference issued it. On our own
      // site the endpoint is the page's own origin, so without this the kit's
      // registrations, consents, sample flushes and snapshot uploads were
      // being read back as the app's own backend: counted for reliability,
      // and measured for data distance as a same-origin dependency.
      //
      // Placed at the TOP of the callback and returning, rather than beside
      // each reading: a reading added to this handler later is then excluded
      // by position instead of by someone remembering. The address is read on
      // this stack for one decision — "is this one of ours?" — and dropped.
      try {
        if (isOwnEndpointReply(res.name)) continue;
      } catch {
        // never break the observer
      }
      // A dev server's hot update ends the page's LOAD: what it paints
      // afterwards is a re-render, not something a visitor waited for on
      // arrival (pageLoadTiming.ts). The same one-decision read of the
      // address — "is this a hot-update download?" — and the same drop.
      try {
        noteResourceForPageLoad(res.name, res.startTime);
      } catch {
        // never break the observer
      }
      // AI-call blind spot — checked BEFORE the fetch/XHR filter below,
      // because the whole point is a transport this kit does not wrap
      // (EventSource, a beacon, an injected script) reaching a model provider.
      // The address is read on this stack for one decision — "is this host a
      // known provider?" — and dropped; only a transport NAME survives.
      try {
        noteAiResourceEntry(res.name, res.initiatorType);
      } catch {
        // never break the observer
      }
      if (res.initiatorType !== "fetch" && res.initiatorType !== "xmlhttprequest") {
        continue;
      }
      // WHICH KIND of destination, decided once from the address on this
      // stack and kept only as a closed token (callGroups.ts); and the page
      // the call STARTED on, from the view timeline rather than the address
      // bar as it reads now.
      let to: CallGroupDestination = "unnamed";
      try {
        to = callGroupDestination(res.name);
      } catch {
        to = "unnamed";
      }
      let startedOn: string | null = null;
      try {
        startedOn = pageAtPerf(res.startTime);
      } catch {
        startedOn = null;
      }
      recordRequestStartForCircuit(res.startTime, to, startedOn);
      // Calls that WAIT ON PURPOSE, and STREAMS (declaredCalls.ts). The
      // address is read on this stack for those two decisions and dropped: a
      // declared call's duration stays out of every reading below, and a
      // stream — which this observer hears of only when it CLOSES — is timed
      // to its headers, or kept out where the browser hid them.
      let declared = -1;
      let streamHeaderMs: number | null | undefined = undefined;
      try {
        declared = matchWaitName(res.name);
        if (isStreamMediaType(res.contentType) || takeStreamAddress(res.name)) {
          const rs = res.responseStart;
          streamHeaderMs =
            typeof rs === "number" && rs > 0 && rs >= res.startTime
              ? rs - res.startTime
              : null;
        }
      } catch {
        declared = -1;
        streamHeaderMs = undefined;
      }
      // The call's span on the page clock, for the slow-page split — on the
      // same terms as the readings below: a declared wait is not something the
      // page waited on, and a stream is waited on only until its headers.
      try {
        if (streamHeaderMs !== undefined) {
          if (streamHeaderMs !== null) {
            notePageCall(res.startTime, res.startTime + streamHeaderMs);
          }
        } else if (declared < 0) {
          const end =
            typeof res.responseEnd === "number" && res.responseEnd > 0
              ? res.responseEnd
              : res.startTime + res.duration;
          notePageCall(res.startTime, end);
        }
      } catch {
        // never break the observer
      }
      // Network reliability axis — reuse this SAME outbound observation point
      // (no second interception layer): record duration + a coarse ok/failed
      // outcome. Numbers, the destination token and the page label only; the
      // entry URL itself is never handed over.
      recordResourceEntry({
        duration: res.duration,
        responseStatus: res.responseStatus,
        responseEnd: res.responseEnd,
        transferSize: res.transferSize,
        declared,
        ...(streamHeaderMs !== undefined ? { streamHeaderMs } : {}),
        to,
        page: startedOn,
      });
      // Data-distance axis — connection SETUP time (connect + secure), which
      // is pure distance and does not move when the backend gets slower. Only
      // the app's OWN backend: every other origin hides these phases unless it
      // opts in, so this kit abstains there rather than reporting a zero. The
      // typical call to it leaves out a declared wait, and times a stream to
      // its headers.
      try {
        const typicalMs =
          streamHeaderMs !== undefined
            ? (streamHeaderMs ?? undefined)
            : declared >= 0
              ? undefined
              : res.duration;
        recordResourceSetup({
          sameOrigin: to === "same-origin",
          connectStart: res.connectStart,
          connectEnd: res.connectEnd,
          ...(typicalMs !== undefined ? { duration: typicalMs } : {}),
        });
      } catch {
        // never break the observer
      }
    }
  });

  // Dead-click detection — a click on an actionable-looking control that
  // produces no navigation, DOM change, or scroll within a short window.
  // Count-only + FAIL-SAFE: skipped entirely without MutationObserver.
  try {
    if (
      typeof document !== "undefined" &&
      typeof MutationObserver !== "undefined"
    ) {
      deadClickHandler = onDocumentClick;
      outsideAngular(() => addEventListener("click", onDocumentClick, true));
      // Registered INSIDE this block on purpose: registration is the evidence
      // that something is watching, so "no presses" can be reported as an
      // unused page instead of as a page we could not see (pageActivity.ts).
      setInteractionSource(() => {
        const d = getDeadClickStats();
        return {
          presses: d.actionableClickCount + d.deadClickCount + rapidPressCount,
          // An INP measurement is an interaction the click watch may not have
          // counted (a key press, a drag) — still positive evidence of use.
          interacted:
            d.actionableClickCount + d.deadClickCount + rapidPressCount > 0 ||
            inpMs != null,
        };
      });
      // The same listener answers "which control opened which page" (see
      // controlMap.ts). Recording that it is installed is what lets the panel
      // say "not observable here" instead of showing an empty map as if it
      // had looked and found nothing.
      setControlWatchInstalled(true);
    }
  } catch {
    // no click events — the dead-click axis is simply omitted
  }

  // Route reachability — record the initial page and hook every subsequent SPA
  // navigation so registerWebRoutes() can later name routes never reached this
  // session. Router-agnostic + guest-safe: history wrappers preserve + call the
  // originals, popstate/hashchange cover back/forward + hash routers. All
  // label-local — nothing here is ever uploaded.
  // The FIRST view's route, taken as the kit starts: the document's own view
  // opened before the kit could see it, and this is the earliest the kit can
  // say which screen it is. Its own try: a failure in the hooks below must
  // not leave the first view unlabelled.
  try {
    labelOpenView(true);
    viewOpenedBy = "document";
  } catch {
    // unlabelled: the view falls back to the address at close
  }
  try {
    // Read back what earlier visits on this device already drew before the
    // first page of this load is added, so the map accumulates instead of
    // starting blank every reload.
    loadPageMap();
    recordCurrentLocation();
    // A router handed over before the kit started has already been naming
    // screens: the address hook stood down above, so the baseline the next
    // navigation is judged from is the router's own path.
    if (routerNamesScreens()) {
      const routed = angularRouterPath();
      if (routed !== null) noteAddress(routed);
      const label = screenLabelNow();
      if (label !== null) recordVisit(label);
    }
    patchHistory();
    routeChangeHandler = recordCurrentLocation;
    outsideAngular(() => addEventListener("popstate", recordCurrentLocation));
    outsideAngular(() => addEventListener("hashchange", recordCurrentLocation));
  } catch {
    // no history/nav events — reachability tracking is simply reduced/omitted
  }

  // Rage clicks — a document-level capture click listener feeding the burst
  // detector. Coordinates live ONLY in the detector's tiny ring; only counts
  // survive. The observation window starts here so ragePerMin is anchored to
  // startWebVitals — and only where a MutationObserver exists: without one no
  // press can be seen being answered, so the reading is omitted rather than
  // shown as a clean zero it never looked for.
  try {
    if (
      typeof document !== "undefined" &&
      typeof MutationObserver !== "undefined"
    ) {
      rageWindowStart = nowMs();
      rageClickHandler = onRageClick;
      outsideAngular(() => addEventListener("click", onRageClick, {
        passive: true,
        capture: true,
      }));
    }
  } catch {
    // no click events — the rageClicks axis stays warming with zeros
  }

  // bfcache — inspect the initial navigation entry once (a back_forward nav is
  // one bf nav) and listen for persisted pageshow events (bfcache restores).
  // Reason strings are never stored — only counters are bumped.
  try {
    countInitialBfNav();
    pageShowHandler = onPageShow;
    outsideAngular(() => addEventListener("pageshow", onPageShow));
  } catch {
    // no pageshow — the bfcache axis stays absent until a bf nav is seen
  }

  // Let the panel's count include the page being looked at. A reading is
  // recorded on the way OUT, so without this the number is permanently one
  // behind: a developer on a freshly loaded page reads 0 while the browser has
  // already measured it. Registered here, next to the finalizer it mirrors,
  // and answered from the SAME derivation the finalizer uses.
  try {
    setOpenViewMeasuredSource(() => {
      if (!viewOpen || finalized) return false;
      const { duration } = currentViewMeasurement();
      return duration != null && Number.isFinite(duration);
    });
  } catch {
    // no source registered — the panel counts closed views only, and never
    // claims an open one
  }

  // Finalize once when the page goes away (pagehide) or is backgrounded
  // (visibilitychange→hidden — the last reliable moment on mobile browsers).
  //
  // The accumulated page map — and the count of page views measured on this
  // device — ride these SAME two moments: no listener of their own, and no
  // storage write anywhere on the navigation path.
  try {
    outsideAngular(() => addEventListener("pagehide", onVitalsPageHide));
    outsideAngular(() => addEventListener("visibilitychange", onVitalsHidden));
  } catch {
    // no DOM events — nothing to finalize against
  }
}

/** Force the page sample to record now, and arm the next view.
 *
 *  The kit now does this itself whenever the address changes (see
 *  recordCurrentLocation), so a host app no longer has to call it on an
 *  ordinary SPA route change. It stays for the routers the kit cannot see —
 *  a drawer or wizard that changes screen without touching the address — and
 *  for tests. Either order around a route change counts it once:
 *   - straight AFTER a change the kit already handled, it stands down — the
 *     view is already closed, and only a genuine view boundary opens another;
 *   - just BEFORE the address moves (a router calling it as navigation
 *     starts), it closes the outgoing view under that view's own route and
 *     opens the next, and the address change that follows joins this same
 *     boundary instead of closing the view it just opened.
 *  A call with no address change at all (a drawer, a wizard step) closes one
 *  view and opens the next.
 *
 *  It no longer clears the document's own meters (CLS, INP, FCP). Doing that
 *  on every route change deleted the paintReadiness axis for the rest of the
 *  visit — FCP fires once per document and never again — and reset two axes
 *  that are document-scoped everywhere else in this kit. Per-view attribution
 *  of the reading is done in currentViewMeasurement instead. */
export function flushPageSample(): void {
  // The host's call; the kit's work it starts (an upload, the next view's
  // observers) runs outside an Angular app's zone.
  outsideAngular(flushPageSampleNow);
}

function flushPageSampleNow(): void {
  // The kit has just closed a view for an address change of its own, and this
  // call is the host app doing what the guide used to tell it to do for that
  // same navigation. Closing again would end a view that began a moment ago
  // and bank an untimed view change nobody navigated — so stand down, once,
  // for the boundary the kit already handled.
  //
  // Only while nobody has pressed anything since. A press after the boundary
  // asked for a new screen, and the call that follows it (a drawer, a wizard
  // step) is that screen's, not the navigation's — honoured normally, as is
  // any second call.
  if (autoClosedPending && personPressSeq === autoClosedPressSeq) {
    autoClosedPending = false;
    return;
  }
  autoClosedPending = false;
  finalizePageSample();
  // Open the next view: a host that changes screen without touching the
  // address still has a view in front of the reader, and the page going away
  // must be able to close it.
  openNextView("flush");
}

/** @internal test hook — reset module state between hermetic runs. */
function onVitalsPageHide(): void {
  if (isRuntimeInert()) return;
  finalizePageSample();
  savePageMap();
  savePageViewTally();
}
function onVitalsHidden(): void {
  if (document.visibilityState === "hidden") onVitalsPageHide();
}
export function _resetVitalsForTests(): void { stopWebVitals(); }

/** Production teardown: only kit observers, handlers and wrappers. */
export function stopWebVitals(): void {
  _resetNetworkSamplerForTests();
  _resetIdleTrackerForTests();
  try {
    removeEventListener("pagehide", onVitalsPageHide);
    removeEventListener("visibilitychange", onVitalsHidden);
  } catch { /* no browser */ }
  for (const o of observers) {
    try {
      o.disconnect();
    } catch {
      // ignore
    }
  }
  observers = [];
  try {
    if (deadClickHandler) removeEventListener("click", deadClickHandler, true);
  } catch {
    // ignore
  }
  deadClickHandler = null;
  // The control map is only as trustworthy as the watch that fed it: dropping
  // the listener drops the claim that we were looking.
  try {
    setControlWatchInstalled(false);
    _resetControlMapForTests();
  } catch {
    // ignore
  }
  // ...and with it the reader that made "no presses" a finding rather than a
  // silence, plus this document's page-view bookkeeping.
  try {
    _resetPageActivityForTests();
  } catch {
    // ignore
  }
  // ...and the device-wide count the panel shows, which outlives a page load
  // by design and so has to be dropped explicitly or one test inherits
  // another's tally.
  try {
    setOpenViewMeasuredSource(null);
    _resetPageViewTallyForTests();
  } catch {
    // ignore
  }
  firstViewRecorded = false;
  softNavSamplesAtFlush = 0;
  anyViewFinalized = false;
  viewPressPerfAt = null;
  lastPressPerfAt = null;
  viewOpen = true;
  autoClosedPending = false;
  autoClosedPressSeq = 0;
  viewLabel = undefined;
  viewNamedByRouter = false;
  viewOpenedBy = "document";
  viewFlushedAt = 0;
  viewFlushPressSeq = 0;
  personPressSeq = 0;
  lcpAtViewStart = null;
  // Idle-input listener teardown.
  try {
    if (idleInputHandler) {
      for (const evt of ["pointerdown", "keydown", "wheel", "touchstart"]) {
        removeEventListener(evt, idleInputHandler, true);
      }
    }
  } catch {
    // ignore
  }
  idleInputHandler = null;
  // Input-readiness listener teardown.
  try {
    if (inputReadinessHandler) {
      for (const evt of ["pointerdown", "keydown"]) {
        removeEventListener(evt, inputReadinessHandler, true);
      }
    }
  } catch {
    // ignore
  }
  inputReadinessHandler = null;
  // Rage-click listener teardown.
  try {
    if (rageClickHandler) removeEventListener("click", rageClickHandler, true);
  } catch {
    // ignore
  }
  rageClickHandler = null;
  resetRageDetector();
  // bfcache pageshow listener teardown.
  try {
    if (pageShowHandler) removeEventListener("pageshow", pageShowHandler);
  } catch {
    // ignore
  }
  pageShowHandler = null;
  // Scroll sampler + timer-tracking teardown (restore wrapped timer functions).
  try {
    uninstallScrollSampler();
  } catch {
    // ignore
  }
  try {
    uninstallCallWatch();
  } catch {
    // ignore
  }
  try {
    uninstallTimerTracking();
  } catch {
    // ignore
  }
  try {
    uninstallLocalStoreTracking();
  } catch {
    // ignore
  }
  try {
    uninstallSwallowedErrors();
  } catch {
    // ignore
  }
  try {
    uninstallLeakWatch();
  } catch {
    // ignore
  }
  try {
    uninstallLiveConnections();
  } catch {
    // ignore
  }
  try {
    uninstallUnhandledTracking();
  } catch {
    // ignore
  }
  try {
    uninstallBackgroundWorkTracking();
  } catch {
    // ignore
  }
  try {
    uninstallReportTracking();
  } catch {
    // ignore
  }
  // Route reachability teardown: restore history + drop nav listeners + state.
  unpatchHistory();
  try {
    if (routeChangeHandler) {
      removeEventListener("popstate", routeChangeHandler);
      removeEventListener("hashchange", routeChangeHandler);
    }
  } catch {
    // ignore
  }
  routeChangeHandler = null;
  registeredRoutes = null;
  warnedRouteRefusals.clear();
  visitedRoutes = new Set<string>();
  // The accumulated page map outlives a page-load by design, so it has to be
  // dropped explicitly or one test inherits another's map.
  _resetPageMapForTests();
  started = false;
  finalized = false;
  _resetPageLoadTimingForTests();
  clsScore = null;
  inpMs = null;
  longTaskCount = 0;
  worstBlockMs = 0;
  totalLongTaskMs = 0;
  longTaskWindowStart = 0;
  fcpMs = null;
  fcpOverride = null;
  lcpOverride = null;
  inpLongest = [];
  interactionSamples = [];
  interactionSamplesOverride = null;
  shiftSamples = [];
  shiftSamplesOverride = null;
  sawFirstInteraction = false;
  inpMinId = Infinity;
  inpMaxId = 0;
  inpOverride = null;
  waitingTapStarts = [];
  loafCount = 0;
  asyncBlockRing.clear();
  worstLoafMs = 0;
  loafWindowStart = 0;
  loafSupported = false;
  deadClickCount = 0;
  rapidPressCount = 0;
  controlPressSeq = 0;
  actionableClickCount = 0;
  navPrevLabel = null;
  navPrevPrevLabel = null;
  navRunLen = 0;
  navRunStartTs = 0;
  navLoopMaxBounces = 0;
  requestStarts = [];
  requestBurstMax1s = 0;
  worstBurst = null;
  viewTimeline = [];
  _resetPageWaitForTests();
  heapOverride = null;
  resourceEffOverride = null;
  // ─── New additive-batch collectors ──────────────────────────────────────
  loafBlockingMs = 0;
  loafScriptFirstPartyMs = 0;
  loafScriptThirdPartyMs = 0;
  loafStyleLayoutMs = 0;
  loafCauseOverride = null;
  totalBlockingMs = 0;
  longTaskSupported = false;
  blockingTimeOverride = null;
  bfNavCount = 0;
  bfRestoredCount = 0;
  bfBlockedCount = 0;
  bfActionableBlockedCount = 0;
  bfBlockerUnload = 0;
  bfBlockerCacheControl = 0;
  bfBlockerInFlight = 0;
  bfBlockerHeldConnection = 0;
  bfBlockerBrowser = 0;
  bfBlockerOther = 0;
  bfBlockerUnnamed = 0;
  bfInitialCounted = false;
  bfCacheOverride = null;
  inputCount = 0;
  earlyInputCount = 0;
  inputTsBuffer = [];
  inputReadinessOverride = null;
  softNavSupported = false;
  softNavProbed = false;
  softNavAnswer = null;
  notePressViewTimingSupport(null);
  softNavCount = 0;
  softNavPendingStart = null;
  softNavPendingLabel = null;
  softNavSamples = [];
  softNavRing.clear();
  softNavSeenRoutes.clear();
  softNavRingOverride = null;
  softNavSampleTotal = 0;
  lastSoftNavSampleStart = null;
  softNavOverride = null;
  memoryReadings = [];
  memorySampleInFlight = false;
  memoryTrendOverride = null;
  memoryReadingsOverride = null;
  resourceBloatOverride = null;
  rageWindowStart = 0;
  rageBurstCount = 0;
  rageAnsweredBurstCount = 0;
  rageBurstStamps = [];
  rageBurstsOverride = null;
  rageAnsweredStamps = [];
  rageWorstDelayMs = 0;
  resetRageDetector();
  rageClickOverride = null;
  // 2026-08 web platform + reports batch state.
  try {
    _resetWebPlatformForTests();
  } catch {
    // ignore
  }
  try {
    _resetWebReportsForTests();
  } catch {
    // ignore
  }
}

/** Test-only: seed the long-task counters so the snapshot Stability axis can be
 *  exercised deterministically without a live PerformanceObserver. */
export function _setLongTaskStatsForTests(s: {
  supported?: boolean;
  count: number;
  totalBlockedMs?: number;
  worstBlockMs: number;
  windowStartMsAgo: number;
}): void {
  longTaskSupported = s.supported ?? true;
  longTaskCount = s.count;
  totalLongTaskMs = s.totalBlockedMs ?? 0;
  worstBlockMs = s.worstBlockMs;
  longTaskWindowStart = s.windowStartMsAgo > 0 ? nowMs() - s.windowStartMsAgo : 0;
}

/** Test-only: clear just the long-task collector state. */
export function _resetLongTaskStatsForTests(): void {
  longTaskSupported = false;
  longTaskCount = 0;
  totalLongTaskMs = 0;
  worstBlockMs = 0;
  longTaskWindowStart = 0;
}

/** Test-only: seed the dead-click counters so the bubble / snapshot surface can
 *  be exercised deterministically without live clicks. */
export function _setDeadClickStatsForTests(s: {
  deadClickCount: number;
  actionableClickCount: number;
}): void {
  deadClickCount = s.deadClickCount;
  actionableClickCount = s.actionableClickCount;
}

/** Test-only: seed (or clear with null) the current-page CLS so the snapshot
 *  Layout Stability axis can be exercised without live layout-shift entries. */
export function _setClsForTests(cls: number | null): void {
  clsScore = cls;
}

/** Test-only: drive the circuit-lens trackers deterministically — pushes each
 *  path through the SAME incremental nav-loop tracker as live navigation and
 *  each timestamp through the SAME burst ring as the resource observer. */
export function _driveCircuitForTests(s: {
  navPaths?: string[];
  requestStarts?: Array<
    number | { t: number; to?: CallGroupDestination; page?: string | null }
  >;
}): void {
  for (const p of s.navPaths ?? []) {
    const label = normalizeRouteLabel(p);
    if (label !== null) recordNavForCircuit(label);
  }
  for (const r of s.requestStarts ?? []) {
    if (typeof r === "number") recordRequestStartForCircuit(r);
    else recordRequestStartForCircuit(r.t, r.to ?? "unnamed", r.page ?? null);
  }
}

/** Test-only: seed the route-reachability state so the bubble / detector can be
 *  exercised deterministically without live navigation. Normalizes exactly like
 *  the live paths so tests exercise the same label collapsing. */
export function _setRouteDataForTests(s: {
  registered: string[];
  visited: string[];
}): void {
  const registered = s.registered
    .map((r) => normalizeRouteLabel(r))
    .filter((r): r is string => r !== null);
  registeredRoutes = registered.length > 0 ? Array.from(new Set(registered)) : null;
  visitedRoutes = new Set(
    s.visited
      .map((r) => normalizeRouteLabel(r))
      .filter((r): r is string => r !== null),
  );
}

let bfBlockerHeldConnection = 0;

let bfBlockerUnnamed = 0;

let bfBlockerBrowser = 0;
