/** Swallowed-errors tracker — the input for the Near-Miss Rate axis.
 *
 * Web parity for the Python kit's `swallowedErrors` axis
 * (`lib/boosthis-py/boosthis/extra_meters.py`): errors the HOST app LOGGED at
 * error level but did NOT crash on — a near miss. Every band, gate, and
 * rounding rule mirrors that canonical source so the same number means the
 * same thing in every runtime.
 *
 * OBSERVATION POINT (browser): the only honest analogue of Python's ERROR-level
 * log record is `console.error` — the browser's error-level log call. We CHAIN
 * it (never replace): the host's original `console.error` is captured and
 * ALWAYS called first, its return value is passed straight back, and we only
 * record a TIMESTAMP on the side. We never add or remove a host log handler,
 * never change formatting or output, and never read the arguments. Window
 * `error` / `unhandledrejection` events are NOT counted here — those are
 * crashes and the crash reporter already owns them.
 *
 * GUEST SAFETY (this runs inside a customer's page):
 *   - the original `console.error` is kept and ALWAYS called through first,
 *   - the wrapper never throws (all bookkeeping is guarded),
 *   - the return value and `this` are preserved exactly,
 *   - the original is restored on uninstall,
 *   - installation is idempotent (install-only-once).
 * If wrapping is impossible (no console, non-function `console.error`),
 * install() is a no-op and the axis stays absent (the snapshot omits it) — we
 * never guess.
 *
 * We EXCLUDE Boosthis's own `console.error` calls so we never count ourselves:
 * every call the kit routes through the captured original is invisible to the
 * counter (only the wrapped, host-facing `console.error` records a timestamp).
 *
 * PRIVACY: TIMESTAMPS ONLY. The message, any argument, logger name, or stack is
 * never read or stored — the ring holds at most SWALLOWED_RING_CAP numbers.
 *
 * ONE ERROR, COUNTED ONCE. An Angular app routes every error it catches — and,
 * since Angular 20, every uncaught one the window sees — through its
 * ErrorHandler, whose default logs it with `console.error`. The same error can
 * therefore arrive here as a console call AND as a crash (or as a caught
 * error the app handed to `reportCaughtError` / `reportRenderError`). React,
 * Next.js, Vue and SvelteKit log the errors they catch the same way. So the
 * counter remembers WHICH
 * error objects it has already counted: by identity, in a WeakMap that holds
 * no error alive and is never read for content. A console call carrying an
 * error already counted — as a near miss or as a crash — counts nothing, and a
 * crash takes back the near miss its own error was first counted as. A thrown
 * primitive has no identity to remember, so the last one is compared by `===`
 * for one second and then let go.
 */

import { computeSwallowedErrors, type SwallowedErrorsResult } from "./meterAxes";

/* ─── Gates + bands (copied from Python, unchanged) ──────────────────────── */

/** good band: 1 logged-error/hour. */
export const SWALLOWED_GOOD_PER_HOUR = 1.0;
/** poor band: 60 logged-errors/hour. */
export const SWALLOWED_POOR_PER_HOUR = 60.0;
/** No clean bill until at least 5 minutes have been watched. */
export const SWALLOWED_MIN_WINDOW_MS = 5 * 60_000;
/** Trailing window capped at 60 minutes. */
export const SWALLOWED_WINDOW_MS = 60 * 60_000;
/** Ring holds at most this many timestamps (timestamps ONLY). */
export const SWALLOWED_RING_CAP = 400;

let installed = false;
let armed = false;
let startedAt = 0;
let origConsoleError: ((...args: unknown[]) => unknown) | null = null;
let ourConsoleError: ((...args: unknown[]) => unknown) | null = null;

/** Fixed-size ring of error-record timestamps (ms). TIMESTAMPS ONLY. */
let swallowedTs: number[] = [];

