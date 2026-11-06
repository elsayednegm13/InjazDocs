/** Outstanding-timer tracker — the input for the Timer Health axis.
 *
 * Wraps the host page's `window.setTimeout` / `setInterval` / `clearTimeout` /
 * `clearInterval` to count how many timer handles are currently OUTSTANDING
 * (created and not yet fired/cleared), then samples that count over time so the
 * axis can score its GROWTH TREND (a leak signal).
 *
 * GUEST SAFETY (this runs inside a customer's page):
 *   - the original functions are kept and ALWAYS called through unconditionally,
 *   - the wrapper never throws (all bookkeeping is guarded),
 *   - return values and `this` are preserved exactly,
 *   - the originals are restored on uninstall,
 *   - installation is idempotent (install-only-once).
 * If wrapping is impossible (no window, non-function timers), install() is a
 * no-op and the axis stays absent (readTimerHealth reports pending) — we never
 * guess.
 *
 * PRIVACY: counts + timestamps only. No timer callback, argument, URL, or any
 * customer value is ever read or stored.
 */

import {
  computeTimerHealth,
  TIMER_HEALTH_MIN_SAMPLES,
  TIMER_HEALTH_MIN_ELAPSED_MS,
  ASYNC_SLOW_CALLBACK_MS,
  computeAsyncSlowCallbacks,
  computeEventLoopLag,
  type AsyncSlowCallbacksResult,
  type EventLoopLagResult,
  type TimerHealthResult,
} from "./meterAxes";
import { SampleRing, epochOf } from "./settle";
import { outsideAngular } from "./zoneSafe";

type TimeoutId = ReturnType<typeof setTimeout>;
type IntervalId = ReturnType<typeof setInterval>;

import { isRuntimeInert } from "./lockGate";
let installed = false;
let ownedTimerMethods: Record<string, unknown> = {};
// When true, sampleTimerHealth() is a no-op so a test's seeded samples stay
// intact across a snapshot capture (which samples then reads).
let sampleSuppressedForTests = false;
let origSetTimeout: typeof window.setTimeout | null = null;
let origSetInterval: typeof window.setInterval | null = null;
let origClearTimeout: typeof window.clearTimeout | null = null;
let origClearInterval: typeof window.clearInterval | null = null;

// Outstanding one-shot timeouts (removed when they fire or are cleared) and
// outstanding intervals (removed only when cleared). Both are numeric-id sets
// so memory is bounded by the app's real live-timer count.
const liveTimeouts = new Set<TimeoutId>();
const liveIntervals = new Set<IntervalId>();

/** Fixed-size ring of (t, outstanding) samples for the growth-trend fit. */
const MAX_SAMPLES = 64;
/** @deprecated No longer used: loop delay is measured from the page's own
 *  timeouts (how late each ran), not from capture spacing minus this tick. */
export const EVENT_LOOP_TICK_MS = 2_000;
let sampleTimes: number[] = [];
let sampleCounts: number[] = [];
let lagSamples: number[] = [];
let slowCallbackCount = 0;
let trackingStartedAt = 0;
/** Stamped readings for the settle rule (src/settle.ts), epoch ms:
 *  - timer lag: how late each of the page's own timeouts ran past the delay
 *    it asked for — the real scheduling delay, with no timer of our own;
 *  - slow callbacks: when each callback over the slow floor ran;
 *  - outstanding counts: the live-timer count at each sample. */
const lagRing = new SampleRing(256);
const slowCallbackRing = new SampleRing(256);
const countRing = new SampleRing(128);
/** A timeout whose wait crossed a hidden stretch is throttled by the browser,
 *  not delayed by the page: its lateness is never a loop-delay sample. */
let lastHiddenAt = -Infinity;
let visibilityListener: (() => void) | null = null;
/** Lateness beyond this is a suspended device, not a scheduling delay. */
const MAX_LAG_SAMPLE_MS = 30_000;

function pageHidden(): boolean {
  try {
    return typeof document !== "undefined" && document.visibilityState === "hidden";
  } catch {
    return false;
  }
}

function noteTimerLag(setAt: number, wantMs: number): void {
  if (isRuntimeInert()) return;
  try {
    const runAt = nowMs();
    if (pageHidden() || lastHiddenAt >= setAt) return;
    const lag = runAt - setAt - wantMs;
    if (!Number.isFinite(lag) || lag < 0 || lag > MAX_LAG_SAMPLE_MS) return;
    lagRing.push(epochOf(runAt), Math.round(lag));
  } catch {
    // measurement must never break the page
  }
}

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

