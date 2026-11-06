/* ─────────────────────────────────────────────────────────────────────────
 * IS THIS A BROWSER PAGE, OR A SERVER RENDERING ONE?
 *
 * Frameworks that render on the server (Angular's server rendering among
 * them) run the app's own code in Node to produce the first HTML, and some of
 * that code is code that starts this kit. There is nothing to measure there —
 * no visitor, no screen, no paint — and anything the kit scheduled would sit
 * in the server process: a timer that holds a render open, a request to
 * Boosthis from a machine that is not the visitor's.
 *
 * So the kit's entry points ask here first and, outside a browser page, do
 * nothing and schedule nothing.
 *
 * Angular says so in a word of its own, `ngServerMode`, and says it in one
 * of two places depending on how the server code was built:
 *
 *   • A production server build REPLACES the bare word with `true` at compile
 *     time (and a browser build with `false`), and writes nothing onto the
 *     global object. This kit ships as source the app's own build compiles,
 *     so the kit's own bare `ngServerMode` is replaced the same way. Reading
 *     only the global misses a standard production server render: the
 *     sample Angular app's proof found the kit starting a live client, timer
 *     and all, inside one.
 *   • Where the build did not replace it — the dev server, packages left
 *     external, Angular's own server platform run without the CLI — Angular
 *     writes it onto the global object around each render instead.
 *
 * So both are read, the bare word first. It is the flag Angular's own
 * packages test in exactly this way; its typings call it internal, and no
 * public signal reaches code that holds no injector. It is believed even
 * where a server polyfills `window` and `document` (some setups do, for
 * libraries that reach for them), because a polyfilled window is not a
 * visitor.
 *
 * A leaf: this module imports nothing.
 * ───────────────────────────────────────────────────────────────────────── */

/** Angular's word. Module-local, so an app's own global declaration of it is
 *  shadowed rather than redeclared; it emits nothing, which leaves the bare
 *  word free for the app's build to replace. */
declare const ngServerMode: boolean | undefined;

/** True while Angular is rendering on the server. Read on every call, never
 *  cached: where Angular writes the word at run time it sets and clears it
 *  around each render. */
export function inServerRender(): boolean {
  try {
    // `typeof` first: in a build that does not know the word (every
    // non-Angular app) the bare read would otherwise throw.
    if (typeof ngServerMode !== "undefined" && ngServerMode === true) return true;
  } catch {
    // fall through to the global object
  }
  try {
    return (globalThis as Record<string, unknown>)["ngServerMode"] === true;
  } catch {
    return false;
  }
}

/** True on a real browser page: a window and a document, and no server
 *  render in progress. */
export function isBrowserPage(): boolean {
  try {
    if (inServerRender()) return false;
    const g = globalThis as Record<string, unknown>;
    const w = g["window"];
    const d = g["document"];
    return (
      w !== null &&
      typeof w === "object" &&
      d !== null &&
      typeof d === "object"
    );
  } catch {
    return false;
  }
}
