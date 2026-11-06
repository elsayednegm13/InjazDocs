/**
 * The build's NODE_ENV, read in ONE place.
 *
 * Two decisions read it: the dev-posture debug flag (devPosture.ts) and the
 * development-page decision (developmentPage.ts). They must read the same
 * flag the same way, so neither keeps a copy of its own.
 *
 * A leaf on purpose — it imports nothing. devPosture.ts sits inside the
 * browser kit's recorded module cycle (lib/kit-module-cycles.json), and the
 * development-page decision is read while the kit is starting up; reaching
 * the flag through devPosture would pull developmentPage.ts into that cycle,
 * where a module caught half-evaluated hands back `undefined` exports without
 * a sound.
 *
 * `process.env.NODE_ENV` is the one Node name a browser bundler replaces with
 * a string literal at build time; when it was not replaced, `process` is
 * absent and this reads as `present: false`.
 */

/** The host's `process`, declared here rather than taken from Node's type
 *  definitions: a browser app compiles this file with the browser's types
 *  alone (a new Angular project lists none), and there the global name is
 *  unknown to the type checker. A declaration emits nothing, so the runtime
 *  reads exactly the global it always read. */
declare const process: { env?: Record<string, string | undefined> } | undefined;

/** `present` is false when `process` (or its env) is absent or unreadable.
 *  Never throws. */
export function readBuildEnv(): { present: boolean; nodeEnv: string | undefined } {
  try {
    const p = (typeof process !== "undefined" ? process : undefined) as
      | { env?: Record<string, string | undefined> }
      | undefined;
    if (!p || !p.env) return { present: false, nodeEnv: undefined };
    const env = p.env["NODE_ENV"];
    return { present: true, nodeEnv: typeof env === "string" ? env : undefined };
  } catch {
    return { present: false, nodeEnv: undefined };
  }
}
