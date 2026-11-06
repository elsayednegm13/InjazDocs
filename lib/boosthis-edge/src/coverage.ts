/* ─── What this kit reached in this worker, and what it did not ───────────
 *
 * `withBoosthis` instruments exactly one export: `fetch`. Every other entry
 * point a module worker can declare — the queue consumer, the cron handler,
 * the email and tail handlers — is passed through untouched, on purpose. The
 * wrapper has always KNOWN this; it just never said so, so a developer whose
 * queue consumer does most of the real work saw a page of green request meters
 * and reasonably concluded we were watching all of it.
 *
 * This module is a READER over that fact plus the counters the isolate already
 * keeps. It patches nothing and starts nothing.
 *
 * Three rules it exists to keep:
 *
 *   1. POSITIVE EVIDENCE BOTH WAYS. A surface is WATCHED only once something
 *      has really come through it, and UNWATCHED only when we genuinely found
 *      the entry point declared on this worker. A worker with no queue consumer
 *      has no queue gap. No evidence either way means the surface appears in
 *      neither list, and the server renders it as "we have not looked".
 *   2. NO CUSTOMER NAMES. Only terms from `watchableSurfaces.ts` and counts
 *      leave the isolate. The developer's own handler names never travel.
 *   3. NO PERCENTAGES. We do not know the denominator.
 *
 * The gap here is reported as `no-adapter-yet`, NOT `not-wrapped`. There is no
 * automatic attachment for these exports that the developer could have
 * forgotten to switch on, so "wire it up" would be a next step nobody can
 * follow — the dead end this whole answer exists to remove. `no-adapter-yet`
 * is the reason whose way out is the kit's hand mark, and `boosthisEntryPoint`
 * is that mark. A handler carrying it is measured, so it is no longer a gap.
 */

import { readState } from "./collector";
import { getAiStats, getDbStats, getDependencyStats } from "./outbound";
import type {
  CoverageInventory,
  SurfaceGap,
  WatchableSurface,
} from "./watchableSurfaces";

/**
 * The non-`fetch` entry points a Cloudflare module worker can declare.
 *
 * A fixed, code-defined list. The name is used to look for a function on the
 * worker object, and is the only vocabulary `boosthisEntryPoint` accepts — it
 * is never joined to anything the developer wrote, and only the COUNT of how
 * many were found unmarked ever travels.
 *
 * Durable Objects are deliberately absent: they are separate named exports of
 * the module, not properties of the default export, so this wrapper never sees
 * them and must not claim to have looked.
 */
export const NON_FETCH_ENTRY_POINTS = [
  "email",
  "queue",
  "scheduled",
  "tail",
  "trace",
] as const;

/** One of the entry points above. The closed vocabulary for the hand mark. */
export type EntryPointKind = (typeof NON_FETCH_ENTRY_POINTS)[number];

/**
 * The mark `boosthisEntryPoint` leaves on a handler it wraps.
 *
 * A plain non-enumerable property rather than a Symbol, because a worker is
 * usually assembled as an object literal and this has to survive being read
 * back off it. Non-enumerable so it never shows up in the developer's own
 * iteration over their worker.
 */
const MEASURED_MARK = "__boosthisMeasuredEntryPoint";

/** Stamp a wrapped handler so the reader below knows it is already measured. */
export function markEntryPointMeasured<F>(fn: F): F {
  try {
    Object.defineProperty(fn as object, MEASURED_MARK, {
      value: true,
      enumerable: false,
      configurable: true,
    });
  } catch {
    /* a frozen function is still measured; it just cannot carry the stamp */
  }
  return fn;
}

function isMeasured(fn: unknown): boolean {
  try {
    return (fn as Record<string, unknown>)[MEASURED_MARK] === true;
  } catch {
    return false;
  }
}

/** Non-`fetch` entry points this worker declared and did NOT hand-mark. */
let unmarkedEntryPoints = 0;

/**
 * Hand-marked entry-point runs that really happened.
 *
 * Wrapping a handler is a promise; a run is the proof. Nothing is reported as
 * watched off the wrapping alone — that is the same positive-evidence rule the
 * rest of this reader keeps.
 */
let measuredEntryPointRuns = 0;

/** Count one run of a hand-marked entry point. */
export function noteEntryPointRun(): void {
  measuredEntryPointRuns += 1;
}

/**
 * Record what else the wrapped worker exports.
 *
 * Called by `withBoosthis` with the object the developer handed us, which is
 * the only moment this kit is ever shown the whole worker. Never throws: a
 * getter on an exotic object must not cost the developer their wrapper.
 */
export function noteWorkerEntryPoints(worker: unknown): void {
  try {
    if (!worker || typeof worker !== "object") return;
    let found = 0;
    for (const name of NON_FETCH_ENTRY_POINTS) {
      const fn = (worker as Record<string, unknown>)[name];
      if (typeof fn !== "function") continue;
      // A hand-marked handler is being measured, so it is not a gap. Reporting
      // it would name a problem the developer has already closed.
      if (isMeasured(fn)) continue;
      found++;
    }
    unmarkedEntryPoints = found;
  } catch {
    /* observing must never disturb the host */
  }
}

/** What this isolate is attached to, and what it found and cannot watch. */
export function coverageInventory(): CoverageInventory {
  const watched: WatchableSurface[] = [];
  const unwatched: SurfaceGap[] = [];

  try {
    // A hand-marked entry-point run is recorded as a unit of work through the
    // same collector a request uses, so it lands in the same counter. Take it
    // back out here: a worker whose only traffic arrives on a queue has NOT
    // demonstrated that its request handling is watched, and saying so would
    // manufacture exactly the false clean bill of health this reader exists to
    // prevent.
    if (readState().requests - measuredEntryPointRuns > 0)
      watched.push("request-handling");
  } catch {
    /* a blind reader must not cost the whole inventory */
  }

  // An isolate's only way out is `fetch`, and this kit watches it — a blind
  // spot here would be a fiction, which is why the outbound readings hard-code
  // `unwatchedClients: 0`. So there is never a gap; there is only evidence
  // that calls have really flowed through the observer, or silence.
  try {
    const calls =
      getAiStats().callCount +
      getDbStats().callCount +
      getDependencyStats().callCount;
    if (calls > 0) {
      watched.push("outbound-calls");
      if (getDbStats().callCount > 0) watched.push("database-work");
    }
  } catch {
    /* as above */
  }

  if (measuredEntryPointRuns > 0) watched.push("non-http-entry-points");

  if (unmarkedEntryPoints > 0) {
    unwatched.push({
      surface: "non-http-entry-points",
      reason: "no-adapter-yet",
      detected: unmarkedEntryPoints,
    });
  }

  return {
    watched: watched.sort(),
    unwatched: unwatched
      .slice()
      .sort((a, b) =>
        a.surface === b.surface
          ? a.reason.localeCompare(b.reason)
          : a.surface.localeCompare(b.surface),
      ),
  };
}

/** THE LOCK RULE (docs/kit-lock-rule.md): forget the runs counted. What the
 *  worker declares stays — that is the developer's code, not a reading. */
export function clearEntryPointRuns(): void {
  measuredEntryPointRuns = 0;
}

/** Test seam: reset the per-isolate state a real isolate gets for free. */
export function _resetCoverageForTests(): void {
  unmarkedEntryPoints = 0;
  measuredEntryPointRuns = 0;
}