/** Args observers piggybacking the SAME wrapper (e.g. leakWatch's bounded
 *  scan). We NEVER add a second console.error wrapper — additional monitors
 *  subscribe here so the kit's own logging exclusion + reentrancy are reused.
 *  Observers get the host-facing args ONLY (never our own passthrough calls),
 *  are called on the side AFTER the host's original, and must never throw. */
let argsObservers: Array<(args: unknown[]) => void> = [];

function nowMs(): number {
  return Date.now();
}

/** Subscribe to host-facing `console.error` arg lists observed by the SAME
 *  chained wrapper (no second hook). Returns an unsubscribe function; a no-op
 *  unsubscribe when the chain is not installed. The observer is invoked on the
 *  side after the host original, wrapped so it can never throw into the host. */
export function onConsoleErrorArgs(
  observer: (args: unknown[]) => void,
): () => void {
  argsObservers.push(observer);
  return () => {
    argsObservers = argsObservers.filter((o) => o !== observer);
  };
}

/** Fan an observed host-facing arg list out to the side observers. Guarded so a
 *  misbehaving observer can never break the host's logging call. */
function notifyArgsObservers(args: unknown[]): void {
  try {
    if (!armed) return;
    for (const o of argsObservers) {
      try {
        o(args);
      } catch {
        // one observer failing must never affect the host or other observers
      }
    }
  } catch {
    // never let bookkeeping break the host's logging call
  }
}

/** Record one host `console.error` call — a TIMESTAMP only. Never the message,
 *  argument, logger name, or stack. Never raises into the host's call.
 *  Returns the timestamp recorded, or null when nothing was. */
function noteError(): number | null {
  try {
    if (!armed) return null;
    const at = nowMs();
    swallowedTs.push(at);
    if (swallowedTs.length > SWALLOWED_RING_CAP) {
      swallowedTs.splice(0, swallowedTs.length - SWALLOWED_RING_CAP);
    }
    return at;
  } catch {
    // never let bookkeeping break the host's logging call
    return null;
  }
}

/* ─── One error, counted once ─────────────────────────────────────────────── */

/** Error objects counted as a near miss, with the timestamp they were counted
 *  at — so a crash for the same error can take that one count back. */
let countedAt: WeakMap<object, number> = new WeakMap();
/** Error objects the crash reporter recorded as crashes. */
let countedAsCrash: WeakSet<object> = new WeakSet();
/** The last thrown primitive seen, for one second. */
let lastPrimitive: { value: unknown; at: number; crash: boolean; ts: number | null } | null = null;
/** How long a thrown primitive is remembered. */
export const PRIMITIVE_DEDUPE_MS = 1000;

function isObjectLike(v: unknown): v is object {
  return v !== null && (typeof v === "object" || typeof v === "function");
}

/** An error object, by shape: an `Error`, or anything carrying a string
 *  `message` and `stack` (an error from another frame fails `instanceof`). */
function isErrorLike(v: unknown): v is object {
  try {
    if (!isObjectLike(v)) return false;
    if (v instanceof Error) return true;
    const r = v as Record<string, unknown>;
    return typeof r["message"] === "string" && typeof r["stack"] === "string";
  } catch {
    return false;
  }
}

function primitiveFresh(v: unknown): boolean {
  return (
    lastPrimitive !== null &&
    lastPrimitive.value === v &&
    nowMs() - lastPrimitive.at <= PRIMITIVE_DEDUPE_MS
  );
}

/** Has one of these console arguments already been counted? */
function alreadyCounted(args: readonly unknown[]): boolean {
  try {
    for (const a of args) {
      if (isObjectLike(a)) {
        if (countedAt.has(a) || countedAsCrash.has(a)) return true;
      } else if (lastPrimitive !== null && a !== undefined && primitiveFresh(a)) {
        return true;
      }
    }
  } catch {
    // an argument that cannot be looked at is simply not a known one
  }
  return false;
}