function outstanding(): number {
  return liveTimeouts.size + liveIntervals.size;
}

function runTimedCallback(
  handler: (...args: unknown[]) => unknown,
  receiver: unknown,
  args: unknown[],
): unknown {
  if (isRuntimeInert()) return handler.apply(receiver, args);
  const startedAt = nowMs();
  try {
    return handler.apply(receiver, args);
  } finally {
    try {
      const ran = nowMs() - startedAt;
      if (ran > ASYNC_SLOW_CALLBACK_MS) {
        slowCallbackCount++;
        slowCallbackRing.push(epochOf(startedAt), Math.round(ran));
      }
    } catch {
      // timing must never change callback behavior
    }
  }
}

/** Install the timer wrappers once. Guest-safe + idempotent. Returns true when
 *  wrapping succeeded (or was already installed); false when it was impossible
 *  (the axis then stays absent). */
export function installTimerTracking(): boolean {
  if (installed) return true;
  try {
    if (typeof window === "undefined") return false;
    const w = window as Window &
      typeof globalThis & {
        setTimeout: typeof setTimeout;
        setInterval: typeof setInterval;
        clearTimeout: typeof clearTimeout;
        clearInterval: typeof clearInterval;
      };
    if (
      typeof w.setTimeout !== "function" ||
      typeof w.setInterval !== "function" ||
      typeof w.clearTimeout !== "function" ||
      typeof w.clearInterval !== "function"
    ) {
      return false;
    }

    origSetTimeout = w.setTimeout;
    origSetInterval = w.setInterval;
    origClearTimeout = w.clearTimeout;
    origClearInterval = w.clearInterval;

    const realSetTimeout = origSetTimeout;
    const realSetInterval = origSetInterval;
    const realClearTimeout = origClearTimeout;
    const realClearInterval = origClearInterval;

    // setTimeout: wrap the handler so we drop the id from the live set when it
    // fires (a fired one-shot is no longer outstanding), then track its id.
    w.setTimeout = function (
      this: unknown,
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ): TimeoutId {
      if (isRuntimeInert()) return realSetTimeout.apply(this, [handler, timeout, ...args] as unknown as Parameters<typeof setTimeout>);
      let id: TimeoutId;
      if (typeof handler === "function") {
        const setAt = nowMs();
        const wantMs = Math.max(0, Number(timeout) || 0);
        const wrapped = function (this: unknown, ...cbArgs: unknown[]): unknown {
          noteTimerLag(setAt, wantMs);
          try {
            liveTimeouts.delete(id);
          } catch {
            // never let bookkeeping break the timer
          }
          return runTimedCallback(
            handler as (...a: unknown[]) => unknown,
            this,
            cbArgs,
          );
        };
        id = realSetTimeout.apply(this, [
          wrapped,
          timeout,
          ...args,
        ] as unknown as Parameters<typeof setTimeout>);
      } else {
        // String-source timers can't be un-hooked safely; still track the id.
        id = realSetTimeout.apply(this, [
          handler,
          timeout,
          ...args,
        ] as unknown as Parameters<typeof setTimeout>);
      }
      try {
        liveTimeouts.add(id);
      } catch {
        // ignore
      }
      return id;
      // Through `unknown`: with Node's types loaded beside the DOM's (a new
      // Angular project with server rendering has both), `typeof setTimeout`
      // is Node's overload set plus a `__promisify__` member, and a direct
      // cast from one browser-shaped function fails the app's type check.
    } as unknown as typeof setTimeout;

    w.setInterval = function (
      this: unknown,
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ): IntervalId {
      if (isRuntimeInert()) return realSetInterval.apply(this, [handler, timeout, ...args] as unknown as Parameters<typeof setInterval>);
      const wrapped =
        typeof handler === "function"
          ? function (this: unknown, ...cbArgs: unknown[]): unknown {
              return runTimedCallback(
                handler as (...a: unknown[]) => unknown,
                this,
                cbArgs,
              );
            }
          : handler;
      const id = realSetInterval.apply(this, [
        wrapped,
        timeout,
        ...args,
      ] as unknown as Parameters<typeof setInterval>);
      try {
        liveIntervals.add(id);
      } catch {
        // ignore
      }
      return id;
    } as unknown as typeof setInterval;

    w.clearTimeout = function (this: unknown, id?: TimeoutId): void {
      try {
        if (id !== undefined) liveTimeouts.delete(id);
      } catch {
        // ignore
      }
      return realClearTimeout.apply(this, [id] as unknown as Parameters<
        typeof clearTimeout
      >);
    } as typeof clearTimeout;

    w.clearInterval = function (this: unknown, id?: IntervalId): void {
      try {
        if (id !== undefined) liveIntervals.delete(id);
      } catch {
        // ignore
      }
      return realClearInterval.apply(this, [id] as unknown as Parameters<
        typeof clearInterval
      >);
    } as typeof clearInterval;

    installed = true;
    ownedTimerMethods = {
      setTimeout: w.setTimeout, setInterval: w.setInterval,
      clearTimeout: w.clearTimeout, clearInterval: w.clearInterval,
    };
    try {
      if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
        const onVisibility = (): void => {
          if (pageHidden()) lastHiddenAt = nowMs();
        };
        visibilityListener = onVisibility;
        outsideAngular(() => document.addEventListener("visibilitychange", onVisibility));
        if (pageHidden()) lastHiddenAt = nowMs();
      }
    } catch {
      visibilityListener = null;
    }
    // Seed the first sample so the trend has an anchor from t0.
    sampleTimes = [nowMs()];
    sampleCounts = [outstanding()];
    countRing.push(epochOf(sampleTimes[0]), sampleCounts[0]);
    lagSamples = [];
    slowCallbackCount = 0;
    trackingStartedAt = sampleTimes[0];
    return true;
  } catch {
    // Wrapping failed — restore whatever we swapped and stay absent.
    uninstallTimerTracking();
    return false;
  }
}

