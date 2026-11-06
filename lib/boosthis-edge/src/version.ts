/** Version + wire identity of the edge-isolate kit.
 *
 * `RUNTIME_TAG` is the name every install of this kit registers under. It is a
 * single tag on purpose: one kit, one wire name, with the *platform* (Cloudflare
 * Workers, Deno, a hosted edge function) carried alongside it so a project is
 * never mislabelled as an ordinary Node back end and never split into three
 * half-supported runtimes either.
 */

export const RUNTIME_VERSION = "1.0.0-alpha.41" as const;

/** The `installs.runtime` value this kit registers under. Frozen wire name. */
export const RUNTIME_TAG = "edge" as const;

export type Rating = "good" | "needs-work" | "poor";

/** Request-duration bands. Identical to every other server kit (TTI bands), so
 *  a route that rates "good" on Node rates "good" here. */
export const SCORE_THRESHOLDS = {
  tti: { good: 500, poor: 1500 },
} as const;

export function rateDuration(durationMs: number): Rating {
  if (durationMs <= SCORE_THRESHOLDS.tti.good) return "good";
  if (durationMs >= SCORE_THRESHOLDS.tti.poor) return "poor";
  return "needs-work";
}