/** Remember the error objects a counted console call carried. */
function rememberCounted(args: readonly unknown[], at: number): void {
  try {
    for (const a of args) {
      if (isErrorLike(a)) countedAt.set(a, at);
    }
  } catch {
    // never let bookkeeping break the host's logging call
  }
}

/** Take one counted timestamp back out of the ring. */
function forgetTimestamp(ts: number): void {
  const i = swallowedTs.lastIndexOf(ts);
  if (i >= 0) swallowedTs.splice(i, 1);
}

/**
 * The app handed this error to the kit as one it caught (`reportCaughtError`
 * from a framework's own error hook, `reportRenderError` from an Angular
 * ErrorHandler): count it once as a near miss, and remember it, so the
 * `console.error` the app's own handler logs for it next counts nothing. An
 * error already counted — or recorded as a crash — counts nothing more. The
 * crash reporter sends the same error, named, as a report of its own kind
 * (`caughtByPage`); that report is never a crash and this count is the only
 * place the error is counted.
 */
export function noteCaughtError(error: unknown): void {
  try {
    if (!armed) return;
    if (isObjectLike(error)) {
      if (countedAt.has(error) || countedAsCrash.has(error)) return;
      const at = noteError();
      if (at !== null) countedAt.set(error, at);
      return;
    }
    if (error === undefined || primitiveFresh(error)) return;
    const at = noteError();
    lastPrimitive = { value: error, at: nowMs(), crash: false, ts: at };
  } catch {
    // never let bookkeeping break the host
  }
}

/**
 * Was this exact error object already recorded as a crash? Read by the crash
 * reporter before it sends an error the app handed over as caught: React 18
 * in development, and Angular 20 for every error the window sees, deliver the
 * SAME error both ways, and one error is one report. Identity only — the
 * error is never read.
 */
export function wasRecordedAsCrash(error: unknown): boolean {
  try {
    return isObjectLike(error) && countedAsCrash.has(error);
  } catch {
    return false;
  }
}

/**
 * The crash reporter recorded this error as a crash. A crash is not a near
 * miss: if the same error was already counted as one (the app's handler
 * logged it before the window's error event reached the kit), that count is
 * taken back; and any console call for it from here on counts nothing.
 */
export function noteCrashedError(error: unknown): void {
  try {
    if (isObjectLike(error)) {
      const ts = countedAt.get(error);
      if (ts !== undefined) {
        forgetTimestamp(ts);
        countedAt.delete(error);
      }
      countedAsCrash.add(error);
      return;
    }
    if (error === undefined) return;
    if (primitiveFresh(error) && lastPrimitive !== null) {
      if (lastPrimitive.ts !== null && !lastPrimitive.crash) {
        forgetTimestamp(lastPrimitive.ts);
      }
      lastPrimitive = { value: error, at: nowMs(), crash: true, ts: null };
      return;
    }
    lastPrimitive = { value: error, at: nowMs(), crash: true, ts: null };
  } catch {
    // never let bookkeeping break the host
  }
}

/** Install the `console.error` chain once. Guest-safe + idempotent. Returns
 *  true when chaining succeeded (or was already installed); false when it was
 *  impossible (the axis then stays absent). */
