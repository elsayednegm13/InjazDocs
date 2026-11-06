/* ─────────────────────────────────────────────────────────────────────────
 * THE KIT'S OWN WORK RUNS OUTSIDE THE HOST'S ZONE.
 *
 * An Angular app that loads zone.js decides when it is "stable" — finished
 * starting, ready for hydration, ready for its service worker — by watching
 * every timer, listener and request scheduled from inside its zone. It also
 * runs change detection after each of them. A kit that schedules a recurring
 * timer from inside that zone therefore keeps the app from ever becoming
 * stable, and makes every one of its own ticks re-check the whole page.
 *
 * So every place this kit schedules work of its OWN — a timer, an interval,
 * an animation frame, a microtask, a listener, an observer — goes through the
 * helpers below, which schedule it in zone.js's root zone. Root-zone work is
 * invisible to the app's zone: it never holds stability back and never
 * triggers change detection. Without zone.js (a zoneless Angular app, or any
 * other site) the helpers call straight through, unchanged.
 *
 * WHAT STAYS IN THE APP'S ZONE, on purpose: the app's own callbacks. When the
 * kit wraps the app's `fetch`, `XMLHttpRequest` or `history` calls, the app's
 * promise still resolves, and its listeners still run, in whatever zone the
 * app made the call from — the kit never moves the app's work.
 *
 * A guard (`__tests__/zone-safe-census.test.ts`) lists every place in this
 * kit that calls a scheduling primitive directly. A new timer that bypasses
 * these helpers fails it.
 *
 * A leaf: this module imports nothing, so anything may import it.
 * ───────────────────────────────────────────────────────────────────────── */

type ZoneRunner = { run<T>(fn: () => T): T };

/** zone.js's root zone, when zone.js is on the page; null otherwise. Read on
 *  every call rather than cached: zone.js may load after the kit module is
 *  evaluated (an app importing the kit before its polyfills). */
function rootZone(): ZoneRunner | null {
  try {
    const zone = (globalThis as Record<string, unknown>)["Zone"];
    if (zone === null || (typeof zone !== "function" && typeof zone !== "object")) {
      return null;
    }
    const root = (zone as Record<string, unknown>)["root"];
    if (root === null || typeof root !== "object") return null;
    if (typeof (root as Record<string, unknown>)["run"] !== "function") return null;
    return root as ZoneRunner;
  } catch {
    return null;
  }
}

/**
 * Run `fn` outside the host's zone (in zone.js's root zone), or simply run it
 * where there is no zone.js. Anything `fn` schedules inherits that zone, so a
 * kit entry point wrapped in this cannot leave work behind in the app's zone.
 */
export function outsideAngular<T>(fn: () => T): T {
  const root = rootZone();
  if (root === null) return fn();
  return root.run(fn);
}

/** True when zone.js is on the page — the one case these helpers change
 *  anything. Exposed for the panel's own readout and for tests. */
export function zoneJsPresent(): boolean {
  return rootZone() !== null;
}

/** `setTimeout`, for the kit's own work. Calls whatever `setTimeout` is
 *  installed NOW (a test's fake clock, the timer meter's wrapper), so this
 *  helper changes the zone and nothing else. */
export function kitTimeout(
  fn: (...args: never[]) => void,
  ms?: number,
): ReturnType<typeof setTimeout> {
  return outsideAngular(() => setTimeout(fn, ms));
}

/** `setInterval`, for the kit's own work. */
export function kitInterval(
  fn: (...args: never[]) => void,
  ms: number,
): ReturnType<typeof setInterval> {
  return outsideAngular(() => setInterval(fn, ms));
}

/** `requestAnimationFrame`, for the kit's own work. */
export function kitFrame(fn: (t: number) => void): number {
  return outsideAngular(() => requestAnimationFrame(fn));
}

/** `queueMicrotask`, for the kit's own work. */
export function kitMicrotask(fn: () => void): void {
  outsideAngular(() => queueMicrotask(fn));
}

/** Anything a listener can be added to. Typed loosely on purpose: the kit
 *  listens on the window, the document, its own elements and abort signals. */
export interface ListenTarget {
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
}

/** `addEventListener`, for the kit's own listeners. The listener then runs
 *  outside the host's zone, so a scroll or click the kit counts never makes
 *  the app re-check its page. Removing it needs no helper: zone.js finds a
 *  listener to remove whichever zone added it. */
export function kitListen(
  target: ListenTarget,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
): void {
  outsideAngular(() => target.addEventListener(type, listener, options));
}

/** Build an observer (Mutation, Performance) for the kit's own use. zone.js
 *  binds an observer's callback to the zone it was CONSTRUCTED in, so
 *  constructing it here keeps every callback outside the host's zone. */
export function kitObserver<T>(make: () => T): T {
  return outsideAngular(make);
}
