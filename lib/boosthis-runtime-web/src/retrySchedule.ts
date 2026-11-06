/**
 * THE ONE SCHEDULE A CALL THAT FAILED IS TRIED AGAIN ON.
 *
 * Every retry this kit makes after a call that got no usable answer — a
 * registration, the first verdict once its short burst is over, a credential
 * renewal — waits on this ladder: 15 s, 45 s, 2 min, 5 min, then every 5 min.
 * The contract every kit keeps is docs/kit-call-recovery.md.
 *
 * In its own module, with no timers and no imports, so the registration
 * (telemetry.ts) and the check-in (killSwitch.ts) read the SAME steps without
 * importing each other.
 */

/**
 * The widening ladder a registration that never completed is chased on.
 *
 * Exported for one reason: it is the HORIZON the kit promises a developer
 * when it says a failed registration is not final. A ladder buried inside
 * `enableTelemetry` could be lengthened without anyone noticing that the
 * sentence still says ten minutes, which is the same class of mistake as the
 * 36-second verdict this wording replaced — a promise made on one surface and
 * kept somewhere else entirely. A test holds the two together.
 *
 * Cumulative: 15s, 1m, 3m, 8m. Quick enough to catch the common brief outage,
 * slow enough that a page left open all day on a dead network costs almost
 * nothing. The last step repeats for as long as the call keeps failing.
 */
export const CONSENT_CHASE_LADDER_MS = [15_000, 45_000, 120_000, 300_000];

/** The spread every wait is multiplied by: a factor between 0.9 and 1.1.
 *  Pages that lost the same network get it back in the same second, and
 *  without the spread every one of them would ask again in that same second
 *  too. */
function defaultSpread(): number {
  return 0.9 + Math.random() * 0.2;
}

let spread: () => number = defaultSpread;

/** Test-only: replace the spread (return 1 for exact waits); null restores. */
export function _setRetrySpreadForTests(fn: (() => number) | null): void {
  spread = fn ?? defaultSpread;
}

/**
 * How long to wait before attempt `step` (0 = the first retry), spread.
 * Past the end of the ladder the last step repeats. Never throws: a broken
 * spread falls back to the exact step.
 */
export function retryWaitMs(step: number): number {
  const last = CONSENT_CHASE_LADDER_MS.length - 1;
  const idx = Math.min(Math.max(0, Math.floor(step) || 0), last);
  const base = CONSENT_CHASE_LADDER_MS[idx] ?? 300_000;
  let factor = 1;
  try {
    factor = spread();
  } catch {
    factor = 1;
  }
  if (!Number.isFinite(factor) || factor <= 0) factor = 1;
  return Math.round(base * factor);
}