/** Restore the original timer functions and clear state. Safe to call
 *  repeatedly; called when telemetry is disabled/disconnected or in tests. */
export function uninstallTimerTracking(): void {
  try {
    if (typeof window !== "undefined") {
      const w = window as unknown as Record<string, unknown>;
      if (origSetTimeout && w["setTimeout"] === ownedTimerMethods["setTimeout"]) w["setTimeout"] = origSetTimeout;
      if (origSetInterval && w["setInterval"] === ownedTimerMethods["setInterval"]) w["setInterval"] = origSetInterval;
      if (origClearTimeout && w["clearTimeout"] === ownedTimerMethods["clearTimeout"]) w["clearTimeout"] = origClearTimeout;
      if (origClearInterval && w["clearInterval"] === ownedTimerMethods["clearInterval"]) w["clearInterval"] = origClearInterval;
    }
  } catch {
    // ignore
  }
  origSetTimeout = null;
  origSetInterval = null;
  origClearTimeout = null;
  origClearInterval = null;
  try {
    if (visibilityListener && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", visibilityListener);
    }
  } catch {
    // ignore
  }
  visibilityListener = null;
  lastHiddenAt = -Infinity;
  liveTimeouts.clear();
  liveIntervals.clear();
  sampleTimes = [];
  sampleCounts = [];
  lagSamples = [];
  lagRing.clear();
  slowCallbackRing.clear();
  countRing.clear();
  slowCallbackCount = 0;
  trackingStartedAt = 0;
  installed = false;
  sampleSuppressedForTests = false;
}

/** Record one sample of the current outstanding-timer count. Cheap; meant to be
 *  driven off an EXISTING kit cadence (the bubble refresh / snapshot flush),
 *  never a new timer. Guarded; never throws. */
export function sampleTimerHealth(): void {
  if (isRuntimeInert()) return;
  if (!installed || sampleSuppressedForTests) return;
  try {
    const now = nowMs();
    // (Loop delay is no longer derived here: capture spacing minus a fixed
    // tick measured how often a snapshot was taken, not how late the loop
    // ran. It comes from the page's own timeouts — noteTimerLag.)
    sampleTimes.push(now);
    sampleCounts.push(outstanding());
    countRing.push(epochOf(now), sampleCounts[sampleCounts.length - 1]);
    if (sampleTimes.length > MAX_SAMPLES) {
      sampleTimes.splice(0, sampleTimes.length - MAX_SAMPLES);
      sampleCounts.splice(0, sampleCounts.length - MAX_SAMPLES);
    }
  } catch {
    // ignore
  }
}

/** Least-squares growth slope (handles per ms) of the sampled outstanding
 *  count. 0 when fewer than 2 samples or a degenerate time span. */