export function installSwallowedErrors(): boolean {
  if (installed) return true;
  try {
    const c =
      typeof console !== "undefined"
        ? (console as unknown as Record<string, unknown>)
        : undefined;
    if (!c || typeof c["error"] !== "function") {
      return false;
    }

    const orig = c["error"] as (...args: unknown[]) => unknown;
    const realConsoleError = orig;

    // Chain, never replace: call the host's original FIRST, observe on the
    // side (timestamp only), then return exactly what the host expected.
    const wrapped = function (this: unknown, ...args: unknown[]): unknown {
      const result = realConsoleError.apply(this, args);
      // One error is counted once: a call carrying an error already counted
      // (a caught error the app handed over, a crash, an earlier log of the
      // same error) records nothing.
      if (!alreadyCounted(args)) {
        const at = noteError();
        if (at !== null) rememberCounted(args, at);
      }
      // Fan the SAME observed args out to side observers (e.g. leakWatch's
      // bounded scan) — never a second wrapper. Our own passthrough calls go
      // through the captured original and so are excluded here too.
      notifyArgsObservers(args);
      return result;
    };

    c["error"] = wrapped;
    origConsoleError = orig;
    ourConsoleError = wrapped;
    installed = true;
    armed = true;
    startedAt = nowMs();
    swallowedTs = [];
    return true;
  } catch {
    // Chaining failed — restore whatever we swapped and stay absent.
    uninstallSwallowedErrors();
    return false;
  }
}

/** Restore the host's `console.error` and clear state. If another library
 *  chained ON TOP of ours we leave the chain alone — unhooking would drop THEIR
 *  wrapper too; ours is already inert because `armed` is false. Safe to call
 *  repeatedly. */
export function uninstallSwallowedErrors(): void {
  try {
    if (
      typeof console !== "undefined" &&
      origConsoleError !== null &&
      ourConsoleError !== null
    ) {
      const c = console as unknown as Record<string, unknown>;
      if (c["error"] === ourConsoleError) {
        c["error"] = origConsoleError;
      }
    }
  } catch {
    // ignore
  }
  origConsoleError = null;
  ourConsoleError = null;
  swallowedTs = [];
  startedAt = 0;
  installed = false;
  armed = false;
  countedAt = new WeakMap();
  countedAsCrash = new WeakSet();
  lastPrimitive = null;
}

/** Call the HOST's original `console.error` (never our wrapper), so Boosthis's
 *  own error logging is EXCLUDED from the near-miss counter. Falls back to the
 *  live `console.error` when the chain was never installed. Never throws. */
export function ourConsoleErrorPassthrough(...args: unknown[]): void {
  try {
    if (origConsoleError) {
      origConsoleError.apply(console, args);
      return;
    }
    if (typeof console !== "undefined" && typeof console.error === "function") {
      // Chain not installed — nothing is counting, so a direct call is safe.
      (console.error as (...a: unknown[]) => unknown).apply(console, args);
    }
  } catch {
    // logging must never break the caller
  }
}

/** Current Near-Miss reading. Pending (null score) until the chain is armed AND
 *  the trailing window reaches the 5-minute minimum — never a fabricated
 *  reading. When chaining was never installed (impossible) it stays pending, so
 *  the snapshot omits the axis. */
export function readSwallowedErrors(): SwallowedErrorsResult {
  if (!armed) {
    return { score: null, rating: "pending", count: 0, perHour: null, windowMin: null };
  }
  const now = nowMs();
  const windowMs = Math.min(now - startedAt, SWALLOWED_WINDOW_MS);
  const cutoff = now - windowMs;
  const count = swallowedTs.reduce((acc, t) => (t >= cutoff ? acc + 1 : acc), 0);
  return computeSwallowedErrors({ count, windowMs });
}

/** True once the chain is installed (guards double-install at the caller). */
export function isSwallowedErrorsInstalled(): boolean {
  return installed;
}

/** @internal test hook — seed the ring + window deterministically without a
 *  live `console.error` or wall-clock. Marks the axis "armed" so
 *  readSwallowedErrors scores. `tsAgoMs` entries are ms-before-now. */
export function _setSwallowedErrorsForTests(opts: {
  windowElapsedMs: number;
  tsAgoMs: number[];
}): void {
  armed = true;
  installed = true;
  const now = nowMs();
  startedAt = now - opts.windowElapsedMs;
  swallowedTs = opts.tsAgoMs.map((ago) => now - ago);
}

/** @internal test hook — number of timestamps currently held in the ring. */
export function _swallowedRingSizeForTests(): number {
  return swallowedTs.length;
}