function growthPerMs(): number {
  const n = sampleTimes.length;
  if (n < 2) return 0;
  const t0 = sampleTimes[0];
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = sampleTimes[i] - t0;
    const y = sampleCounts[i];
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return 0;
  return (n * sxy - sx * sy) / denom;
}

/** Current Timer Health reading. Pending (null score) until tracking is
 *  installed AND enough samples span enough time — never a fabricated reading.
 *  When tracking was never installed (wrapping impossible) it stays pending, so
 *  the snapshot omits the axis. */
export function readTimerHealth(): TimerHealthResult {
  if (!installed) {
    return { score: null, rating: "pending", timers: 0, growthPerMin: null };
  }
  const elapsedMs =
    sampleTimes.length >= 2
      ? sampleTimes[sampleTimes.length - 1] - sampleTimes[0]
      : 0;
  const growthPerMin = growthPerMs() * 60_000;
  return computeTimerHealth({
    outstanding: outstanding(),
    growthPerMin,
    sampleCount: sampleTimes.length,
    elapsedMs,
  });
}

export function readAsyncSlowCallbacks(): AsyncSlowCallbacksResult {
  return computeAsyncSlowCallbacks({
    installed,
    count: slowCallbackCount,
    windowMs: trackingStartedAt > 0 ? Math.max(0, nowMs() - trackingStartedAt) : 0,
  });
}

export function readEventLoopLag(): EventLoopLagResult {
  const stamped = lagRing.all();
  const samples = stamped.length > 0 ? stamped.map((x) => x.v) : lagSamples;
  const windowMs =
    stamped.length >= 2
      ? stamped[stamped.length - 1].t - stamped[0].t
      : sampleTimes.length >= 2
        ? sampleTimes[sampleTimes.length - 1] - sampleTimes[0]
        : 0;
  return computeEventLoopLag({ samples, windowMs });
}

/** Stamped timer lateness (epoch ms, ms late), oldest first. */
export function getTimerLagSamples(): ReadonlyArray<{ t: number; v: number }> {
  return lagRing.all();
}

/** Stamped slow callbacks (epoch ms at start, ms run), oldest first. */
export function getSlowCallbackSamples(): ReadonlyArray<{ t: number; v: number }> {
  return slowCallbackRing.all();
}

/** Stamped outstanding-timer counts, oldest first. */
export function getTimerCountSamples(): ReadonlyArray<{ t: number; v: number }> {
  return countRing.all();
}

/** @internal test hook — seed the stamped rings directly (epoch ms). */
export function _setStampedTimerSamplesForTests(opts: {
  lag?: ReadonlyArray<{ t: number; v: number }>;
  slow?: ReadonlyArray<{ t: number; v: number }>;
  counts?: ReadonlyArray<{ t: number; v: number }>;
}): void {
  installed = true;
  sampleSuppressedForTests = true;
  if (opts.lag) {
    lagRing.clear();
    for (const x of opts.lag) lagRing.push(x.t, x.v);
  }
  if (opts.slow) {
    slowCallbackRing.clear();
    for (const x of opts.slow) slowCallbackRing.push(x.t, x.v);
  }
  if (opts.counts) {
    countRing.clear();
    for (const x of opts.counts) countRing.push(x.t, x.v);
  }
}

/** True once the wrappers are installed (guards double-install at the caller). */
export function isTimerTrackingInstalled(): boolean {
  return installed;
}

/** @internal test hook — drive the sampler deterministically without live
 *  timers or wall-clock. Marks tracking "installed" so readTimerHealth scores.
 *  Each entry is a (relative-ms, outstanding-count) sample. */
export function _setTimerSamplesForTests(
  samples: Array<{ tMs: number; count: number }>,
): void {
  installed = true;
  sampleSuppressedForTests = true;
  sampleTimes = samples.map((s) => s.tMs);
  sampleCounts = samples.map((s) => s.count);
}

export function _setSchedulingSamplesForTests(opts: {
  lagSamples: number[];
  windowMs: number;
  slowCallbackCount: number;
}): void {
  installed = true;
  sampleSuppressedForTests = true;
  lagSamples = opts.lagSamples.slice(-MAX_SAMPLES);
  const end = nowMs();
  sampleTimes = [end - opts.windowMs, end];
  sampleCounts = [0, 0];
  trackingStartedAt = end - opts.windowMs;
  slowCallbackCount = opts.slowCallbackCount;
}

/** @internal test hook — count of currently-outstanding tracked handles. */
export function _outstandingForTests(): number {
  return outstanding();
}
